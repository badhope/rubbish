"""Unit tests for scripts/generate_leaf_readmes.py."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

# Make the script importable as a module.
ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "generate_leaf_readmes.py"
sys.path.insert(0, str(ROOT / "scripts"))

import generate_leaf_readmes as glr  # noqa: E402


class _RepoFixture(unittest.TestCase):
    """Build a tiny in-memory repository and exercise the renderer against it."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_root = Path(self._tmp.name)
        self.papers = self.tmp_root / "papers"
        self.leaf = (
            self.papers
            / "fieldA" / "2026" / "categoryA" / "topicA"
            / "FT50" / "empirical" / "tech" / "leafA"
        )
        self.leaf.mkdir(parents=True)

        self.meta = {
            "title": "A Test Paper",
            "authors": ["Alice", "Bob", "Carol"],
            "year": 2025,
            "journal": "Journal of Tests",
            "journal_tier": "FT50",
            "volume": 12,
            "number": 3,
            "pages": "100-120",
            "doi": "10.1234/test.2025.001",
            "url": "https://doi.org/10.1234/test.2025.001",
            "abstract": "An abstract that explains what the paper is about.",
            "keywords": ["alpha", "beta", "gamma"],
            "category": "categoryA",
            "submitted_by": "Tester",
            "date_added": "2026-01-01",
            "synthetic": False,
            "has_pdf": True,
            "doi_verified": True,
            "publisher_url": "https://publisher.example.com/article/10.1234/test.2025.001",
        }
        (self.leaf / "metadata.json").write_text(
            json.dumps(self.meta, indent=2), encoding="utf-8"
        )
        (self.leaf / "paper.pdf").write_bytes(b"%PDF-1.4\n%fake\n")
        (self.leaf / "paper.bib").write_text("@article{test2025,...}", encoding="utf-8")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _render_under_tmp(self) -> str:
        return glr._render(self.meta, self.leaf / "metadata.json",  # type: ignore[attr-defined]
                           base_dir=self.tmp_root,
                           papers_root=self.papers)

    def test_position_parses_taxonomy(self) -> None:
        pos = glr._position(self.leaf / "metadata.json", papers_root=self.papers)  # type: ignore[attr-defined]
        self.assertEqual(pos["field"], "fieldA")
        self.assertEqual(pos["year"], "2026")
        self.assertEqual(pos["category"], "categoryA")
        self.assertEqual(pos["topic"], "topicA")
        self.assertEqual(pos["tier"], "FT50")
        self.assertEqual(pos["method"], "empirical")
        self.assertEqual(pos["industry"], "tech")
        self.assertEqual(pos["leaf"], "leafA")

    def test_render_includes_title_authors_year_journal(self) -> None:
        md = self._render_under_tmp()
        self.assertIn("# A Test Paper", md)
        self.assertIn("Alice, Bob, & Carol", md)
        # Cells are padded by _pad_markdown_tables to align columns, so
        # just look for the field label and the value as separate tokens.
        self.assertRegex(md, r"\*\*Year\*\*\s*\|\s*2025")
        self.assertIn("Journal of Tests (FT50), 12(3), pp. 100-120", md)

    def test_render_includes_doi_and_publisher_links(self) -> None:
        md = self._render_under_tmp()
        self.assertIn("[10.1234/test.2025.001](https://doi.org/10.1234/test.2025.001)", md)
        self.assertIn("[Publisher page](https://publisher.example.com/article/", md)
        self.assertIn("[📄 PDF on the site](https://badhope.github.io/ScholarLib/", md)
        self.assertIn("[BibTeX citation](", md)

    def test_render_includes_abstract_and_keywords(self) -> None:
        md = self._render_under_tmp()
        self.assertIn("## Abstract", md)
        self.assertIn("An abstract that explains what the paper is about.", md)
        self.assertIn("## Keywords", md)
        self.assertIn("`alpha`", md)
        self.assertIn("`gamma`", md)

    def test_render_includes_position_table(self) -> None:
        md = self._render_under_tmp()
        self.assertIn("## Where it sits in the corpus", md)
        self.assertIn("`fieldA`", md)
        self.assertIn("`leafA`", md)

    def test_render_marks_synthetic_and_verified(self) -> None:
        md = self._render_under_tmp()
        self.assertIn("✓ DOI verified live", md)
        self.assertIn("📄 full PDF bundled", md)
        self.assertNotIn("placeholder", md)

    def test_render_omits_pdf_link_when_no_pdf(self) -> None:
        self.meta["has_pdf"] = False
        (self.leaf / "paper.pdf").unlink()
        md = self._render_under_tmp()
        self.assertIn("📄 PDF: not bundled", md)
        self.assertNotIn("[📄 PDF on the site]", md)

    def test_render_flags_placeholder(self) -> None:
        self.meta["synthetic"] = True
        self.meta["has_pdf"] = False
        self.meta["doi_verified"] = False
        (self.leaf / "paper.pdf").unlink()
        md = self._render_under_tmp()
        self.assertIn("placeholder entry", md)
        self.assertNotIn("DOI verified", md)

    def test_main_writes_readme_to_every_leaf(self) -> None:
        rc = glr.main(argv=[], papers_dir=self.papers)
        self.assertEqual(rc, 0)
        out = self.leaf / "README.md"
        self.assertTrue(out.exists(), "README.md should be created")
        body = out.read_text(encoding="utf-8")
        self.assertIn(glr.GENERATED_MARKER, body)
        self.assertIn("# A Test Paper", body)
        self.assertIn("https://doi.org/10.1234/test.2025.001", body)

    def test_main_check_detects_stale_readme(self) -> None:
        # Write once.
        glr.main(argv=[], papers_dir=self.papers)
        # Mutate the README to simulate drift.
        readme = self.leaf / "README.md"
        readme.write_text(readme.read_text(encoding="utf-8") + "\nmanual edit\n", encoding="utf-8")
        rc = glr.main(argv=["--check"], papers_dir=self.papers)
        self.assertEqual(rc, 1)

    def test_main_check_idempotent_on_clean_run(self) -> None:
        glr.main(argv=[], papers_dir=self.papers)
        self.assertEqual(glr.main(argv=["--check"], papers_dir=self.papers), 0)


if __name__ == "__main__":
    unittest.main()
