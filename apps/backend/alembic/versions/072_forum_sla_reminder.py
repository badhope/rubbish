"""Forum moderation SLA reminder marker.

Revision ID: 072_forum_sla
Revises: 071_workflow_closure
Create Date: 2026-11-25
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "072_forum_sla"
down_revision = "071_workflow_closure"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "forum_topics",
        sa.Column("sla_reminded_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("forum_topics", "sla_reminded_at")
