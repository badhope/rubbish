"""Unit tests for scripts/copy-paper-assets.mjs.

We shell out to the script in a tmp directory so the tests don't depend
on the current state of the real `papers/` tree.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "copy-paper-assets.mjs"


@unittest.skipUnless(SCRIPT.exists(), "scripts/copy-paper-assets.mjs missing")
class TestCopyPaperAssets(unittest.TestCase):

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.cwd = Path(self._tmp.name)
        # Build a tiny papers/ tree:
        #   papers/fieldA/2026/cat/topic/tier/method/industry/leafA/paper.pdf
        #   papers/fieldA/2026/cat/topic/tier/method/industry/leafA/paper.bib
        #   papers/fieldA/2026/cat/topic/tier/method/industry/leafA/README.md
        #   papers/fieldA/2026/cat/topic/tier/method/industry/leafA/metadata.json
        self.leaf = (
            self.cwd / "papers" / "fieldA" / "2026" / "cat" / "topic"
            / "tier" / "method" / "industry" / "leafA"
        )
        self.leaf.mkdir(parents=True)
        (self.leaf / "paper.pdf").write_bytes(b"%PDF-1.4\n")
        (self.leaf / "paper.bib").write_text("@article{x,}")
        (self.leaf / "README.md").write_text("# Leaf\n")
        (self.leaf / "metadata.json").write_text("{}")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _run(self) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["node", str(SCRIPT)],
            cwd=self.cwd,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_copies_pdf_bib_only_not_readme_or_metadata(self) -> None:
        proc = self._run()
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        copied = sorted(p.relative_to(self.cwd).as_posix()
                        for p in (self.cwd / "docs" / "public" / "papers").rglob("*")
                        if p.is_file())
        self.assertEqual(
            copied,
            [
                "docs/public/papers/fieldA/2026/cat/topic/tier/method/industry/leafA/paper.bib",
                "docs/public/papers/fieldA/2026/cat/topic/tier/method/industry/leafA/paper.pdf",
            ],
        )

    def test_missing_papers_directory_is_a_noop(self) -> None:
        shutil.rmtree(self.cwd / "papers")
        proc = self._run()
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        # No docs/public/papers dir should be created.
        self.assertFalse((self.cwd / "docs" / "public" / "papers").exists())


if __name__ == "__main__":
    unittest.main()
