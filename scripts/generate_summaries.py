#!/usr/bin/env python3
"""AI Paper Summary Generator for ScholarLib.

Reads paper metadata.json + .bib files, sends to Claude API, generates
a concise structured summary, and saves as <paper>/summary-v1.md.

Usage:
  export CLAUDE_API_KEY=sk-ant-...
  python3 scripts/generate_summaries.py --dry-run              # preview only
  python3 scripts/generate_summaries.py --topic machine-learning --limit 5
  python3 scripts/generate_summaries.py --all --limit 10        # 10 papers across all topics

Requirements: pip install anthropic
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    from anthropic import Anthropic
except ImportError:
    print("Error: anthropic not installed. Run: pip install anthropic")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
PAPERS_DIR = ROOT / "papers"
SUMMARY_FILENAME = "summary-v1.md"

SUMMARY_PROMPT = """You are an expert academic summarizer. Given a paper's metadata and abstract, produce a concise, structured summary in Markdown.

Use this exact format:

# {Paper Title}

**Authors**: {list}
**Year**: {year}
**Journal**: {journal}

## What problem does it solve?

Two sentences max.

## Key method/approach

Two to three sentences.

## Main findings

Two to three sentences.

## Why it matters

One sentence.

## Keywords

{comma-separated list}

Keep it under 200 words total. Write in English. No introduction or closing phrases — just the content.
"""


def find_papers(topic_filter: str | None = None) -> list[Path]:
    """Find all paper directories (ones containing metadata.json)."""
    files = sorted(PAPERS_DIR.glob("**/metadata.json"))
    if topic_filter:
        files = [f for f in files if f"/{topic_filter}/" in str(f)]
    return [f.parent for f in files]


def has_summary(paper_dir: Path) -> bool:
    return (paper_dir / SUMMARY_FILENAME).exists()


def read_paper(paper_dir: Path) -> dict | None:
    """Read metadata.json for a paper."""
    meta_path = paper_dir / "metadata.json"
    if not meta_path.exists():
        return None
    try:
        with open(meta_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def build_prompt(meta: dict) -> str:
    """Build the input text for the LLM from metadata."""
    title = meta.get("title", "Unknown Title")
    authors = ", ".join(meta.get("authors", [])) if isinstance(meta.get("authors"), list) else meta.get("authors", "Unknown")
    year = meta.get("year", "Unknown")
    journal = meta.get("journal", "Unknown")
    abstract = meta.get("abstract", meta.get("description", "No abstract available."))
    keywords = ", ".join(meta.get("keywords", [])) if isinstance(meta.get("keywords"), list) else meta.get("keywords", "")

    return f"""Paper metadata:
Title: {title}
Authors: {authors}
Year: {year}
Journal: {journal}
DOI: {meta.get('doi', 'N/A')}

Abstract:
{abstract}

Keywords: {keywords}

---
Generate a structured summary following the required format."""


def generate_summary(client: Anthropic, meta: dict) -> str | None:
    """Call Claude API to generate summary."""
    prompt = build_prompt(meta)
    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=512,
            temperature=0.3,
            system=SUMMARY_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text
    except Exception as e:
        print(f"  Error: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(description="ScholarLib AI Summary Generator")
    parser.add_argument("--topic", type=str, help="Filter by topic directory name")
    parser.add_argument("--limit", type=int, default=10, help="Max papers to process (default 10)")
    parser.add_argument("--all", action="store_true", help="Process all papers (overrides --limit)")
    parser.add_argument("--dry-run", action="store_true", help="Print which papers would be processed")
    parser.add_argument("--force", action="store_true", help="Re-generate even if summary exists")
    args = parser.parse_args()

    api_key = os.environ.get("CLAUDE_API_KEY")
    if not api_key and not args.dry_run:
        print("Error: Set CLAUDE_API_KEY environment variable.")
        print("  export CLAUDE_API_KEY=sk-ant-...")
        sys.exit(1)

    # Find papers to process
    all_papers = find_papers(args.topic)
    print(f"\nTotal papers found: {len(all_papers)}")

    to_process = []
    already_done = 0
    for pd in all_papers:
        if not args.force and has_summary(pd):
            already_done += 1
            continue
        to_process.append(pd)
    
    print(f"Already have summaries: {already_done}")
    print(f"Need summaries: {len(to_process)}")

    if not args.all:
        limit = args.limit
        to_process = to_process[:limit]
        print(f"Processing up to: {limit}")
    else:
        print(f"Processing all {len(to_process)} papers...")

    if args.dry_run:
        print("\nPapers to process:")
        for pd in to_process:
            print(f"  {pd.relative_to(ROOT)}")
        return

    if not to_process:
        print("\nAll papers already have summaries!")
        return

    client = Anthropic(api_key=api_key)
    success = 0
    failed = 0

    for i, paper_dir in enumerate(to_process, 1):
        meta = read_paper(paper_dir)
        if not meta:
            failed += 1
            continue
        
        title = meta.get("title", "unknown")[:70]
        print(f"[{i}/{len(to_process)}] {title}")
        
        summary = generate_summary(client, meta)
        if summary:
            out_path = paper_dir / SUMMARY_FILENAME
            with open(out_path, "w") as f:
                f.write(summary)
            print(f"  ✓ Saved to {out_path.relative_to(ROOT)}")
            success += 1
        else:
            failed += 1
        
        time.sleep(0.5)  # Rate limiting

    print(f"\n{'='*60}")
    print(f"Summary generation complete: {success} succeeded, {failed} failed")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()