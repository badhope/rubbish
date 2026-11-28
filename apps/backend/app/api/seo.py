"""Crawler-facing endpoints for the community.

The SPA serves one ``index.html`` for every route, so crawlers need explicit
titles, descriptions, Open Graph tags and a sitemap. This module owns:

- ``robots.txt`` / ``sitemap.xml`` / ``llms.txt`` / RSS
- per-path ``<head>`` metadata for the SPA shell
- structured data for public archive records

Only published records are exposed. All interpolated values are HTML-escaped.
There is no academic citation metadata and no machine submission endpoint.
"""

from __future__ import annotations

import html
import json
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_db
from app.core.site_settings import get_access_policy
from app.domain.catalog.models import Resource
from app.domain.catalog.visibility import public_conditions
from app.models import Tenant

router = APIRouter(tags=["seo"])

SITE_NAME = "Rubbish"
SITE_TITLE = "Rubbish — 公开写作与讨论社区"
DEFAULT_DESCRIPTION = (
    "Rubbish 是一张公开的桌面。有人拆开一个问题，有人留下一次失败，也有人把不可能写得一本正经。"
    "长文在内容库，短帖在主题论坛，登录后可读；这里不做学术评价，也不出具任何证明。"
)

PAGE_META: dict[str, tuple[str, str]] = {
    "": (SITE_TITLE, DEFAULT_DESCRIPTION),
    "catalog": (
        "内容库 · 长文、怪问题与随手写",
        "长文、怪问题、小说与随笔。按合集慢慢读，或随手翻开一篇。",
    ),
    "forum": (
        "主题论坛 · 写法、复盘与组队",
        "写法、复盘、组队，以及写作之外的生活。登录即可发帖，不必攒经验。",
    ),
    "issues": (
        "合集 · 一组一组地读",
        "合集只把内容放在一起，便于顺着读。编号用于定位，不是等级，也不是公开先后。",
    ),
    "levels": (
        "参与记录 · 在站内留下的脚印",
        "发帖、讨论、发布与互评留下的记录。它不换权限，所有人从第一档开始。",
    ),
    "submissions": (
        "我的作品 · 发布与进度",
        "看已发布的作品、互评进度与版本；新作品也从这里开始。",
    ),
    "submissions/new": (
        "写新作品 · 从标题到正文",
        "填题名、开头与正文，草稿自动保存；发布后进入基础检查与互评。",
    ),
    "about": (
        "关于 Rubbish",
        "一张公开的桌面。问题可以怪，文字可以未竟，话要说明白。不做学术评价，也不出具公开证明。",
    ),
    "review": (
        "互评广场 · 作品还没揭开时",
        "作品还在互评里，作者和正文先不公开。你能看到标题、简介和主题；想参与，就向站务组申请。",
    ),
    "guide": (
        "怎么用 · 第一次来，先走一遍",
        "四步上手、全站地图与边界。第一次来，照着走一遍，不必着急。",
    ),
    "privacy": (
        "隐私政策",
        "只取社区运转所需之物，不做广告追踪，也不出售数据。",
    ),
}


def _root(request: Request) -> str:
    if settings.public_base_url:
        return settings.public_base_url.rstrip("/")
    return str(request.base_url).rstrip("/")


