"""Library API routes — member-curated reading lists.

Read/write split:

- Write endpoints (create / update / delete / add-remove item) are
  owner-only. The SELECT for ``list_id`` includes ``user_id == current_user.id``,
  so a missing-or-owned-by-someone-else list both surface as 404 (no existence
  leak).
- Read endpoints carry a visibility gate: the owner always reads; a
  ``public`` list is readable by anyone (anonymous included); a ``private``
  list owned by someone else surfaces as 403 (frontend jumps to login on
  403); a missing list still 404.

Adding/removing items is idempotent:

- Re-adding an existing resource returns the current list state (201).
- Removing a non-present resource returns 204 (no-op).

The (list_id, resource_id) uniqueness is enforced at the DB level;
the route checks first to skip the IntegrityError round-trip in the
common case, and falls back to rollback + return-current if a race
hits the constraint.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_current_user_optional
from app.api.levels import require_reader
from app.core.db import get_db, paginate
from app.core.tenant import get_current_tenant_id
from app.domain.catalog.models import Resource
from app.domain.catalog.visibility import public_conditions
from app.domain.library.models import ReadingList, ReadingListItem
from app.interfaces.http.library.schemas import (
    MessageResponse,
    ReadingListCreate,
    ReadingListDetailResponse,
    ReadingListItemCreate,
    ReadingListListResponse,
    ReadingListResponse,
    ReadingListUpdate,
)
from app.models import User

router = APIRouter(prefix="/reading-lists", tags=["library"])

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


async def _load_owned_list(db: AsyncSession, list_id: int, user: User) -> ReadingList:
    """Load a list owned by ``user``; 404 if missing or owned by someone else.

    Eager-loads ``items.resource`` so the detail response serializes
    without N+1. Uses ``populate_existing`` so a reload after a commit
    reflects newly added/removed items instead of the identity-map cache.
    Filters by tenant too — a list_id from another tenant must 404.
    """
    rl = (
        await db.execute(
            select(ReadingList)
            .where(
                ReadingList.id == list_id,
                ReadingList.user_id == user.id,
                ReadingList.tenant_id == user.tenant_id,
            )
            .options(selectinload(ReadingList.items).selectinload(ReadingListItem.resource))
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if rl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reading list not found",
        )
    return rl


async def _load_readable_list(db: AsyncSession, list_id: int, user: User | None) -> ReadingList:
    """Load a list for read: owner always readable; public readable by anyone.

    Private lists owned by someone else surface as 403 (frontend jumps to login
    on 403); a missing list still 404. Cross-tenant lists 404 as well.
    """
    tenant_id = get_current_tenant_id()
    rl = (
        await db.execute(
            select(ReadingList)
            .where(ReadingList.id == list_id)
            .where(
                ReadingList.tenant_id == tenant_id
                if tenant_id is not None
                else ReadingList.tenant_id.is_not(None)
            )
            .options(selectinload(ReadingList.items).selectinload(ReadingListItem.resource))
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if rl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reading list not found",
        )
    if user is not None and rl.user_id == user.id:
        return rl
    if rl.visibility == "public":
        return rl
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="This reading list is private",
    )


@router.get("", response_model=ReadingListListResponse)
async def list_my_lists(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReadingListListResponse:
    """List the current user's reading lists, newest first."""
    # Eager-load items so item_count computes without per-row queries.
    base = (
        select(ReadingList)
        .where(
            ReadingList.user_id == current_user.id,
            ReadingList.tenant_id == current_user.tenant_id,
        )
        .options(selectinload(ReadingList.items))
    )
    rows, meta = await paginate(
        db,
        base,
        page=page,
        page_size=page_size,
        order_by=(desc(ReadingList.created_at), ReadingList.id.asc()),
    )
    return ReadingListListResponse(
        data=[ReadingListResponse.model_validate(r) for r in rows],
        meta=meta,
    )


@router.get("/public", response_model=ReadingListListResponse)
async def list_public_lists(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    db: AsyncSession = Depends(get_db),
) -> ReadingListListResponse:
    """List public reading lists, newest first. Anonymous-friendly."""
    tenant_id = get_current_tenant_id()
    base = select(ReadingList).where(ReadingList.visibility == "public")
    if tenant_id is not None:
        base = base.where(ReadingList.tenant_id == tenant_id)
    base = base.options(selectinload(ReadingList.items))
    rows, meta = await paginate(
        db,
        base,
        page=page,
        page_size=page_size,
        order_by=(desc(ReadingList.created_at), ReadingList.id.asc()),
    )
    return ReadingListListResponse(
        data=[ReadingListResponse.model_validate(r) for r in rows],
        meta=meta,
    )


