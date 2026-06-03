"""Regression: every link declared in docs/.vitepress/config.ts must resolve
to a real source page (or asset) under docs/.

This catches the exact bug class the GitHub Pages site just hit: VitePress
config advertises a navigation target (e.g. ``/zh/citation-graph``) but no
corresponding ``.md`` exists, so the link 404s for users — and silently
breaks the lang-switcher UX for any locale that does not ship every
single subpage.

Source-based (not dist-based) so this runs in CI before the build step.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONFIG = REPO / "docs" / ".vitepress" / "config.ts"
DOCS = REPO / "docs"


# ── helpers ────────────────────────────────────────────────────────────


def _strip_comments(src: str) -> str:
    """Crude TS comment stripper — we only scan for ``link: "..."`` so
    string contents must be preserved verbatim, but the rest can be cleared.
    """
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    src = re.sub(r"//[^\n]*", "", src)
    return src


def _extract_links() -> list[str]:
    text = _strip_comments(CONFIG.read_text(encoding="utf-8"))
    return re.findall(r'link:\s*"([^"]+)"', text)


def _source_path_for(link: str) -> Path | None:
    """Map a VitePress route to the on-disk source file(s) it should live at.

    With ``cleanUrls: true`` in this site, the routing is:

    - ``/``               → ``docs/<lang>/index.md`` (or ``docs/index.md``)
    - ``/foo``            → ``docs/<lang>/foo.md`` (file) **or**
                            ``docs/<lang>/foo/index.md`` (directory index)
    - ``/foo#bar``        → same as ``/foo``; fragment is a heading anchor
    - ``/foo/bar``        → same rule, one level deeper

    We check both forms. Returns ``None`` for off-site links or static
    assets (images, fonts, RSS — anything that isn't a VitePress page).
    """
    if not link.startswith("/"):
        return None
    # Strip fragment — `/about#license` is a heading within docs/about.md
    link = link.split("#", 1)[0]
    base = link.strip("/")  # "zh/papers/cs/index"  or  ""  or  "foo"
    if not base:
        return DOCS / "index.md"
    candidate = DOCS / f"{base}.md"
    if candidate.is_file():
        return candidate
    candidate_dir = DOCS / base / "index.md"
    if candidate_dir.is_file():
        return candidate_dir
    # Not a page; might be a static asset under docs/public/ (favicon, rss,
    # manifest, sw.js, etc.). Caller checks existence on its own.
    return None


def _static_asset_path_for(link: str) -> Path | None:
    """Resolve a link to docs/public/ if it points to a static asset there.

    VitePress serves ``docs/public/foo.png`` at ``/foo.png`` (no /ScholarLib/
    base prefix in the config; the base is only applied at request time).
    """
    link = link.split("#", 1)[0]
    base = link.lstrip("/")
    if not base:
        return None
    p = DOCS / "public" / base
    return p if p.is_file() else None


# ── tests ──────────────────────────────────────────────────────────────


class TestConfigLinksResolve(unittest.TestCase):
    """Every ``link:`` declared in config.ts must point to a real source page
    or static asset."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.links = _extract_links()

    def test_config_has_links(self) -> None:
        self.assertGreater(
            len(self.links),
            50,
            "config has very few links; parser may be broken",
        )

    def test_no_link_is_a_404(self) -> None:
        """Every config link must resolve to an existing .md under docs/
        (for a page) or a real file under docs/public/ (for a static asset).
        Off-site URLs are skipped.
        """
        missing: list[str] = []
        skipped: list[str] = []
        for link in self.links:
            if link.startswith("http://") or link.startswith("https://"):
                skipped.append(link)
                continue
            src = _source_path_for(link)
            if src is not None:
                continue
            asset = _static_asset_path_for(link)
            if asset is not None:
                continue
            # Might be a mailto: or other non-file scheme
            if "://" in link or link.startswith("mailto:"):
                skipped.append(link)
                continue
            missing.append(link)
        if missing:
            self.fail(
                "These nav/sidebar links have no source page or asset (404 for users):\n  "
                + "\n  ".join(sorted(missing))
                + f"\n(skipped {len(skipped)} off-site/asset links)"
            )

    def test_no_zh_link_points_to_legacy_topic_pages(self) -> None:
        """Guard rail: /zh/ links in nav must only point to top-level
        landing pages. Per-topic subpages exist only under /papers/...; the
        zh locale does not ship them, and adding them to the zh nav was
        the original 404 source.
        """
        offenders = [
            link
            for link in self.links
            if link.startswith("/zh/papers/")
            and link.rstrip("/").count("/") >= 3
            and not link.endswith("/index")
        ]
        self.assertEqual(
            offenders,
            [],
            "zh nav/sidebar links must not reference per-topic subpages "
            "(only /zh/, /zh/about, /zh/papers/<area>/index are allowed):\n  "
            + "\n  ".join(offenders),
        )

    def test_every_zh_link_resolves(self) -> None:
        zh_links = [l for l in self.links if l.startswith("/zh/")]
        missing = [l for l in zh_links if _source_path_for(l) is None]
        if missing:
            self.fail(
                "These /zh/ links have no source page under docs/ "
                "(404 for zh users):\n  "
                + "\n  ".join(sorted(missing))
            )

    def test_locales_zh_has_link_field(self) -> None:
        """The zh locale must declare a `link:` so the lang switcher
        always lands on a real page even when the user is on an en path
        that has no zh equivalent (e.g. per-topic subpages).
        """
        text = CONFIG.read_text(encoding="utf-8")
        # crude match: find the `zh: { ... }` block and assert `link:` is
        # somewhere inside it before the next `},`
        m = re.search(r"zh:\s*\{", text)
        self.assertIsNotNone(m, "no zh locale block in config.ts")
        # find matching close brace
        start = m.end()
        depth = 1
        i = start
        while i < len(text) and depth > 0:
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            i += 1
        zh_block = text[start : i - 1]
        self.assertRegex(
            zh_block,
            r"link:\s*[\"']/[^\"']*[\"']",
            "locales.zh must declare a `link:` so the lang switcher has "
            "a safe fallback (otherwise it auto-maps every en URL to a "
            "non-existent /zh/... path)",
        )

    def test_i18n_routing_disabled_in_theme(self) -> None:
        """`themeConfig.i18nRouting: false` is the other half of the fix:
        even with locales.zh.link set, VitePress still path-maps the
        switcher unless this is off. We assert it lives inside the
        TOP-LEVEL themeConfig (not in locales.<lang>.themeConfig) and
        is set to false.
        """
        text = _strip_comments(CONFIG.read_text(encoding="utf-8"))
        # Find the top-level themeConfig block (one indented at 2 spaces).
        # The nested locales.<lang>.themeConfig blocks are indented further,
        # so a 2-space indent is a reliable anchor.
        m = re.search(
            r"^  themeConfig:\s*\{",
            text,
            re.MULTILINE,
        )
        self.assertIsNotNone(
            m, "no top-level themeConfig (indented at 2 spaces) in config.ts"
        )
        start = m.end()
        depth = 1
        i = start
        while i < len(text) and depth > 0:
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            i += 1
        theme_block = text[start : i - 1]
        self.assertRegex(
            theme_block,
            r"i18nRouting:\s*false",
            "themeConfig.i18nRouting must be set to false so the lang "
            "switcher stops auto-mapping /papers/cs/foo to "
            "/zh/papers/cs/foo (which 404s)",
        )


if __name__ == "__main__":
    unittest.main()
