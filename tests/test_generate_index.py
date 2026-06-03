"""Unit tests for generate_index.py.

Run: python -m pytest tests/ -v
"""

import sys
import unittest
import tempfile
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Import the module
import importlib.util
spec = importlib.util.spec_from_file_location(
    "generate_index", ROOT / "scripts" / "generate_index.py"
)
generate_index = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generate_index)


class TestCollectBibEntries(unittest.TestCase):
    """Test the BibTeX entry collection logic."""

    def setUp(self):
        # Create a temp dir with sample structure
        self.tmp = Path(tempfile.mkdtemp())
        self.papers = self.tmp / "papers" / "2026" / "finance"
        self.papers.mkdir(parents=True)
        (self.papers / "paper1.bib").write_text(
            "@article{test1, title={Test Paper 1}, author={Doe}, year={2026}}"
        )
        (self.papers / "paper2.bib").write_text(
            "@article{test2, title={Test Paper 2}, author={Smith}, year={2026}}"
        )

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_collect_bib_entries_finds_files(self):
        # Patch the module's REPO_ROOT
        original = generate_index.REPO_ROOT
        generate_index.REPO_ROOT = self.tmp
        try:
            entries = generate_index.collect_bib_entries()
            self.assertEqual(len(entries), 2)
        finally:
            generate_index.REPO_ROOT = original

    def test_collect_bib_entries_empty_dir(self):
        empty = Path(tempfile.mkdtemp())
        original = generate_index.REPO_ROOT
        generate_index.REPO_ROOT = empty
        try:
            entries = generate_index.collect_bib_entries()
            self.assertEqual(entries, [])
        finally:
            generate_index.REPO_ROOT = original
            shutil.rmtree(empty)


class TestGenerateStats(unittest.TestCase):
    """Test the statistics generation."""

    def test_generate_stats_groups_by_year_category(self):
        entries = [
            {"path": "papers/2026/finance/p1.bib", "content": "@article{a}"},
            {"path": "papers/2026/finance/p2.bib", "content": "@article{b}"},
            {"path": "papers/2026/marketing/p3.bib", "content": "@article{c}"},
            {"path": "papers/2025/finance/p4.bib", "content": "@article{d}"},
        ]
        stats = generate_index.generate_stats(entries)
        self.assertEqual(stats.get("2026/finance"), 2)
        self.assertEqual(stats.get("2026/marketing"), 1)
        self.assertEqual(stats.get("2025/finance"), 1)


class TestGenerateIndex(unittest.TestCase):
    """Test the BibTeX file generation."""

    def test_includes_all_entries(self):
        entries = [
            {"path": "papers/test/p1.bib", "content": "@article{a, title={A}}"},
            {"path": "papers/test/p2.bib", "content": "@article{b, title={B}}"},
        ]
        output = generate_index.generate_index(entries)
        self.assertIn("@article{a, title={A}}", output)
        self.assertIn("@article{b, title={B}}", output)
        self.assertIn("Total entries: 2", output)
        self.assertIn("papers/test/p1.bib", output)


if __name__ == "__main__":
    unittest.main()