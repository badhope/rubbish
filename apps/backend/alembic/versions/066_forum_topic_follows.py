"""Add ``forum_topic_follows`` for topic-level reply notifications.

Revision ID: 066_forum_topic_follows
Revises: 065_forum_five_boards
Create Date: 2026-11-21
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "066_forum_topic_follows"
down_revision = "065_forum_five_boards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "forum_topic_follows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "topic_id",
            sa.Integer(),
            sa.ForeignKey("forum_topics.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "tenant_id", "user_id", "topic_id", name="uq_forum_topic_follows_tenant_user_topic"
        ),
    )
    op.create_index("ix_forum_topic_follows_user_id", "forum_topic_follows", ["user_id"])
    op.create_index("ix_forum_topic_follows_topic_id", "forum_topic_follows", ["topic_id"])
    op.create_index("ix_forum_topic_follows_tenant_id", "forum_topic_follows", ["tenant_id"])
    op.create_index(
        "ix_forum_topic_follows_tenant_topic",
        "forum_topic_follows",
        ["tenant_id", "topic_id"],
    )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE forum_topic_follows ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE forum_topic_follows FORCE ROW LEVEL SECURITY")
        op.execute(
            """
            CREATE POLICY tenant_isolation ON forum_topic_follows
                USING (tenant_id::text = current_setting('app.current_tenant_id', true))
                WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true))
            """
        )


def downgrade() -> None:
    op.drop_index("ix_forum_topic_follows_tenant_topic", table_name="forum_topic_follows")
    op.drop_index("ix_forum_topic_follows_tenant_id", table_name="forum_topic_follows")
    op.drop_index("ix_forum_topic_follows_topic_id", table_name="forum_topic_follows")
    op.drop_index("ix_forum_topic_follows_user_id", table_name="forum_topic_follows")
    op.drop_table("forum_topic_follows")
