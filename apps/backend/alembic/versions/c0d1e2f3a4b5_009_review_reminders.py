"""009 — review_assignments reminder tracking.

自动催办（0.8.0）需要两个字段：最近催办时间（幂等窗口）与累计次数
（编辑侧可见「已催 N 次」）。两列均可空/默认 0，对历史数据无需回填。

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-10-24
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "c0d1e2f3a4b5"
down_revision = "b9c0d1e2f3a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_assignments",
        sa.Column("last_reminded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "review_assignments",
        sa.Column("reminder_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("review_assignments", "reminder_count")
    op.drop_column("review_assignments", "last_reminded_at")
