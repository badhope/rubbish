"""Unit tests for generate_citation_graph.py.

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
    "generate_citation_graph", ROOT / "scripts" / "generate_citation_graph.py"
)
graph_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(graph_module)


class TestParseBibtex(unittest.TestCase):
    """Test the BibTeX parser."""

    def test_parses_title(self):
        content = """@article{key1,
  title = {Sample Title},
  author = {Doe, J.},
  year = {2025}
}"""
        result = graph_module.parse_bibtex(content)
        self.assertEqual(result.get("title"), "Sample Title")

    def test_parses_year(self):
        content = """@article{k, year={2024}}"""
        self.assertEqual(graph_module.parse_bibtex(content).get("year"), "2024")

    def test_parses_cite_key(self):
        content = """@article{myKey2025,
  title = {Test}
}"""
        self.assertEqual(graph_module.parse_bibtex(content).get("cite_key"), "myKey2025")

    def test_parses_journal(self):
        content = """@article{k,
  journal = {Nature},
  booktitle = {ICML}
}"""
        result = graph_module.parse_bibtex(content)
        # Should match either journal or booktitle
        self.assertIn(result.get("journal"), ["Nature", "ICML"])

    def test_parses_keywords(self):
        content = """@article{k,
  keywords = {AI, machine learning, deep learning}
}"""
        result = graph_module.parse_bibtex(content)
        self.assertIn("AI", result.get("keywords", ""))

    def test_handles_quoted_braces(self):
        content = '@article{k, title = "Quoted Title"}'
        result = graph_module.parse_bibtex(content)
        # Should still parse something
        self.assertIn("title", result)

    def test_empty_content(self):
        result = graph_module.parse_bibtex("")
        self.assertEqual(result, {})


class TestBuildGraph(unittest.TestCase):
    """Test the graph building logic."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        # Create sample structure: papers/2026/finance/p1/p1.bib
        p1 = self.tmp / "papers" / "2026" / "finance" / "p1"
        p1.mkdir(parents=True)
        (p1 / "p1.bib").write_text("""@article{smith2025ai,
  title = {AI in Finance},
  author = {Smith, J.},
  year = {2025},
  journal = {JFE},
  keywords = {AI, finance}
}""")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_build_graph_counts_papers(self):
        original = graph_module.PAPERS_DIR
        graph_module.PAPERS_DIR = self.tmp / "papers"
        try:
            bibs = graph_module.find_all_bibs()
            self.assertEqual(len(bibs), 1)
            graph = graph_module.build_graph(bibs)
            self.assertEqual(len(graph["nodes"]), 1)
            self.assertEqual(graph["nodes"][0]["id"], "smith2025ai")
        finally:
            graph_module.PAPERS_DIR = original


class TestFindAllBibs(unittest.TestCase):
    """Test the bib file discovery."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        papers = self.tmp / "papers" / "2026" / "finance"
        papers.mkdir(parents=True)
        (papers / "test.bib").write_text("@article{x}")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_finds_bib_files(self):
        original = graph_module.PAPERS_DIR
        graph_module.PAPERS_DIR = self.tmp / "papers"
        try:
            bibs = graph_module.find_all_bibs()
            self.assertEqual(len(bibs), 1)
        finally:
            graph_module.PAPERS_DIR = original

    def test_topic_filter(self):
        original = graph_module.PAPERS_DIR
        graph_module.PAPERS_DIR = self.tmp / "papers"
        try:
            bibs = graph_module.find_all_bibs("nonexistent")
            self.assertEqual(bibs, [])
        finally:
            graph_module.PAPERS_DIR = original


class TestGenerateMarkdownPage(unittest.TestCase):
    """Test the markdown page generation."""

    def test_contains_stats(self):
        graph = {
            "nodes": [{"id": "a", "title": "A", "year": "2025"}],
            "edges": [],
            "stats": {
                "total_papers": 1,
                "total_keywords": 5,
                "total_journals": 1,
                "year_distribution": {"2025": 1},
                "top_keywords": {"AI": 1},
                "top_journals": {"Nature": 1},
                "topic_distribution": {"2026/finance": 1},
            }
        }
        md = graph_module.generate_markdown_page(graph)
        self.assertIn("Citation Graph", md)
        self.assertIn("1 papers", md)
        self.assertIn("2025", md)
        self.assertIn("AI", md)
        # markdown header is "## Topic Distribution" (lowercased by BS4 in HTML)
        self.assertTrue(
            "Topic Distribution" in md or "topic distribution" in md.lower(),
            "Should contain a Topic Distribution section"
        )


if __name__ == "__main__":
    unittest.main()