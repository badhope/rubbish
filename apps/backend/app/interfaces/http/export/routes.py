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
