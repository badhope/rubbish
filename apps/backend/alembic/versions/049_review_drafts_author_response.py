"""049 — review report drafts + author response to reviewers

Revision ID: 049_review_drafts_author_response
Revises: 048_submission_drafts
Create Date: 2026-11-15
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "049_review_drafts"
down_revision = "048_submission_drafts"
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
    op.create_table(
        "review_drafts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("reviewer_id", sa.Integer(), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assignment_id"], ["review_assignments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("assignment_id", name="uq_review_draft_assignment"),
    )
    op.create_index("ix_review_drafts_tenant_id", "review_drafts", ["tenant_id"])
    op.create_index("ix_review_drafts_assignment_id", "review_drafts", ["assignment_id"])
    op.create_index("ix_review_drafts_reviewer_id", "review_drafts", ["reviewer_id"])
    _enable_rls("review_drafts")

    op.add_column("submissions", sa.Column("author_response", sa.Text(), nullable=True))
    op.add_column(
        "submissions",
        sa.Column("author_response_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("submissions", "author_response_at")
    op.drop_column("submissions", "author_response")
    _disable_rls("review_drafts")
    op.drop_table("review_drafts")
