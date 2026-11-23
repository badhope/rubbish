"""Add purpose to email_login_codes so registration codes cannot be consumed by login.

Revision ID: 069_registration_email_codes
Revises: 068_reading_list_visibility
Create Date: 2026-11-23
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "069_registration_email_codes"
down_revision = "068_reading_list_visibility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "email_login_codes",
        sa.Column(
            "purpose",
            sa.String(length=16),
            nullable=False,
            server_default="login",
        ),
    )
    op.create_index(
        "ix_email_login_codes_tenant_email_purpose_created",
        "email_login_codes",
        ["tenant_id", "email", "purpose", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_email_login_codes_tenant_email_purpose_created",
        table_name="email_login_codes",
    )
    op.drop_column("email_login_codes", "purpose")