@router.post(
    "",
    response_model=ReadingListDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_list(
    payload: ReadingListCreate,
    current_user: User = Depends(require_reader),
    db: AsyncSession = Depends(get_db),
) -> ReadingListDetailResponse:
    """Create a new reading list owned by the current user (L2+)."""
    rl = ReadingList(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        name=payload.name,
        description=payload.description,
        visibility=payload.visibility or "private",
    )
    db.add(rl)
    try:
        await db.flush()
        from app.domain.gamification import service as gamification

        await gamification.award(
            db, current_user, "library.create", ref_type="list", ref_id=str(rl.id)
        )
        await db.commit()
    except IntegrityError as exc:
        # (tenant, user, name) collision — same name already exists.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A list with this name already exists",
        ) from exc
    # Reload with items eager-loaded (a fresh list has none, but this
    # keeps the response shape consistent with other endpoints).
    rl = await _load_owned_list(db, rl.id, current_user)
    return ReadingListDetailResponse.model_validate(rl)


@router.get("/{list_id}", response_model=ReadingListDetailResponse)
async def get_list(
    list_id: int,
    current_user: User | None = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> ReadingListDetailResponse:
    """Get a single list with its items. Public lists are readable by anyone;
    private lists are owner-only (403 for other readers)."""
    rl = await _load_readable_list(db, list_id, current_user)
    return ReadingListDetailResponse.model_validate(rl)


@router.patch("/{list_id}", response_model=ReadingListDetailResponse)
async def update_list(
    list_id: int,
    payload: ReadingListUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReadingListDetailResponse:
    """Update a list's name/description. Owner-only."""
    rl = await _load_owned_list(db, list_id, current_user)
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(rl, field, value)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A list with this name already exists",
        ) from exc
    rl = await _load_owned_list(db, list_id, current_user)
    return ReadingListDetailResponse.model_validate(rl)


@router.delete("/{list_id}", response_model=MessageResponse)
async def delete_list(
    list_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Delete a list and all its items. Owner-only."""
    rl = await _load_owned_list(db, list_id, current_user)
    await db.delete(rl)
    await db.commit()
    return MessageResponse(message="Reading list deleted")


@router.post(
    "/{list_id}/items",
    response_model=ReadingListDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_item(
    list_id: int,
    payload: ReadingListItemCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReadingListDetailResponse:
    """Add a resource to a list. Idempotent: re-adding is a no-op.

    Returns 201 even when the item already exists; the response body is
    the current list state either way.
    """
    rl = await _load_owned_list(db, list_id, current_user)

    # Verify the resource exists before linking (FK would catch this
    # with a 500, but a 404 is friendlier). Scope by tenant too — a
    # resource_id from another tenant must 404.
    # 只查 id 列（F5 列剪枝），存在性判断不需要整行。
    exists = (
        await db.execute(
            select(Resource.id).where(
                Resource.id == payload.resource_id,
                Resource.tenant_id == current_user.tenant_id,
                # 与公开面同口径：排期中的期号不能被加入阅读列表
                # （否则 201/404 的差异会泄露它存在）。
                *public_conditions(),
            )
        )
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )

    # Skip the IntegrityError round-trip in the common case; the unique
    # constraint still catches concurrent inserts.
    existing = (
        await db.execute(
            select(ReadingListItem).where(
                ReadingListItem.reading_list_id == rl.id,
                ReadingListItem.resource_id == payload.resource_id,
                ReadingListItem.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            ReadingListItem(
                tenant_id=current_user.tenant_id,
                reading_list_id=rl.id,
                resource_id=payload.resource_id,
            )
        )
        try:
            await db.commit()
        except IntegrityError:
            # Race: another request added the same item.
            await db.rollback()

    # Reload to reflect the (possibly new) item set + eager-load resource.
    rl = await _load_owned_list(db, list_id, current_user)
    return ReadingListDetailResponse.model_validate(rl)


@router.delete(
    "/{list_id}/items/{resource_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_item(
    list_id: int,
    resource_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a resource from a list. Idempotent: removing a non-present
    resource is a no-op (still 204)."""
    rl = await _load_owned_list(db, list_id, current_user)
    item = (
        await db.execute(
            select(ReadingListItem).where(
                ReadingListItem.reading_list_id == rl.id,
                ReadingListItem.resource_id == resource_id,
                ReadingListItem.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if item is not None:
        await db.delete(item)
        await db.commit()
