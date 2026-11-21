"""全站活跃等级：只看 XP，不参与身份与权限。"""

from __future__ import annotations

from app.domain.gamification.activity import activity_snapshot, level_for_xp


def test_level_thresholds_are_stable_and_capped() -> None:
    assert level_for_xp(0) == 1
    assert level_for_xp(49) == 1
    assert level_for_xp(50) == 2
    assert level_for_xp(149) == 2
    assert level_for_xp(150) == 3
    assert level_for_xp(3000) == 10
    assert level_for_xp(999999) == 10


def test_activity_snapshot_progress_never_negative() -> None:
    snap = activity_snapshot(0)
    assert snap["level"] == 1
    assert snap["xp"] == 0
    assert snap["current_floor"] == 0
    assert 0 <= snap["progress"] <= 1
