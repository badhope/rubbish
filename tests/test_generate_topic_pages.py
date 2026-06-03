"""Tests for the topic page generator."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import generate_topic_pages as gtp  # noqa: E402


def _make_meta(tmp: Path, *, category: str = "human-resources", year: int = 2026, title: str = "A Test Paper",
               journal: str = "Journal of Testing", doi: str = "10.1234/test.5678", authors=None,
               sub: str = "ai-work", tier: str = "SSCI-Q1", method: str = "empirical",
               scenario: str = "cross-industry", leaf: str = "test-paper") -> Path:
    paper_dir = tmp / "papers" / "economics-management" / str(year) / category / sub / tier / method / scenario / leaf
    paper_dir.mkdir(parents=True, exist_ok=True)
    (paper_dir / f"{leaf}.bib").write_text("@article{test, title={x}}", encoding="utf-8")
    (paper_dir / "metadata.json").write_text(json.dumps({
        "title": title,
        "authors": authors or ["Alice Aardvark", "Bob Beaver"],
        "year": year,
        "journal": journal,
        "doi": doi,
        "category": category,
    }), encoding="utf-8")
    return paper_dir


class GeneratorSmokeTest(unittest.TestCase):
    def test_meta_is_parsed(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _make_meta(tmp)
            metas = list((tmp / "papers" / "economics-management" / "2026" / "human-resources").rglob("metadata.json"))
            self.assertEqual(len(metas), 1)
            self.assertEqual(gtp.read_meta(metas[0])["title"], "A Test Paper")

    def test_format_authors_truncates(self):
        meta = {"authors": ["A", "B", "C", "D", "E"]}
        self.assertEqual(gtp.format_authors(meta), "A et al.")
        meta = {"authors": ["A", "B", "C"]}
        self.assertEqual(gtp.format_authors(meta), "A, B, C")
        meta = {"authors": []}
        self.assertEqual(gtp.format_authors(meta), "—")
        meta = {"authors": "A and B"}
        self.assertEqual(gtp.format_authors(meta), "A and B")

    def test_doi_link(self):
        meta = {"doi": "10.1/2.3", "year": 2025, "journal": "J", "title": "T", "authors": ["A"], "_rel": "x/y"}
        row = gtp.paper_row(meta)
        self.assertIn("[10.1/2.3](https://doi.org/10.1/2.3)", row)
        meta_no_doi = {"doi": "", "year": 2025, "journal": "J", "title": "T", "authors": ["A"], "_rel": "x/y"}
        self.assertIn("—", gtp.paper_row(meta_no_doi))

    def test_read_column_prefers_pdf(self):
        meta = {"doi": "10.1/2.3", "year": 2025, "journal": "J", "title": "T",
                "authors": ["A"], "_rel": "x/y", "has_pdf": True}
        row = gtp.paper_row(meta)
        self.assertIn("PDF", row)
        # _rel already contains the path segment ("papers/..." in real runs);
        # the link must use it as-is so VitePress base resolves to
        # /ScholarLib/<_rel>/paper.pdf (not /ScholarLib/papers/papers/...).
        self.assertIn("/x/y/paper.pdf", row)
        self.assertNotIn("/papers/papers/", row)

    def test_read_column_falls_back_to_publisher_url(self):
        meta = {"doi": "10.1/2.3", "year": 2025, "journal": "J", "title": "T",
                "authors": ["A"], "_rel": "x/y",
                "publisher_url": "https://journals.example.com/article/123"}
        row = gtp.paper_row(meta)
        self.assertIn("publisher", row)
        self.assertIn("https://journals.example.com/article/123", row)

    def test_read_column_falls_back_to_doi(self):
        meta = {"doi": "10.1/2.3", "year": 2025, "journal": "J", "title": "T",
                "authors": ["A"], "_rel": "x/y"}
        row = gtp.paper_row(meta)
        self.assertIn("[doi](https://doi.org/10.1/2.3)", row)

    def test_pad_markdown_tables(self):
        before = (
            "## 2026 · 2 papers\n\n"
            "| Title | Authors | Year |\n"
            "| --- | --- | ---: |\n"
            "| Short | A | 2026 |\n"
            "| A Much Longer Paper Title | X, Y | 2026 |\n"
        )
        after = gtp.pad_markdown_tables(before)
        # The long-title row should be padded so columns line up
        lines = after.splitlines()
        # The two data rows should have the same length (modulo trailing newline)
        self.assertEqual(len(lines[3]), len(lines[4]))

    def test_script_runs_end_to_end(self):
        """Generate into a temp output tree and confirm the file count."""
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            # Build 2 papers under one field
            _make_meta(tmp, year=2026, leaf="p1")
            _make_meta(tmp, year=2025, leaf="p2", title="Another Paper", doi="")
            out = tmp / "docs" / "papers" / "economics-management"
            out.mkdir(parents=True)
            content = gtp.render_em_field("human-resources", "Human Resources", papers_dir=tmp / "papers" / "economics-management")
            (out / "human-resources.md").write_text(gtp.pad_markdown_tables(content), encoding="utf-8")
            text = (out / "human-resources.md").read_text(encoding="utf-8")
            self.assertIn("**2** indexed papers", text)
            self.assertIn("## 2026 · 1 paper", text)
            self.assertIn("## 2025 · 1 paper", text)
            self.assertIn(gtp.GENERATED_MARKER, text)


if __name__ == "__main__":
    unittest.main()
