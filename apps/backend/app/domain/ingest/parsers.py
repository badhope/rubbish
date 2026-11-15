"""Bibliographic parsers — BibTeX / RIS / CSV / JSON → list[IngestResource].

Each parser returns ``(resources, errors)`` where ``errors`` carries
per-entry failures with a 1-based line/index number. A parser only
raises when the whole input is unparseable (the route layer maps that
to 422); per-entry problems never raise.

Author / tag separators are aligned with the export module
(``" and "`` for authors, ``"; "`` for tags) so a CSV produced by
``GET /api/export?format=csv`` round-trips through ``POST /api/ingest/parse``.
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Mapping
from typing import Any

import bibtexparser
import rispy
from bibtexparser.bparser import BibTexParser
from pydantic import ValidationError

from app.domain.ingest.types import IngestResource, ParseError

# BibTeX entry type → IngestResourceType. Anything unmapped falls back
# to ``DEFAULT_TYPE`` so an exotic ``@misc{...}`` still imports cleanly.
BIBTEX_TYPE_MAP: dict[str, str] = {
    "article": "paper",
    "inproceedings": "paper",
    "conference": "paper",
    "incollection": "paper",
    "techreport": "paper",
    "unpublished": "preprint",
    "book": "book",
    "booklet": "book",
    "proceedings": "book",
    "manual": "book",
    "phdthesis": "thesis",
    "mastersthesis": "thesis",
}

# RIS ``type_of_reference`` → IngestResourceType.
RIS_TYPE_MAP: dict[str, str] = {
    "JOUR": "paper",
    "CHAP": "paper",
    "CONF": "paper",
    "RPRT": "paper",
    "GEN": "paper",
    "BOOK": "book",
    "THES": "thesis",
    "UNPB": "preprint",
    "ELEC": "preprint",
    "DATA": "dataset",
}

DEFAULT_TYPE = "paper"
AUTHOR_SEP = " and "
TAG_SEP = "; "


def _parse_year(raw: Any) -> int | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        # Some BibTeX entries use "to appear" or similar; treat as unknown.
        return None


def _split_authors(raw: Any) -> list[str]:
    if not raw:
        return []
    return [a.strip() for a in str(raw).split(AUTHOR_SEP) if a.strip()]


def _split_tags(raw: Any) -> list[str]:
    if not raw:
        return []
    # BibTeX ``keywords`` field is comma- or semicolon-separated.
    text = str(raw).replace(",", ";")
    return [t.strip() for t in text.split(";") if t.strip()]


def _format_validation_error(exc: ValidationError) -> str:
    errors = exc.errors()
    if not errors:
        return "validation error"
    first = errors[0]
    field = ".".join(str(p) for p in first.get("loc", ()))
    msg = first.get("msg", "invalid value")
    return f"{field}: {msg}" if field else msg


def parse_bibtex(content: str) -> tuple[list[IngestResource], list[ParseError]]:
    """Parse a BibTeX string into resources + per-entry errors."""
    parser = BibTexParser()
    parser.ignore_nonstandard_types = False
    try:
        db = bibtexparser.loads(content, parser=parser)
    except Exception as exc:
        return [], [ParseError(line=1, error=f"BibTeX parse failed: {exc}")]

    resources: list[IngestResource] = []
    errors: list[ParseError] = []
    for idx, entry in enumerate(db.entries, start=1):
        try:
            resources.append(_bibtex_entry_to_resource(entry))
        except ValidationError as exc:
            errors.append(ParseError(line=idx, error=_format_validation_error(exc)))
        except ValueError as exc:
            errors.append(ParseError(line=idx, error=str(exc)))
    return resources, errors


def _bibtex_entry_to_resource(entry: Mapping[str, str]) -> IngestResource:
    title = (entry.get("title") or "").strip()
    if not title:
        raise ValueError("missing title")

    authors = _split_authors(entry.get("author"))
    if not authors:
        raise ValueError("missing authors")

    entry_type = (entry.get("ENTRYTYPE") or "").lower().strip()
    resource_type = BIBTEX_TYPE_MAP.get(entry_type, DEFAULT_TYPE)

    venue = entry.get("journal") or entry.get("booktitle")
    return IngestResource(
        title=title,
        type=resource_type,
        authors=authors,
        year=_parse_year(entry.get("year")),
        venue=venue.strip() if venue else None,
        discipline="unknown",
        tags=_split_tags(entry.get("keywords")),
        abstract=(entry.get("abstract") or "").strip(),
        doi=(entry.get("doi") or "").strip() or None,
    )


def parse_ris(content: str) -> tuple[list[IngestResource], list[ParseError]]:
    """Parse an RIS string into resources + per-entry errors."""
    try:
        entries = rispy.loads(content)
    except Exception as exc:
        return [], [ParseError(line=1, error=f"RIS parse failed: {exc}")]

    resources: list[IngestResource] = []
    errors: list[ParseError] = []
    for idx, entry in enumerate(entries, start=1):
        try:
            resources.append(_ris_entry_to_resource(entry))
        except ValidationError as exc:
            errors.append(ParseError(line=idx, error=_format_validation_error(exc)))
        except ValueError as exc:
            errors.append(ParseError(line=idx, error=str(exc)))
    return resources, errors


def _ris_entry_to_resource(entry: Mapping[str, Any]) -> IngestResource:
    title = (entry.get("title") or "").strip()
    if not title:
        raise ValueError("missing title")

    raw_authors = entry.get("authors") or []
    authors = [a.strip() for a in raw_authors if a and a.strip()]
    if not authors:
        raise ValueError("missing authors")

    ris_type = (entry.get("type_of_reference") or "GEN").strip().upper()
    resource_type = RIS_TYPE_MAP.get(ris_type, DEFAULT_TYPE)

    venue = entry.get("journal_name") or entry.get("secondary_title") or entry.get("publisher")
    return IngestResource(
        title=title,
        type=resource_type,
        authors=authors,
        year=_parse_year(entry.get("year")),
        venue=venue.strip() if isinstance(venue, str) else None,
        discipline="unknown",
        tags=list(entry.get("keywords") or []),
        abstract=(entry.get("abstract") or "").strip(),
        doi=(entry.get("doi") or "").strip() or None,
    )


# CSV column aliases. Aligned with the export module's ``_CSV_COLUMNS``
# so a CSV produced by ``GET /api/export?format=csv`` re-imports cleanly.
# We accept any subset; missing optional columns fall back to defaults.
_JSON_FIELDS = (
    "title",
    "type",
    "authors",
    "year",
    "venue",
    "discipline",
    "subdiscipline",
    "tags",
    "abstract",
    "doi",
    "publisher",
    "volume",
    "issue",
    "pages",
    "issn",
    "short_container_title",
)


def parse_json(content: str) -> tuple[list[IngestResource], list[ParseError]]:
    """Parse the JSON array emitted by ``GET /api/export?format=json``.

    Also accepts a single record object or an API-style wrapper with ``data``
    / ``items``; this keeps exported batches re-importable without a bespoke
    converter. Extra export-only fields (source_id, external_url, keywords)
    are ignored by ``IngestResource``.
    """
    try:
        root = json.loads(content)
    except json.JSONDecodeError as exc:
        return [], [ParseError(line=1, error=f"JSON parse failed: {exc}")]

    if isinstance(root, list):
        records: list[Any] = root
    elif isinstance(root, dict) and isinstance(root.get("data"), list):
        records = root["data"]
    elif isinstance(root, dict) and isinstance(root.get("items"), list):
        records = root["items"]
    elif isinstance(root, dict):
        records = [root]
    else:
        return [], [ParseError(line=1, error="JSON must be an object or an array of objects")]

    resources: list[IngestResource] = []
    errors: list[ParseError] = []
    for idx, row in enumerate(records, start=1):
        try:
            resources.append(_json_record_to_resource(row))
        except ValidationError as exc:
            errors.append(ParseError(line=idx, error=_format_validation_error(exc)))
        except ValueError as exc:
            errors.append(ParseError(line=idx, error=str(exc)))
    return resources, errors


def _json_record_to_resource(row: Any) -> IngestResource:
    if not isinstance(row, Mapping):
        raise ValueError("JSON entry must be an object")

    payload: dict[str, Any] = {}
    for field in _JSON_FIELDS:
        value = row.get(field)
        if value is not None:
            payload[field] = value

    authors = payload.get("authors")
    if isinstance(authors, str):
        payload["authors"] = _split_authors(authors)
    tags = payload.get("tags")
    if isinstance(tags, str):
        payload["tags"] = _split_tags(tags)
    payload.setdefault("type", DEFAULT_TYPE)
    payload.setdefault("discipline", "unknown")
    if "abstract" not in payload:
        payload["abstract"] = ""
    return IngestResource(**payload)


_CSV_ALLOWED_TYPES = {
    "paper",
    "book",
    "journal",
    "preprint",
    "thesis",
    "dataset",
    "tutorial",
}


CSV_IGNORE_TARGET = "__ignore__"

CSV_FIELD_TARGETS = {
    "title",
    "type",
    "authors",
    "year",
    "venue",
    "discipline",
    "subdiscipline",
    "tags",
    "abstract",
    "doi",
    "publisher",
    "volume",
    "issue",
    "pages",
    "issn",
    "short_container_title",
}

# 常见导出/手工表头的别名。键统一按 _normalize_header() 归一化。
CSV_HEADER_ALIASES = {
    "title": "title",
    "标题": "title",
    "题名": "title",
    "name": "title",
    "authors": "authors",
    "author": "authors",
    "作者": "authors",
    "作者列表": "authors",
    "year": "year",
    "年份": "year",
    "年": "year",
    "type": "type",
    "类型": "type",
    "venue": "venue",
    "journal": "venue",
    "期刊": "venue",
    "来源": "venue",
    "刊物": "venue",
    "discipline": "discipline",
    "学科": "discipline",
    "领域": "discipline",
    "subdiscipline": "subdiscipline",
    "子学科": "subdiscipline",
    "tags": "tags",
    "keywords": "tags",
    "关键词": "tags",
    "标签": "tags",
    "abstract": "abstract",
    "摘要": "abstract",
    "doi": "doi",
    "publisher": "publisher",
    "出版方": "publisher",
    "出版社": "publisher",
    "volume": "volume",
    "卷": "volume",
    "issue": "issue",
    "期": "issue",
    "pages": "pages",
    "页码": "pages",
    "issn": "issn",
    "short_container_title": "short_container_title",
    "journal_abbrev": "short_container_title",
    "简称": "short_container_title",
}


def _normalize_header(name: str) -> str:
    return name.strip().lstrip("\ufeff").lower().replace("-", "_").replace(" ", "_")


def _resolve_column_map(
    fieldnames: list[str],
    column_map: Mapping[str, str] | None,
) -> dict[str, str]:
    """把原始表头映射到 IngestResource 字段，拒绝未知字段和重复目标。"""
    resolved: dict[str, str] = {}
    used: set[str] = set()

    if column_map:
        unknown_headers = [raw for raw in column_map if raw not in fieldnames]
        if unknown_headers:
            raise ValueError(f"column_map 指向不存在的表头: {', '.join(unknown_headers)}")
        for raw, target in column_map.items():
            if target == CSV_IGNORE_TARGET:
                # 显式忽略的列必须压住别名回退，否则用户选了“忽略”仍会被自动映射。
                resolved[raw] = ""
                continue
            if target not in CSV_FIELD_TARGETS:
                raise ValueError(f"不支持的目标字段: {target}")
            if target in used:
                raise ValueError(f"多个表头映射到同一字段: {target}")
            resolved[raw] = target
            used.add(target)

    for raw in fieldnames:
        if raw in resolved:
            continue
        target = CSV_HEADER_ALIASES.get(_normalize_header(raw))
        if target is None or target in used:
            continue
        resolved[raw] = target
        used.add(target)

    return resolved


def parse_csv(
    content: str,
    column_map: Mapping[str, str] | None = None,
) -> tuple[list[IngestResource], list[ParseError]]:
    """Parse a CSV string (header row + one entry per row).

    ``column_map`` maps raw header names to canonical IngestResource fields.
    Headers omitted from an explicit map still get the built-in alias fallback,
    so a partial user map does not silently drop obvious columns.
    """
    reader = csv.DictReader(io.StringIO(content))
    if reader.fieldnames is None:
        return [], [ParseError(line=1, error="empty CSV: no header row")]

    try:
        resolved = _resolve_column_map(reader.fieldnames, column_map)
    except ValueError as exc:
        return [], [ParseError(line=1, error=str(exc))]

    resources: list[IngestResource] = []
    errors: list[ParseError] = []
    # Header is line 1, so the first data row is line 2.
    for line_no, row in enumerate(reader, start=2):
        try:
            resources.append(_csv_row_to_resource(row, resolved))
        except ValidationError as exc:
            errors.append(ParseError(line=line_no, error=_format_validation_error(exc)))
        except ValueError as exc:
            errors.append(ParseError(line=line_no, error=str(exc)))
    return resources, errors


def _csv_row_to_resource(
    row: Mapping[str, str | None],
    column_map: Mapping[str, str] | None = None,
) -> IngestResource:
    mapping = column_map or {}
    by_target: dict[str, str] = {}
    for raw, target in mapping.items():
        value = (row.get(raw) or "").strip()
        if value and target:
            by_target[target] = value

    def get(name: str) -> str:
        return by_target.get(name) or (row.get(name) or "").strip()

    title = get("title")
    if not title:
        raise ValueError("missing title")

    authors = _split_authors(get("authors"))
    if not authors:
        raise ValueError("missing authors")

    type_str = get("type") or DEFAULT_TYPE
    if type_str not in _CSV_ALLOWED_TYPES:
        raise ValueError(f"invalid type: {type_str}")

    tag_text = get("tags")
    tags = _split_tags(tag_text) if tag_text else []

    return IngestResource(
        title=title,
        type=type_str,
        authors=authors,
        year=_parse_year(get("year")),
        venue=get("venue") or None,
        discipline=get("discipline") or "unknown",
        subdiscipline=get("subdiscipline") or None,
        tags=tags,
        abstract=get("abstract"),
        doi=get("doi") or None,
        publisher=get("publisher") or None,
        volume=get("volume") or None,
        issue=get("issue") or None,
        pages=get("pages") or None,
        issn=get("issn") or None,
        short_container_title=get("short_container_title") or None,
    )


__all__ = [
    "AUTHOR_SEP",
    "BIBTEX_TYPE_MAP",
    "CSV_FIELD_TARGETS",
    "CSV_HEADER_ALIASES",
    "CSV_IGNORE_TARGET",
    "DEFAULT_TYPE",
    "RIS_TYPE_MAP",
    "TAG_SEP",
    "parse_bibtex",
    "parse_csv",
    "parse_ris",
]
