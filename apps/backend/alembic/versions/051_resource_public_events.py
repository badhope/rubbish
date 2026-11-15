"""051 — public correction / retraction / version log

Revision ID: 051_resource_public_events
Revises: 050_content_declarations
Create Date: 2026-11-15
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "051_resource_public_events"
down_revision = "050_content_declarations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resource_public_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "resource_id",
            sa.Integer(),
            sa.ForeignKey("resources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_resource_public_events_resource",
        "resource_public_events",
        ["resource_id", "created_at"],
    )
    op.create_index(
        "ix_resource_public_events_tenant_id",
        "resource_public_events",
        ["tenant_id"],
    )
    op.create_index(
        "ix_resource_public_events_tenant_type",
        "resource_public_events",
        ["tenant_id", "event_type"],
    )
    op.create_foreign_key(
        "fk_resource_public_events_tenant_id_tenants",
        "resource_public_events",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.execute("ALTER TABLE resource_public_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE resource_public_events FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON resource_public_events "
        "USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) "
        "WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)"
    )


def downgrade() -> None:
    op.drop_index("ix_resource_public_events_tenant_type", table_name="resource_public_events")
    op.drop_index("ix_resource_public_events_tenant_id", table_name="resource_public_events")
    op.drop_index("ix_resource_public_events_resource", table_name="resource_public_events")
    op.drop_table("resource_public_events")
