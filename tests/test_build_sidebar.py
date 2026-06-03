"""Unit tests for the build_sidebar.py module.

Run: python -m pytest tests/ -v
Or:  python tests/test_build_sidebar.py
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Import the module under test
import importlib.util
spec = importlib.util.spec_from_file_location(
    "build_sidebar", ROOT / "build_sidebar.py"
)
build_sidebar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_sidebar)


class TestBuildSidebarHelpers(unittest.TestCase):
    """Test the helper functions in build_sidebar.py."""

    def test_humanize_simple(self):
        self.assertEqual(build_sidebar.humanize("machine-learning"), "Machine Learning")
        self.assertEqual(build_sidebar.humanize("reinforcement-learning"), "Reinforcement Learning")

    def test_humanize_single_word(self):
        self.assertEqual(build_sidebar.humanize("robotics"), "Robotics")

    def test_slugify_lowercase(self):
        self.assertEqual(build_sidebar.slugify("AI-Safety-Alignment"), "ai-safety-alignment")
        self.assertEqual(build_sidebar.slugify("Programming-Languages"), "programming-languages")

    def test_cs_pretty_map_contains_expected_topics(self):
        # Sanity: ensure the map has a good range of entries
        self.assertGreaterEqual(len(build_sidebar.CS_PRETTY), 30)
        # Spot-check a few
        self.assertEqual(build_sidebar.CS_PRETTY["Machine-Learning"], "Machine Learning")
        self.assertEqual(build_sidebar.CS_PRETTY["AI-Safety-Alignment"], "AI Safety & Alignment")

    def test_build_sidebar_block_format(self):
        block = build_sidebar.build_sidebar_block(
            ["topic-a", "topic-b"],
            {"topic-a": "Topic A"},
            "Test Label",
            "papers/test",
        )
        self.assertIn("'/papers/test/': [", block)
        self.assertIn("text: 'Test Label'", block)
        self.assertIn("'Topic A'", block)
        self.assertIn("link: '/papers/test/topic-a'", block)
        self.assertIn("Overview", block)

    def test_build_sidebar_block_uses_humanize_for_unknown(self):
        block = build_sidebar.build_sidebar_block(
            ["my-topic"],
            {},
            "Label",
            "papers/test",
        )
        self.assertIn("'My Topic'", block)

    def test_discover_cs_topics_empty_when_missing(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmppath = Path(tmp)
            result = build_sidebar.discover_cs_topics(tmppath)
            self.assertEqual(result, [])

    def test_discover_em_fields_empty_when_missing(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmppath = Path(tmp)
            result = build_sidebar.discover_em_fields(tmppath)
            self.assertEqual(result, [])

    def test_discover_cs_topics_filters_dotfiles(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmppath = Path(tmp)
            cs = tmppath / "computer-science"
            cs.mkdir()
            (cs / "Machine-Learning").mkdir()
            (cs / ".hidden").mkdir()
            result = build_sidebar.discover_cs_topics(tmppath)
            self.assertEqual(result, ["Machine-Learning"])


if __name__ == "__main__":
    unittest.main()