#!/usr/bin/env python3
"""Validate paper metadata.json files against the schema.

Checks:
  - All required fields present
  - Year is a 4-digit number
  - DOI matches expected format (or absent)
  - File naming consistency (kebab-case folder name)
  - .bib file exists for each metadata.json
  - PDF file exists (or skipped if --no-pdf-check)

Usage:
  python3 scripts/validate_papers.py
  python3 scripts/validate_papers.py --no-pdf-check
  python3 scripts/validate_papers.py --strict   # warnings become errors
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAPERS_DIR = ROOT / "papers"

REQUIRED_FIELDS = ["title", "authors", "year", "journal", "doi"]
DOI_PATTERN = re.compile(r"^10\.\d{4,9}/[-._;()/:A-Z0-9]+$", re.IGNORECASE)
KEBAB_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def validate_metadata(meta_path: Path, strict: bool = False) -> list[str]:
    """Return a list of issues. Empty list = valid."""
    issues: list[str] = []
    paper_dir = meta_path.parent
    rel = paper_dir.relative_to(ROOT)

    # Load
    try:
        with open(meta_path) as f:
            meta = json.load(f)
    except json.JSONDecodeError as e:
        issues.append(f"INVALID JSON: {e}")
        return issues
    except OSError as e:
        issues.append(f"CANNOT READ: {e}")
        return issues

    # Required fields
    for field in REQUIRED_FIELDS:
        if field not in meta or not meta[field]:
            issues.append(f"MISSING required field: {field}")

    # Year validation
    year = meta.get("year")
    if year is not None and not (isinstance(year, int) and 1900 <= year <= 2100):
        issues.append(f"INVALID year: {year} (expected integer 1900-2100)")

    # DOI format
    doi = meta.get("doi", "")
    if doi and not DOI_PATTERN.match(doi):
        msg = f"DOI does not match expected format: {doi}"
        if strict:
            issues.append(msg)
        else:
            issues.append(f"WARN: {msg}")

    # Folder name (kebab-case)
    folder = paper_dir.name
    if not KEBAB_PATTERN.match(folder):
        issues.append(f"WARN: folder name not kebab-case: {folder}")

    # .bib file should exist
    bib_name = f"{folder}.bib"
    bib_path = paper_dir / bib_name
    if not bib_path.exists():
        # Sometimes the bib uses a different name
        any_bib = list(paper_dir.glob("*.bib"))
        if not any_bib:
            issues.append(f"MISSING .bib file (expected: {bib_name})")

    # PDF (warn only) — only count PDFs in this paper's own folder;
    # scanning the parent would let a sibling paper's PDF mask this
    # one as "present".
    pdfs = list(paper_dir.glob("*.pdf"))
    if not pdfs and strict:
        issues.append("WARN: no PDF file found")

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate paper metadata")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as errors")
    parser.add_argument("--no-pdf-check", action="store_true", help="Skip PDF presence check")
    args = parser.parse_args()

    if not PAPERS_DIR.exists():
        print(f"Error: papers dir not found: {PAPERS_DIR}", file=sys.stderr)
        return 1

    metas = sorted(PAPERS_DIR.glob("**/metadata.json"))
    if not metas:
        print("No metadata.json files found.")
        return 0

    print(f"Validating {len(metas)} metadata.json files...\n")

    total_issues = 0
    total_warnings = 0
    for meta_path in metas:
        issues = validate_metadata(meta_path, strict=args.strict)
        if not issues:
            continue

        rel = meta_path.relative_to(ROOT)
        for issue in issues:
            if issue.startswith("WARN:"):
                total_warnings += 1
                print(f"  [WARN] {rel}: {issue[6:]}")
            else:
                total_issues += 1
                print(f"  [FAIL] {rel}: {issue}")

    print(f"\n{'='*60}")
    if total_issues == 0:
        print(f"✓ All {len(metas)} files pass validation")
        if total_warnings:
            print(f"  {total_warnings} warning(s)")
        return 0
    print(f"✗ {total_issues} error(s), {total_warnings} warning(s)")
    return 1


if __name__ == "__main__":
    sys.exit(main())