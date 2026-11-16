"""Submission 题录的规范化模型（不新增数据库列）。

线上 `submissions` 已经有 title / authors / author_affiliations / abstract /
keywords / doi / funding / clc_code / license 这些列，缺的是“把自由文本
作者串拆成姓名 + 单位序号 + 通讯标记”的确定性规则。这个模块集中定义规则，
供版本快照、Studio 预览与排版 PDF 复用，避免三处各猜一套。

同时提供 `--` 分隔的副标题拆分。输出只依赖入参，可安全写入 JSON 快照。
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

_AUTHOR_SUP = re.compile(r"^([^0-9*]+?)\s*([0-9,，\s]*)(\*?)$")


def split_title(title: str) -> tuple[str, str]:
    parts = re.split(r"\s*——\s*", title or "", maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return (title or "").strip(), ""


def normalize_affiliations(value: str | Iterable[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw = re.split(r"[\n；;]+", value)
    else:
        raw = []
        for item in value:
            raw.extend(re.split(r"[\n；;]+", str(item)))
    out = []
    for line in raw:
        line = re.sub(r"^\s*[0-9]+[.、)]\s*", "", str(line)).strip()
        if line:
            out.append(line)
    return out


def parse_author(raw: str) -> dict[str, Any]:
    raw = (raw or "").strip()
    m = _AUTHOR_SUP.match(raw)
    if m and (m.group(2).strip() or m.group(3)):
        numbers = [
            int(n)
            for n in re.split(r"[，,\s]+", m.group(2).strip())
            if n.isdigit()
        ]
        return {
            "name": m.group(1).strip(),
            "affiliations": numbers,
            "corresponding": bool(m.group(3)),
        }
    return {"name": raw, "affiliations": [], "corresponding": False}


def build_manuscript_meta(
    *,
    title: str,
    authors: Iterable[str] | None,
    affiliations: str | Iterable[str] | None,
    abstract: str = "",
    keywords: Iterable[str] | None = None,
    doi: str | None = None,
    funding: str | None = None,
    clc: str | None = None,
    license: str | None = None,
    track: str = "paper",
) -> dict[str, Any]:
    main, subtitle = split_title(title)
    author_list = [parse_author(a) for a in (authors or []) if str(a).strip()]
    return {
        "title": {"main": main, "subtitle": subtitle},
        "authors": author_list,
        "affiliations": normalize_affiliations(affiliations),
        "abstract": abstract or "",
        "keywords": [str(k).strip() for k in (keywords or []) if str(k).strip()],
        "doi": doi or None,
        "funding": funding or None,
        "clc": clc or None,
        "license": license or None,
        "track": "essay" if track == "essay" else "paper",
    }
