"""Studio 排版 PDF：用与网页预览同一套题录顺序和排版规则出 A4 PDF。

与 catalog 导出（docx→LibreOffice）的区别：
- 不经过 Word，直接由 PyMuPDF Story 渲染，适合“所见即所得”的投稿排版预览下载；
- 题录结构化传入（主副标题、作者上标、单位、摘要、关键词、CLC/DOI/基金），
  不再依赖从 Markdown 正文里猜元信息；
- 页眉页脚在渲染后统一盖章，与预览里的「RUBBISH JOURNAL / 第 x 页 / 共 n 页」一致。

字体策略：正文优先 Noto Serif CJK SC，Story 找不到时回退内置 china-s（宋体），
和 docx 模板的衬线基调一致；页眉页脚用内置黑体，避免额外字体依赖。
"""

from __future__ import annotations

import html
import io
import re
from typing import Any


_SERIF_SRC = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"


def _subset_font(html_text: str) -> str | None:
    """只保留文档实际用到的字符，避免把 20MB 的 Noto Serif 全量塞进 PDF。

    Story 嵌 TTC 后是 CID Type 0C，PyMuPDF 的 subset_fonts 无法再裁；
    因此用 fontTools 先生成按字符集裁剪的 OTF，再交给 @font-face。
    """
    import os
    import re
    import tempfile
    from html import unescape

    try:
        from fontTools.subset import Options, Subsetter
        from fontTools.ttLib import TTFont
    except Exception:
        return None
    if not os.path.exists(_SERIF_SRC):
        return None
    plain = unescape(re.sub(r"<[^>]+>", "", html_text))
    chars = set(plain) | set(
        " 0123456789.,;:()[]{}%-/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    )
    chars.discard("\n")
    chars.discard("\r")
    font = TTFont(_SERIF_SRC, fontNumber=0)
    opts = Options()
    opts.name_IDs = ["*"]
    opts.name_legacy = True
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.recalc_timestamp = False
    subsetter = Subsetter(options=opts)
    subsetter.populate(unicodes={ord(c) for c in chars})
    subsetter.subset(font)
    tmpdir = tempfile.mkdtemp(prefix="studio-pdf-")
    font.save(os.path.join(tmpdir, "PaperSerif.otf"))
    return tmpdir


_PAGE_W, _PAGE_H = 595, 842  # A4 pt
_MARGIN_X, _MARGIN_TOP, _MARGIN_BOTTOM = 40.5, 37.5, 34.5

_CSS = """
@font-face { font-family: "PaperSerif"; src: url("PaperSerif.otf"); }
body { font-family: "PaperSerif", "Noto Serif CJK SC", china-s; font-size: 10.5pt; line-height: 1.85; color: #1b211d; }
.title { font-size: 20pt; font-weight: bold; text-align: center; margin: 0 0 4pt 0; line-height: 1.35; }
.subtitle { font-size: 11pt; text-align: center; color: #44514a; margin: 0 0 10pt 0; }
.authors { font-size: 10pt; text-align: center; margin: 0 0 3pt 0; }
.affs { font-size: 8.5pt; text-align: center; color: #5d6b60; margin: 0 0 3pt 0; line-height: 1.6; }
.num { font-family: "Times-Roman"; }
.formula { font-family: "Times-Roman"; font-style: italic; }
.meta { font-size: 8.5pt; text-align: center; color: #5d6b60; margin: 0 0 10pt 0; }
.abstract { background-color: #f5f7f3; border-left: 2pt solid #2e5e4a; padding: 8pt 10pt; margin: 10pt 0 8pt 0; }
.abstract .label { font-size: 8pt; font-weight: bold; letter-spacing: 3pt; color: #2e5e4a; margin: 0 0 4pt 0; }
.abstract p { font-size: 9.5pt; line-height: 1.8; margin: 0; }
.keywords { font-size: 9pt; margin: 4pt 0 10pt 0; line-height: 1.7; }
h2 { font-size: 12pt; font-weight: bold; margin: 12pt 0 5pt 0; }
h3 { font-size: 10.5pt; margin: 10pt 0 4pt 0; }
p { margin: 4pt 0; text-align: justify; }
table { border-collapse: collapse; margin: 8pt auto; }
th, td { border: 0.6pt solid #444; padding: 3pt 6pt; font-size: 9pt; }
img { display: block; margin: 8pt auto; }
blockquote { color: #444; margin: 6pt 12pt; }
code { font-family: monospace; font-size: 9pt; }
"""


_SUP_MAP = str.maketrans("0123456789,，", "⁰¹²³⁴⁵⁶⁷⁸⁹··")


def _sup(text: str) -> str:
    """Story 不支持 vertical-align/sup，用 Unicode 上标数字替代。"""
    return (text or "").translate(_SUP_MAP)


_GREEK = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε",
    "zeta": "ζ", "eta": "η", "theta": "θ", "lambda": "λ", "mu": "μ",
    "nu": "ν", "xi": "ξ", "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ",
    "phi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
    "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Pi": "Π",
    "Sigma": "Σ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",
}
_SUP_DIGITS = str.maketrans("0123456789+-n", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ")


def _tex_to_text(tex: str) -> str:
    """把常见 TeX 片段降级成可读文本（PDF 无 KaTeX，先保证不是源码）。"""
    import re

    text = tex.strip()
    text = re.sub(r"\\left|\\right|\\,|\\;|\\!", "", text)
    text = re.sub(r"\\(?:mathbb|mathbf|mathrm|mathcal|text|operatorname)\{(.+?)\}", r"\1", text)
    for _ in range(3):
        text = re.sub(r"\\frac\{(.+?)\}\{(.+?)\}", r"(\1)/(\2)", text)
    text = re.sub(r"\\sqrt\{(.+?)\}", r"√(\1)", text)
    for name, char in _GREEK.items():
        text = re.sub(rf"\\{name}\b", char, text)
    text = text.replace("\\sim", "∼").replace("\\cdot", "·").replace("\\times", "×")
    text = text.replace("\\le", "≤").replace("\\ge", "≥").replace("\\neq", "≠")
    text = text.replace("\\infty", "∞").replace("\\pm", "±").replace("\\to", "→")
    text = re.sub(r"\^{([0-9n+\-]+)}", lambda m: m.group(1).translate(_SUP_DIGITS), text)
    text = re.sub(r"\^([0-9n])", lambda m: m.group(1).translate(_SUP_DIGITS), text)
    text = text.replace("\\", "")
    return text.strip()


def _math_html(fragment: str) -> str:
    """$...$ / $$...$$ → 可读公式文本；Story 不支持 KaTeX。"""
    import re

    def block(match: re.Match[str]) -> str:
        return f'<div class="formula">{html.escape(_tex_to_text(match.group(1)))}</div>'

    def inline(match: re.Match[str]) -> str:
        return f'<span class="formula">{html.escape(_tex_to_text(match.group(1)))}</span>'

    fragment = re.sub(r"\$\$(.+?)\$\$", block, fragment, flags=re.S)
    fragment = re.sub(r"\$(.+?)\$", inline, fragment, flags=re.S)
    return fragment

_AUTHOR_SUP = re.compile(r"^([^0-9*]+?)\s*([0-9,，\s]*)(\*?)$")


def _esc(value: str) -> str:
    return html.escape(value or "", quote=False)


def _split_title(title: str) -> tuple[str, str]:
    parts = re.split(r"\s*——\s*", title or "", maxsplit=1)
    if len(parts) == 2:
        return parts[0], parts[1]
    return title or "未填写标题", ""


def _author_html(authors: list[str]) -> str:
    """把「张三1,2*」拆成姓名 + 上标 + 通讯标记；与网页预览同一规则。"""
    rendered: list[str] = []
    for raw in authors:
        raw = (raw or "").strip()
        if not raw:
            continue
        m = _AUTHOR_SUP.match(raw)
        if m and (m.group(2).strip() or m.group(3)):
            name = m.group(1).strip()
            sup = re.sub(r"[，\s]+", ",", m.group(2).strip()).strip(",")
            star = m.group(3)
            suffix = _sup(_esc(sup)) if sup else ""
            rendered.append(f"{_esc(name)}{suffix}{star}")
        else:
            rendered.append(_esc(raw))
    return "　".join(rendered)


def _affiliations_html(affiliations: str) -> str:
    lines = [ln.strip() for ln in re.split(r"[\n；;]+", affiliations or "") if ln.strip()]
    if not lines:
        return ""
    out = []
    for i, line in enumerate(lines, start=1):
        line = re.sub(r"^\s*[0-9]+[.、)]\s*", "", line)
        out.append(f"{_sup(str(i))} {_esc(line)}")
    return "<br/>".join(out)


def build_studio_html(meta: dict[str, Any], body_md: str) -> str:
    from app.domain.submission.export_docs import md_to_html

    title, subtitle = _split_title(meta.get("title", ""))
    authors = meta.get("authors") or []
    if isinstance(authors, str):
        authors = [a for a in re.split(r"[,，、;；]+", authors) if a.strip()]
    keywords = meta.get("keywords") or []
    if isinstance(keywords, str):
        keywords = [k for k in re.split(r"[,，、;；]+", keywords) if k.strip()]

    meta_parts = []
    if meta.get("clc"):
        meta_parts.append(
            f"中图分类号 <span class=\"num\">{_esc(meta['clc'])}</span>"
        )
    if meta.get("doi"):
        meta_parts.append(f"DOI <span class=\"num\">{_esc(meta['doi'])}</span>")
    if meta.get("funding"):
        meta_parts.append(f"基金：{_esc(meta['funding'])}")
    meta_line = "　·　".join(meta_parts)

    abstract = meta.get("abstract") or ""
    abstract_html = (
        f'<div class="abstract"><div class="label">摘 要</div>{_math_html(md_to_html(abstract))}</div>'
        if abstract.strip()
        else ""
    )
    keywords_html = (
        f'<div class="keywords"><b>关键词：</b>{_esc("；".join(keywords))}</div>'
        if keywords
        else ""
    )

    return f"""<html><body>
<div class="title">{_esc(title)}</div>
{f'<div class="subtitle">——{_esc(subtitle)}</div>' if subtitle else ''}
<div class="authors">{_author_html(authors) or '作者未填写'}</div>
{f'<div class="affs">{_affiliations_html(meta.get("affiliations",""))}</div>' if meta.get('affiliations') else ''}
{f'<div class="meta">{meta_line}</div>' if meta_line else ''}
{abstract_html}
{keywords_html}
{_math_html(md_to_html(body_md))}
</body></html>"""


def render_studio_pdf(meta: dict[str, Any], body_md: str) -> bytes:
    import pymupdf

    html_text = build_studio_html(meta, body_md)
    font_dir = _subset_font(html_text)
    story = pymupdf.Story(
        html=html_text,
        user_css=_CSS,
        em=11,
        archive=pymupdf.Archive(font_dir or "/usr/share/fonts/opentype/noto/"),
    )
    buf = io.BytesIO()
    writer = pymupdf.DocumentWriter(buf)
    mediabox = pymupdf.paper_rect("a4")
    where = pymupdf.Rect(
        mediabox.x0 + _MARGIN_X,
        mediabox.y0 + _MARGIN_TOP,
        mediabox.x1 - _MARGIN_X,
        mediabox.y1 - _MARGIN_BOTTOM,
    )
    more = 1
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()

    doc = pymupdf.open(stream=buf.getvalue(), filetype="pdf")
    total = doc.page_count
    license_text = f"{'副刊 · 非论文格式' if meta.get('track') == 'essay' else '论文轨 · 学术排版'}"
    if meta.get("license"):
        license_text += f" · {meta['license']}"
    for i, page in enumerate(doc, start=1):
        page.insert_text(
            (40.5, 26),
            "RUBBISH JOURNAL",
            fontsize=7.5,
            fontname="helv",
            color=(0.36, 0.42, 0.38),
        )
        page.insert_text(
            (430, 26),
            "rubbish.argjiemi.cn",
            fontsize=7.5,
            fontname="helv",
            color=(0.36, 0.42, 0.38),
        )
        page.draw_line((40.5, 31), (554.5, 31), color=(0.84, 0.87, 0.83), width=0.5)
        page.insert_text(
            (40.5, 816),
            license_text,
            fontsize=7.5,
            fontname="china-ss",
            color=(0.42, 0.48, 0.44),
        )
        page.insert_text(
            (470, 816),
            f"第 {i} 页 / 共 {total} 页",
            fontsize=7.5,
            fontname="china-ss",
            color=(0.42, 0.48, 0.44),
        )
    packed = io.BytesIO()
    doc.save(packed, deflate=True, garbage=4, deflate_images=True, deflate_fonts=True)
    if font_dir:
        import shutil

        shutil.rmtree(font_dir, ignore_errors=True)
    return packed.getvalue()
