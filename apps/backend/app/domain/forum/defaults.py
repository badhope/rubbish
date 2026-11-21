"""The default forum board tree for the community.

Five rooms, all top-level. The old parent/leaf tree created nine empty rooms;
keeping the tree flat makes the list readable and the board picker short.
"""

from __future__ import annotations

# slug, parent slug, name, description, sort_order
BOARD_TREE: tuple[tuple[str, str | None, str, str, int], ...] = (
    ("discussion", None, "写作讨论", "写法、材料、证据与继续追问", 0),
    ("records", None, "记录与复盘", "选题、过程、现场与失败，都放在这里；用标签区分阶段", 1),
    ("collab", None, "组队招募", "找合作、找数据、找同伴", 2),
    ("life", None, "创作生活", "写作以外，支撑继续写下去的部分", 3),
    ("site", None, "站务与反馈", "社区公告、规则、建议与申诉", 4),
)
