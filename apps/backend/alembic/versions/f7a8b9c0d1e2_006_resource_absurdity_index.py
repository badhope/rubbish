"""006 — resources.absurdity_index（编辑部评定的荒诞指数）

Rubbish 兼收正经与荒诞研究。荒诞指数是编辑部对单篇内容「离谱程度」
的评定值（0–10，一位小数），与 R 指数（互动热度）相互独立：
R 指数衡量读者注意力，荒诞指数衡量内容气质。列可空——正经论文
可以不评定；对用户隐藏口径，仅在卡片与详情页展示等级徽章。

Revision ID: f7a8b9c0d1e2
Revises: e5f6a7b8c9d0
Create Date: 2026-10-24
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "f7a8b9c0d1e2"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("resources", sa.Column("absurdity_index", sa.Numeric(4, 1), nullable=True))


def downgrade() -> None:
    op.drop_column("resources", "absurdity_index")
