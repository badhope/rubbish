"""045 — P1 triage 48h reminders

Revision ID: 045_p1_triage_reminders
Revises: 044_p1_reviewer_match
Create Date: 2026-11-15
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "045_p1_triage_reminders"
down_revision = "044_p1_reviewer_match"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column("triage_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    # 仍在初筛队列里的历史稿件从迁移时刻重新计时，避免上线后一次性
    # 给编辑补发几百条“已等待 48 小时”的旧提醒；已处理稿件保留历史时间。
    #
    # submissions 启用了 FORCE RLS，迁移会话默认没有 app.current_tenant_id，
    # 直接 UPDATE 会被策略静默过滤成 0 行。必须按租户设置事务级 GUC 再回填。
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        tenant_ids = [
            str(row[0]) for row in bind.execute(sa.text("SELECT id FROM tenants")).fetchall()
        ]
        for tenant_id in tenant_ids:
            bind.execute(
                sa.text("SELECT set_config('app.current_tenant_id', :tid, true)"),
                {"tid": tenant_id},
            )
            bind.execute(
                sa.text(
                    """
                    UPDATE submissions
                    SET triage_started_at = CASE
                        WHEN (triage_status IS NULL OR triage_status = 'pending')
                             AND status IN ('pending', 'resubmitted')
                        THEN now()
                        ELSE COALESCE(triaged_at, submitted_at)
                    END
                    WHERE tenant_id = :tid AND triage_started_at IS NULL
                    """
                ),
                {"tid": tenant_id},
            )
    else:
        op.execute(
            """
            UPDATE submissions
            SET triage_started_at = CASE
                WHEN (triage_status IS NULL OR triage_status = 'pending')
                     AND status IN ('pending', 'resubmitted')
                THEN CURRENT_TIMESTAMP
                ELSE COALESCE(triaged_at, submitted_at)
            END
            WHERE triage_started_at IS NULL
            """
        )
    op.add_column(
        "submissions",
        sa.Column("triage_reminded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "submissions",
        sa.Column(
            "triage_reminder_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("submissions", "triage_reminder_count")
    op.drop_column("submissions", "triage_reminded_at")
    op.drop_column("submissions", "triage_started_at")
