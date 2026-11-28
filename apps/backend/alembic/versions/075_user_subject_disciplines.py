"""075 — user subject disciplines

Revision ID: 075_user_subject_disciplines
Revises: 074_public_reviews
Create Date: 2026-11-28

用户的科目领域（受控词表 Discipline.slug 数组），与审稿领域
reviewer_disciplines 分开：前者可在公开主页展示，后者只参与互评匹配
和站务审阅，不进入公开响应。加列不新建表，无需新增 RLS 策略。
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "075_user_subject_disciplines"
down_revision = "074_public_reviews"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "subject_disciplines",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "subject_disciplines")
