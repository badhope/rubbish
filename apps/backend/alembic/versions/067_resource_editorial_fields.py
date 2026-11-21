"""Add editorial fields to ``resources``.

Revision ID: 067_resource_editorial_fields
Revises: 066_forum_topic_follows
Create Date: 2026-11-21
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "067_resource_editorial_fields"
down_revision = "066_forum_topic_follows"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 只加可空列：历史 274 篇不需要重写；推荐池由编辑部逐篇填入。
    op.add_column("resources", sa.Column("short_title", sa.String(length=120), nullable=True))
    op.add_column("resources", sa.Column("editor_note", sa.Text(), nullable=True))
    op.add_column("resources", sa.Column("discussion_prompt", sa.Text(), nullable=True))
    op.add_column("resources", sa.Column("featured_rank", sa.Integer(), nullable=True))
    op.add_column("resources", sa.Column("reading_path", sa.String(length=20), nullable=True))
    op.create_index("ix_resources_featured_rank", "resources", ["featured_rank"])


def downgrade() -> None:
    op.drop_index("ix_resources_featured_rank", table_name="resources")
    op.drop_column("resources", "reading_path")
    op.drop_column("resources", "featured_rank")
    op.drop_column("resources", "discussion_prompt")
    op.drop_column("resources", "editor_note")
    op.drop_column("resources", "short_title")
