"""Pure tests for multi-document merge helpers (no DB, no network)."""

from __future__ import annotations

from io import BytesIO

import pymupdf
from docx import Document

from app.domain.submission.export_docs import merge_docx, merge_pdfs


def _pdf(text: str) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


def _docx(text: str) -> bytes:
    doc = Document()
    doc.add_heading(text, level=1)
    doc.add_paragraph("正文段落")
    out = BytesIO()
    doc.save(out)
    return out.getvalue()


def test_merge_pdfs_keeps_all_pages() -> None:
    merged = merge_pdfs([_pdf("one"), _pdf("two")])
    with pymupdf.open(stream=merged, filetype="pdf") as doc:
        assert doc.page_count == 2
        assert doc.metadata["title"] == "Rubbish 合集"


def test_merge_docx_keeps_all_paragraphs_and_page_breaks() -> None:
    merged = merge_docx([_docx("第一篇"), _docx("第二篇")])
    doc = Document(BytesIO(merged))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "第一篇" in text
    assert "第二篇" in text
    assert doc.core_properties.title == "Rubbish 合集"


def test_merge_requires_at_least_one_part() -> None:
    import pytest

    with pytest.raises(ValueError):
        merge_pdfs([])
    with pytest.raises(ValueError):
        merge_docx([])
