#!/usr/bin/env python3
"""Generate RSS 2.0 feed for ScholarLib papers.

Scans all .bib files, extracts titles/authors/years, and writes a single
RSS feed to docs/public/rss.xml for autodiscovery from the doc site.

Usage:
  python3 scripts/generate_rss.py
"""

import argparse
import html
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "docs" / "public" / "rss.xml"
SITE_URL = "https://badhope.github.io/ScholarLib"
TITLE = "ScholarLib — New Papers"
DESCRIPTION = "Latest open-access papers added to ScholarLib"

# All entries sorted by most recent
MAX_ENTRIES = 50


def parse_bib(content: str) -> dict:
    """Extract title, author, year, and DOI from a BibTeX entry."""
    info = {"title": "", "author": "", "year": "", "doi": ""}
    m = re.search(r"title\s*=\s*[{]+(.+?)[}]+", content, re.DOTALL)
    if m:
        info["title"] = re.sub(r"\s+", " ", m.group(1).strip())
    m = re.search(r"author\s*=\s*[{]+(.+?)[}]+", content, re.DOTALL)
    if m:
        info["author"] = m.group(1).strip()
    m = re.search(r"year\s*=\s*[{]*(\d{4})[}]*", content, re.IGNORECASE)
    if m:
        info["year"] = m.group(1)
    m = re.search(r"doi\s*=\s*[{]+(.+?)[}]+", content, re.DOTALL)
    if m:
        info["doi"] = m.group(1).strip()
    return info


def find_papers() -> list[dict]:
    """Find all .bib files and parse them."""
    papers = []
    for bib_path in sorted(ROOT.glob("papers/**/*.bib")):
        try:
            with open(bib_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except OSError:
            continue
        info = parse_bib(content)
        if not info["title"]:
            continue
        rel = bib_path.relative_to(ROOT)
        # Determine link from path: papers/cs/Machine-Learning/2020/foo/foo.bib
        parts = rel.parts
        if len(parts) >= 2:
            section = parts[1]  # "computer-science" or "economics-management"
        else:
            section = "unknown"
        info["path"] = str(rel)
        info["section"] = section
        papers.append(info)
    return papers


def rfc822_date(t: float) -> str:
    """Format a timestamp as RFC-822 (RSS requires this)."""
    return time.strftime("%a, %d %b %Y %H:%M:%S +0000", time.gmtime(t))


def escape(text: str) -> str:
    """XML-escape text."""
    return html.escape(text or "", quote=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate RSS feed for ScholarLib")
    args = parser.parse_args()

    papers = find_papers()
    if not papers:
        print("No papers found.")
        return 0

    # Sort by year (descending), then by title
    papers.sort(key=lambda p: (p.get("year", "0"), p["title"]), reverse=True)
    papers = papers[:MAX_ENTRIES]

    items_xml = []
    for p in papers:
        link = f"{SITE_URL}/papers/{p['section']}/"
        items_xml.append(
            f"""    <item>
      <title>{escape(p["title"])}</title>
      <link>{link}</link>
      <guid isPermaLink="false">{escape(p["path"])}</guid>
      <author>{escape(p["author"])}</author>
      <pubDate>{rfc822_date(time.time())}</pubDate>
      <category>{escape(p["section"])}</category>
    </item>"""
        )

    feed = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>{escape(TITLE)}</title>
    <link>{SITE_URL}/</link>
    <description>{escape(DESCRIPTION)}</description>
    <language>en-us</language>
    <lastBuildDate>{rfc822_date(time.time())}</lastBuildDate>
    <atom:link href="{SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
{chr(10).join(items_xml)}
  </channel>
</rss>
"""

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(feed, encoding="utf-8")
    print(f"✓ RSS feed written to {OUTPUT.relative_to(ROOT)}")
    print(f"  {len(papers)} items")
    return 0


if __name__ == "__main__":
    sys.exit(main())