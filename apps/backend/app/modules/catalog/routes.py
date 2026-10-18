"""Catalog API routes — CRUD + stats + facets for resource records.

Read endpoints are public (no auth required) so anonymous users can
browse the catalog. Write endpoints require admin. Per-tenant scoping
is enforced at the application layer (explicit ``tenant_id`` filter
on every query) AND by RLS in production.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import desc, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin, require_tenant_id
from app.core import search as fulltext
from app.core.db import get_db, paginate
from app.core.schemas import PaginationMeta
from app.models import AuditLog, User
from app.modules.catalog.models import Resource
from app.modules.catalog.ontology_routes import router as ontology_router
from app.modules.catalog.schemas import (
    FacetBucket,
    ResourceCreate,
    ResourceFacets,
    ResourceListResponse,
    ResourceResponse,
    ResourceStats,
    ResourceUpdate,
)

router = APIRouter(prefix="/catalog", tags=["catalog"])

# Attach ontology sub-router so static ``/disciplines`` paths are
# tried before the dynamic ``/{resource_id}`` catch-all below.
router.include_router(ontology_router)

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


@router.get("", response_model=ResourceListResponse)
async def list_resources(
    type: str | None = None,
    discipline: str | None = None,
    year: int | None = None,
    q: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    sort: str | None = Query(default=None, pattern=r"^(year|title|created_at)$"),
    order: str | None = Query(default=None, pattern=r"^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
) -> ResourceListResponse:
    """List resources with pagination, filtering, and basic search.

    When Meilisearch is configured and a query string is present, the
    search is delegated to it (typo tolerance + relevance ranking) and
    rows are re-fetched from the DB by id. Otherwise — including any
    Meilisearch failure — the original DB ILIKE path runs unchanged.
    """
    tenant_id = require_tenant_id()

    if q is not None and fulltext.search_enabled():
        hit = await fulltext.search_resource_ids(
            tenant_id=str(tenant_id),
            q=q,
            type_=type,
            discipline=discipline,
            year=year,
            page=page,
            page_size=page_size,
        )
        if hit is not None:
            ids, total = hit
            rows_by_id: dict[int, Resource] = {}
            if ids:
                fetched = (
                    await db.execute(
                        select(Resource).where(
                            Resource.tenant_id == tenant_id, Resource.id.in_(ids)
                        )
                    )
                ).scalars()
                rows_by_id = {r.id: r for r in fetched}
            # Preserve Meilisearch relevance order.
            ranked = [rows_by_id[i] for i in ids if i in rows_by_id]
            return ResourceListResponse(
                data=[ResourceResponse.model_validate(r) for r in ranked],
                meta=PaginationMeta(
                    total=total,
                    page=page,
                    page_size=page_size,
                    total_pages=(total + page_size - 1) // page_size,
                ),
            )

    stmt = select(Resource).where(Resource.tenant_id == tenant_id)
    if type is not None:
        stmt = stmt.where(Resource.type == type)
    if discipline is not None:
        stmt = stmt.where(Resource.discipline == discipline)
    if year is not None:
        stmt = stmt.where(Resource.year == year)
    if q is not None:
        pattern = f"%{q}%"
        stmt = stmt.where((Resource.title.ilike(pattern)) | (Resource.abstract.ilike(pattern)))

    # Sort with deterministic tiebreaker — order_by is applied by paginate.
    sort_col = getattr(Resource, sort, Resource.created_at) if sort else Resource.created_at
    order_by = (
        sort_col.asc() if order == "asc" else sort_col.desc(),
        Resource.id.asc(),
    )

    rows, meta = await paginate(
        db,
        stmt,
        page=page,
        page_size=page_size,
        order_by=order_by,
    )
    return ResourceListResponse(
        data=[ResourceResponse.model_validate(r) for r in rows],
        meta=meta,
    )


@router.get("/stats", response_model=ResourceStats)
async def get_stats(db: AsyncSession = Depends(get_db)) -> ResourceStats:
    """Aggregate stats: total count + breakdowns by type and discipline."""
    tenant_id = require_tenant_id()
    base_filter = Resource.tenant_id == tenant_id
    total = (await db.execute(select(func.count(Resource.id)).where(base_filter))).scalar_one()
    by_type_rows = await db.execute(
        select(Resource.type, func.count(Resource.id)).where(base_filter).group_by(Resource.type)
    )
    by_discipline_rows = await db.execute(
        select(Resource.discipline, func.count(Resource.id))
        .where(base_filter)
        .group_by(Resource.discipline)
    )
    return ResourceStats(
        total=total,
        by_type={t: c for t, c in by_type_rows.all()},
        by_discipline={d: c for d, c in by_discipline_rows.all()},
    )


@router.get("/facets", response_model=ResourceFacets)
async def get_facets(
    type: str | None = None,
    discipline: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> ResourceFacets:
    """Year + tag facet buckets for the current filter."""
    tenant_id = require_tenant_id()
    stmt = select(Resource).where(Resource.tenant_id == tenant_id)
    if type is not None:
        stmt = stmt.where(Resource.type == type)
    if discipline is not None:
        stmt = stmt.where(Resource.discipline == discipline)

    year_rows = await db.execute(
        select(Resource.year, func.count(Resource.id))
        .where(Resource.id.in_(select(stmt.subquery().c.id)))
        .group_by(Resource.year)
        .order_by(desc(Resource.year))
    )
    years = [FacetBucket(value=str(y), count=c) for y, c in year_rows.all() if y is not None]

    # Tags are JSON; aggregate in Python (small N).
    # F2 服务端优化：限定在过滤范围内拉取（type/discipline 命中后行数已收敛），
    # 并对拉取行数做上限保护（10k 行足够 facet 50 个 top tag），避免匿名浏览
    # 全表 tags 物化的 O(N×M) 开销。若未来 data > 10k 需引入 SQL 端 JSON 展开。
    stmt_tags = select(Resource.tags).where(Resource.tenant_id == tenant_id)
    if type is not None:
        stmt_tags = stmt_tags.where(Resource.type == type)
    if discipline is not None:
        stmt_tags = stmt_tags.where(Resource.discipline == discipline)
    stmt_tags = stmt_tags.limit(10000)
    rows = (await db.execute(stmt_tags)).scalars().all()
    tag_counts: dict[str, int] = {}
    for tags in rows:
        for tag in tags or []:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
    tags_sorted = sorted(tag_counts.items(), key=lambda kv: kv[1], reverse=True)[:50]
    return ResourceFacets(
        years=years,
        tags=[FacetBucket(value=t, count=c) for t, c in tags_sorted],
    )


@router.get("/{resource_id}/file")
async def download_resource_file(
    resource_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """流式返回**已发表**资源的文件（公开可读，无需登录）。

    这是替代原 `/uploads` 静态挂载的通道。区别是：
    - 只有已经进入公开目录（catalog）的资源才能在这里读到文件；
    - 尚未公开的在审稿件，仍然只能走鉴权端点 `GET /api/submissions/{id}/files`。

    换句话说，"发表"这个文件动作本身就是授权边界：物化进目录才公开。
    """
    import mimetypes

    from fastapi.responses import RedirectResponse, StreamingResponse

    from app.core.storage import get_storage

    tenant_id = require_tenant_id()
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.tenant_id == tenant_id,
            # 纵深防御：只有物化为 published 的资源才允许公开取稿。编辑在
            # "接受"决定里可以把投稿对接到任一带 resource_id 的现有条目
            # （submission/routes.py accept 分支），若那条目处于 draft/
            # in_review，稿件仍处于未公开状态，不得经此公开端点流出。
            Resource.publication_status == "published",
        )
    )
    resource = result.scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")

    # 延迟导入避免与 submission 模块形成循环依赖（submission 依赖 catalog）。
    from app.modules.submission.models import Submission

    submission = (
        (
            await db.execute(
                select(Submission).where(
                    Submission.resource_id == resource_id,
                    Submission.tenant_id == tenant_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if submission is None or not submission.file_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This resource has no downloadable file",
        )

    storage = get_storage()
    url = storage.presigned_url(submission.file_path)
    if url:
        return RedirectResponse(url, status_code=status.HTTP_302_FOUND)

    try:
        data = await storage.load(submission.file_path)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Stored file is missing"
        ) from exc

    filename = submission.file_path.rsplit("/", 1)[-1]
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

    range_header = request.headers.get("Range")
    if range_header and range_header.startswith("bytes="):
        spec = range_header[len("bytes=") :]
        try:
            if "-" in spec:
                start_s, end_s = spec.split("-", 1)
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else len(data) - 1
            else:
                start = int(spec)
                end = len(data) - 1
            start = max(start, 0)
            end = min(end, len(data) - 1)
            if start > end or start >= len(data):
                raise ValueError("invalid range")
            chunk = data[start : end + 1]
            return Response(
                content=chunk,
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                media_type=media_type,
                headers={
                    "Content-Range": f"bytes {start}-{end}/{len(data)}",
                    "Accept-Ranges": "bytes",
                },
            )
        except ValueError:
            pass  # Range 非法 → 退回 200 全量

    return StreamingResponse(
        iter([data]),
        media_type=media_type,
        headers={"Accept-Ranges": "bytes"},
    )


@router.get("/{resource_id}", response_model=ResourceResponse)
async def get_resource(
    resource_id: int,
    db: AsyncSession = Depends(get_db),
) -> ResourceResponse:
    """Get a single resource by id."""
    tenant_id = require_tenant_id()
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.tenant_id == tenant_id,
        )
    )
    resource = result.scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
    return ResourceResponse.model_validate(resource)


@router.post("", response_model=ResourceResponse, status_code=status.HTTP_201_CREATED)
async def create_resource(
    payload: ResourceCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> ResourceResponse:
    """Create a new resource (admin only)."""
    tenant_id = require_tenant_id()
    # AnyHttpUrl → str：SQLite 默认 DBAPI 不识别 Pydantic 的 Url 类型，
    # PostgreSQL 那边 asyncpg 倒是接受，但为保持两库行为一致统一转 str。
    # Ontology check: discipline must exist; if subdiscipline is
    # given, it must belong to the chosen discipline. Fails with
    # HTTP 422 on miss so the client gets a clear, actionable
    # error instead of a silent typo landing in the DB.
    from app.modules.catalog.onto import (
        DisciplineNotFound,
        SubdisciplineMismatch,
        assert_discipline_valid,
        assert_subdiscipline_matches,
    )

    try:
        discipline_row = await assert_discipline_valid(
            db,
            tenant_id=tenant_id,
            discipline_name=payload.discipline,
        )
        # If ontology is unconfigured (no disciplines registered),
        # discipline_row is None — skip subdiscipline check too.
        if payload.subdiscipline and discipline_row is not None:
            await assert_subdiscipline_matches(
                db,
                tenant_id=tenant_id,
                discipline=discipline_row,
                subdiscipline_name=payload.subdiscipline,
            )
    except DisciplineNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    except SubdisciplineMismatch as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    resource = Resource(
        tenant_id=tenant_id,
        slug=payload.slug,
        type=payload.type,
        title=payload.title,
        authors=payload.authors,
        year=payload.year,
        venue=payload.venue,
        discipline=payload.discipline,
        subdiscipline=payload.subdiscipline,
        tags=payload.tags,
        abstract=payload.abstract,
        preview=payload.preview,
        download_url=str(payload.download_url) if payload.download_url else None,
        external_url=str(payload.external_url) if payload.external_url else None,
        doi=payload.doi,
        volume=payload.volume,
        issue=payload.issue,
        pages=payload.pages,
        issn=payload.issn,
        isbn=payload.isbn,
        publisher=payload.publisher,
        short_container_title=payload.short_container_title,
        keywords=payload.keywords,
        language=payload.language,
        publication_status=payload.publication_status,
        authors_meta=(
            [m.model_dump() for m in payload.authors_meta]
            if payload.authors_meta is not None
            else None
        ),
    )
    db.add(resource)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Slug already taken in this tenant",
        ) from exc
    await db.refresh(resource)
    await fulltext.index_resource(resource)  # best-effort, never raises
    # Audit: log identifiers only — full payload is the Resource row itself.
    db.add(
        AuditLog(
            tenant_id=current_admin.tenant_id,
            actor_user_id=current_admin.id,
            action="catalog.resource.create",
            target_type="resource",
            target_id=str(resource.id),
            payload={"slug": resource.slug, "title": resource.title},
        )
    )
    await db.commit()
    return ResourceResponse.model_validate(resource)


@router.patch("/{resource_id}", response_model=ResourceResponse)
async def update_resource(
    resource_id: int,
    payload: ResourceUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> ResourceResponse:
    """Update an existing resource (admin only)."""
    tenant_id = require_tenant_id()
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.tenant_id == tenant_id,
        )
    )
    resource = result.scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")

    update_data: dict[str, Any] = payload.model_dump(exclude_unset=True)
    # AnyHttpUrl → str（同 create_resource 的处理）
    for url_field in ("download_url", "external_url"):
        if url_field in update_data and update_data[url_field] is not None:
            update_data[url_field] = str(update_data[url_field])

    # Ontology check on update: if discipline is being changed (or
    # subdiscipline alone is being changed while discipline is
    # carried over from the existing row), validate both against
    # the controlled vocabulary.
    if "discipline" in update_data or "subdiscipline" in update_data:
        from app.modules.catalog.onto import (
            DisciplineNotFound,
            SubdisciplineMismatch,
            assert_discipline_valid,
            assert_subdiscipline_matches,
        )

        effective_discipline = update_data.get("discipline", resource.discipline)
        effective_subdiscipline = update_data.get("subdiscipline", resource.subdiscipline)
        try:
            discipline_row = await assert_discipline_valid(
                db,
                tenant_id=tenant_id,
                discipline_name=effective_discipline,
            )
            # If ontology is unconfigured (no disciplines registered),
            # discipline_row is None — skip subdiscipline check too.
            if effective_subdiscipline and discipline_row is not None:
                await assert_subdiscipline_matches(
                    db,
                    tenant_id=tenant_id,
                    discipline=discipline_row,
                    subdiscipline_name=effective_subdiscipline,
                )
        except DisciplineNotFound as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc
        except SubdisciplineMismatch as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc

    for field, value in update_data.items():
        setattr(resource, field, value)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Slug already taken in this tenant",
        ) from exc
    await db.refresh(resource)
    await fulltext.index_resource(resource)  # best-effort, never raises
    # Audit: record which fields the admin touched (values may be large,
    # so we log field names only; the Resource row keeps the new state).
    db.add(
        AuditLog(
            tenant_id=current_admin.tenant_id,
            actor_user_id=current_admin.id,
            action="catalog.resource.update",
            target_type="resource",
            target_id=str(resource.id),
            payload={"fields": list(update_data.keys())},
        )
    )
    await db.commit()
    return ResourceResponse.model_validate(resource)


@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resource(
    resource_id: int,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> None:
    """Delete a resource (admin only)."""
    tenant_id = require_tenant_id()
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.tenant_id == tenant_id,
        )
    )
    resource = result.scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
    # Capture identifying info before the row is deleted so the audit
    # entry can still describe what was removed.
    deleted_slug = resource.slug
    deleted_title = resource.title
    await db.delete(resource)
    await fulltext.unindex_resource(resource_id)  # best-effort, never raises
    db.add(
        AuditLog(
            tenant_id=current_admin.tenant_id,
            actor_user_id=current_admin.id,
            action="catalog.resource.delete",
            target_type="resource",
            target_id=str(resource_id),
            payload={"slug": deleted_slug, "title": deleted_title},
        )
    )
    await db.commit()
