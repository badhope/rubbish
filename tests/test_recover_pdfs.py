"""Unit tests for recover_pdfs.py.

Run: python -m pytest tests/ -v
"""

import json
import sys
import unittest
import tempfile
import shutil
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Import the module
import importlib.util
spec = importlib.util.spec_from_file_location(
    "recover_pdfs", ROOT / "scripts" / "recover_pdfs.py"
)
recover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recover)


class TestExtractIdentifiers(unittest.TestCase):
    """Test DOI/arXiv extraction from metadata."""

    def test_extracts_doi(self):
        meta = {"doi": "10.1234/example"}
        ids = recover.extract_identifiers(meta)
        self.assertEqual(ids["doi"], "10.1234/example")

    def test_normalizes_doi_url(self):
        meta = {"doi": "https://doi.org/10.1234/example"}
        ids = recover.extract_identifiers(meta)
        self.assertEqual(ids["doi"], "10.1234/example")

    def test_strips_dx_doi(self):
        meta = {"doi": "https://dx.doi.org/10.1234/example"}
        ids = recover.extract_identifiers(meta)
        self.assertEqual(ids["doi"], "10.1234/example")

    def test_extracts_arxiv_from_url(self):
        meta = {"url": "https://arxiv.org/abs/2501.12345"}
        ids = recover.extract_identifiers(meta)
        self.assertEqual(ids["arxiv"], "2501.12345")

    def test_extracts_arxiv_version(self):
        meta = {"url": "https://arxiv.org/abs/2501.12345v2"}
        ids = recover.extract_identifiers(meta)
        # Version suffix is stripped for downstream URL building
        self.assertEqual(ids["arxiv"], "2501.12345")

    def test_extracts_arxiv_with_pdf(self):
        meta = {"url": "https://arxiv.org/pdf/2501.12345"}
        ids = recover.extract_identifiers(meta)
        self.assertEqual(ids["arxiv"], "2501.12345")

    def test_extracts_arxiv_from_field(self):
        meta = {"arxiv": "2501.12345"}
        ids = recover.extract_identifiers(meta)
        self.assertEqual(ids["arxiv"], "2501.12345")

    def test_extracts_arxiv_from_bibtex(self):
        meta = {"bibtex": "@article{k, note={arXiv:2501.12345}}"}
        ids = recover.extract_identifiers(meta)
        self.assertEqual(ids["arxiv"], "2501.12345")

    def test_extracts_direct_pdf_url(self):
        meta = {"pdf_url": "https://arxiv.org/pdf/2501.12345.pdf"}
        ids = recover.extract_identifiers(meta)
        self.assertEqual(ids["pdf_url"], "https://arxiv.org/pdf/2501.12345.pdf")

    def test_detects_pdf_extension_in_url(self):
        meta = {"url": "https://arxiv.org/pdf/2501.12345.pdf"}
        ids = recover.extract_identifiers(meta)
        self.assertEqual(ids["pdf_url"], "https://arxiv.org/pdf/2501.12345.pdf")

    def test_rejects_pdf_on_untrusted_domain(self):
        meta = {"url": "https://evil.com/paper.pdf"}
        ids = recover.extract_identifiers(meta)
        self.assertIsNone(ids["pdf_url"])

    def test_empty_metadata(self):
        ids = recover.extract_identifiers({})
        self.assertIsNone(ids["doi"])
        self.assertIsNone(ids["arxiv"])
        self.assertIsNone(ids["pdf_url"])