async def _published_resources(db: AsyncSession, limit: int = 5000) -> list[Resource]:
    tenant = (
        await db.execute(select(Tenant).where(Tenant.slug == settings.bootstrap_tenant_slug))
    ).scalar_one_or_none()
    if tenant is None:
        return []
    rows = (
        (
            await db.execute(
                select(Resource)
                .where(
                    Resource.tenant_id == tenant.id,
                    *public_conditions(),
                )
                .order_by(Resource.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


CRAWLER_RULES = [
    "Allow: /",
    "Allow: /api/catalog/*/export",
    "Allow: /api/catalog/*/img/",
    "Disallow: /api/",
    "Disallow: /admin",
    "Disallow: /dashboard",
    "Disallow: /me",
    "Disallow: /notifications",
]

# 明确允许主流检索与 AI 爬虫抓公开内容；管理端仍统一禁止。
AI_CRAWLERS = [
    "GPTBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-Web",
    "PerplexityBot",
    "Google-Extended",
    "Applebot-Extended",
    "CCBot",
    "Bytespider",
]


@router.get("/robots.txt", response_class=Response, include_in_schema=False)
async def robots(request: Request) -> Response:
    if get_access_policy().auth_wall_enabled:
        return Response(
            content=b"User-agent: *\nDisallow: /\n",
            media_type="text/plain; charset=utf-8",
        )
    lines = ["User-agent: *", *CRAWLER_RULES, ""]
    for bot in AI_CRAWLERS:
        lines.extend([f"User-agent: {bot}", *CRAWLER_RULES, ""])
    lines.append(f"Sitemap: {_root(request)}/sitemap.xml")
    lines.append(f"# LLM guide: {_root(request)}/llms.txt")
    body = "\n".join(lines) + "\n"
    return Response(
        content=body.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )


@router.get("/ai.txt", response_class=Response, include_in_schema=False)
async def ai_txt(request: Request) -> Response:
    """给 AI Agent 的机器可读边界说明。"""
    if get_access_policy().auth_wall_enabled:
        return Response(
            status_code=404, content="Not Found", media_type="text/plain; charset=utf-8"
        )
    root = _root(request)
    body = f"""# Rubbish AI Agent Policy

## 可以做什么
- 读取公开页面、内容库、主题帖与 RSS，遵守 /robots.txt。
- 引用时保留标题、作者、出处与原文链接。

## 不可以做什么
- 不要尝试登录、抓取 /admin、/me、/notifications 或他人数据。
- 本站没有机器发布 API；发帖与回复需要用户在网页登录后手动操作。
- 不要批量注册账号、刷积分、伪造出处或绕过限流与审核。

## 公开入口
- 首页：{root}/
- 主题论坛：{root}/forum
- 公开阅读列表：{root}/library
- 内容库：{root}/catalog
- 指南：{root}/guide
- 关于：{root}/about
- 机器可读站点说明：{root}/llms.txt

## 联系方式
- 站点政策：{root}/guide
- 隐私政策：{root}/privacy
"""
    return Response(
        content=body.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )


@router.get("/sitemap.xml", response_class=Response, include_in_schema=False)
async def sitemap(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    if get_access_policy().auth_wall_enabled:
        return Response(
            status_code=404, content="Not Found", media_type="text/plain; charset=utf-8"
        )
    root = _root(request)
    urls: list[tuple[str, str, str, str | None]] = [
        (f"{root}/", "weekly", "1.0", None),
        (f"{root}/catalog", "daily", "0.9", None),
        (f"{root}/issues", "weekly", "0.7", None),
        (f"{root}/levels", "monthly", "0.5", None),
        (f"{root}/forum", "daily", "0.8", None),
        (f"{root}/library", "daily", "0.7", None),
        (f"{root}/guide", "monthly", "0.6", None),
        (f"{root}/about", "monthly", "0.6", None),
        (f"{root}/privacy", "yearly", "0.3", None),
    ]
    rows = await _published_resources(db)
    for r in rows:
        lastmod = r.publish_at or r.updated_at or r.created_at
        urls.append(
            (
                f"{root}/catalog/{r.id}",
                "monthly",
                "0.7",
                lastmod.date().isoformat() if lastmod else None,
            )
        )

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for loc, changefreq, priority, last_modified in urls:
        lines.append(
            "  <url>"
            f"<loc>{html.escape(loc)}</loc>"
            + (f"<lastmod>{html.escape(str(last_modified))}</lastmod>" if last_modified else "")
            + f"<changefreq>{changefreq}</changefreq>"
            f"<priority>{priority}</priority>"
            "</url>"
        )
    lines.append("</urlset>")
    return Response(content="\n".join(lines), media_type="application/xml")


@router.get("/llms.txt", response_class=Response, include_in_schema=False)
async def llms_txt(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """Machine-readable guide for LLM crawlers and answer engines."""
    if get_access_policy().auth_wall_enabled:
        return Response(
            status_code=404, content="Not Found", media_type="text/plain; charset=utf-8"
        )
    root = _root(request)
    rows = await _published_resources(db, limit=200)
    lines = [
        "# Rubbish",
        "",
        "> Rubbish 是一个公开写作与讨论社区。主题帖做讨论，内容库做长文。",
        "> 公开内容可读；管理端与个人数据需要授权。这里不做学术评价。",
        "",
        "## 核心入口",
        f"- [首页]({root}/)",
        f"- [主题论坛]({root}/forum)",
        f"- [公开阅读列表]({root}/library)",
        f"- [内容库]({root}/catalog)",
        f"- [怎么用]({root}/guide)",
        f"- [关于]({root}/about)",
        f"- [隐私政策]({root}/privacy)",
        f"- [RSS]({root}/rss.xml)",
        f"- [Sitemap]({root}/sitemap.xml)",
        "",
        "## 最新公开内容",
    ]
    for r in rows[:50]:
        abstract = " ".join((r.abstract or "").split())[:180]
        line = f"- [{r.title}]({root}/catalog/{r.id})"
        if r.authors:
            line += f" — {', '.join(str(a) for a in r.authors)}"
        if abstract:
            line += f"：{abstract}"
        lines.append(line)
    lines.extend(
        [
            "",
            "## 抓取边界",
            "- 只抓公开页面；/admin、/me、/notifications 禁止；/library 只含公开列表，可以读。",
            "- 本站没有机器发布 API；发帖与回复需要用户手动操作。",
            f"- Sitemap: {root}/sitemap.xml",
            "",
        ]
    )
    return Response(
        content="\n".join(lines).encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )


@router.get("/feed.xml", response_class=Response, include_in_schema=False)
@router.get("/rss.xml", response_class=Response, include_in_schema=False)
async def rss_feed(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """RSS 2.0 feed of the latest published archive records."""
    if get_access_policy().auth_wall_enabled:
        return Response(
            status_code=404, content="Not Found", media_type="text/plain; charset=utf-8"
        )
    from email.utils import format_datetime

    root = _root(request)
    site = html.escape(settings.site_name)
    rows = await _published_resources(db, limit=50)
    items: list[str] = []
    for r in rows:
        link = f"{root}/catalog/{r.id}"
        summary = html.escape((r.abstract or "")[:500])
        pub_line = f"<pubDate>{format_datetime(r.created_at)}</pubDate>" if r.created_at else ""
        items.append(
            "<item>"
            f"<title>{html.escape(r.title)}</title>"
            f"<link>{html.escape(link)}</link>"
            f'<guid isPermaLink="true">{html.escape(link)}</guid>'
            f"<description>{summary}</description>"
            f"<author>{html.escape(', '.join(r.authors or []))}</author>"
            f"<category>{html.escape(r.discipline or '')}</category>"
            f"{pub_line}"
            "</item>"
        )
    latest = rows[0].created_at if rows else None
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>'
        f"<title>{site}</title>"
        f"<link>{html.escape(root)}</link>"
        f"<description>{site} · 公开写作与讨论社区 · 最新公开内容</description>"
        "<language>zh-cn</language>"
        f'<atom:link href="{html.escape(root)}/feed.xml" rel="self" type="application/rss+xml"/>'
        + (f"<lastBuildDate>{format_datetime(latest)}</lastBuildDate>" if latest else "")
        + "".join(items)
        + "</channel></rss>"
    )
    return Response(
        content=body.encode("utf-8"),
        media_type="application/rss+xml; charset=utf-8",
        headers={"Content-Type": "application/rss+xml; charset=utf-8"},
    )


@router.get("/feed.atom", response_class=Response, include_in_schema=False)
@router.get("/atom.xml", response_class=Response, include_in_schema=False)
async def atom_feed(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """Atom 1.0 feed of the latest published records; mirrors the RSS source."""
    if get_access_policy().auth_wall_enabled:
        return Response(
            status_code=404, content="Not Found", media_type="text/plain; charset=utf-8"
        )
    root = _root(request)
    site = html.escape(settings.site_name)
    rows = await _published_resources(db, limit=50)
    entries: list[str] = []
    for r in rows:
        link = f"{root}/catalog/{r.id}"
        updated = f"<updated>{r.created_at.isoformat()}</updated>" if r.created_at else ""
        entries.append(
            "<entry>"
            f"<title>{html.escape(r.title)}</title>"
            f"<id>{html.escape(link)}</id>"
            f'<link rel="alternate" href="{html.escape(link)}"/>'
            f"<summary>{html.escape((r.abstract or '')[:500])}</summary>"
            f"<author><name>{html.escape(', '.join(r.authors or []))}</name></author>"
            f'<category term="{html.escape(r.discipline or "")}"/>'
            f"{updated}"
            "</entry>"
        )
    latest = rows[0].created_at.isoformat() if rows else ""
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<feed xmlns="http://www.w3.org/2005/Atom">'
        f"<title>{site}</title>"
        f"<id>{html.escape(root)}/feed.atom</id>"
        f'<link rel="self" href="{html.escape(root)}/feed.atom"/>'
        f'<link rel="alternate" href="{html.escape(root)}/"/>'
        f"<updated>{latest}</updated>" + "".join(entries) + "</feed>"
    )
    return Response(
        content=body.encode("utf-8"),
        media_type="application/atom+xml; charset=utf-8",
        headers={"Content-Type": "application/atom+xml; charset=utf-8"},
    )


def _meta_tags(
    title: str,
    description: str,
    canonical: str,
    extra: str = "",
    *,
    root: str,
    og_type: str = "website",
) -> str:
    t = html.escape(title, quote=True)
    d = html.escape(description, quote=True)
    c = html.escape(canonical, quote=True)
    image = html.escape(f"{root.rstrip('/')}/brand/rubbish-og.png", quote=True)
    return (
        f'<meta name="description" content="{d}" />\n'
        f'<link rel="canonical" href="{c}" />\n'
        f'<link rel="alternate" type="application/rss+xml" title="{SITE_NAME} RSS" href="{root.rstrip("/")}/rss.xml" />\n'
        f'<link rel="alternate" type="application/atom+xml" title="{SITE_NAME} Atom" href="{root.rstrip("/")}/feed.atom" />\n'
        f'<meta property="og:type" content="{og_type}" />\n'
        '<meta property="og:locale" content="zh_CN" />\n'
        f'<meta property="og:site_name" content="{SITE_NAME}" />\n'
        f'<meta property="og:title" content="{t}" />\n'
        f'<meta property="og:description" content="{d}" />\n'
        f'<meta property="og:url" content="{c}" />\n'
        f'<meta property="og:image" content="{image}" />\n'
        '<meta property="og:image:width" content="1200" />\n'
        '<meta property="og:image:height" content="630" />\n'
        '<meta name="twitter:card" content="summary_large_image" />\n'
        f'<meta name="twitter:title" content="{t}" />\n'
        f'<meta name="twitter:description" content="{d}" />\n'
        f'<meta name="twitter:image" content="{image}" />\n'
        f"{extra}"
    )


def _record_date(r: Resource) -> str:
    """Use the real publish date when present; fall back to the year."""
    if r.publish_at is not None:
        return r.publish_at.date().isoformat()
    return str(int(r.year))


async def build_index_html(
    index_html: str,
    full_path: str,
    request: Request,
    db: AsyncSession,
) -> tuple[str, str]:
    """Return ``(html, status)`` for a SPA route."""
    if get_access_policy().auth_wall_enabled:
        # The SPA shell itself is public, but per-route title/description/JSON-LD
        # would leak article metadata to anonymous crawlers. Let the frontend
        # redirect visitors to the cover; serve only the generic shell here.
        return index_html, "200"
    root = _root(request)
    path = full_path.strip("/")
    title, description = PAGE_META.get(path, (SITE_TITLE, DEFAULT_DESCRIPTION))
    extra = ""
    status = "200"
    og_type = "website"

    if path.startswith("catalog/") and path.split("/", 1)[1].isdigit():
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == settings.bootstrap_tenant_slug))
        ).scalar_one_or_none()
        resource: Resource | None = None
        if tenant is not None:
            resource = (
                await db.execute(
                    select(Resource).where(
                        Resource.id == int(path.split("/", 1)[1]),
                        Resource.tenant_id == tenant.id,
                        *public_conditions(),
                    )
                )
            ).scalar_one_or_none()
        if resource is None:
            # Unpublished or absent: do not leak existence.
            title = f"未找到这条记录 — {SITE_NAME}"
            description = DEFAULT_DESCRIPTION
            extra = '<meta name="robots" content="noindex" />\n'
            status = "404"
        else:
            title = f"{resource.title} — {SITE_NAME}"
            description = (resource.abstract or DEFAULT_DESCRIPTION)[:300]
            og_type = "article"
            updated_at = resource.updated_at or resource.created_at or resource.publish_at
            published = _record_date(resource)
            payload: dict[str, Any] = {
                "@context": "https://schema.org",
                "@type": "CreativeWork",
                "headline": resource.title,
                "author": [{"@type": "Person", "name": str(a)} for a in resource.authors or []],
                "datePublished": published,
                "dateModified": (updated_at.date().isoformat() if updated_at else published),
                "abstract": (resource.abstract or "")[:2000],
                "url": f"{root}/catalog/{resource.id}",
                "mainEntityOfPage": {"@type": "WebPage", "@id": f"{root}/catalog/{resource.id}"},
                "isPartOf": {"@type": "WebSite", "name": SITE_NAME, "url": f"{root}/"},
                "publisher": {"@type": "Organization", "name": SITE_NAME, "url": f"{root}/"},
                "isAccessibleForFree": True,
                "inLanguage": resource.language or "zh",
                "image": f"{root}/brand/rubbish-og.png",
            }
            if resource.keywords:
                payload["keywords"] = ", ".join(str(k) for k in resource.keywords)
            extra = (
                f'<meta property="article:published_time" content="{html.escape(published, quote=True)}" />'
                '<meta property="article:section" content="内容" />\n'
            )
            breadcrumb = {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "首页", "item": f"{root}/"},
                    {
                        "@type": "ListItem",
                        "position": 2,
                        "name": "内容",
                        "item": f"{root}/catalog",
                    },
                    {
                        "@type": "ListItem",
                        "position": 3,
                        "name": resource.title,
                        "item": f"{root}/catalog/{resource.id}",
                    },
                ],
            }
            json_ld = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
            crumb_ld = json.dumps(breadcrumb, ensure_ascii=False).replace("</", "<\\/")
            extra += (
                f'\n<script type="application/ld+json">{json_ld}</script>'
                f'\n<script type="application/ld+json">{crumb_ld}</script>'
            )

    if not path:
        website = {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": SITE_NAME,
            "alternateName": "Rubbish Community",
            "url": f"{root}/",
            "description": DEFAULT_DESCRIPTION,
            "potentialAction": {
                "@type": "SearchAction",
                "target": f"{root}/catalog?q={{search_term_string}}",
                "query-input": "required name=search_term_string",
            },
            "publisher": {
                "@type": "Organization",
                "name": SITE_NAME,
                "url": f"{root}/",
                "logo": f"{root}/brand/rubbish-r-512.png",
            },
        }
        extra += (
            '<script type="application/ld+json">'
            + json.dumps(website, ensure_ascii=False).replace("</", "<\\/")
            + "</script>\n"
        )

    block = _meta_tags(
        title,
        description,
        f"{root}/{path}" if path else f"{root}/",
        extra,
        root=root,
        og_type=og_type,
    )
    out = index_html
    start = out.find("<title>")
    end = out.find("</title>", start) if start >= 0 else -1
    if start >= 0 and end >= 0:
        out = out[:start] + f"<title>{html.escape(title)}</title>" + out[end + len("</title>") :]
    if "</head>" in out:
        out = out.replace("</head>", f"    {block}\n  </head>", 1)
    return out, status


__all__: list[Any] = ["build_index_html", "router"]
