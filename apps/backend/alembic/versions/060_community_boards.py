"""Rebuild the forum board tree for the absurd-research community.

Revision ID: 060_community_boards
Revises: 059_volume_issue_objects
Create Date: 2026-11-20
"""

from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "060_community_boards"
down_revision = "059_volume_issue_objects"
branch_labels = None
depends_on = None

# slug, parent slug, name, description, sort_order
BOARD_TREE = [
    ("research", None, "研究", "把问题拆成可做的研究：计划、记录、观察与讨论", 0),
    ("planning", "research", "研究计划", "还没动手：问题、假设、方法、时间表", 1),
    ("lab-notes", "research", "实验记录", "实验、数据、代码与过程记录", 2),
    ("field-notes", "research", "田野观察", "田野、访谈、现场与观察笔记", 3),
    ("failures", "research", "失败档案", "没做成、做错了、推翻重来的记录", 4),
    ("discussion", "research", "研究讨论", "方法、证据、结果与继续追问", 5),
    ("life", None, "科研生活", "做研究以外，支撑研究继续下去的部分", 6),
    ("survival", "life", "科研生存", "读研、写作、情绪、时间与钱", 7),
    ("collab", "life", "组队招募", "找合作、找数据、找被试", 8),
    ("site", None, "站务", "社区公告、规则、反馈与举报", 9),
    ("announcements", "site", "社区公告", "官方公告、规则与活动", 10),
    ("feedback", "site", "意见反馈", "产品建议、问题反馈与申诉", 11),
]

# 旧 category -> 新版块 slug。旧帖不删，只搬家。
CATEGORY_MAP = {
    "paper": "discussion",
    "paper-reading": "discussion",
    "paper-repro": "discussion",
    "method": "discussion",
    "writing": "discussion",
    "stats": "discussion",
    "question": "discussion",
    "life": "survival",
    "collab": "collab",
    "meta": "announcements",
    "notice": "announcements",
    "suggestion": "feedback",
}


def upgrade() -> None:
    bind = op.get_bind()
    tenant_rows = bind.execute(sa.text("SELECT id FROM tenants ORDER BY id")).all()
    now = datetime.now(UTC)
    insert_board = sa.text(
        """
        INSERT INTO forum_boards
            (tenant_id, parent_id, slug, name, description, sort_order, is_active, created_at)
        VALUES
            (:tenant_id, :parent_id, :slug, :name, :description, :sort_order, true, :created_at)
        RETURNING id
        """
    )

    for tenant_row in tenant_rows:
        tenant_id = str(tenant_row[0])
        if bind.dialect.name == "postgresql":
            bind.execute(
                sa.text("SELECT set_config('app.current_tenant_id', :tid, false)"),
                {"tid": tenant_id},
            )
        # 旧版块先清空引用再删除；不删除帖子。
        bind.execute(sa.text("UPDATE forum_topics SET board_id = NULL WHERE tenant_id = :tid"), {"tid": tenant_id})
        bind.execute(sa.text("DELETE FROM forum_boards WHERE tenant_id = :tid"), {"tid": tenant_id})

        ids: dict[str, int] = {}
        for slug, parent_slug, name, description, sort_order in BOARD_TREE:
            parent_id = ids.get(parent_slug) if parent_slug else None
            board_id = bind.execute(
                insert_board,
                {
                    "tenant_id": tenant_id,
                    "parent_id": parent_id,
                    "slug": slug,
                    "name": name,
                    "description": description,
                    "sort_order": sort_order,
                    "created_at": now,
                },
            ).scalar_one()
            ids[slug] = int(board_id)

        for old_category, new_slug in CATEGORY_MAP.items():
            bind.execute(
                sa.text(
                    """
                    UPDATE forum_topics
                       SET category = :new_slug,
                           board_id = :board_id
                     WHERE tenant_id = :tid
                       AND category = :old_category
                    """
                ),
                {
                    "new_slug": new_slug,
                    "board_id": ids[new_slug],
                    "tid": tenant_id,
                    "old_category": old_category,
                },
            )

        # 兜底：任何没有归到版块的存量帖进入研究讨论。
        bind.execute(
            sa.text(
                """
                UPDATE forum_topics
                   SET category = 'discussion',
                       board_id = :board_id
                 WHERE tenant_id = :tid
                   AND board_id IS NULL
                """
            ),
            {"board_id": ids["discussion"], "tid": tenant_id},
        )

    bind.execute(sa.text("UPDATE tenants SET tenant_type = 'community' WHERE tenant_type = 'journal'"))


def downgrade() -> None:
    # 版块是运营配置；回到旧树会改变用户已经看到的帖子归属。
    # 保留新树，避免降级时把社区结构再拆回论文栏目。
    pass
