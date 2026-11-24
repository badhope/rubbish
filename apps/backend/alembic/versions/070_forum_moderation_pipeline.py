"""Add deterministic moderation fields, manual review audit and tenant rules.

Revision ID: 070_forum_moderation_pipeline
Revises: 069_registration_email_codes
Create Date: 2026-11-24
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "070_forum_moderation_pipeline"
down_revision = "069_registration_email_codes"
branch_labels = None
depends_on = None

_NEW_RLS_TABLES = ("forum_moderation_events", "forum_moderation_settings")


def upgrade() -> None:
    op.add_column(
        "forum_topics",
        sa.Column(
            "moderation_status", sa.String(length=24), nullable=False, server_default="published"
        ),
    )
    op.add_column(
        "forum_topics",
        sa.Column("risk_score", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "forum_topics",
        sa.Column("moderation_signals", sa.JSON(), nullable=True),
    )
    op.add_column("forum_topics", sa.Column("manual_review_reason", sa.Text(), nullable=True))
    op.add_column(
        "forum_topics", sa.Column("review_eta_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "forum_topics",
        sa.Column(
            "reviewed_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "forum_topics", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "forum_topics", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index("ix_forum_topics_moderation_status", "forum_topics", ["moderation_status"])
    # 存量主题一律视为已发布，published_at 回填创建时间，避免历史内容消失。
    op.execute(
        "UPDATE forum_topics SET moderation_status = 'published', "
        "published_at = COALESCE(published_at, created_at) "
        "WHERE moderation_status IS NULL OR published_at IS NULL"
    )

    op.create_table(
        "forum_moderation_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "topic_id",
            sa.Integer(),
            sa.ForeignKey("forum_topics.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(length=24), nullable=False),
        sa.Column("from_status", sa.String(length=24), nullable=True),
        sa.Column("to_status", sa.String(length=24), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_forum_moderation_events_topic_id", "forum_moderation_events", ["topic_id"])
    op.create_index("ix_forum_moderation_events_actor_id", "forum_moderation_events", ["actor_id"])
    op.create_index(
        "ix_forum_moderation_events_tenant_id", "forum_moderation_events", ["tenant_id"]
    )
    op.create_index(
        "ix_forum_moderation_events_tenant_topic_created",
        "forum_moderation_events",
        ["tenant_id", "topic_id", "created_at"],
    )

    op.create_table(
        "forum_moderation_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("auto_publish_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("manual_threshold", sa.Integer(), nullable=False, server_default="40"),
        sa.Column("sla_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("weights", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_forum_moderation_settings_tenant_id", "forum_moderation_settings", ["tenant_id"]
    )
    op.create_unique_constraint(
        "uq_forum_moderation_settings_tenant", "forum_moderation_settings", ["tenant_id"]
    )

    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table in _NEW_RLS_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
                USING (tenant_id::text = current_setting('app.current_tenant_id', true))
                WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true))
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table in _NEW_RLS_TABLES:
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
            op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.drop_constraint(
        "uq_forum_moderation_settings_tenant",
        "forum_moderation_settings",
        type_="unique",
    )
    op.drop_index("ix_forum_moderation_settings_tenant_id", table_name="forum_moderation_settings")
    op.drop_table("forum_moderation_settings")
    op.drop_index(
        "ix_forum_moderation_events_tenant_topic_created", table_name="forum_moderation_events"
    )
    op.drop_index("ix_forum_moderation_events_tenant_id", table_name="forum_moderation_events")
    op.drop_index("ix_forum_moderation_events_actor_id", table_name="forum_moderation_events")
    op.drop_index("ix_forum_moderation_events_topic_id", table_name="forum_moderation_events")
    op.drop_table("forum_moderation_events")
    op.drop_index("ix_forum_topics_moderation_status", table_name="forum_topics")
    op.drop_column("forum_topics", "published_at")
    op.drop_column("forum_topics", "reviewed_at")
    op.drop_column("forum_topics", "reviewed_by")
    op.drop_column("forum_topics", "review_eta_at")
    op.drop_column("forum_topics", "manual_review_reason")
    op.drop_column("forum_topics", "moderation_signals")
    op.drop_column("forum_topics", "risk_score")
    op.drop_column("forum_topics", "moderation_status")
