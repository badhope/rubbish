"""010 — 等级体系 / 成就 / 公告 / 质量评分（v1.0 上线）

一次迁移收口四组结构：

1. ``users`` 增列：``xp``（XP 快照）、``rules_ack_version`` / ``rules_ack_at``
   （投稿规范确认留痕）。
2. 新表 ``user_xp_events``（append-only 积分台账）与 ``user_achievements``
   （已解锁勋章）。
3. 新表 ``announcements``（首访公告，带发布窗口）。
4. ``resources`` 增列：``quality_score`` / ``quality_grade`` /
   ``quality_breakdown`` / ``cover_image`` / ``cover_theme``。

所有新表租户列 + RLS 策略，与 007 的 ``_RLS_TABLES`` 同风格。

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
Create Date: 2026-10-27
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "d1e2f3a4b5c6"
down_revision = "c0d1e2f3a4b5"
branch_labels = None
depends_on = None

# 本迁移启用 RLS 的表（for-loop 列表形式，供 test_rls_coverage 识别）。
_RLS_TABLES = ("user_xp_events", "user_achievements", "announcements")


def upgrade() -> None:
    # --- users ---
    op.add_column("users", sa.Column("xp", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("rules_ack_version", sa.String(length=20), nullable=True))
    op.add_column("users", sa.Column("rules_ack_at", sa.DateTime(timezone=True), nullable=True))

    # --- resources ---
    op.add_column("resources", sa.Column("quality_score", sa.Numeric(5, 1), nullable=True))
    op.add_column("resources", sa.Column("quality_grade", sa.String(length=4), nullable=True))
    op.add_column("resources", sa.Column("quality_breakdown", sa.JSON(), nullable=True))
    op.add_column("resources", sa.Column("cover_image", sa.String(length=500), nullable=True))
    op.add_column("resources", sa.Column("cover_theme", sa.String(length=50), nullable=True))

    # --- user_xp_events ---
    op.create_table(
        "user_xp_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("ref_type", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("ref_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "tenant_id", "user_id", "action", "ref_type", "ref_id", name="uq_user_xp_event_identity"
        ),
    )
    op.create_index("ix_user_xp_events_user_id", "user_xp_events", ["user_id"])
    op.create_index("ix_user_xp_events_tenant_id", "user_xp_events", ["tenant_id"])
    op.create_index(
        "ix_user_xp_events_tenant_user_created",
        "user_xp_events",
        ["tenant_id", "user_id", sa.text("created_at DESC")],
    )

    # --- user_achievements ---
    op.create_table(
        "user_achievements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("badge_key", sa.String(length=64), nullable=False),
        sa.Column(
            "unlocked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "tenant_id", "user_id", "badge_key", name="uq_user_achievement_identity"
        ),
    )
    op.create_index("ix_user_achievements_user_id", "user_achievements", ["user_id"])
    op.create_index("ix_user_achievements_tenant_id", "user_achievements", ["tenant_id"])

    # --- announcements ---
    op.create_table(
        "announcements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("level", sa.String(length=16), nullable=False, server_default="info"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "starts_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_announcements_tenant_slug"),
    )
    op.create_index("ix_announcements_tenant_id", "announcements", ["tenant_id"])

    # RLS（SQLite 测试库跳过）
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table in _RLS_TABLES:
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
        for table in _RLS_TABLES:
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
            op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_announcements_tenant_id", table_name="announcements")
    op.drop_table("announcements")
    op.drop_index("ix_user_achievements_tenant_id", table_name="user_achievements")
    op.drop_index("ix_user_achievements_user_id", table_name="user_achievements")
    op.drop_table("user_achievements")
    op.drop_index("ix_user_xp_events_tenant_user_created", table_name="user_xp_events")
    op.drop_index("ix_user_xp_events_tenant_id", table_name="user_xp_events")
    op.drop_index("ix_user_xp_events_user_id", table_name="user_xp_events")
    op.drop_table("user_xp_events")

    op.drop_column("resources", "cover_theme")
    op.drop_column("resources", "cover_image")
    op.drop_column("resources", "quality_breakdown")
    op.drop_column("resources", "quality_grade")
    op.drop_column("resources", "quality_score")

    op.drop_column("users", "rules_ack_at")
    op.drop_column("users", "rules_ack_version")
    op.drop_column("users", "xp")
