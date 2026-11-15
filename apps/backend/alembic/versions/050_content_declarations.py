"""050 — structured academic declarations and per-article license

Revision ID: 050_content_declarations
Revises: 049_review_drafts
Create Date: 2026-11-15
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "050_content_declarations"
down_revision = "049_review_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("resources", "submissions"):
        op.add_column(table, sa.Column("license", sa.String(length=100), nullable=True))
        op.add_column(table, sa.Column("author_contributions", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("funding", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("coi_statement", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("data_availability", sa.Text(), nullable=True))


def downgrade() -> None:
    for table in ("submissions", "resources"):
        op.drop_column(table, "data_availability")
        op.drop_column(table, "coi_statement")
        op.drop_column(table, "funding")
        op.drop_column(table, "author_contributions")
        op.drop_column(table, "license")
