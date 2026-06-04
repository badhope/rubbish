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
        """Guard rail: /zh/ links in nav must not reference per-topic
        subpages that don't have a stub. (When stubs exist, the link is
        legitimate and a different test — ``test_zh_topic_stubs_cover_all_en_topics``
        — verifies the stub is on disk.)
        """
        offenders = [
            link
            for link in self.links
            if link.startswith("/zh/papers/")
            and link.rstrip("/").count("/") >= 3
            and not link.endswith("/index")
        ]
        # Every per-topic /zh/papers/<area>/<slug> link must point at a
        # stub file. We rely on the _source_path_for lookup to verify.
        missing = [l for l in offenders if _source_path_for(l) is None]
        self.assertEqual(
            missing,
            [],
            "These /zh/papers/<area>/<slug> links have no matching zh "
            "stub file. Either add the stub (run "
            "`python3 scripts/generate_zh_topic_stubs.py`) or remove the "
            "link from nav/sidebar:\n  "
            + "\n  ".join(missing),
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

    def test_i18n_routing_enabled_with_zh_stubs(self) -> None:
        """`themeConfig.i18nRouting` is left on (the default) — we want the
        lang switcher to auto-map en paths to zh paths. For that to be
        safe, a zh stub must exist for every en topic page; that is
        asserted by ``test_zh_topic_stubs_cover_all_en_topics`` below.
        """
        text = _strip_comments(CONFIG.read_text(encoding="utf-8"))
        # Find the top-level themeConfig block (one indented at 2 spaces).
        m = re.search(r"^  themeConfig:\s*\{", text, re.MULTILINE)
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
        # Either the key is absent (default true) or explicitly set true.
        match = re.search(r"i18nRouting:\s*(\w+)", theme_block)
        if match is not None:
            self.assertEqual(
                match.group(1),
                "true",
                "i18nRouting must be true (or omitted) so the lang "
                "switcher auto-maps en → zh paths and lands on the "
                "corresponding zh stub.",
            )

    def test_zh_topic_stubs_cover_all_en_topics(self) -> None:
        """Every en topic page under docs/papers/computer-science/ and
        docs/papers/economics-management/ must have a matching zh stub
        under docs/zh/papers/<area>/, otherwise the lang switcher will
        404 from en → zh.

        Convention: the zh stub lives at the same slug as the en page
        (e.g. docs/papers/cs/ai-safety-alignment.md ↔
               docs/zh/papers/cs/ai-safety-alignment.md).
        """
        # Slugs that explicitly opt out of zh coverage (hand-curated and
        # intentionally kept en-only because they have no scholarly
        # content the user would need in Chinese).
        ALLOWLIST: set[str] = set()  # currently none

        en_dirs = {
            "computer-science": DOCS / "papers" / "computer-science",
            "economics-management": DOCS / "papers" / "economics-management",
        }
        missing: list[str] = []
        for area, en_dir in en_dirs.items():
            zh_dir = DOCS / "zh" / "papers" / area
            for en in sorted(en_dir.glob("*.md")):
                slug = en.stem
                if slug == "index" or slug in ALLOWLIST:
                    continue
                zh = zh_dir / f"{slug}.md"
                if not zh.is_file():
                    missing.append(f"  /zh/papers/{area}/{slug}.md  (en: {en.name})")
        if missing:
            self.fail(
                "These zh stubs are missing — the lang switcher will 404 "
                "from en to zh. Run "
                "`python3 scripts/generate_zh_topic_stubs.py` to create "
                "them:\n" + "\n".join(missing)
            )

    def test_zh_topic_stubs_are_marked_generated(self) -> None:
        """Every zh stub must contain the generator marker so future runs
        of generate_zh_topic_stubs.py can identify and refresh them,
        and so a hand-edited page is protected from silent overwrite.
        """
        MARKER = "generated by scripts/generate_zh_topic_stubs.py"
        offenders: list[str] = []
        for area in ("computer-science", "economics-management"):
            zh_dir = DOCS / "zh" / "papers" / area
            if not zh_dir.is_dir():
                continue
            for p in sorted(zh_dir.glob("*.md")):
                if p.name == "index.md":
                    continue
                if MARKER not in p.read_text(encoding="utf-8"):
                    offenders.append(p.relative_to(REPO).as_posix())
        self.assertEqual(
            offenders,
            [],
            "These zh topic pages are not marked as generated; either "
            "they're hand-written and should be protected by adding the "
            "marker, or the generator was bypassed:\n  "
            + "\n  ".join(offenders),
        )


if __name__ == "__main__":
    unittest.main()
