"""Unit tests for Markdown clean-export helpers (no PDF/docx rendering)."""

from __future__ import annotations

from app.domain.submission.clc import clc_status_of, parse_clc
from app.domain.submission.export_docs import (
    _story_html,
    _style_captions,
    md_to_html,
    preprocess_md,
)


def test_preprocess_headings_captions_and_images() -> None:
    md = (
        "## 2Methodology\n\n"
        "### _4_ 结论\n\n"
        "图 1 实验流程。这是一段足够长的图注后正文，用来验证图注与正文会被拆成两段。\n\n"
        "![图](https://example.com/a.png)\n图 1 图片说明\n"
    )
    out = preprocess_md(md)
    assert "## 2 Methodology" in out
    assert "### 4 结论" in out
    assert "图 1 实验流程。" in out
    assert "\n\n这是一段足够长" in out
    assert "\n\n![图](https://example.com/a.png)\n\n图 1 图片说明" in out
    assert preprocess_md(out) == out


def test_md_to_html_and_story_shell() -> None:
    html = md_to_html("| A | B |\n|---|---|\n| 1 | 2 |\n")
    assert "<table>" in html and "<td>1</td>" in html
    story = _story_html(html, "标题", "作者 · 2026")
    assert "<h1>标题</h1>" in story and "<table>" in story
    assert 'class="byline"' in story
    styled = _style_captions("<p>图 1 说明</p><p>正文</p>")
    assert 'class="caption"' in styled


def test_parse_clc_valid_invalid_and_absent() -> None:
    valid = parse_clc("---\nclc: tp311.13\nclc_label: 计算机\n---\n\n# 正文")
    assert valid.code == "TP311.13" and valid.status == "valid" and valid.label == "计算机"
    bad = parse_clc("---\nclc: not-a-code\n---\n")
    assert bad.code == "NOT-A-CODE" and bad.status == "needs_correction"
    assert parse_clc("# 无 front matter").status == "absent"
    assert clc_status_of(None) == "absent"
    assert clc_status_of("TP3") == "valid"
    assert clc_status_of("bad") == "needs_correction"


def test_md_pdf_docx_contract_keeps_core_fields() -> None:
    """统一转换契约：标题、作者、摘要、关键词、正文与表格必须进入两个出口。"""
    from io import BytesIO

    import pymupdf
    from docx import Document

    from app.domain.submission.export_docs import html_to_pdf, md_to_docx

    md = (
        "# 转换契约测试\n\n"
        "**作者：** 张三、李四\n\n"
        "## 摘要\n\n"
        "这是摘要正文，必须完整保留。\n\n"
        "**关键词：** 转换；契约；排版\n\n"
        "## 1 引言\n\n"
        "正文第一段。\n\n"
        "| 指标 | 数值 |\n"
        "|---|---|\n"
        "| 通过率 | 100% |\n"
    )
    pdf = html_to_pdf(md_to_html(md), "转换契约测试", "张三、李四 · 2026")
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        text = "\n".join(page.get_text("text", sort=True) for page in doc)
    assert "转换契约测试" in text
    assert "这是摘要正文" in text
    assert "关键词" in text
    assert "通过率" in text

    docx = md_to_docx(md, "转换契约测试", "张三、李四 · 2026")
    document = Document(BytesIO(docx))
    doc_text = "\n".join(p.text for p in document.paragraphs)
    assert "转换契约测试" in doc_text
    assert "这是摘要正文" in doc_text
    assert "话题" in doc_text
    table_text = "\n".join(
        cell.text for table in document.tables for row in table.rows for cell in row.cells
    )
    assert "通过率" in table_text
