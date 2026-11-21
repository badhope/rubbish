"""全站活跃等级（activity level）。

等级只回答“参与了多少”，不回答“能做什么”。
权限走身份轴（成员 / 评审 / 管理），等级走经验轴；
主编和管理员也从 Level 1 开始，只能靠真实参与涨经验。

所有经验都记在 ``user_xp_events``，``users.xp`` 是运行总量；
这里只做纯函数换算，不写库、不参与任何权限判定。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ActivityBand:
    level: int
    floor: int


# 1–10 级；阈值写死，前端 /levels 页展示同一份口径。
ACTIVITY_BANDS: tuple[ActivityBand, ...] = (
    ActivityBand(1, 0),
    ActivityBand(2, 50),
    ActivityBand(3, 150),
    ActivityBand(4, 300),
    ActivityBand(5, 500),
    ActivityBand(6, 800),
    ActivityBand(7, 1200),
    ActivityBand(8, 1700),
    ActivityBand(9, 2300),
    ActivityBand(10, 3000),
)

MAX_LEVEL = ACTIVITY_BANDS[-1].level


def level_for_xp(xp: int) -> int:
    points = max(0, int(xp or 0))
    level = 1
    for band in ACTIVITY_BANDS:
        if points >= band.floor:
            level = band.level
        else:
            break
    return level


def activity_snapshot(xp: int) -> dict[str, object]:
    """当前活跃等级快照；字段名避开身份/权限，避免前端再次混用。"""
    points = max(0, int(xp or 0))
    level = level_for_xp(points)
    index = level - 1
    floor = ACTIVITY_BANDS[index].floor
    next_band = ACTIVITY_BANDS[index + 1] if index + 1 < len(ACTIVITY_BANDS) else None
    ceiling = next_band.floor - 1 if next_band else points
    to_next = max(0, next_band.floor - points) if next_band else 0
    progress = 1.0 if next_band is None else (points - floor) / max(1, (ceiling - floor) + 1)
    return {
        "level": level,
        "max_level": MAX_LEVEL,
        "xp": points,
        "current_floor": floor,
        "current_ceiling": ceiling,
        "next_threshold": next_band.floor if next_band else None,
        "to_next": to_next,
        "progress": progress,
    }


def bands_payload() -> list[dict[str, int]]:
    return [{"level": band.level, "floor": band.floor} for band in ACTIVITY_BANDS]


__all__ = [
    "ACTIVITY_BANDS",
    "MAX_LEVEL",
    "activity_snapshot",
    "bands_payload",
    "level_for_xp",
]
