"""Workflow closure: rework deadlines, withdrawal, version bodies and email retry.

Revision ID: 071_workflow_closure
Revises: 070_forum_moderation_pipeline
Create Date: 2026-11-25
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "071_workflow_closure"
down_revision = "070_forum_moderation_pipeline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- submission rework loop -------------------------------------------
    op.add_column(
        "submissions",
        sa.Column("rework_due_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "submissions",
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "submissions",
        sa.Column("withdrawn_reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "submissions",
        sa.Column("rework_requirements", sa.JSON(), nullable=True),
    )
    op.create_index("ix_submissions_rework_due_at", "submissions", ["rework_due_at"])
    op.create_index("ix_submissions_withdrawn_at", "submissions", ["withdrawn_at"])

    # --- version body snapshot for honest diffs ---------------------------
    op.add_column(
        "submission_versions",
        sa.Column("body", sa.Text(), nullable=True),
    )

    # --- email outbox/ledger retry fields ---------------------------------
    op.add_column(
        "email_digest_records",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "email_digest_records",
        sa.Column("channel", sa.String(length=20), nullable=False, server_default="default"),
    )
    op.add_column(
        "email_digest_records",
        sa.Column("html", sa.Text(), nullable=True),
    )
    op.add_column(
        "email_digest_records",
        sa.Column("last_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "email_digest_records",
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "email_digest_records",
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "email_digest_records",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE email_digest_records SET updated_at = COALESCE(updated_at, created_at)")
    op.alter_column(
        "email_digest_records",
        "updated_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )
    op.create_index(
        "ix_email_digest_records_status_retry",
        "email_digest_records",
        ["status", "next_retry_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_email_digest_records_status_retry", table_name="email_digest_records")
    op.drop_column("email_digest_records", "updated_at")
    op.drop_column("email_digest_records", "sent_at")
    op.drop_column("email_digest_records", "next_retry_at")
    op.drop_column("email_digest_records", "last_error")
    op.drop_column("email_digest_records", "html")
    op.drop_column("email_digest_records", "attempts")
    op.drop_column("submission_versions", "body")
    op.drop_index("ix_submissions_withdrawn_at", table_name="submissions")
    op.drop_index("ix_submissions_rework_due_at", table_name="submissions")
    op.drop_column("submissions", "rework_requirements")
    op.drop_column("submissions", "withdrawn_reason")
    op.drop_column("submissions", "withdrawn_at")
    op.drop_column("submissions", "rework_due_at")
