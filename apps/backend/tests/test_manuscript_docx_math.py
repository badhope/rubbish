"""Regression: Word OMML 公式不能在 docx → Markdown 转换里丢失。"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pypandoc

from app.domain.submission.manuscript import (
    _clean_pandoc_reference_artifacts,
    convert_manuscript,
)
from app.domain.submission.normalize import normalize_markdown


def _math_docx() -> bytes:
    source = r"""
Inline formula $E = mc^{2}$ stays in the sentence.

$$
\int_{0}^{1} x^{2}\, dx = \frac{1}{3}
$$

$$
\begin{aligned}
K &= (\gamma - 1) m_{0} c^{2} \\
  &= \frac{1}{2} m_{0} v^{2} + O(\beta^{4})
\end{aligned}
$$
"""
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp, "math.docx")
        pypandoc.convert_text(source, "docx", format="markdown", outputfile=target.as_posix())
        return target.read_bytes()


def test_docx_omml_math_is_kept() -> None:
    result = convert_manuscript(_math_docx(), "math.docx")

    assert result.markdown is not None
    assert "E = mc^{2}" in result.markdown
    assert r"\frac{1}{3}" in result.markdown
    assert r"\gamma" in result.markdown
    # 块级公式必须是 $$，否则 remark-math 按行内公式解析，aligned 环境会坏。
    assert "$$" in result.markdown
    assert "$$\\n\\\\begin{aligned}" not in result.markdown


def test_normalize_keeps_latex_bytes_exact() -> None:
    source = (
        "正文第一段。\n\n"
        "$$\n\\begin{aligned}\n"
        "K &= (\\gamma - 1) m_{0} c^{2} \\\\\n"
        "  &= \\frac{1}{2} m_{0} v^{2}\n"
        "\\end{aligned}\n\\tag{3.5}\n$$\n\n"
        "正文第二段。\n"
    )
    out = normalize_markdown(source)

    assert out.count("$$") == 2
    assert "\\tag{3.5}" in out
    assert "\\begin{aligned}" in out
    assert "正文第一段。" in out and "正文第二段。" in out


def test_plain_docx_still_uses_legacy_path() -> None:
    """没有公式的 docx 不应被 pandoc 重排，保持 mammoth 的旧行为。"""
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp, "plain.docx")
        pypandoc.convert_text(
            "# 标题\n\n普通段落，没有公式。\n",
            "docx",
            format="markdown",
            outputfile=target.as_posix(),
        )
        docx = target.read_bytes()
    result = convert_manuscript(docx, "plain.docx")

    assert result.markdown is not None
    assert "普通段落" in result.markdown
    assert "$" not in result.markdown


def test_pandoc_word_reference_artifacts_are_removed() -> None:
    source = (
        "正文引用 [\\[1\\]](#_Ref218149556)，以及 [\\[3, 4\\]](#_Ref218149530)。\n\n"
        "1. []{#_Ref218149556 .anchor}Einstein, A. (1905).\n"
    )
    out = _clean_pandoc_reference_artifacts(source)

    assert "_Ref" not in out
    assert "\\[" not in out and "\\]" not in out
    assert "[1]" in out and "[3, 4]" in out
    assert "Einstein, A. (1905)." in out
