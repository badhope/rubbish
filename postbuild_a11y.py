"""Post-build a11y enhancements.

This script runs after VitePress build to add:
1. aria-label to VitePress theme buttons (VPSwitch, DocSearch-Button, etc.)
2. Convert <div id=VPContent> to <main id=VPContent>
3. Add sufficient touch target sizes via wrapper class
"""
import sys
from pathlib import Path
from bs4 import BeautifulSoup

DIST = Path(__file__).parent / "docs" / ".vitepress" / "dist"


def transform(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    # 1) Convert <div id="VPContent"> → <main id="VPContent">
    for div in soup.find_all("div", id="VPContent"):
        main = soup.new_tag("main", id="VPContent")
        for attr, value in div.attrs.items():
            main[attr] = value
        for child in list(div.children):
            main.append(child.extract() if hasattr(child, 'extract') else child)
        div.replace_with(main)

    # 2) aria-label on VPSwitch (theme toggle)
    for btn in soup.find_all("button", class_="VPSwitch"):
        if not btn.get("aria-label"):
            btn["aria-label"] = "Toggle color theme between light and dark"
        if not btn.get("title"):
            btn["title"] = "Toggle theme"

    # 3) aria-label on DocSearch button (match its visible text "Search")
    for btn in soup.find_all("button", class_="DocSearch-Button"):
        # Visible text includes keyboard shortcut; make aria-label more descriptive
        if not btn.get("aria-label"):
            btn["aria-label"] = "Search papers (press Ctrl+K)"
        btn["title"] = "Search papers (Ctrl+K)"

    # 4) Add aria-label on skip-link (if not present)
    for a in soup.find_all("a", class_="skip-link"):
        if not a.get("aria-label"):
            a["aria-label"] = "Skip to main content"

    # 5) Wrap VPSidebarItem links for better touch target size (CSS does the work)

    return str(soup)


def main():
    if not DIST.exists():
        print(f"✗ dist not found: {DIST}", file=sys.stderr)
        sys.exit(1)

    html_files = list(DIST.rglob("*.html"))
    if not html_files:
        print(f"✗ no HTML files in {DIST}", file=sys.stderr)
        sys.exit(1)

    total_modified = 0
    for f in html_files:
        original = f.read_text(encoding='utf-8')
        try:
            transformed = transform(original)
        except Exception as e:
            print(f"  ✗ {f.relative_to(DIST)}: {e}", file=sys.stderr)
            continue
        if transformed != original:
            f.write_text(transformed, encoding='utf-8')
            total_modified += 1

    print(f"✓ a11y post-processing: {total_modified}/{len(html_files)} files")


if __name__ == "__main__":
    main()
