"""007 — comments（读者评论区）

已刊出文章的公开评论区：游客可读，登录用户可发，作者可删自己的，
管理员可删任何人的（审计记录 comment.delete）。硬删不软删——
保留"撤稿保留声明"原则的对称面：评论不是文献记录，删了就是删了，
审计日志里留痕即可。

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-10-24
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "a8b9c0d1e2f3"
down_revision = "f7a8b9c0d1e2"
branch_labels = None
depends_on = None

# 本迁移启用 RLS 的表（命名列表形式，供 tests/test_rls_coverage.py 的
# 检测器按 for-loop 样式识别）。
_RLS_TABLES = ("comments", "audit_logs")


def upgrade() -> None:
    op.create_table(
        "comments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "resource_id",
            sa.Integer(),
            sa.ForeignKey("resources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_comments_tenant_resource_created",
        "comments",
        ["tenant_id", "resource_id", sa.text("created_at DESC")],
    )
    op.create_index("ix_comments_resource_id", "comments", ["resource_id"])
    op.create_index("ix_comments_user_id", "comments", ["user_id"])
    op.create_index("ix_comments_tenant_id", "comments", ["tenant_id"])

    # 与 003 相同的租户隔离策略（SQLite 测试库跳过）。
    # 顺带补齐 audit_logs：001 建表时带 tenant_id，但 003 的启用清单
    # 漏掉了它——RLS 覆盖门禁此前检测不到 003 的启用方式，这个缺口
    # 一直没被发现。应用层始终显式过滤 tenant_id，故补策略无行为回退。
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
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON comments")
        op.execute("ALTER TABLE comments NO FORCE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE comments DISABLE ROW LEVEL SECURITY")
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON audit_logs")
        op.execute("ALTER TABLE audit_logs NO FORCE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_comments_tenant_id", table_name="comments")
    op.drop_index("ix_comments_user_id", table_name="comments")
    op.drop_index("ix_comments_resource_id", table_name="comments")
    op.drop_index("ix_comments_tenant_resource_created", table_name="comments")
    op.drop_table("comments")
