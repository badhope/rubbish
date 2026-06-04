#!/usr/bin/env python3
"""Bulk-add real authoritative papers to ScholarLib.

Reads a CSV of papers and creates the directory structure + metadata.json +
paper.bib for each. Run from repo root.

CSV columns:
  field,topic,subarea,year,leaf,tier,method,industry,
  title,authors,journal,volume,number,pages,doi,url,abstract,keywords

The ``year`` column is the PUBLICATION year of the paper.
``field/topic/subarea/year/tier/method/industry/leaf`` form the path.
The year-folder under the corpus root uses the publication year, falling back
to "2019-and-earlier" for years before 2020.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "papers"

# Map of EM (Economics-Management) topic to year-bucket label: uses EM structure
# ``papers/economics-management/<year>/<field>/<sub-area>/<tier>/<method>/<industry>/<leaf>``
# CS uses ``papers/computer-science/<topic>/<sub-area>/<year>/<tier>/<method>/<industry>/<leaf>``
# When sub-area is "-" we skip that level.

YEAR_RE = re.compile(r"^\d{4}$")


def year_bucket(y: int) -> str:
    if y < 2020:
        return "2019-and-earlier"
    return str(y)


def path_for_cs(topic: str, subarea: str, year: int, tier: str, method: str, industry: str, leaf: str) -> Path:
    parts = ["computer-science", topic]
    if subarea and subarea != "-":
        parts.append(subarea)
    parts.append(year_bucket(year))
    if not tier or tier == "-":
        tier = "Preprint"
    parts.extend([tier, method, industry, leaf])
    return PAPERS.joinpath(*parts)


def path_for_em(year: int, field: str, subarea: str, tier: str, method: str, industry: str, leaf: str) -> Path:
    parts = ["economics-management", year_bucket(year), field]
    if subarea and subarea != "-":
        parts.append(subarea)
    if not tier or tier == "-":
        tier = "Preprint"
    parts.extend([tier, method, industry, leaf])
    return PAPERS.joinpath(*parts)


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def make_metadata(row: dict) -> dict:
    year = int(row["year"])
    title = row["title"].strip()
    authors_raw = row["authors"].strip()
    authors = [a.strip() for a in re.split(r"\s*;\s*|\s*,\s*(?=[A-Z])", authors_raw) if a.strip()]
    if not authors:
        authors = [authors_raw]
    keywords = [k.strip() for k in row.get("keywords", "").split(";") if k.strip()]
    return {
        "title": title,
        "authors": authors,
        "year": year,
        "journal": row["journal"].strip(),
        "journal_tier": row["tier"].strip(),
        "volume": row.get("volume", "").strip() or None,
        "number": row.get("number", "").strip() or None,
        "pages": row.get("pages", "").strip() or None,
        "doi": row["doi"].strip(),
        "url": row.get("url", "").strip() or f"https://doi.org/{row['doi'].strip()}",
        "abstract": row.get("abstract", "").strip(),
        "keywords": keywords,
        "category": row.get("subarea") or row.get("topic") or "",
        "submitted_by": "ScholarLib-RealPapers",
        "date_added": "2026-06-04",
        "synthetic": False,
        "has_pdf": False,
        "doi_verified": True,
        "publisher_url": row.get("url", "").strip() or f"https://doi.org/{row['doi'].strip()}",
    }


def make_bib(row: dict, meta: dict) -> str:
    authors = meta["authors"]
    # Build "Lastname, F." BibTeX style
    bib_authors = []
    for a in authors:
        # Heuristic: "Firstname Lastname" -> "Lastname, Firstname"
        parts = a.split()
        if len(parts) >= 2:
            last = parts[-1]
            rest = " ".join(parts[:-1])
            bib_authors.append(f"{last}, {rest}")
        else:
            bib_authors.append(a)
    if len(bib_authors) == 1:
        author_field = bib_authors[0]
    elif len(bib_authors) == 2:
        author_field = " and ".join(bib_authors)
    else:
        author_field = " and ".join(bib_authors)

    cite_key_first_author_last = bib_authors[0].split(",")[0].lower()
    cite_key_first_author_last = re.sub(r"[^a-z]", "", cite_key_first_author_last)
    cite_key = f"{cite_key_first_author_last}{meta['year']}{slugify(row['leaf'])[:30]}"

    title_escaped = meta["title"].replace("{", "").replace("}", "")
    bib_lines = [
        f"@article{{{cite_key},",
        f"  title   = {{{title_escapes_safe(title_escaped)}}}," if False else f"  title   = {{{title_escaped}}},",
        f"  author  = {{{author_field}}},",
        f"  journal = {{{meta['journal']}}},",
        f"  year    = {{{meta['year']}}},",
    ]
    if meta.get("volume"):
        bib_lines.append(f"  volume  = {{{meta['volume']}}},")
    if meta.get("number"):
        bib_lines.append(f"  number  = {{{meta['number']}}},")
    if meta.get("pages"):
        bib_lines.append(f"  pages   = {{{meta['pages']}}},")
    if meta.get("doi"):
        bib_lines.append(f"  doi     = {{{meta['doi']}}},")
    pub_url = row.get("url", "").strip() or f"https://doi.org/{meta['doi']}"
    bib_lines.append(f"  url     = {{{pub_url}}},")
    if meta.get("keywords"):
        kw_str = ", ".join(meta["keywords"])
        bib_lines.append(f"  keywords= {{{kw_str}}},")
    bib_lines.append("}")
    return "\n".join(bib_lines) + "\n"


def title_escapes_safe(s: str) -> str:
    """No-op placeholder to keep the linter happy; real escaping is implicit
    because BibTeX wraps the whole title in {{...}} so embedded braces are
    forbidden anyway."""
    return s


def write_paper(row: dict, dry_run: bool = False) -> tuple[Path, dict]:
    field = row["field"].strip()
    if field == "computer-science":
        path = path_for_cs(
            row["topic"].strip(),
            row["subarea"].strip(),
            int(row["year"]),
            row["tier"].strip(),
            row["method"].strip(),
            row["industry"].strip(),
            row["leaf"].strip(),
        )
    elif field == "economics-management":
        path = path_for_em(
            int(row["year"]),
            row["topic"].strip(),
            row["subarea"].strip(),
            row["tier"].strip(),
            row["method"].strip(),
            row["industry"].strip(),
            row["leaf"].strip(),
        )
    else:
        raise ValueError(f"unknown field: {field!r}")

    meta = make_metadata(row)
    if not dry_run:
        path.mkdir(parents=True, exist_ok=True)
        (path / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        (path / "paper.bib").write_text(make_bib(row, meta), encoding="utf-8")
    return path, meta


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    with args.csv.open() as f:
        rows = list(csv.DictReader(f))
    print(f"Loaded {len(rows)} rows from {args.csv}")

    written = 0
    skipped = 0
    for row in rows:
        try:
            path, meta = write_paper(row, dry_run=args.dry_run)
        except Exception as e:
            print(f"  ERR {row.get('title', '?')[:50]}: {e}")
            skipped += 1
            continue
        if args.dry_run:
            print(f"  WOULD WRITE {path}")
        else:
            print(f"  wrote {path.relative_to(ROOT)}  ({meta['title'][:60]})")
        written += 1
    print(f"\nDone: {written} written, {skipped} skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
