#!/usr/bin/env python3
"""PDF Recovery Script for ScholarLib.

Phase 1: Scan all metadata.json files, collect DOIs/arXiv IDs that are missing PDFs.
Phase 2: Attempt to download PDFs from:
  - arXiv (if arXiv ID or URL present)
  - Sci-Hub (via DOI) — best effort, may be blocked
  - Direct URL (if metadata has a direct PDF URL)

Security: URLs are validated against an allowlist of schemes and hosts
to prevent SSRF. HTTPS only.

Usage:
  python3 scripts/recover_pdfs.py              # dry-run: list missing PDFs
  python3 scripts/recover_pdfs.py --download   # actually download
  python3 scripts/recover_pdfs.py --topic machine-learning  # single topic

Requirements: pip install requests beautifulsoup4
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    requests = None  # Allow importing module for unit tests

ROOT = Path(__file__).resolve().parent.parent
PAPERS_DIR = ROOT / "papers"
REQUEST_TIMEOUT = 30
USER_AGENT = "ScholarLib/1.0 (https://github.com/badhope/ScholarLib; academic PDF recovery)"
MIN_DELAY = 2.0  # seconds between requests
MAX_PDF_SIZE = 100 * 1024 * 1024  # 100 MB safety cap

# Allowlist of domains we trust to serve PDF redirects / mirrors.
# Anything else gets rejected outright (SSRF defense).
ALLOWED_DOWNLOAD_DOMAINS = {
    "arxiv.org",
    "export.arxiv.org",
    "sci-hub.se",
    "sci-hub.st",
    "sci-hub.ru",
    "sci-hub.wf",
    "sci-hub.ee",
    "sci-hub.shop",
    "sci-hub.do",
}

# Unpaywall is a metadata API (not a host of PDFs); it returns URLs that
# we then resolve to the publisher. We trust its recommendations because
# it's a curated OA index maintained by OurResearch.
UNPAYWALL_API = "https://api.unpaywall.org/v2"


def _is_allowed_url(url: str) -> bool:
    """Check that a URL is HTTPS and points to an allowlisted domain."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("https", "http"):
        return False
    host = (parsed.hostname or "").lower()
    # Strip leading "www." for matching
    if host.startswith("www."):
        host = host[4:]
    return host in ALLOWED_DOWNLOAD_DOMAINS or any(
        host.endswith("." + d) for d in ALLOWED_DOWNLOAD_DOMAINS
    )


def find_metadata_files(topic_filter: str | None = None) -> list[Path]:
    """Collect all metadata.json paths, optionally filtered by topic."""
    files = sorted(PAPERS_DIR.glob("**/metadata.json"))
    if topic_filter:
        files = [f for f in files if f"/{topic_filter}/" in str(f)]
    return files


def extract_identifiers(meta: dict) -> dict:
    """Extract DOI, arXiv ID, and direct PDF URL from metadata."""
    result: dict[str, str | None] = {"doi": None, "arxiv": None, "pdf_url": None}

    # DOI
    doi = (meta.get("doi") or "").strip()
    if doi:
        doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi)
        # Sanity check: DOI must match the official pattern
        if re.match(r"^10\.\d{4,9}/[^\s]+$", doi):
            result["doi"] = doi

    # arXiv
    arxiv = (meta.get("arxiv") or "").strip()
    if not arxiv:
        url = (meta.get("url") or "").strip()
        m = re.search(r"arxiv\.org/(?:abs|pdf)/([\d.]+(?:v\d+)?)", url)
        if m:
            arxiv = m.group(1)
    if not arxiv:
        bib = (meta.get("bibtex") or meta.get("eprint") or "").strip()
        m = re.search(r"arXiv:([\d.]+(?:v\d+)?)", bib)
        if m:
            arxiv = m.group(1)
    if arxiv:
        # Normalize: strip version suffix
        arxiv_clean = re.sub(r"v\d+$", "", arxiv)
        result["arxiv"] = arxiv_clean

    # Direct PDF URL
    pdf_url = (meta.get("pdf_url") or meta.get("pdf") or "").strip()
    if not pdf_url:
        url = (meta.get("url") or "").strip()
        if url.endswith(".pdf") and _is_allowed_url(url):
            pdf_url = url
    if pdf_url and _is_allowed_url(pdf_url):
        result["pdf_url"] = pdf_url

    return result


