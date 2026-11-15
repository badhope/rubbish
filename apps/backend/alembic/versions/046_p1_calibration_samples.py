"""046 — P1 quarterly blind calibration samples

Revision ID: 046_p1_calibration_samples
Revises: 045_p1_triage_reminders
Create Date: 2026-11-15
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "046_p1_calibration_samples"
down_revision = "045_p1_triage_reminders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_calibration_samples",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("quarter", sa.Integer(), nullable=False),
        sa.Column("submission_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("abstract", sa.Text(), nullable=False),
        sa.Column("discipline", sa.String(length=100), nullable=False, server_default=""),
        sa.Column(
            "reviewer_scores",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("consensus_score", sa.Float(), nullable=True),
        sa.Column("score_spread", sa.Float(), nullable=True),
        sa.Column("review_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["submission_id"], ["submissions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "tenant_id",
            "year",
            "quarter",
            "submission_id",
            name="uq_review_calibration_sample_period_submission",
        ),
    )
    op.create_index(
        "ix_review_calibration_samples_year",
        "review_calibration_samples",
        ["year"],
    )
    op.create_index(
        "ix_review_calibration_samples_quarter",
        "review_calibration_samples",
        ["quarter"],
    )
    op.create_index(
        "ix_review_calibration_samples_submission_id",
        "review_calibration_samples",
        ["submission_id"],
    )

    # 与 042/043 同期新表一致：租户隔离必须有第二层 RLS。
    # SQLite 测试库没有 RLS，显式跳过。
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE review_calibration_samples ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE review_calibration_samples FORCE ROW LEVEL SECURITY")
        op.execute(
            """
            CREATE POLICY tenant_isolation ON review_calibration_samples
            USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
            WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON review_calibration_samples")
        op.execute("ALTER TABLE review_calibration_samples NO FORCE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE review_calibration_samples DISABLE ROW LEVEL SECURITY")
    op.drop_table("review_calibration_samples")
