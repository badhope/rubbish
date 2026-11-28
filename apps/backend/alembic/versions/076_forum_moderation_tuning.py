"""076 — forum moderation priority weights and gray rules

Revision ID: 076_forum_moderation_tuning
Revises: 075_user_subject_disciplines
Create Date: 2026-11-28

队列排序从“只看风险分”改成风险分与等待时长可配置权重；灰度规则按分区
或角色收紧人工阈值。两列都有默认值，存量租户不需要补数据。
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "076_forum_moderation_tuning"
down_revision = "075_user_subject_disciplines"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "forum_moderation_settings",
        sa.Column("priority_risk_weight", sa.Integer(), nullable=False, server_default="10"),
    )
    op.add_column(
        "forum_moderation_settings",
        sa.Column("priority_age_weight", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "forum_moderation_settings",
        sa.Column(
            "gray_rules",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("forum_moderation_settings", "gray_rules")
    op.drop_column("forum_moderation_settings", "priority_age_weight")
    op.drop_column("forum_moderation_settings", "priority_risk_weight")