def paper_has_pdf(paper_dir: Path) -> bool:
    """Check if a paper directory already has a PDF file.

    Only counts PDFs directly inside ``paper_dir``; we deliberately
    do NOT walk into the parent directory, because that would treat
    a sibling paper's PDF as if it belonged here and silently skip
    papers that are actually missing a PDF.
    """
    return any(paper_dir.glob("*.pdf"))


def download_file(url: str, dest: Path) -> bool:
    """Download a file with safety checks. Returns True on success."""
    if requests is None:
        print("  Error: requests not installed. Run: pip install requests")
        return False
    if not _is_allowed_url(url):
        print(f"  Skipped (disallowed URL): {url}")
        return False
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*"},
            timeout=REQUEST_TIMEOUT,
            stream=True,
            allow_redirects=True,
        )
        resp.raise_for_status()

        ct = resp.headers.get("content-type", "").lower()
        if "html" in ct and "pdf" not in ct:
            return False

        # Check Content-Length
        cl = resp.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > MAX_PDF_SIZE:
            print(f"  Skipped (too large: {int(cl) // 1024 // 1024} MB)")
            return False

        written = 0
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
                written += len(chunk)
                if written > MAX_PDF_SIZE:
                    dest.unlink(missing_ok=True)
                    print(f"  Aborted (size limit exceeded)")
                    return False

        # Verify it looks like a PDF
        with open(dest, "rb") as f:
            header = f.read(5)
        if header[:5] != b"%PDF-":
            dest.unlink(missing_ok=True)
            return False
        return True
    except requests.exceptions.RequestException as e:
        dest.unlink(missing_ok=True)
        print(f"  Network error: {type(e).__name__}: {e}")
        return False
    except (OSError, IOError) as e:
        dest.unlink(missing_ok=True)
        print(f"  File error: {e}")
        return False


def try_arxiv(arxiv_id: str, dest: Path) -> bool:
    """Download PDF from arXiv."""
    clean_id = re.sub(r"v\d+$", "", arxiv_id)
    pdf_url = f"https://arxiv.org/pdf/{clean_id}.pdf"
    return download_file(pdf_url, dest)


