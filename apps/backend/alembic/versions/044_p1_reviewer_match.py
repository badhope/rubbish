"""044 — P1 reviewer capability tags & author affiliations

Revision ID: 044_p1_reviewer_match
Revises: 043_submission_triage
Create Date: 2026-11-15
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "044_p1_reviewer_match"
down_revision = "043_submission_triage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "reviewer_tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "submissions",
        sa.Column(
            "author_affiliations",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("submissions", "author_affiliations")
    op.drop_column("users", "reviewer_tags")
