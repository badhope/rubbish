"""005 — resources.download_count（R 指数所需的下载计数）

R 指数（app/modules/catalog/engagement.py）由三类平台真实事件构成：
阅读次数（reading_history）、下载次数、收藏次数（reading_list_items）。
前两者已有来源，下载此前没有落库，只存在于 Web 服务器访问日志里。

本迁移新增 `downloads` 计数列，默认 0；公开文件端点每次成功返回
PDF 时原子 +1。列非空且带 server_default，对已有行无需回填。

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-22
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "resources",
        sa.Column("download_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("resources", "download_count")
