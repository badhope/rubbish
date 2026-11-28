"""Export API routes — ``GET /api/export`` downloads a citation file.

``GET /api/export/preflight`` checks required citation fields first.

Public endpoint (no auth required, like the catalog list). The caller
supplies ``ids`` (repeated query param) and ``format``; the endpoint
fetches matching resources from the catalog module and pipes them
through the serializer.

Cap on ids is enforced to bound response size and DB load.
"""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_tenant_id
from app.core.db import get_db
from app.domain.catalog.models import Resource
from app.domain.catalog.visibility import public_conditions
from app.domain.export.exporters import (
    FILE_EXTENSIONS,
    MIME_TYPES,
    Exportable,
    export_field_warnings,
    export_resources,
)

router = APIRouter(prefix="/export", tags=["export"])

EXPORT_MAX_IDS = 500
EXPORT_DOC_MAX_IDS = 20


class PreflightWarning(BaseModel):
    resource_id: int | str
    title: str
    code: str
    message: str


class ExportPreflightResponse(BaseModel):
    requested_count: int
    resolved_count: int
    missing_ids: list[int]
    warnings: list[PreflightWarning]
    can_export: bool


async def _load_resources(db: AsyncSession, ids: list[int]) -> dict[int, Resource]:
    tenant_id = require_tenant_id()
    result = await db.execute(
        select(Resource).where(
            Resource.id.in_(ids),
            Resource.tenant_id == tenant_id,
            *public_conditions(),
        )
    )
    return {resource.id: resource for resource in result.scalars().all()}


@router.get("/preflight", response_model=ExportPreflightResponse)
async def export_preflight(
    ids: list[int] = Query(default_factory=list),
    db: AsyncSession = Depends(get_db),
) -> ExportPreflightResponse:
    """Export 前的字段检查：缺标题/作者/年份/DOI 时给 warning，不静默导出。

    与 ``GET /api/export`` 使用同一套可见性边界；无匹配资源时仍返回 200，
    由前端决定是提示「已被删除/未公开」还是继续。最多 500 条，避免把
    这个只读检查变成批量枚举接口。
    """

    requested_ids = list(dict.fromkeys(ids))
    if len(requested_ids) > EXPORT_MAX_IDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many ids requested ({len(requested_ids)}); limit is {EXPORT_MAX_IDS}.",
        )
    if not requested_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one `ids` query parameter is required.",
        )
    resources_by_id = await _load_resources(db, requested_ids)
    ordered = [resources_by_id[i] for i in requested_ids if i in resources_by_id]
    missing_ids = [i for i in requested_ids if i not in resources_by_id]
    warnings = export_field_warnings(cast(list[Exportable], ordered))
    return ExportPreflightResponse(
        requested_count=len(requested_ids),
        resolved_count=len(ordered),
        missing_ids=missing_ids,
        warnings=[PreflightWarning(**warning) for warning in warnings],
        can_export=bool(ordered),
    )


async def _load_article_docs(
    db: AsyncSession, resources: list[Resource]
) -> tuple[list[tuple[Resource, str]], list[int]]:
    """Load the first online Markdown for each resource; return docs and skipped ids."""
    from app.core.storage import get_storage
    from app.domain.submission.export_docs import preprocess_md
    from app.domain.submission.models import Submission

    if not resources:
        return [], []
    rows = (
        await db.execute(
            select(Submission.resource_id, Submission.markdown_path)
            .where(
                Submission.tenant_id == require_tenant_id(),
                Submission.resource_id.in_([r.id for r in resources]),
                Submission.markdown_path.is_not(None),
                Submission.markdown_path != "",
            )
            .order_by(Submission.id.asc())
        )
    ).all()
    markdown_paths: dict[int, str] = {}
    for resource_id, path in rows:
        markdown_paths.setdefault(int(resource_id or 0), str(path))

    storage = get_storage()
    documents: list[tuple[Resource, str]] = []
    skipped_ids: list[int] = []
    for resource in resources:
        path = markdown_paths.get(resource.id)
        if not path:
            skipped_ids.append(resource.id)
            continue
        try:
            raw = await storage.load(path)
        except FileNotFoundError:
            skipped_ids.append(resource.id)
            continue
        md = _redact_export_essay(preprocess_md(raw.decode("utf-8", errors="replace")), resource)
        documents.append((resource, md))
    return documents, skipped_ids


def _byline(resource: Resource) -> str | None:
    authors = "、".join(resource.authors or [])
    year = str(resource.year or "")
    return " · ".join(part for part in (authors, year) if part) or None


