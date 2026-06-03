"""Unit tests for postbuild_a11y.py.

Run: python -m unittest discover -s tests -p 'test_*.py' -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    import bs4  # noqa: F401
except ImportError:
    raise unittest.SkipTest("beautifulsoup4 not installed (pip install beautifulsoup4)")

import importlib.util

spec = importlib.util.spec_from_file_location(
    "postbuild_a11y", ROOT / "postbuild_a11y.py"
)
a11y = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a11y)


class TestSvgAriaHidden(unittest.TestCase):
    """Decorative SVGs should be hidden from assistive tech."""

    def test_adds_aria_hidden_to_unmarked_svg(self):
        html = '<svg viewBox="0 0 24 24"></svg>'
        result = a11y.transform(html)
        self.assertIn('aria-hidden="true"', result)
        self.assertIn('focusable="false"', result)

    def test_preserves_explicit_aria_label(self):
        html = '<svg aria-label="Logo" viewBox="0 0 24 24"></svg>'
        result = a11y.transform(html)
        self.assertIn('aria-label="Logo"', result)
        self.assertNotIn('aria-hidden="true"', result)

    def test_preserves_existing_aria_hidden(self):
        html = '<svg aria-hidden="false" viewBox="0 0 24 24"></svg>'
        result = a11y.transform(html)
        # Pre-existing aria-hidden value must be preserved
        self.assertIn('aria-hidden="false"', result)


class TestNoopForCleanInput(unittest.TestCase):
    """We don't touch the SSR HTML structure (VitePress 1.6 already
    ships <main id="VPContent">, VPSkipLink, aria-labels). The only
    job of this script is decorative-SVG hygiene."""

    def test_preserves_existing_main(self):
        html = '<main id="VPContent">body</main>'
        result = a11y.transform(html)
        self.assertIn('<main id="VPContent">', result)

    def test_empty_input(self):
        self.assertIsInstance(a11y.transform("<html></html>"), str)


if __name__ == "__main__":
    unittest.main()
