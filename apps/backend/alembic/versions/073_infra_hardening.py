"""Infrastructure hardening: upload scanning, publication digest, RLS.

Revision ID: 073_infra_hardening
Revises: 072_forum_sla
Create Date: 2026-11-25
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "073_infra_hardening"
down_revision = "072_forum_sla"
branch_labels = None
depends_on = None


def _enable_rls(table: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON {table}
        USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
        """
    )


def _disable_rls(table: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")


def upgrade() -> None:
    # --- upload malware scan state -----------------------------------------
    for column in (
        sa.Column("file_scan_status", sa.String(length=20), nullable=True),
        sa.Column("file_scan_engine", sa.String(length=40), nullable=True),
        sa.Column("file_scan_signature", sa.String(length=200), nullable=True),
        sa.Column("file_scan_detail", sa.Text(), nullable=True),
        sa.Column("file_scan_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("file_scan_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("file_sha256", sa.String(length=64), nullable=True),
    ):
        op.add_column("submissions", column)
    op.create_index("ix_submissions_file_scan_status", "submissions", ["file_scan_status"])

    for column in (
        sa.Column("file_scan_status", sa.String(length=20), nullable=True),
        sa.Column("file_scan_engine", sa.String(length=40), nullable=True),
        sa.Column("file_scan_signature", sa.String(length=200), nullable=True),
        sa.Column("file_scan_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("file_scan_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("file_sha256", sa.String(length=64), nullable=True),
    ):
        op.add_column("submission_versions", column)
    op.create_index(
        "ix_submission_versions_file_scan_status",
        "submission_versions",
        ["file_scan_status"],
    )

    # --- daily publication digest queue + idempotency -----------------------
    op.create_table(
        "publication_digest_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["resource_id"], ["resources.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "tenant_id",
            "user_id",
            "resource_id",
            name="uq_publication_digest_item_user_resource",
        ),
    )
    op.create_index(
        "ix_publication_digest_items_tenant_id",
        "publication_digest_items",
        ["tenant_id"],
    )
    op.create_index(
        "ix_publication_digest_items_user_pending",
        "publication_digest_items",
        ["user_id", "delivered_at"],
    )
    op.create_index(
        "ix_publication_digest_items_tenant_created",
        "publication_digest_items",
        ["tenant_id", "created_at"],
    )
    _enable_rls("publication_digest_items")

    op.create_table(
        "publication_digest_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("digest_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="queued"),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("email_record_id", sa.Integer(), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["email_record_id"], ["email_digest_records.id"], ondelete="SET NULL"
        ),
        sa.UniqueConstraint(
            "tenant_id",
            "user_id",
            "digest_date",
            name="uq_publication_digest_user_date",
        ),
    )
    op.create_index(
        "ix_publication_digest_deliveries_tenant_id",
        "publication_digest_deliveries",
        ["tenant_id"],
    )
    op.create_index(
        "ix_publication_digest_user_id",
        "publication_digest_deliveries",
        ["user_id"],
    )
    op.create_index(
        "ix_publication_digest_tenant_date",
        "publication_digest_deliveries",
        ["tenant_id", "digest_date"],
    )
    _enable_rls("publication_digest_deliveries")


def downgrade() -> None:
    _disable_rls("publication_digest_items")
    op.drop_index(
        "ix_publication_digest_items_tenant_created",
        table_name="publication_digest_items",
    )
    op.drop_index(
        "ix_publication_digest_items_user_pending",
        table_name="publication_digest_items",
    )
    op.drop_index(
        "ix_publication_digest_items_tenant_id",
        table_name="publication_digest_items",
    )
    op.drop_table("publication_digest_items")

    _disable_rls("publication_digest_deliveries")
    op.drop_index(
        "ix_publication_digest_tenant_date",
        table_name="publication_digest_deliveries",
    )
    op.drop_index("ix_publication_digest_user_id", table_name="publication_digest_deliveries")
    op.drop_index(
        "ix_publication_digest_deliveries_tenant_id",
        table_name="publication_digest_deliveries",
    )
    op.drop_table("publication_digest_deliveries")

    op.drop_index(
        "ix_submission_versions_file_scan_status",
        table_name="submission_versions",
    )
    for column in (
        "file_sha256",
        "file_scan_attempts",
        "file_scan_at",
        "file_scan_signature",
        "file_scan_engine",
        "file_scan_status",
    ):
        op.drop_column("submission_versions", column)

    op.drop_index("ix_submissions_file_scan_status", table_name="submissions")
    for column in (
        "file_sha256",
        "file_scan_attempts",
        "file_scan_at",
        "file_scan_detail",
        "file_scan_signature",
        "file_scan_engine",
        "file_scan_status",
    ):
        op.drop_column("submissions", column)
