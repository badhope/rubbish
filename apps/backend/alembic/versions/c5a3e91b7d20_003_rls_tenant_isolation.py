"""003 — PostgreSQL 行级安全（RLS）落地（安全修复 P0-2）

架构文档与多处代码注释一直把 RLS 描述为"租户隔离的第二层防线"，
但 001 迁移里**一条 RLS 语句都没有**（唯一的 op.execute 是 pg_trgm 扩展），
注释引用的 014/021/022 迁移在仓库中并不存在（历史迁移被压缩时丢失）。
也就是说：``alembic upgrade head`` 产出的库完全没有 RLS，隔离实际只剩
应用层 ``WHERE tenant_id`` —— 而这层过滤一旦漏写就是跨租户数据泄露。

本迁移为每张 ``TenantScopedMixin`` 表补上：

* ``ENABLE ROW LEVEL SECURITY``
* ``FORCE ROW LEVEL SECURITY``（连表属主也受约束，否则应用以属主身份
  连接时 RLS 会被整条旁路，等于没上）
* 一条 ``tenant_isolation`` 策略，读写都以会话 GUC
  ``app.current_tenant_id`` 为准。

GUC 由 ``app.core.db._reissue_tenant_guc`` 在每个事务 BEGIN 后注入；
未设置 GUC 时 ``current_setting(..., true)`` 返回 NULL，比较结果为 false，
表现为 fail-closed（查不到任何行），不会意外放行。

配套要求（否则 RLS 一上就会"什么都查不到"）：
* bootstrap 必须设置 ``TENANT_CONTEXT_VAR``（见 app/core/bootstrap.py）；
* 多租户模式下未解析出租户的请求会 fail-closed，这是预期行为。

Revision ID: c5a3e91b7d20
Revises: b7f1c0d2a934
Create Date: 2026-10-18
"""

from __future__ import annotations

from alembic import op

revision = "c5a3e91b7d20"
down_revision = "b7f1c0d2a934"
branch_labels = None
depends_on = None

# 所有继承 TenantScopedMixin 的表（与 app/models 及各模块 models 保持一致）。
# 顺序无关，但按字母排列便于 review。
TENANT_TABLES = (
    "author_follows",
    "discipline_subscriptions",
    "disciplines",
    "doi_registrations",
    "file_assets",
    "notifications",
    "reading_history",
    "reading_list_items",
    "reading_lists",
    "resources",
    "review_assignments",
    "review_reports",
    "roles",
    "subdisciplines",
    "submission_versions",
    "submissions",
    "tenant_hosts",
    "user_roles",
    "users",
)


def upgrade() -> None:
    bind = op.get_bind()
    # SQLite（测试后端）没有 RLS；这里必须显式跳过，否则测试库直接报错。
    if bind.dialect.name != "postgresql":
        return

    for table in TENANT_TABLES:
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
    if bind.dialect.name != "postgresql":
        return

    for table in TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
