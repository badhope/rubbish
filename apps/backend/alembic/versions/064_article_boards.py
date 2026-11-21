"""Rename the forum board tree from research-only terms to article terms.

Slugs stay unchanged so existing topics, bookmarks and links keep working.
Only the visible names and descriptions change; the community still runs the
same "write it down, show the process" product.

Revision ID: 064_article_boards
Revises: 063_submission_classification
Create Date: 2026-11-21
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "064_article_boards"
down_revision = "063_submission_classification"
branch_labels = None
depends_on = None

# slug, name, description
NEW_NAMES = (
    ("research", "文章", "任何想讲清楚的事：选题、过程、观察与讨论"),
    ("planning", "选题与计划", "想写什么、为什么写、打算怎么写"),
    ("lab-notes", "过程记录", "做法、材料、数据、代码与中间结果"),
    ("field-notes", "现场观察", "现场、访谈、体验与观察笔记"),
    ("failures", "失败复盘", "没做成、做错了、推翻重来的记录"),
    ("discussion", "写作讨论", "写法、材料、证据与继续追问"),
    ("life", "创作生活", "写作以外，支撑继续写下去的部分"),
    ("survival", "创作生存", "时间、情绪、工作与写作之间的拉扯"),
)

OLD_NAMES = (
    ("research", "研究", "把问题拆成可做的研究：计划、记录、观察与讨论"),
    ("planning", "研究计划", "还没动手：问题、假设、方法、时间表"),
    ("lab-notes", "实验记录", "实验、数据、代码与过程记录"),
    ("field-notes", "田野观察", "田野、访谈、现场与观察笔记"),
    ("failures", "失败档案", "没做成、做错了、推翻重来的记录"),
    ("discussion", "研究讨论", "方法、证据、结果与继续追问"),
    ("life", "科研生活", "做研究以外，支撑研究继续下去的部分"),
    ("survival", "科研生存", "读研、写作、情绪、时间与钱"),
)


def _apply(rows: tuple[tuple[str, str, str], ...]) -> None:
    bind = op.get_bind()
    # forum_boards is tenant-scoped with FORCE ROW LEVEL SECURITY. Set the
    # tenant context for each tenant before touching its board rows.
    tenant_ids = [
        str(row[0])
        for row in bind.execute(sa.text("SELECT id FROM tenants ORDER BY id")).all()
    ]
    for tenant_id in tenant_ids:
        bind.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tid, false)"),
            {"tid": tenant_id},
        )
        for slug, name, description in rows:
            bind.execute(
                sa.text(
                    "UPDATE forum_boards SET name = :name, description = :description "
                    "WHERE slug = :slug AND tenant_id = :tid"
                ),
                {
                    "slug": slug,
                    "name": name,
                    "description": description,
                    "tid": tenant_id,
                },
            )


def upgrade() -> None:
    _apply(NEW_NAMES)


def downgrade() -> None:
    _apply(OLD_NAMES)
