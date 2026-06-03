"""VitePress build post-processor.

VitePress's default theme ships without a <main> landmark and without
aria-labels on the theme buttons, which trips axe-core and the
screen-reader quick-nav. This script runs after `vitepress build` and
adds the missing landmarks. Safe to re-run on already-processed HTML
(idempotent on the <main id="VPContent"> rewrite).
"""

import sys
from pathlib import Path

try:
    from bs4 import BeautifulSoup, Comment
except ImportError:
    print(
        "Error: beautifulsoup4 not installed.\n"
        "  pip install beautifulsoup4",
        file=sys.stderr,
    )
    sys.exit(1)

DIST = Path(__file__).parent / "docs" / ".vitepress" / "dist"


def transform(html: str) -> str:
    """Apply all a11y transformations to a single HTML string."""
    soup = BeautifulSoup(html, "html.parser")

    # 1) Convert <div id="VPContent"> → <main id="VPContent">
    #    Only if no <main> with that id already exists (idempotent).
    for div in soup.find_all("div", id="VPContent"):
        if soup.find("main", id="VPContent"):
            break
        main = soup.new_tag("main", id="VPContent")
        # Copy attributes (skip boolean attrs BeautifulSoup can't re-assign).
        for attr, value in list(div.attrs.items()):
            if isinstance(value, list):
                value = " ".join(value)
            try:
                main[attr] = value
            except (TypeError, ValueError):
                # Skip non-serializable attributes
                continue
        # Move children: extract() removes from source, append() adds to dest.
        for child in list(div.contents):
            main.append(child.extract() if hasattr(child, "extract") else child)
        div.replace_with(main)

    # 2) aria-label on VPSwitch (theme toggle)
    for btn in soup.find_all("button", class_="VPSwitch"):
        if not btn.get("aria-label"):
            btn["aria-label"] = "Toggle color theme between light and dark"
        if not btn.get("title"):
            btn["title"] = "Toggle theme"

    # 3) aria-label on DocSearch button
    for btn in soup.find_all("button", class_="DocSearch-Button"):
        if not btn.get("aria-label"):
            btn["aria-label"] = "Search papers (press Ctrl+K)"
        btn["title"] = "Search papers (Ctrl+K)"

    # 4) aria-label on skip-link
    for a in soup.find_all("a", class_="skip-link"):
        if not a.get("aria-label"):
            a["aria-label"] = "Skip to main content"

    # 5) Mark decorative SVGs in the badge/nav that lack aria-hidden
    for svg in soup.find_all("svg"):
        # Skip SVGs that are already labeled
        if svg.get("aria-label") or svg.get("aria-labelledby") or svg.get("role"):
            continue
        # Skip SVGs inside <a> or <button> that already have aria-label
        parent = svg.parent
        if parent and parent.name in ("a", "button") and parent.get("aria-label"):
            continue
        # Otherwise mark as hidden from screen readers
        svg["aria-hidden"] = "true"
        svg["focusable"] = "false"

    return str(soup)


def main() -> int:
    if not DIST.exists():
        print(f"✗ dist not found: {DIST}", file=sys.stderr)
        return 1

    html_files = sorted(DIST.rglob("*.html"))
    if not html_files:
        print(f"✗ no HTML files in {DIST}", file=sys.stderr)
        return 1

    total = 0
    failed = 0
    for f in html_files:
        original = f.read_text(encoding="utf-8")
        try:
            transformed = transform(original)
        except Exception as e:
            print(f"  ✗ {f.relative_to(DIST)}: {type(e).__name__}: {e}", file=sys.stderr)
            failed += 1
            continue
        if transformed != original:
            f.write_text(transformed, encoding="utf-8")
            total += 1

    print(f"✓ a11y post-processing: {total}/{len(html_files)} files modified"
          + (f" ({failed} failed)" if failed else ""))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())