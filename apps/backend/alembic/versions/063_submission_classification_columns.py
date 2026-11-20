"""Add submission classification columns that existed only on production.

`clc_code`, `clc_label`, and `content_track` were added to the production
database by manual SQL during the classification work. Fresh databases built
from Alembic therefore failed when the ORM inserted a submission. Keep the
migration idempotent so production is unaffected.

Revision ID: 063_submission_classification
Revises: 062_users_role_axis
Create Date: 2026-11-20
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import context, op

revision = "063_submission_classification"
down_revision = "062_users_role_axis"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("clc_code", sa.String(length=20)),
    ("clc_label", sa.String(length=80)),
    ("content_track", sa.String(length=8)),
)


def upgrade() -> None:
    if context.is_offline_mode():
        for name, column_type in _COLUMNS:
            op.execute(
                f"ALTER TABLE submissions ADD COLUMN IF NOT EXISTS {name} "
                f"{column_type.compile(dialect=op.get_context().dialect)}"
            )
        return
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("submissions")}
    for name, column_type in _COLUMNS:
        if name not in existing:
            op.add_column("submissions", sa.Column(name, column_type, nullable=True))


def downgrade() -> None:
    # These columns are part of the current submission payload; dropping them
    # would discard production data, so this migration is one-way.
    pass