def _build_pdf(resource: Resource, md: str) -> bytes:
    from app.domain.submission.export_docs import html_to_pdf, md_to_html

    return html_to_pdf(md_to_html(md), resource.title, _byline(resource))


def _build_docx(resource: Resource, md: str) -> bytes:
    from app.domain.submission.export_docs import md_to_docx

    return md_to_docx(md, resource.title, _byline(resource))


def _safe_name(resource: Resource, index: int, ext: str) -> str:
    import re

    title = re.sub(
        r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "-", resource.title or f"article-{resource.id}"
    )
    return f"{index:02d}-{title[:60].strip('-')}.{ext}".replace("/", "-")


def _zip_documents(
    documents: list[tuple[Resource, str]],
    skipped_ids: list[int],
    *,
    extra_files: dict[str, bytes] | None = None,
) -> bytes:
    import json
    import zipfile
    from io import BytesIO

    out = BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, blob in (extra_files or {}).items():
            archive.writestr(name, blob)
        for index, (resource, md) in enumerate(documents, start=1):
            archive.writestr(_safe_name(resource, index, "pdf"), _build_pdf(resource, md))
        archive.writestr(
            "manifest.json",
            (
                json.dumps(
                    {
                        "count": len(documents),
                        "skipped_ids": skipped_ids,
                        "documents": [
                            {"id": resource.id, "title": resource.title}
                            for resource, _ in documents
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n"
            ).encode("utf-8"),
        )
    return out.getvalue()


def _render_documents(documents: list[tuple[Resource, str]], format: str) -> bytes:
    from app.domain.submission.export_docs import merge_docx, merge_pdfs

    if format == "zip":
        return _zip_documents(documents, [])
    parts = [
        _build_pdf(resource, md) if format == "pdf" else _build_docx(resource, md)
        for resource, md in documents
    ]
    if format == "pdf":
        return merge_pdfs(parts, title=f"Rubbish 合集（{len(parts)} 篇）")
    return merge_docx(parts, title=f"Rubbish 合集（{len(parts)} 篇）")


def _document_response(
    payload: bytes,
    *,
    format: str,
    count: int,
    skipped_ids: list[int],
    filename_stem: str,
) -> Response:
    from urllib.parse import quote

    extension = {"pdf": "pdf", "docx": "docx", "zip": "zip"}[format]
    media_type = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "zip": "application/zip",
    }[format]
    readable = f"{filename_stem}-{count}篇.{extension}"
    headers = {
        "Content-Disposition": (
            f'attachment; filename="rubbish-collection.{extension}"; '
            f"filename*=UTF-8''{quote(readable)}"
        ),
        "X-Rubbish-Skipped-Ids": ",".join(str(i) for i in skipped_ids),
        "Cache-Control": "private, max-age=600",
    }
    return Response(content=payload, media_type=media_type, headers=headers)


@router.get("/documents")
async def export_documents(
    ids: list[int] = Query(default_factory=list),
    format: str = Query(default="pdf", pattern="^(pdf|docx|zip)$"),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """批量导出正文文档：合并 PDF / 合并 Word / 逐篇 ZIP。

    引用文件（BibTeX/RIS 等）走 ``/api/export``；这里只处理正文。最多 20 篇，
    既避免一次请求把 CPU 与内存打满，也让编辑能一次打包「本期专题」。
    没有线上 Markdown 的作品会被跳过；全部缺失时返回 404。
    """

    import asyncio

    requested_ids = list(dict.fromkeys(ids))
    if not requested_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one `ids` query parameter is required.",
        )
    if len(requested_ids) > EXPORT_DOC_MAX_IDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many ids requested ({len(requested_ids)}); limit is {EXPORT_DOC_MAX_IDS}.",
        )

    resources_by_id = await _load_resources(db, requested_ids)
    ordered = [resources_by_id[i] for i in requested_ids if i in resources_by_id]
    if not ordered:
        raise HTTPException(status_code=404, detail="No resources found for the given ids.")

    documents, skipped_ids = await _load_article_docs(db, ordered)
    if not documents:
        raise HTTPException(status_code=404, detail="所选内容没有可导出的在线正文。")

    def _render() -> bytes:
        if format == "zip":
            return _zip_documents(documents, skipped_ids)
        return _render_documents(documents, format)

    payload = await asyncio.wait_for(asyncio.to_thread(_render), timeout=180)
    return _document_response(
        payload,
        format=format,
        count=len(documents),
        skipped_ids=skipped_ids,
        filename_stem="Rubbish-合集",
    )


@router.get("/issue")
async def export_issue_package(
    volume: str = Query(min_length=1, max_length=20),
    issue: str = Query(min_length=1, max_length=20),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """整组合集 ZIP：目录页 PDF + 每篇规范 PDF + manifest。

    与 ``/api/catalog/issues/{volume}-{issue}/export`` 的「整组合集版面」互补：
    后者只有封面/目录/版权页，这里把已公开作品正文一并打包。
    """

    import asyncio
    from urllib.parse import quote

    from app.domain.submission.export_docs import issue_front_matter_pdf

    tenant_id = require_tenant_id()
    rows = (
        (
            await db.execute(
                select(Resource)
                .where(
                    Resource.tenant_id == tenant_id,
                    Resource.volume == volume,
                    Resource.issue == issue,
                    *public_conditions(),
                )
                .order_by(Resource.publish_at.asc(), Resource.id.asc())
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Issue is empty or not published")
    if len(rows) > 60:
        raise HTTPException(status_code=400, detail="合集内容过多（上限 60 篇）")

    documents, skipped_ids = await _load_article_docs(db, list(rows))
    if not documents:
        raise HTTPException(status_code=404, detail="合集内没有可导出的在线正文")

    def _render() -> bytes:
        entries = [
            {
                "title": resource.title,
                "authors": list(resource.authors or []),
                "discipline": resource.discipline,
                "clc": resource.clc_code,
                "track": resource.content_track,
                "special": bool(resource.is_special_issue),
            }
            for resource, _ in documents
        ]
        front = issue_front_matter_pdf(
            volume=volume,
            issue=issue,
            theme=f"合集 {volume}-{issue}",
            note="合集全文：目录页 + 各篇规范 PDF。",
            range_label=f"合集 {volume}-{issue}",
            entries=entries,
        )
        return _zip_documents(
            documents,
            skipped_ids,
            extra_files={"00-front-matter.pdf": front},
        )

    payload = await asyncio.wait_for(asyncio.to_thread(_render), timeout=240)
    headers = {
        "Content-Disposition": (
            f'attachment; filename="rubbish-collection-{volume}-{issue}.zip"; '
            f"filename*=UTF-8''{quote(f'Rubbish-Collection-{volume}-{issue}.zip')}"
        ),
        "X-Rubbish-Skipped-Ids": ",".join(str(i) for i in skipped_ids),
        "Cache-Control": "private, max-age=3600",
    }
    return Response(content=payload, media_type="application/zip", headers=headers)


def _redact_export_essay(md_text: str, resource: Resource) -> str:
    """娱乐轨正文里的邮箱/手机号不进入批量下载件（与单篇导出一致）。"""
    if (getattr(resource, "content_track", "") or "").lower() != "essay":
        return md_text
    import re

    md_text = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "[邮箱已隐藏]", md_text)
    return re.sub(r"(?<!\d)1[3-9]\d{9}(?!\d)", "[手机号已隐藏]", md_text)


@router.get("", response_class=Response)
async def export_endpoint(
    ids: list[int] = Query(default_factory=list),
    format: str = Query(default="json", pattern=r"^(bibtex|ris|csv|json|jats)$"),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Download the given resources as BibTeX / RIS / CSV / JSON / JATS.

    Public (no auth). ``ids`` is a repeated query param
    (``?ids=1&ids=2``); up to ``EXPORT_MAX_IDS`` are honoured. Unknown ids
    are silently dropped; if none resolve, a 404 is returned. The query
    is scoped by tenant — exporting a resource from another tenant is
    treated the same as a non-existent id (silently dropped).
    """
    # 去重但保持调用方顺序：?ids=1&ids=1 不应让同一资源在导出里出现两次。
    requested_ids = list(dict.fromkeys(ids))
    if len(requested_ids) > EXPORT_MAX_IDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many ids requested ({len(requested_ids)}); limit is {EXPORT_MAX_IDS}.",
        )
    if not requested_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one `ids` query parameter is required.",
        )

    # 排期中的期号不导出：导出是公开面，等同于「能否被引用」。
    resources_by_id = await _load_resources(db, requested_ids)

    # Preserve caller's requested order and drop missing ids.
    ordered = [resources_by_id[i] for i in requested_ids if i in resources_by_id]
    if not ordered:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No resources found for the given ids.",
        )

    # format 已被 Query 的正则约束在五选一内，export_resources 不会抛
    # ValueError —— 无需 try/except。
    # Resource satisfies Exportable structurally (duck-typed), but mypy
    # can't see that without a runtime check; cast through.
    body = export_resources(format, cast(list[Exportable], ordered))

    extension = FILE_EXTENSIONS[format]
    media_type = MIME_TYPES[format]
    filename = f"rubbish-export.{extension}"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
