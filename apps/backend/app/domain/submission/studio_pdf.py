"""Studio 排版 PDF：用与网页预览同一套题录顺序和排版规则出 A4 PDF。

与 catalog 导出（docx→LibreOffice）的区别：
- 不经过 Word，直接由 PyMuPDF Story 渲染，适合“所见即所得”的发布排版预览下载；
- 题录结构化传入（主副标题、作者上标、单位、摘要、关键词、CLC/DOI/基金），
  不再依赖从 Markdown 正文里猜元信息；
- 页眉页脚在渲染后统一盖章，与预览里的「RUBBISH JOURNAL / 第 x 页 / 共 n 页」一致。

字体策略：正文优先 Noto Serif CJK SC，Story 找不到时回退内置 china-s（宋体），
和 docx 模板的衬线基调一致；页眉页脚用内置黑体，避免额外字体依赖。
"""

from __future__ import annotations

import html
import io
import os
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
body { font-family: "Noto Serif CJK SC", china-s; font-size: 10.5pt; line-height: 1.85; color: #1b211d; }
.title { font-size: 18pt; font-weight: bold; text-align: center; margin: 0 0 4pt 0; line-height: 1.35; }
.title.long { font-size: 16pt; }
.title.xlong { font-size: 14.5pt; }
.subtitle { font-size: 11pt; text-align: center; color: #44514a; margin: 0 0 10pt 0; }
.authors { font-size: 10pt; text-align: center; margin: 0 0 3pt 0; }
.affs { font-size: 8.5pt; text-align: center; color: #5d6b60; margin: 0 0 3pt 0; line-height: 1.6; }
.num { font-family: "Times-Roman"; }
.formula { font-family: "Times-Roman"; font-style: italic; }
.meta { font-size: 8.5pt; text-align: center; color: #5d6b60; margin: 0 0 3pt 0; }
.cite { font-size: 8pt; text-align: center; color: #6b7a70; margin: 0 0 10pt 0; }
.abstract { background-color: #f5f7f3; border-left: 2pt solid #2e5e4a; padding: 8pt 10pt; margin: 10pt 0 8pt 0; }
.abstract .label { font-size: 8pt; font-weight: bold; letter-spacing: 3pt; color: #2e5e4a; margin: 0 0 4pt 0; }
.abstract p { font-size: 9.5pt; line-height: 1.8; margin: 0; }
.keywords { font-size: 9pt; margin: 4pt 0 10pt 0; line-height: 1.7; }
h2 { font-size: 12pt; font-weight: bold; margin: 12pt 0 5pt 0; }
h3 { font-size: 10.5pt; margin: 10pt 0 4pt 0; }
p { margin: 4pt 0; text-align: justify; }
table { border-collapse: collapse; margin: 8pt auto; }
th, td { border: 0.6pt solid #444; padding: 3pt 6pt; font-size: 9pt; }
img { display: block; margin: 8pt auto; width: 320px; }
blockquote { color: #444; margin: 6pt 12pt; }
code { font-family: monospace; font-size: 9pt; }
"""


_SUP_MAP = str.maketrans("0123456789,，", "⁰¹²³⁴⁵⁶⁷⁸⁹··")


def _sup(text: str) -> str:
    """Story 不支持 vertical-align/sup，用 Unicode 上标数字替代。"""
    return (text or "").translate(_SUP_MAP)


_GREEK = {
    "alpha": "α",
    "beta": "β",
    "gamma": "γ",
    "delta": "δ",
    "epsilon": "ε",
    "zeta": "ζ",
    "eta": "η",
    "theta": "θ",
    "lambda": "λ",
    "mu": "μ",
    "nu": "ν",
    "xi": "ξ",
    "pi": "π",
    "rho": "ρ",
    "sigma": "σ",
    "tau": "τ",
    "phi": "φ",
    "chi": "χ",
    "psi": "ψ",
    "omega": "ω",
    "Gamma": "Γ",
    "Delta": "Δ",
    "Theta": "Θ",
    "Lambda": "Λ",
    "Pi": "Π",
    "Sigma": "Σ",
    "Phi": "Φ",
    "Psi": "Ψ",
    "Omega": "Ω",
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


def _strip_meta_sections(body_md: str) -> str:
    """去掉正文开头重复的「摘要 / 关键词」块（元信息已在题录区印过一次）。"""
    import re

    text = body_md or ""
    # 只在文档最前面处理，避免误删正文中段的同名小节。
    text = re.sub(
        r"^\s*#{1,6}\s*(?:摘\s*要|关键词)\s*\n+.*?\n(?=#{1,6}\s)",
        "",
        text,
        count=1,
        flags=re.S,
    )
    text = re.sub(
        r"^\s*#{1,6}\s*(?:摘\s*要|关键词)\s*\n+.*?\n(?=#{1,6}\s)",
        "",
        text,
        count=1,
        flags=re.S,
    )
    return text.lstrip("\n")


def _inline_image_sources(fragment: str) -> str:
    """把正文里的同站图片取回并内联成 data URI；Story 不会自己请求 HTTP 图。"""
    import base64
    import re
    from urllib.request import ProxyHandler, Request, build_opener

    pattern = re.compile(r'src="([^"]+)"')

    def sniff(raw: bytes) -> str:
        if raw.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if raw.startswith(b"\x89PNG"):
            return "image/png"
        if raw.startswith(b"GIF8"):
            return "image/gif"
        return "image/png"

    def repl(match: re.Match[str]) -> str:
        src = match.group(1)
        if not (
            src.startswith("/api/catalog/")
            or src.startswith("https://rubbish.argjiemi.cn/api/catalog/")
        ):
            return match.group(0)
        url = (
            f"http://localhost:{os.environ.get('PORT', '8000')}" + src
            if src.startswith("/api/")
            else src.replace(
                "https://rubbish.argjiemi.cn",
                f"http://localhost:{os.environ.get('PORT', '8000')}",
                1,
            )
        )
        try:
            req = Request(url, headers={"User-Agent": "rubbish-studio-pdf/1.0"})
            opener = build_opener(ProxyHandler({}))
            with opener.open(req, timeout=8) as resp:
                raw = resp.read()
            if not raw:
                return match.group(0)
            mime = sniff(raw)
            # Story 会按图片原始像素宽度铺满版面，用 width 属性把它压到 360px；
            # 保留原始字节，不物理降采样，避免论文插图被压成马赛克。
            data = base64.b64encode(raw).decode("ascii")
            return f'src="data:{mime};base64,{data}" width="460"'
        except Exception:
            return match.group(0)

    return pattern.sub(repl, fragment)


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
        meta_parts.append(f'中图分类号 <span class="num">{_esc(meta["clc"])}</span>')
    if meta.get("doi"):
        meta_parts.append(f'DOI <span class="num">{_esc(meta["doi"])}</span>')
    if meta.get("funding"):
        meta_parts.append(f"基金：{_esc(meta['funding'])}")
    meta_line = "　·　".join(meta_parts)

    cite_parts = []
    if meta.get("year") or meta.get("volume") or meta.get("issue"):
        vi = []
        if meta.get("year"):
            vi.append(str(meta["year"]))
        if meta.get("volume"):
            vi.append(f"合集 {meta['volume']}")
        if meta.get("issue"):
            vi.append(f"第 {meta['issue']} 组")
        cite_parts.append(" · ".join(vi))
    if meta.get("pages"):
        cite_parts.append(f"页码 {_esc(str(meta['pages']))}")
    if meta.get("site_id"):
        cite_parts.append(f"本站站内编号: {_esc(str(meta['site_id']))}")
    cite_line = "　·　".join(cite_parts)

    abstract = meta.get("abstract") or ""
    abstract_html = (
        f'<div class="abstract"><div class="label">开头</div>{_math_html(md_to_html(abstract))}</div>'
        if abstract.strip()
        else ""
    )
    keywords_html = (
        f'<div class="keywords"><b>话题：</b>{_esc("；".join(keywords))}</div>' if keywords else ""
    )

    return f"""<html><body>
<div class="title{" xlong" if len(title) > 28 else (" long" if len(title) > 22 else "")}">{_esc(title)}</div>
{f'<div class="subtitle">——{_esc(subtitle)}</div>' if subtitle else ""}
<div class="authors">{_author_html(authors) or "作者未填写"}</div>
{f'<div class="affs">{_affiliations_html(meta.get("affiliations", ""))}</div>' if meta.get("affiliations") else ""}
{f'<div class="meta">{meta_line}</div>' if meta_line else ""}
{f'<div class="cite">{cite_line}</div>' if cite_line else ""}
{abstract_html}
{keywords_html}
{_inline_image_sources(_math_html(md_to_html(_strip_meta_sections(body_md))))}
</body></html>"""


def render_studio_pdf(meta: dict[str, Any], body_md: str) -> bytes:
    import pymupdf

    html_text = build_studio_html(meta, body_md)
    # 直接使用系统 Noto Serif CJK SC，不再走 fontTools 的 CID 子集。
    # 实测 PyMuPDF 2.0 对子集 OTF 的 CMap 映射会错位，导致正文出现
    # “PADA-Vृ”这类乱码；全量嵌入换来正确字形，2 MB 左右的体积可接受。
    font_dir = None
    story = pymupdf.Story(
        html=html_text,
        user_css=_CSS,
        em=11,
        archive=pymupdf.Archive("/usr/share/fonts/opentype/noto/"),
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
    license_text = (
        f"{'自由创作 · 非学术文章格式' if meta.get('track') == 'essay' else '研究文章 · 学术排版'}"
    )
    if meta.get("license"):
        license_text += f" · {meta['license']}"
    for i, page in enumerate(doc, start=1):
        page.insert_text(
            (40.5, 26),
            "RUBBISH",
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
    doc.set_metadata(
        {
            "title": str(meta.get("title") or ""),
            "author": "；".join(str(a) for a in (meta.get("authors") or [])),
            "subject": "Rubbish · " + str(meta.get("track") or "article"),
            "keywords": "；".join(str(k) for k in (meta.get("keywords") or [])),
            "creator": "Rubbish Studio",
            "producer": "Rubbish",
        }
    )
    packed = io.BytesIO()
    doc.save(packed, deflate=True, garbage=4, deflate_images=True, deflate_fonts=True)
    if font_dir:
        import shutil

        shutil.rmtree(font_dir, ignore_errors=True)
    return packed.getvalue()
