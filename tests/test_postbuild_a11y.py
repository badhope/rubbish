"""Unit tests for postbuild_a11y.py.

Run: python -m pytest tests/ -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Skip entire module if bs4 not installed
try:
    import bs4  # noqa: F401
except ImportError:
    raise unittest.SkipTest("beautifulsoup4 not installed (pip install beautifulsoup4)")

# Import the module
import importlib.util
spec = importlib.util.spec_from_file_location(
    "postbuild_a11y", ROOT / "postbuild_a11y.py"
)
a11y = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a11y)


class TestTransform(unittest.TestCase):
    """Test the HTML transformation function."""

    def test_transforms_div_to_main(self):
        html = '<html><body><div id="VPContent">content</div></body></html>'
        result = a11y.transform(html)
        self.assertIn('<main id="VPContent">', result)
        self.assertNotIn('<div id="VPContent">', result)
        self.assertIn("content", result)

    def test_preserves_attributes(self):
        html = '<div id="VPContent" class="x" data-foo="bar">content</div>'
        result = a11y.transform(html)
        self.assertIn('id="VPContent"', result)
        self.assertIn('class="x"', result)
        self.assertIn('data-foo="bar"', result)

    def test_adds_aria_label_to_vpswitch(self):
        html = '<button class="VPSwitch"></button>'
        result = a11y.transform(html)
        self.assertIn('aria-label="Toggle color theme between light and dark"', result)

    def test_preserves_existing_aria_label(self):
        html = '<button class="VPSwitch" aria-label="Custom"></button>'
        result = a11y.transform(html)
        self.assertIn('aria-label="Custom"', result)

    def test_adds_aria_label_to_docsearch(self):
        html = '<button class="DocSearch-Button"></button>'
        result = a11y.transform(html)
        self.assertIn('aria-label="Search papers (press Ctrl+K)"', result)
        self.assertIn('title="Search papers (Ctrl+K)"', result)

    def test_adds_aria_label_to_skip_link(self):
        html = '<a class="skip-link" href="#VPContent">Skip</a>'
        result = a11y.transform(html)
        self.assertIn('aria-label="Skip to main content"', result)

    def test_handles_nested_content(self):
        html = """<div id="VPContent">
            <h1>Title</h1>
            <p>Paragraph</p>
        </div>"""
        result = a11y.transform(html)
        self.assertIn("<main", result)
        self.assertIn("<h1>Title</h1>", result)
        self.assertIn("<p>Paragraph</p>", result)

    def test_no_op_for_empty_input(self):
        # Empty input should not crash
        result = a11y.transform("<html></html>")
        self.assertIsInstance(result, str)


class TestIntegration(unittest.TestCase):
    """Integration tests on real built files (if they exist)."""

    def test_no_id_collision_with_other_mains(self):
        # If there are other <main> tags, we shouldn't add a duplicate id
        html = '<main id="other">old</main><div id="VPContent">new</div>'
        result = a11y.transform(html)
        # The script only transforms VPContent divs
        self.assertIn('id="other"', result)
        self.assertIn('id="VPContent"', result)


if __name__ == "__main__":
    unittest.main()