"""Content hygiene at the submission/catalog schema boundary (1.20.13)."""

from __future__ import annotations

from app.core.lists import normalize_string_list
from app.interfaces.http.catalog.schemas import ResourceUpdate
from app.interfaces.http.submission.schemas import SubmissionCreate


def _submission(**overrides: object) -> SubmissionCreate:
    payload: dict[str, object] = {
        "title": "一层一层拆开",
        "type": "paper",
        "authors": ["Lin Wan"],
        "year": 2026,
        "discipline": "社会学",
        "subdiscipline": "民俗学",
        "abstract": "这是一段足够长的摘要，用来验证短预告会被摘要替换，而不是把作者写给编辑看的备注当成卡片文案。",
        "preview": "我希望把我的内容放在学术里，而不是娱乐！",
        "tags": [],
        "keywords": ["地方民俗，文化记忆；灾害社会学、地方民俗"],
        "download_url": None,
        "external_url": None,
    }
    payload.update(overrides)
    return SubmissionCreate(**payload)


def test_normalize_string_list_splits_all_chinese_separators() -> None:
    got = normalize_string_list(["甲，乙；丙、丁", "甲"])
    assert got == ["甲", "乙", "丙", "丁"]


def test_submission_short_preview_falls_back_to_abstract() -> None:
    body = _submission()
    assert body.preview.startswith("这是一段足够长的摘要")
    assert "放在学术里" not in body.preview


def test_submission_keywords_split_and_tags_fall_back_to_taxonomy() -> None:
    body = _submission()
    assert body.keywords == ["地方民俗", "文化记忆", "灾害社会学"]
    assert body.tags == ["社会学", "民俗学"]


def test_submission_keeps_author_tags_and_splits_a_single_string() -> None:
    body = _submission(tags=["腺苷；受体脱敏；衰老"])
    assert body.tags == ["腺苷", "受体脱敏", "衰老"]


def test_resource_update_normalizes_single_string_tags() -> None:
    body = ResourceUpdate(tags=["PADA 假说；光周期；衰老"])
    assert body.tags == ["PADA 假说", "光周期", "衰老"]


def test_resource_update_leaves_none_untouched() -> None:
    body = ResourceUpdate()
    assert body.tags is None
    assert body.keywords is None
