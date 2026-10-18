"""004 — submissions.anonymized_file_url（双盲绕过修复）

双盲评审下，审稿人取稿件有两条通道：

1. ``GET /api/submissions/{id}/files`` —— 此前在双盲下把审稿人
   302 重定向到 ``download_url``；但 ``download_url``/``external_url``
   都是**作者可控**字段（创建端点与作者编辑端点均可写），作者填一条
   带身份信息的链接即可直穿双盲（重定向目标对审稿人可见，页面内容
   更可直接暴露姓名单位）。审稿人视角的 JSON 序列化同样保留了这两个
   作者可控外链。

2. 审稿人视角 JSON —— ``anonymize_submission_fields`` 刻意不抹
   download_url/external_url，注释假设那是"编辑提供的匿名稿"，
   与实际控制面（作者）不符。

本迁移新增**编辑专属**列 ``anonymized_file_url``：只由编辑端点
``PUT /submissions/{id}/anonymized-file`` 写入。双盲下审稿人只被
放行到该列指向的链接；作者可控的 download_url/external_url 从审稿人
视角抹掉。列为可空，无数据回填需要。

Revision ID: d4e5f6a7b8c9
Revises: c5a3e91b7d20
Create Date: 2026-10-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "c5a3e91b7d20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column("anonymized_file_url", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("submissions", "anonymized_file_url")
