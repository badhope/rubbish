"""059 — volumes and issues as first-class objects

Revision ID: 059_volume_issue_objects
Revises: 058_backfill_orm_drift_columns
Create Date: 2026-11-19

The journal used to store volume/issue only as free-text columns on
``resources``.  That made it impossible to create an empty issue, edit its
title/intro/cover before articles existed, or keep a draft issue invisible.

This migration adds ``volumes`` and ``issues``, backfills them from the
legacy strings, and links each resource through ``resources.issue_id``.
The legacy ``resources.volume`` / ``resources.issue`` columns stay as
compatibility snapshots; application writes update both sides.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "059_volume_issue_objects"
down_revision = "058_backfill_orm_drift_columns"
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
            USING (tenant_id::text = current_setting('app.current_tenant_id', true))
            WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true))
        """
    )


def upgrade() -> None:
    op.create_table(
        "volumes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("cover_image", sa.String(500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "number", name="uq_volumes_tenant_number"),
    )
    op.create_index("ix_volumes_tenant_id", "volumes", ["tenant_id"])

    op.create_table(
        "issues",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("volume_id", sa.Integer(), nullable=False),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("intro", sa.Text(), nullable=True),
        sa.Column("cover_image", sa.String(500), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("publish_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["volume_id"], ["volumes.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "tenant_id", "volume_id", "number", name="uq_issues_tenant_volume_number"
        ),
    )
    op.create_index("ix_issues_tenant_id", "issues", ["tenant_id"])
    op.create_index("ix_issues_volume_id", "issues", ["volume_id"])
    op.create_index("ix_issues_tenant_status", "issues", ["tenant_id", "status"])

    op.add_column("resources", sa.Column("issue_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_resources_issue_id_issues",
        "resources",
        "issues",
        ["issue_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_resources_issue_id", "resources", ["issue_id"])

    # Backfill volumes from legacy strings.
    op.execute(
        """
        INSERT INTO volumes (tenant_id, number, created_at, updated_at)
        SELECT DISTINCT tenant_id, volume, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM resources
        WHERE volume IS NOT NULL AND volume <> ''
        """
    )

    # Backfill issues. An issue with any published resource is live; an issue
    # whose resources are all future-dated is scheduled; otherwise draft.
    op.execute(
        """
        INSERT INTO issues (tenant_id, volume_id, number, status, publish_at, published_at, created_at, updated_at)
        SELECT
            r.tenant_id,
            v.id,
            r.issue,
            CASE
                WHEN MAX(CASE WHEN r.publication_status = 'published' AND (r.publish_at IS NULL OR r.publish_at <= CURRENT_TIMESTAMP) THEN 1 ELSE 0 END) = 1 THEN 'live'
                WHEN MAX(CASE WHEN r.publication_status = 'published' THEN 1 ELSE 0 END) = 1 THEN 'scheduled'
                ELSE 'draft'
            END,
            MIN(r.publish_at),
            CASE WHEN MAX(CASE WHEN r.publication_status = 'published' THEN 1 ELSE 0 END) = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM resources r
        JOIN volumes v ON v.tenant_id = r.tenant_id AND v.number = r.volume
        WHERE r.volume IS NOT NULL AND r.volume <> ''
          AND r.issue IS NOT NULL AND r.issue <> ''
        GROUP BY r.tenant_id, v.id, r.issue
        """
    )

    # Link each resource to its issue.
    op.execute(
        """
        UPDATE resources
        SET issue_id = (
            SELECT i.id
            FROM issues i
            JOIN volumes v ON v.id = i.volume_id AND v.tenant_id = i.tenant_id
            WHERE i.tenant_id = resources.tenant_id
              AND v.number = resources.volume
              AND i.number = resources.issue
            LIMIT 1
        )
        WHERE volume IS NOT NULL AND volume <> ''
          AND issue IS NOT NULL AND issue <> ''
        """
    )

    # Bind manifests to the real issue container as well; the legacy strings
    # remain so old manifests stay readable and reproducible.
    op.add_column("release_manifests", sa.Column("issue_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_release_manifests_issue_id_issues",
        "release_manifests",
        "issues",
        ["issue_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_release_manifests_issue_id", "release_manifests", ["issue_id"])
    op.execute(
        """
        UPDATE release_manifests
        SET issue_id = (
            SELECT i.id
            FROM issues i
            JOIN volumes v ON v.id = i.volume_id AND v.tenant_id = i.tenant_id
            WHERE i.tenant_id = release_manifests.tenant_id
              AND v.number = release_manifests.volume
              AND i.number = release_manifests.issue
            LIMIT 1
        )
        WHERE volume IS NOT NULL AND issue IS NOT NULL
        """
    )

    _enable_rls("volumes")
    _enable_rls("issues")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table in ("issues", "volumes"):
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
            op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_release_manifests_issue_id", table_name="release_manifests")
    op.drop_constraint(
        "fk_release_manifests_issue_id_issues", "release_manifests", type_="foreignkey"
    )
    op.drop_column("release_manifests", "issue_id")
    op.drop_index("ix_resources_issue_id", table_name="resources")
    op.drop_constraint("fk_resources_issue_id_issues", "resources", type_="foreignkey")
    op.drop_column("resources", "issue_id")
    op.drop_index("ix_issues_tenant_status", table_name="issues")
    op.drop_index("ix_issues_volume_id", table_name="issues")
    op.drop_index("ix_issues_tenant_id", table_name="issues")
    op.drop_table("issues")
    op.drop_index("ix_volumes_tenant_id", table_name="volumes")
    op.drop_table("volumes")
