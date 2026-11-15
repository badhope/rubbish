"""012 — users.bio + role_applications（申请审稿人）

用户资料自定义：``users.bio`` 一句话简介（≤200 字，可空），设置页可编辑，
个人中心与评论区可展示。

职员角色申请：``role_applications`` 记录读者申请 L5 审稿人 / L6 资深
审稿人的队列。L1–L6 逐级晋升的申请链路由本表承载；L7–L9（编辑职）
仍只接受编辑部直接提拔，不开放申请。状态机 pending → approved/rejected
（终态，重申需新开一行）；批准时由 API 层授角色 + 站内通知 + 审计。

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-10-30
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "f3a4b5c6d7e8"
down_revision = "e2f3a4b5c6d7"
branch_labels = None
depends_on = None

_RLS_TABLES = ("role_applications",)


def upgrade() -> None:
    op.add_column("users", sa.Column("bio", sa.String(length=200), nullable=True))
    op.create_table(
        "role_applications",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # reviewer | senior_reviewer —— L7 以上不开放申请（schema 层校验）
        sa.Column("target_role", sa.String(32), nullable=False),
        # pending | approved | rejected（终态；重申 = 新行）
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("decided_by", sa.Integer(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_role_applications_tenant_id", "role_applications", ["tenant_id"])
    op.create_index("ix_role_applications_user_id", "role_applications", ["user_id"])
    op.create_index(
        "ix_role_applications_tenant_status_created",
        "role_applications",
        ["tenant_id", "status", sa.text("created_at DESC")],
    )
    # 同一用户同一角色最多一条待审申请（并发双击兜底）；终态可并列多条历史。
    op.create_index(
        "uq_role_applications_pending",
        "role_applications",
        ["tenant_id", "user_id", "target_role"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
        sqlite_where=sa.text("status = 'pending'"),
    )

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
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON role_applications")
        op.execute("ALTER TABLE role_applications NO FORCE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE role_applications DISABLE ROW LEVEL SECURITY")
    op.drop_index("uq_role_applications_pending", table_name="role_applications")
    op.drop_index("ix_role_applications_tenant_status_created", table_name="role_applications")
    op.drop_index("ix_role_applications_user_id", table_name="role_applications")
    op.drop_index("ix_role_applications_tenant_id", table_name="role_applications")
    op.drop_table("role_applications")
    op.drop_column("users", "bio")