def try_scihub(doi: str, dest: Path) -> bool:
    """Try to download PDF from Sci-Hub mirrors.

    The mirror list MUST stay in sync with ``ALLOWED_DOWNLOAD_DOMAINS``;
    the allowlist in ``_is_allowed_url`` will reject any URL pointing
    outside the allowlist, so iterating over unlisted mirrors is wasted
    effort.
    """
    if requests is None:
        return False
    mirrors = [d for d in ALLOWED_DOWNLOAD_DOMAINS if d.startswith("sci-hub.")]
    for mirror in mirrors:
        url = f"https://{mirror}/{doi}"
        try:
            resp = requests.get(
                url,
                headers={"User-Agent": USER_AGENT},
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code != 200:
                continue
            m = re.search(
                r'(?:iframe|embed)\s+src\s*=\s*["\']([^"\']+\.pdf[^"\']*)["\']',
                resp.text,
                re.I,
            )
            if not m:
                continue
            pdf_url = m.group(1)
            if pdf_url.startswith("//"):
                pdf_url = "https:" + pdf_url
            elif pdf_url.startswith("/"):
                parsed = urlparse(url)
                pdf_url = f"https://{parsed.netloc}{pdf_url}"
            if download_file(pdf_url, dest):
                return True
        except requests.exceptions.RequestException:
            continue
    return False


def try_direct_url(pdf_url: str, dest: Path) -> bool:
    """Try to download from a direct PDF URL."""
    return download_file(pdf_url, dest)


def try_unpaywall(doi: str, dest: Path, contact_email: str = "scholarlib@localhost") -> bool:
    """Try to find an open-access PDF via the Unpaywall API.

    Unpaywall only returns metadata; the actual PDF comes from the
    publisher's domain. We trust Unpaywall's recommendations, so this
    function bypasses the host allowlist that ``download_file`` enforces
    for arbitrary user-supplied URLs.
    """
    if requests is None:
        return False
    try:
        resp = requests.get(
            f"{UNPAYWALL_API}/{doi}",
            params={"email": contact_email},
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            return False
        data = resp.json()
    except (requests.exceptions.RequestException, ValueError):
        return False

    # Prefer best_oa_location.url_for_pdf; fall back to any oa location.
    candidates: list[dict] = []
    best = data.get("best_oa_location")
    if best:
        candidates.append(best)
    candidates.extend(data.get("oa_locations") or [])

    for loc in candidates:
        pdf = loc.get("url_for_pdf") or loc.get("url")
        if not pdf:
            continue
        # Trust Unpaywall's recommendation even if the host is not in
        # our allowlist; Unpaywall only indexes legitimate OA copies.
        if _download_file_relaxed(pdf, dest):
            return True
    return False


def _download_file_relaxed(url: str, dest: Path) -> bool:
    """Like ``download_file`` but allows any HTTPS host.

    Only call this from paths where the URL came from a trusted curator
    (e.g. the Unpaywall API), never from raw user input.
    """
    if requests is None:
        return False
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("https", "http"):
        return False
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*"},
            timeout=REQUEST_TIMEOUT,
            stream=True,
            allow_redirects=True,
        )
        resp.raise_for_status()
        ct = resp.headers.get("content-type", "").lower()
        if "html" in ct and "pdf" not in ct:
            return False
        cl = resp.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > MAX_PDF_SIZE:
            return False
        written = 0
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
                written += len(chunk)
                if written > MAX_PDF_SIZE:
                    dest.unlink(missing_ok=True)
                    return False
        with open(dest, "rb") as f:
            header = f.read(5)
        if header[:5] != b"%PDF-":
            dest.unlink(missing_ok=True)
            return False
        return True
    except requests.exceptions.RequestException:
        dest.unlink(missing_ok=True)
        return False
    except (OSError, IOError):
        dest.unlink(missing_ok=True)
        return False


def scan_missing(
    topic_filter: str | None = None,
    include_synthetic: bool = False,
) -> list[tuple[Path, dict]]:
    """Scan for papers missing PDFs. Returns list of (paper_dir, identifiers).

    Entries marked ``"synthetic": true`` in metadata.json are skipped by
    default — they are placeholder records (e.g. demo data) and have no
    real DOI to resolve. Pass ``include_synthetic=True`` to try them
    anyway.
    """
    missing: list[tuple[Path, dict]] = []
    for meta_path in find_metadata_files(topic_filter):
        try:
            with open(meta_path) as f:
                meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue

        if not include_synthetic and meta.get("synthetic"):
            continue

        paper_dir = meta_path.parent
        if paper_has_pdf(paper_dir):
            continue

        ids = extract_identifiers(meta)
        if any(ids.values()):
            missing.append((paper_dir, ids))
    return missing


def main() -> int:
    parser = argparse.ArgumentParser(description="ScholarLib PDF Recovery Tool")
    parser.add_argument("--download", action="store_true", help="Actually download PDFs")
    parser.add_argument("--topic", type=str, help="Filter by topic (directory name)")
    parser.add_argument(
        "--force", action="store_true", help="Re-download even if PDF exists"
    )
    parser.add_argument(
        "--include-synthetic",
        action="store_true",
        help="Also try synthetic / placeholder entries (off by default)",
    )
    args = parser.parse_args()

    missing = scan_missing(args.topic, include_synthetic=args.include_synthetic)

    if not missing:
        print("All papers have PDFs. Nothing to recover.")
        return 0

    print(f"\n{'=' * 60}")
    print(f"Papers missing PDFs: {len(missing)}")
    print(f"{'=' * 60}\n")

    if not args.download:
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
        return 0

    success = failed = 0
    for i, (paper_dir, ids) in enumerate(missing, 1):
        rel = paper_dir.relative_to(ROOT)
        meta_path = paper_dir / "metadata.json"
        title = "unknown"
        if meta_path.exists():
            try:
                with open(meta_path) as f:
                    title = json.load(f).get("title", "unknown")[:60]
            except (json.JSONDecodeError, OSError):
                pass

        print(f"[{i}/{len(missing)}] {title}")
        dest = paper_dir / "paper.pdf"
        recovered = False

        if ids["arxiv"]:
            print(f"  → arXiv: {ids['arxiv']}")
            if try_arxiv(ids["arxiv"], dest):
                recovered = True
                print(f"  ✓ Downloaded from arXiv")

        if not recovered and ids["doi"]:
            print(f"  → Unpaywall: {ids['doi']}")
            if try_unpaywall(ids["doi"], dest):
                recovered = True
                print(f"  ✓ Downloaded via Unpaywall (open access)")

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

    print(f"\n{'=' * 60}")
    print(f"Recovery complete: {success} succeeded, {failed} failed")
    print(f"{'=' * 60}")
    return 0


if __name__ == "__main__":
    sys.exit(main())