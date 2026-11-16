"""057 — reviewer controlled discipline tags

Revision ID: 057_user_reviewer_disciplines
Revises: 056_drop_legacy_backup_tables
Create Date: 2026-11-16

审稿人自选学科标签（受控词表 Discipline.slug 数组），与自由文本
reviewer_tags 并存：前者用于与稿件 discipline 精确匹配，后者补充
交叉/新兴方向。加列不新建表，无需新增 RLS 策略。
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "057_user_reviewer_disciplines"
down_revision = "056_drop_legacy_backup_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "reviewer_disciplines",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "reviewer_disciplines")
