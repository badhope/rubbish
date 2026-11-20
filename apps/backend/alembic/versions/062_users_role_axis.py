"""Add users.role for databases created from the Alembic chain.

The role column was introduced on the production database by a manual
role-axis migration, so fresh CI databases created from Alembic never had
it. Keep this idempotent: production already has the column and must not
fail when the migration is applied there.

Revision ID: 062_users_role_axis
Revises: 061_forum_fiction_flag
Create Date: 2026-11-20
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import context, op

revision = "062_users_role_axis"
down_revision = "061_forum_fiction_flag"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if context.is_offline_mode():
        # Offline SQL generation is PostgreSQL-only; this mirrors the column
        # that production already has, without requiring a live inspector.
        op.execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'user'"
        )
        return
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "role" not in columns:
        op.add_column(
            "users",
            sa.Column("role", sa.String(length=32), nullable=False, server_default="user"),
        )


def downgrade() -> None:
    # The column is part of the current authorization model. Removing it here
    # would break production data, so this migration is intentionally one-way.
    pass
