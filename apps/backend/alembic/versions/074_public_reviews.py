"""Public peer-review attribution.

Adds ``review_reports.is_anonymous``. True is the safe default: every
historical report was written under the old single-blind assumption, so it
must stay anonymous until the reviewer explicitly opts in. New reports may
set false to publish the reviewer display name next to their comments.

Revision ID: 074_public_reviews
Revises: 073_infra_hardening
Create Date: 2026-11-25
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "074_public_reviews"
down_revision = "073_infra_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_reports",
        sa.Column(
            "is_anonymous",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("review_reports", "is_anonymous")
