"""VitePress build post-processor.

This is intentionally minimal in 1.6 — VitePress itself now ships
a <main id="VPContent"> landmark, aria-labels on the nav buttons, and
the VPSkipLink. Doing our own string surgery on those trees breaks
Vue's hydration and the page goes blank client-side. We only touch
what VitePress doesn't already do:

- mark decorative <svg> icons as aria-hidden + focusable=false
  (VitePress uses inline SVG for its social/nav icons)
- log a count for sanity-checking in CI

Safe to re-run on already-processed output.
"""
from __future__ import annotations

import sys
from pathlib import Path

from bs4 import BeautifulSoup

DIST = Path("docs/.vitepress/dist")


def transform(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    # Decorative <svg>s should be hidden from assistive tech. VitePress
    # already sets role="img" + aria-label on meaningful icons, so we
    # only touch the truly decorative ones.
    for svg in soup.find_all("svg"):
        if svg.get("aria-hidden") is None and svg.get("aria-label") is None:
            svg["aria-hidden"] = "true"
            svg["focusable"] = "false"

    return str(soup)


def main() -> int:
    if not DIST.exists():
        print(f"postbuild_a11y: {DIST} not found, skipping", file=sys.stderr)
        return 0

    html_files = list(DIST.rglob("*.html"))
    for f in html_files:
        original = f.read_text(encoding="utf-8")
        transformed = transform(original)
        if transformed != original:
            f.write_text(transformed, encoding="utf-8")

    print(f"postbuild_a11y: processed {len(html_files)} html files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
