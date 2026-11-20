"""Add the fiction marker to forum topics.

Revision ID: 061_forum_fiction_flag
Revises: 060_community_boards
Create Date: 2026-11-20
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "061_forum_fiction_flag"
down_revision = "060_community_boards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "forum_topics",
        sa.Column("is_fictional", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("forum_topics", "is_fictional")