class TestPaperHasPdf(unittest.TestCase):
    """Test PDF existence check."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_returns_false_when_no_pdf(self):
        paper_dir = self.tmp / "paper1"
        paper_dir.mkdir()
        self.assertFalse(recover.paper_has_pdf(paper_dir))

    def test_returns_true_when_pdf_exists(self):
        paper_dir = self.tmp / "paper1"
        paper_dir.mkdir()
        (paper_dir / "paper.pdf").write_bytes(b"%PDF-1.4 fake")
        self.assertTrue(recover.paper_has_pdf(paper_dir))

    def test_returns_true_for_any_pdf_name(self):
        paper_dir = self.tmp / "paper1"
        paper_dir.mkdir()
        (paper_dir / "main.pdf").write_bytes(b"%PDF-1.4 fake")
        self.assertTrue(recover.paper_has_pdf(paper_dir))

    def test_ignores_pdf_in_parent_directory(self):
        """Regression: a sibling paper's PDF in the parent dir must NOT
        count as the current paper having a PDF.
        """
        topic_dir = self.tmp / "topic"
        topic_dir.mkdir()
        paper_dir = topic_dir / "paper1"
        paper_dir.mkdir()
        # PDF lives in sibling paper dir, NOT in paper1 itself
        (topic_dir / "paper2").mkdir()
        (topic_dir / "paper2" / "paper.pdf").write_bytes(b"%PDF-1.4 fake")
        self.assertFalse(recover.paper_has_pdf(paper_dir))


class TestDownloadFile(unittest.TestCase):
    """Test the file download helper (network calls mocked)."""

    @unittest.skipUnless(
        __import__("importlib").util.find_spec("requests") is not None,
        "requests not installed",
    )
    def test_download_file_rejects_html(self):
        # Without mocking, this might actually hit the network.
        # We just test that it returns False for a 404 or non-PDF content.
        from unittest.mock import patch, MagicMock
        with patch("requests.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.headers = {"content-type": "text/html"}
            mock_resp.status_code = 200
            mock_resp.iter_content.return_value = [b"<html>Error</html>"]
            mock_get.return_value = mock_resp

            dest = Path(tempfile.mkdtemp()) / "test.pdf"
            result = recover.download_file("http://example.com", dest)
            # download_file will save then check header
            # The HTML content doesn't start with %PDF-, so it should delete
            self.assertFalse(result)
            self.assertFalse(dest.exists())


class TestScanMissing(unittest.TestCase):
    """Test that scan_missing honours the ``synthetic`` flag in metadata."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        # Build a minimal repo tree:
        #   tmp/papers/<topic>/<paper>/metadata.json
        self.papers_root = self.tmp / "papers"
        self.topic_dir = self.papers_root / "t"
        self.topic_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def _make_paper(self, name: str, meta: dict) -> Path:
        d = self.topic_dir / name
        d.mkdir()
        (d / "metadata.json").write_text(json.dumps(meta), encoding="utf-8")
        return d

    def _scan(self) -> list:
        with patch.object(recover, "PAPERS_DIR", self.papers_root):
            return recover.scan_missing()

    def test_skips_synthetic_entries_by_default(self):
        self._make_paper(
            "synth",
            {"doi": "10.9999/fake", "synthetic": True},
        )
        self.assertEqual(self._scan(), [])

    def test_includes_real_entries(self):
        self._make_paper(
            "real",
            {"doi": "10.1234/real", "synthetic": False},
        )
        result = self._scan()
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][1]["doi"], "10.1234/real")

    def test_include_synthetic_flag_includes_them(self):
        self._make_paper(
            "synth",
            {"doi": "10.9999/fake", "synthetic": True},
        )
        self._make_paper(
            "real",
            {"doi": "10.1234/real", "synthetic": False},
        )
        with patch.object(recover, "PAPERS_DIR", self.papers_root):
            result = recover.scan_missing(include_synthetic=True)
        self.assertEqual(len(result), 2)

    def test_paper_with_pdf_is_skipped_even_if_not_synthetic(self):
        d = self._make_paper("real", {"doi": "10.1234/real", "synthetic": False})
        (d / "paper.pdf").write_bytes(b"%PDF-1.4 fake")
        self.assertEqual(self._scan(), [])


if __name__ == "__main__":
    unittest.main()