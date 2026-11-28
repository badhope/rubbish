"""Anchor a forum topic to a quoted passage of its linked work.

Revision ID: 077_forum_topic_passages
Revises: 076_forum_moderation_tuning
Create Date: 2026-11-28

A margin thread keeps the reader's selection as the author's original words
(``passage_quote``) plus a little context on either side, so the reading page
can find the same sentence again even when it occurs more than once. The
columns are nullable: every existing topic simply has no passage.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "077_forum_topic_passages"
down_revision = "076_forum_moderation_tuning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("forum_topics", sa.Column("passage_quote", sa.Text(), nullable=True))
    op.add_column("forum_topics", sa.Column("passage_prefix", sa.String(length=64), nullable=True))
    op.add_column("forum_topics", sa.Column("passage_suffix", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("forum_topics", "passage_suffix")
    op.drop_column("forum_topics", "passage_prefix")
    op.drop_column("forum_topics", "passage_quote")
