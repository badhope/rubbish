"""Static guard: built site must not contain stray README pages.

Background: an earlier build of this site accidentally copied per-leaf
README.md files into ``docs/public/papers/.../``. VitePress 1.6's default
``srcExclude`` only filters out ``**/README.md`` *under the source root*;
it does NOT filter the ``public/`` subtree, so the build emitted
``dist/public/papers/.../README.html`` for every paper and polluted the
SPA hash map with ~90 ghost entries.

This test fails CI immediately if that ever happens again. It is
intentionally tolerant: it only checks what we know to be wrong, so it
will stay green for legitimate changes to the corpus.
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "docs" / ".vitepress" / "dist"
APP_BUNDLE = next(DIST.glob("assets/app.*.js"), None) if DIST.exists() else None


@unittest.skipUnless(DIST.exists(), "docs/.vitepress/dist/ not built; run `npm run docs:build`")
class TestNoStrayReadmePages(unittest.TestCase):

    def test_no_html_under_dist_public(self) -> None:
        """VitePress must never render a page under dist/public/.

        docs/public/ is the static-passthrough root; nothing in it should
        be treated as a markdown source.
        """
        offenders = sorted(
            p.relative_to(DIST).as_posix()
            for p in (DIST / "public").rglob("*.html")
            if p.is_file()
        )
        self.assertEqual(
            offenders, [],
            f"Found {len(offenders)} stray HTML under dist/public/ (these should be "
            f"static files, not VitePress pages): {offenders[:5]}...",
        )

    def test_no_readme_html_anywhere(self) -> None:
        """No README.html should be in the built site."""
        offenders = sorted(
            p.relative_to(DIST).as_posix()
            for p in DIST.rglob("*readme*.html")
            if p.is_file()
        )
        self.assertEqual(
            offenders, [],
            f"Found README.html in build output: {offenders[:5]}",
        )

    @unittest.skipUnless(APP_BUNDLE, "no app bundle in dist")
    def test_app_bundle_does_not_reference_public_papers(self) -> None:
        """__VP_HASH_MAP__ must not contain a 'public_papers_*_readme' entry.

        These were 90 ghost entries before; their presence indicates a
        markdown file leaked into docs/public/.
        """
        text = APP_BUNDLE.read_text(encoding="utf-8", errors="ignore")
        matches = re.findall(r"public_papers_[a-z0-9_]+_readme", text)
        self.assertEqual(
            matches, [],
            f"app bundle references {len(matches)} ghost 'public_papers_*_readme' entries; "
            f"a markdown file has leaked into docs/public/",
        )


if __name__ == "__main__":
    unittest.main()
