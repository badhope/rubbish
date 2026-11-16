"""054 — RLS for tenant tables created outside the alembic chain (P1 #13).

Several tenant-scoped tables never got a second isolation layer:

  * author_claims — 018 created a ``tenant_isolation`` policy (the older
    ``tenant_id::text = current_setting(...)`` variant) but never issued
    ENABLE / FORCE ROW LEVEL SECURITY, so the policy is inert.
  * point_events — created by raw ``CREATE TABLE IF NOT EXISTS`` in 034
    (not op.create_table), no RLS at all.
  * user_levels / email_digest_records / forum_reports — only ever created
    by hand-run ``migrations-sql/*.sql`` on production; absent from the
    alembic chain entirely, so a fresh ``alembic upgrade head`` never built
    them and they had no RLS.

This migration enables ENABLE+FORCE+standard ``::uuid`` tenant_isolation on
all five. For the three chain-absent tables it is **create-if-missing**: on a
fresh database it builds them (matching the ORM models, so the chain produces
a complete schema); on production they already exist, so creation is skipped
and only RLS is added. ``review_scores`` is deliberately excluded — it is a
production-only legacy table whose tenant_id provenance is unverified; see
ops/inspect-review-scores.sh and docs/p1-audit-garbage-tables.md.

Downgrade disables RLS on the five tables but does NOT drop the three
create-if-missing tables: on production they pre-exist this migration and may
hold live data, so dropping them would be destructive. On a fresh chain they
were created empty and leaving them is harmless (re-upgrade skips creation).

Revision ID: 054_missing_table_rls
Revises: 053_coin_force_rls
Create Date: 2026-11-16
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "054_missing_table_rls"
down_revision = "053_coin_force_rls"
branch_labels = None
depends_on = None

# 列表 + for-loop 样式：供 test_rls_coverage 静态门禁识别这五张表的 RLS enable。
_RLS_TABLES = (
    "author_claims",
    "point_events",
    "user_levels",
    "email_digest_records",
    "forum_reports",
)


def _enable_rls(table: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON {table}
        USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
        """
    )


def _disable_rls(table: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")


def _ensure_rls(table: str) -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    # author_claims 已有 018 的同名 text 变体 policy；先 drop 再建标准 ::uuid
    # 变体，避免 CREATE POLICY 撞名。对其余表是幂等清理。
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    _enable_rls(table)


def _create_user_levels() -> None:
    op.create_table(
        "user_levels",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("identity", sa.String(length=16), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "user_id", "identity", name="uq_user_level_identity"),
    )
    op.create_index("ix_user_levels_tenant_id", "user_levels", ["tenant_id"])
    op.create_index("ix_user_levels_user_id", "user_levels", ["user_id"])


def _create_email_digest_records() -> None:
    op.create_table(
        "email_digest_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("recipient_email", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("related_type", sa.String(length=50), nullable=True),
        sa.Column("related_id", sa.String(length=100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_email_digest_records_tenant_id", "email_digest_records", ["tenant_id"])
    op.create_index("ix_email_digest_records_user_id", "email_digest_records", ["user_id"])
    op.create_index("ix_email_digest_records_event_type", "email_digest_records", ["event_type"])
    op.create_index("ix_email_digest_records_status", "email_digest_records", ["status"])
    op.create_index(
        "ix_email_digest_records_user_created", "email_digest_records", ["user_id", "created_at"]
    )


def _create_forum_reports() -> None:
    op.create_table(
        "forum_reports",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("reporter_id", sa.Integer(), nullable=False),
        sa.Column("topic_id", sa.Integer(), nullable=True),
        sa.Column("reply_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["topic_id"], ["forum_topics.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reply_id"], ["forum_replies.id"], ondelete="CASCADE"),
        # 一条举报必须指向帖子或回复（至少其一）。与 migrations-sql DDL 一致；
        # alembic autogenerate 不比较 CHECK，故不影响 alembic check。
        sa.CheckConstraint(
            "topic_id IS NOT NULL OR reply_id IS NOT NULL", name="chk_forum_reports_target"
        ),
    )
    op.create_index("ix_forum_reports_tenant_id", "forum_reports", ["tenant_id"])
    op.create_index("ix_forum_reports_reporter_id", "forum_reports", ["reporter_id"])
    op.create_index("ix_forum_reports_topic_id", "forum_reports", ["topic_id"])
    op.create_index("ix_forum_reports_reply_id", "forum_reports", ["reply_id"])
    op.create_index(
        "ix_forum_reports_tenant_status", "forum_reports", ["tenant_id", "status", "created_at"]
    )


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    # create-if-missing：生产库这三张表已由手工 SQL 建好 → 跳过建表只补 RLS；
    # fresh 链缺失 → 按 ORM 建表，使 alembic upgrade head 产出完整 schema。
    if not insp.has_table("user_levels"):
        _create_user_levels()
    if not insp.has_table("email_digest_records"):
        _create_email_digest_records()
    if not insp.has_table("forum_reports"):
        _create_forum_reports()
    # DDL 之后重新反射，避免 inspector 缓存旧的 has_table 结果。
    insp = sa.inspect(bind)
    for table in _RLS_TABLES:
        if insp.has_table(table):
            _ensure_rls(table)


def downgrade() -> None:
    for table in _RLS_TABLES:
        _disable_rls(table)
    # 刻意不 DROP user_levels / email_digest_records / forum_reports：生产库
    # 它们先于本迁移存在且可能有数据，删表会销毁生产数据。fresh 链上建时为空，
    # 保留无害（re-upgrade 的 create-if-missing 会跳过）。
