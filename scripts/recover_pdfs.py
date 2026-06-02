#!/usr/bin/env python3
"""PDF Recovery Script for ScholarLib.

Phase 1: Scan all metadata.json files, collect DOIs/arXiv IDs that are missing PDFs.
Phase 2: Attempt to download PDFs from:
  - Sci-Hub (via DOI)
  - arXiv (if arXiv ID or URL present)
  - Direct URL (if metadata has a direct PDF URL)

Usage:
  python3 scripts/recover_pdfs.py              # dry-run: list missing PDFs
  python3 scripts/recover_pdfs.py --download   # actually download
  python3 scripts/recover_pdfs.py --topic machine-learning  # single topic

Requirements: pip install requests beautifulsoup4
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    print("Error: requests not installed. Run: pip install requests")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
PAPERS_DIR = ROOT / "papers"
REQUEST_TIMEOUT = 30
USER_AGENT = "ScholarLib/1.0 (https://github.com/badhope/ScholarLib; academic PDF recovery)"
MIN_DELAY = 2.0  # seconds between requests (be polite)


def find_metadata_files(topic_filter: str | None = None) -> list[Path]:
    """Collect all metadata.json paths, optionally filtered by topic."""
    files = sorted(PAPERS_DIR.glob("**/metadata.json"))
    if topic_filter:
        files = [f for f in files if f"/{topic_filter}/" in str(f)]
    return files


def extract_identifiers(meta: dict) -> dict:
    """Extract DOI, arXiv ID, and direct PDF URL from metadata."""
    result = {"doi": None, "arxiv": None, "pdf_url": None}
    
    # DOI
    doi = meta.get("doi", "").strip()
    if doi:
        # Normalize: strip https://doi.org/ prefix
        doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi)
        result["doi"] = doi

    # arXiv
    arxiv = meta.get("arxiv", "").strip()
    if not arxiv:
        url = meta.get("url", "")
        m = re.search(r"arxiv\.org/(?:abs|pdf)/([\d.]+(?:v\d+)?)", url)
        if m:
            arxiv = m.group(1)
    if not arxiv:
        bib = meta.get("bibtex", meta.get("eprint", "")).strip()
        m = re.search(r"arXiv:([\d.]+(?:v\d+)?)", bib)
        if m:
            arxiv = m.group(1)
    result["arxiv"] = arxiv if arxiv else None

    # Direct PDF URL
    pdf_url = meta.get("pdf_url", meta.get("pdf", "")).strip()
    if not pdf_url:
        url = meta.get("url", "")
        if url.endswith(".pdf"):
            pdf_url = url
    result["pdf_url"] = pdf_url if pdf_url else None

    return result


def paper_has_pdf(paper_dir: Path) -> bool:
    """Check if a paper directory already has a PDF file."""
    # Check current dir and one level up (some PDFs are in parent)
    pdfs = list(paper_dir.glob("*.pdf"))
    if paper_dir.parent != paper_dir:
        pdfs += list(paper_dir.parent.glob("*.pdf"))
    return len(pdfs) > 0


def download_file(url: str, dest: Path) -> bool:
    """Download a file, return True on success."""
    try:
        headers = {"User-Agent": USER_AGENT}
        resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT, stream=True)
        resp.raise_for_status()
        
        # Check content-type to avoid HTML error pages
        ct = resp.headers.get("content-type", "")
        if "html" in ct.lower() and "pdf" not in ct.lower():
            return False
        
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        
        # Verify it looks like a PDF
        with open(dest, "rb") as f:
            header = f.read(5)
        if header[:5] == b"%PDF-":
            return True
        else:
            dest.unlink()
            return False
    except Exception as e:
        if dest.exists():
            dest.unlink()
        return False


def try_scihub(doi: str, dest: Path) -> bool:
    """Try to download PDF from Sci-Hub."""
    mirrors = [
        f"https://sci-hub.se/{doi}",
        f"https://sci-hub.st/{doi}",
        f"https://sci-hub.ru/{doi}",
    ]
    for url in mirrors:
        try:
            # First, get the page to find the PDF embed URL
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
            if resp.status_code != 200:
                continue
            import re
            # Sci-Hub embeds PDF in iframe or embed tag
            m = re.search(r'(?:iframe|embed)\s+src\s*=\s*["\']([^"\']+\.pdf[^"\']*)["\']', resp.text, re.I)
            if not m:
                # Try button/link
                m = re.search(r'(?:button|onclick|location)\s*=.*?["\']([^"\']*?\.pdf[^"\']*)["\']', resp.text, re.I)
            if m:
                pdf_url = m.group(1)
                if pdf_url.startswith("//"):
                    pdf_url = "https:" + pdf_url
                elif pdf_url.startswith("/"):
                    pdf_url = urlparse(url)._replace(path=pdf_url).geturl()
                if download_file(pdf_url, dest):
                    return True
        except Exception:
            continue
    return False


def try_arxiv(arxiv_id: str, dest: Path) -> bool:
    """Try to download PDF from arXiv."""
    clean_id = arxiv_id.replace("arXiv:", "").strip()
    # Remove version suffix
    clean_id = re.sub(r"v\d+$", "", clean_id)
    pdf_url = f"https://arxiv.org/pdf/{clean_id}.pdf"
    return download_file(pdf_url, dest)


def try_direct_url(pdf_url: str, dest: Path) -> bool:
    """Try to download from a direct PDF URL."""
    return download_file(pdf_url, dest)


def scan_missing(topic_filter: str | None = None) -> list[tuple[Path, dict]]:
    """Scan for papers missing PDFs. Returns list of (paper_dir, identifiers)."""
    missing = []
    for meta_path in find_metadata_files(topic_filter):
        try:
            with open(meta_path) as f:
                meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        
        paper_dir = meta_path.parent
        if paper_has_pdf(paper_dir):
            continue
        
        ids = extract_identifiers(meta)
        if any(ids.values()):
            missing.append((paper_dir, ids))
    return missing


def main():
    parser = argparse.ArgumentParser(description="ScholarLib PDF Recovery Tool")
    parser.add_argument("--download", action="store_true", help="Actually download PDFs")
    parser.add_argument("--topic", type=str, help="Filter by topic (directory name)")
    parser.add_argument("--force", action="store_true", help="Re-download even if PDF exists")
    args = parser.parse_args()

    missing = scan_missing(args.topic)
    
    if not missing:
        print("All papers have PDFs. Nothing to recover.")
        return

    print(f"\n{'='*60}")
    print(f"Papers missing PDFs: {len(missing)}")
    print(f"{'='*60}\n")

    if not args.download:
        # Dry-run: list them
        for paper_dir, ids in missing:
            rel = paper_dir.relative_to(ROOT)
            sources = []
            if ids["doi"]:
                sources.append(f"DOI: {ids['doi']}")
            if ids["arxiv"]:
                sources.append(f"arXiv: {ids['arxiv']}")
            if ids["pdf_url"]:
                sources.append(f"URL: {ids['pdf_url']}")
            print(f"  {rel}")
            print(f"    Sources: {', '.join(sources) if sources else '(none)'}")
        print(f"\nRun with --download to attempt recovery.")
        return

    # Download mode
    success, failed = 0, 0
    for i, (paper_dir, ids) in enumerate(missing, 1):
        rel = paper_dir.relative_to(ROOT)
        title = "unknown"
        meta_path = paper_dir / "metadata.json"
        if meta_path.exists():
            try:
                with open(meta_path) as f:
                    title = json.load(f).get("title", "unknown")[:60]
            except Exception:
                pass

        print(f"[{i}/{len(missing)}] {title}")

        dest = paper_dir / "paper.pdf"
        recovered = False

        # Try sources in priority order
        if ids["arxiv"]:
            print(f"  → arXiv: {ids['arxiv']}")
            if try_arxiv(ids["arxiv"], dest):
                recovered = True
                print(f"  ✓ Downloaded from arXiv")
        
        if not recovered and ids["doi"]:
            print(f"  → Sci-Hub: {ids['doi']}")
            if try_scihub(ids["doi"], dest):
                recovered = True
                print(f"  ✓ Downloaded from Sci-Hub")
        
        if not recovered and ids["pdf_url"]:
            print(f"  → Direct URL...")
            if try_direct_url(ids["pdf_url"], dest):
                recovered = True
                print(f"  ✓ Downloaded from direct URL")

        if recovered:
            success += 1
        else:
            failed += 1
            print(f"  ✗ Failed to recover PDF")

        time.sleep(MIN_DELAY)

    print(f"\n{'='*60}")
    print(f"Recovery complete: {success} succeeded, {failed} failed")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()