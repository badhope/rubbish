"""The default forum board tree for the absurd-research community.

Kept in one place for new tenants. Migration 060 carries the same tree for
existing tenants, but migrations are immutable and intentionally duplicate it.
"""

from __future__ import annotations

# slug, parent slug, name, description, sort_order
BOARD_TREE: tuple[tuple[str, str | None, str, str, int], ...] = (
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
)
