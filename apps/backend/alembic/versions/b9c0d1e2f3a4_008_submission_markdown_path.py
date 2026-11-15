"""008 — submissions.markdown_path（在线阅读用 Markdown 稿件）

在线阅读不再依赖浏览器端 PDF 渲染：上传 PDF/Word 后服务端自动转换为
Markdown 存储（转换失败静默降级，阅读器回退 PDF 视图），PDF 原件保留为
下载通道。列可空——历史稿件与转换失败的稿件为 None。

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-10-24
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "b9c0d1e2f3a4"
down_revision = "a8b9c0d1e2f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("submissions", sa.Column("markdown_path", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("submissions", "markdown_path")
