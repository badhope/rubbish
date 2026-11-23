"""Add visibility to reading lists (public/private, default private).

Existing lists are backfilled to ``private`` by the column server default, so
owner-only behavior is preserved for historical data. The column is NOT NULL;
downgrade drops it entirely (the public/private split is a read-layer concern).

Revision ID: 068_reading_list_visibility
Revises: 067_resource_editorial_fields
Create Date: 2026-11-23
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "068_reading_list_visibility"
down_revision = "067_resource_editorial_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reading_lists",
        sa.Column(
            "visibility",
            sa.String(length=20),
            nullable=False,
            server_default="private",
        ),
    )
    op.create_index("ix_reading_lists_visibility", "reading_lists", ["visibility"])


def downgrade() -> None:
    op.drop_index("ix_reading_lists_visibility", table_name="reading_lists")
    op.drop_column("reading_lists", "visibility")
