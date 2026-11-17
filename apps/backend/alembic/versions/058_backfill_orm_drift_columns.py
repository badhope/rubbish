"""058 — backfill columns the ORM already declares but no migration created

Revision ID: 058_backfill_orm_drift_columns
Revises: 057_user_reviewer_disciplines
Create Date: 2026-11-16

submissions.article_section / issue_part、resources 特刊四列、
forum_topics.paper_id 早已进入 ORM，但迁移链从未建列：全新库
alembic upgrade head 后运行期 INSERT 直接 UndefinedColumn。
测试走 create_all 掩盖了该缺口。此处补齐；inspector 守卫兼容
已手工补列的库（幂等）。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "058_backfill_orm_drift_columns"
down_revision = "057_user_reviewer_disciplines"
branch_labels = None
depends_on = None

_COLUMNS: tuple[tuple[str, sa.Column], ...] = (
    ("submissions", sa.Column("article_section", sa.String(40), nullable=True)),
    ("submissions", sa.Column("issue_part", sa.String(40), nullable=True)),
    ("forum_topics", sa.Column("paper_id", sa.Integer(), nullable=True)),
    (
        "resources",
        sa.Column(
            "is_special_issue",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    ),
    ("resources", sa.Column("special_issue_reason", sa.Text(), nullable=True)),
    ("resources", sa.Column("special_issue_by", sa.Integer(), nullable=True)),
    (
        "resources",
        sa.Column("special_issue_at", sa.DateTime(timezone=True), nullable=True),
    ),
)

_INDEXES: tuple[tuple[str, str], ...] = (
    ("submissions", "ix_submissions_article_section"),
    ("submissions", "ix_submissions_issue_part"),
    ("forum_topics", "ix_forum_topics_paper_id"),
    ("resources", "ix_resources_is_special_issue"),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {
        table: {c["name"] for c in inspector.get_columns(table)}
        for table, _ in _COLUMNS
    }
    for table, column in _COLUMNS:
        if column.name not in existing[table]:
            op.add_column(table, column)
    for table, index in _INDEXES:
        if not inspector.has_index(table, index):
            op.create_index(index, table, [index.removeprefix(f"ix_{table}_")])


def downgrade() -> None:
    for table, index in reversed(_INDEXES):
        op.drop_index(index, table_name=table)
    for table, column in reversed(_COLUMNS):
        op.drop_column(table, column.name)
