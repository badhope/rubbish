"""Unit tests for URL allowlist in recover_pdfs.py.

Catches SSRF / path-traversal / scheme-mixup bugs.
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import importlib.util
spec = importlib.util.spec_from_file_location(
    "recover_pdfs", ROOT / "scripts" / "recover_pdfs.py"
)
recover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recover)


class TestURLAllowlist(unittest.TestCase):
    """Ensure URL validation prevents SSRF and accepts known sources."""

    # ── Accepted ──────────────────────────────────────────────────────
    def test_arxiv_pdf_accepted(self):
        self.assertTrue(recover._is_allowed_url("https://arxiv.org/pdf/2501.12345.pdf"))

    def test_arxiv_subdomain_accepted(self):
        self.assertTrue(recover._is_allowed_url("https://export.arxiv.org/pdf/1234"))

    def test_scihub_accepted(self):
        self.assertTrue(recover._is_allowed_url("https://sci-hub.se/10.1234/example"))

    def test_http_to_allowed_host_accepted(self):
        # Both http and https are accepted (rare in practice but allowed)
        self.assertTrue(recover._is_allowed_url("http://arxiv.org/pdf/1"))

    def test_www_stripped(self):
        # www.arxiv.org is the same as arxiv.org
        self.assertTrue(recover._is_allowed_url("https://www.arxiv.org/pdf/1"))

    def test_subdomain_accepted(self):
        # mirror.sci-hub.se should be accepted because it ends in sci-hub.se
        self.assertTrue(recover._is_allowed_url("https://mirror.sci-hub.se/10.1234/x"))

    # ── Rejected ──────────────────────────────────────────────────────
    def test_ftp_rejected(self):
        self.assertFalse(recover._is_allowed_url("ftp://arxiv.org/file.pdf"))

    def test_file_scheme_rejected(self):
        self.assertFalse(recover._is_allowed_url("file:///etc/passwd"))

    def test_javascript_scheme_rejected(self):
        self.assertFalse(recover._is_allowed_url("javascript:alert(1)"))

    def test_unrelated_domain_rejected(self):
        self.assertFalse(recover._is_allowed_url("https://evil.com/paper.pdf"))

    def test_lookalike_domain_rejected(self):
        # arxiv.org.evil.com should NOT match arxiv.org
        self.assertFalse(recover._is_allowed_url("https://arxiv.org.evil.com/paper"))

    def test_empty_url_rejected(self):
        self.assertFalse(recover._is_allowed_url(""))

    def test_malformed_url_rejected(self):
        self.assertFalse(recover._is_allowed_url("not a url"))

    def test_internal_169_rejected(self):
        # Cloud metadata endpoint — classic SSRF target
        self.assertFalse(recover._is_allowed_url("http://169.254.169.254/latest"))


class TestExtractIdentifiersHardening(unittest.TestCase):
    """Ensure the identifier extractor is robust to garbage input."""

    def test_handles_none_values(self):
        ids = recover.extract_identifiers({"doi": None, "url": None})
        self.assertIsNone(ids["doi"])
        self.assertIsNone(ids["arxiv"])
        self.assertIsNone(ids["pdf_url"])

    def test_rejects_malformed_doi(self):
        # Random string that doesn't match DOI pattern
        ids = recover.extract_identifiers({"doi": "not-a-doi"})
        self.assertIsNone(ids["doi"])

    def test_normalizes_doi_prefix(self):
        ids = recover.extract_identifiers({"doi": "https://doi.org/10.1234/abc"})
        self.assertEqual(ids["doi"], "10.1234/abc")

    def test_strips_arxiv_version(self):
        ids = recover.extract_identifiers({"arxiv": "2501.12345v2"})
        self.assertEqual(ids["arxiv"], "2501.12345")

    def test_rejects_unsafe_pdf_url(self):
        # A .pdf URL on a non-allowlisted domain should be ignored
        ids = recover.extract_identifiers({"url": "https://evil.com/paper.pdf"})
        self.assertIsNone(ids["pdf_url"])

    def test_accepts_safe_pdf_url(self):
        ids = recover.extract_identifiers({"url": "https://arxiv.org/pdf/2501.12345.pdf"})
        self.assertEqual(ids["pdf_url"], "https://arxiv.org/pdf/2501.12345.pdf")


if __name__ == "__main__":
    unittest.main()