"""011 — resources.publish_at（定时发布）

创刊号 267 篇按十期排期：第 1 期已发，其余九期在编辑部后台排队，到日期
自动对公众可见。可见性判定统一收在 ``app/modules/catalog/visibility.py``：
``publication_status='published' AND (publish_at IS NULL OR publish_at <= now())``。

索引：`(tenant_id, publish_at)` 用于「待发期号」列表与公开列表的过滤。
模型侧同名声明该索引，保证 `alembic check` 不报漂移。

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-10-27
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "e2f3a4b5c6d7"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("resources", sa.Column("publish_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_resources_tenant_publish_at", "resources", ["tenant_id", "publish_at"])


def downgrade() -> None:
    op.drop_index("ix_resources_tenant_publish_at", table_name="resources")
    op.drop_column("resources", "publish_at")
