"""Announcements API — public read of the active notice, admin CRUD."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_chief_editor, require_tenant_id
from app.core.db import get_db
from app.core.time import utcnow
from app.domain.announcements.models import Announcement
from app.models import AuditLog, User
from app.schemas import AdminPreflightItem, AdminPreflightResponse

router = APIRouter(prefix="/announcements", tags=["announcements"])


class AnnouncementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    title: str
    body: str
    level: str
    is_active: bool
    starts_at: datetime
    ends_at: datetime | None


class AnnouncementIn(BaseModel):
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=20000)
    level: str = Field(default="info", pattern=r"^(info|success|warning|critical)$")
    is_active: bool = True
    ends_at: datetime | None = None


class AnnouncementPreflightIn(BaseModel):
    """Permissive shape for preflight: invalid drafts must be reportable, not 422."""

    announcement_id: int | None = Field(default=None, ge=1)
    slug: str = Field(default="", max_length=120)
    title: str = Field(default="", max_length=300)
    body: str = Field(default="", max_length=25000)
    level: str = "info"
    is_active: bool = True
    ends_at: datetime | None = None


def _preflight_status(items: list[AdminPreflightItem]) -> tuple[str, str]:
    if any(item.status == "fail" for item in items):
        return "fail", "有硬冲突，先修正再保存。"
    if any(item.status == "warn" for item in items):
        return "warn", "可以保存，但有几处要留意。"
    return "ok", "检查通过，可以保存。"


@router.post("/preflight", response_model=AdminPreflightResponse)
async def preflight_announcement(
    payload: AnnouncementPreflightIn,
    _admin: User = Depends(require_chief_editor),
    db: AsyncSession = Depends(get_db),
) -> AdminPreflightResponse:
    """Read-only pre-save check for announcements. Never writes or audits."""
    tenant_id = require_tenant_id()
    items: list[AdminPreflightItem] = []
    slug = payload.slug.strip().lower()
    title = payload.title.strip()
    body = payload.body.strip()

    items.append(
        AdminPreflightItem(
            key="copy",
            label="标题与正文",
            status="ok" if title and body else "fail",
            detail=(
                f"标题 {len(title)} 字，正文 {len(body)} 字。"
                if title and body
                else "标题或正文只有空白，发布后读者看不到实际内容。"
            ),
        )
    )

    level_ok = payload.level in {"info", "success", "warning", "critical"}
    items.append(
        AdminPreflightItem(
            key="level",
            label="公告级别",
            status="ok" if level_ok else "fail",
            detail=(
                "级别会映射成前台提示条的颜色。"
                if level_ok
                else "级别只能是 info、success、warning、critical。"
            ),
        )
    )

    slug_ok = bool(re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug)) and len(slug) <= 80
    items.append(
        AdminPreflightItem(
            key="slug",
            label="公告标识",
            status="ok" if slug_ok else "fail",
            detail=(
                f"标识 `{slug}` 格式正确。"
                if slug_ok
                else "只能用小写字母、数字和横线，且不能以横线开头。"
            ),
        )
    )

    existing: Announcement | None = None
    if payload.announcement_id is not None:
        existing = (
            await db.execute(
                select(Announcement).where(
                    Announcement.id == payload.announcement_id,
                    Announcement.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            items.append(
                AdminPreflightItem(
                    key="target",
                    label="目标公告",
                    status="fail",
                    detail="要编辑的公告不存在，可能已被删除。",
                )
            )

    if slug_ok:
        duplicate = (
            await db.execute(
                select(Announcement.id).where(
                    Announcement.tenant_id == tenant_id,
                    Announcement.slug == slug,
                    Announcement.id != (payload.announcement_id or 0),
                )
            )
        ).scalar_one_or_none()
        items.append(
            AdminPreflightItem(
                key="slug_unique",
                label="标识是否重复",
                status="fail" if duplicate is not None else "ok",
                detail=(
                    "这个标识已经有公告在用，保存会触发唯一约束。"
                    if duplicate is not None
                    else "这个标识没有和现有公告重复。"
                ),
            )
        )

    start_at = existing.starts_at if existing is not None else utcnow()
    if start_at.tzinfo is None:
        start_at = start_at.replace(tzinfo=UTC)
    ends_at = payload.ends_at
    if ends_at is not None and ends_at.tzinfo is None:
        ends_at = ends_at.replace(tzinfo=UTC)
    now = utcnow()
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)

    if ends_at is not None and ends_at <= start_at:
        time_item = AdminPreflightItem(
            key="window",
            label="展示时间",
            status="fail",
            detail="结束时间早于开始时间，公告会一发布就下线。",
        )
    elif payload.is_active and ends_at is not None and ends_at <= now:
        time_item = AdminPreflightItem(
            key="window",
            label="展示时间",
            status="fail",
            detail="结束时间已经过去，启用后也不会出现在前台。",
        )
    else:
        time_item = AdminPreflightItem(
            key="window",
            label="展示时间",
            status="ok",
            detail="展示时间有效。" if ends_at is not None else "长期展示，直到手动停用。",
        )
    items.append(time_item)

    if payload.is_active:
        stmt = select(Announcement.id).where(
            Announcement.tenant_id == tenant_id,
            Announcement.is_active.is_(True),
            Announcement.id != (payload.announcement_id or 0),
            Announcement.starts_at
            < (ends_at if ends_at is not None else datetime.max.replace(tzinfo=UTC)),
            or_(Announcement.ends_at.is_(None), Announcement.ends_at > start_at),
        )
        overlap = (await db.execute(stmt.limit(1))).scalar_one_or_none()
        items.append(
            AdminPreflightItem(
                key="active_overlap",
                label="同时在线",
                status="warn" if overlap is not None else "ok",
                detail=(
                    "还有一条启用公告的时间窗与这条重叠；前台只展示最新一条，另一条可能看不到。"
                    if overlap is not None
                    else "没有其他启用公告与这条重叠。"
                ),
            )
        )

    status, summary = _preflight_status(items)
    return AdminPreflightResponse(status=status, summary=summary, items=items)


@router.get("/active", response_model=AnnouncementOut | None)
async def active_announcement(db: AsyncSession = Depends(get_db)) -> AnnouncementOut | None:
    """The notice shown on first visit (newest active one, inside its window)."""
    tenant_id = require_tenant_id()
    now = utcnow()
    row = (
        await db.execute(
            select(Announcement)
            .where(
                Announcement.tenant_id == tenant_id,
                Announcement.is_active.is_(True),
                Announcement.starts_at <= now,
                or_(Announcement.ends_at.is_(None), Announcement.ends_at > now),
            )
            .order_by(Announcement.starts_at.desc(), Announcement.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return AnnouncementOut.model_validate(row) if row is not None else None


@router.get("", response_model=list[AnnouncementOut])
async def list_announcements(
    db: AsyncSession = Depends(get_db),
) -> list[AnnouncementOut]:
    tenant_id = require_tenant_id()
    rows = (
        (
            await db.execute(
                select(Announcement)
                .where(Announcement.tenant_id == tenant_id)
                .order_by(Announcement.created_at.desc(), Announcement.id.desc())
            )
        )
        .scalars()
        .all()
    )
    return [AnnouncementOut.model_validate(r) for r in rows]


@router.post("", response_model=AnnouncementOut, status_code=status.HTTP_201_CREATED)
async def create_announcement(
    payload: AnnouncementIn,
    _admin: User = Depends(require_chief_editor),
    db: AsyncSession = Depends(get_db),
) -> AnnouncementOut:
    tenant_id = require_tenant_id()
    row = Announcement(tenant_id=tenant_id, **payload.model_dump())
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Announcement slug already exists"
        ) from exc
    await db.refresh(row)
    return AnnouncementOut.model_validate(row)


@router.patch("/{announcement_id}", response_model=AnnouncementOut)
async def update_announcement(
    announcement_id: int,
    payload: AnnouncementIn,
    current_admin: User = Depends(require_chief_editor),
    db: AsyncSession = Depends(get_db),
) -> AnnouncementOut:
    tenant_id = require_tenant_id()
    row = (
        await db.execute(
            select(Announcement).where(
                Announcement.id == announcement_id, Announcement.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_admin.id,
            action="announcement.update",
            target_type="announcement",
            target_id=str(announcement_id),
            payload={"slug": payload.slug, "is_active": payload.is_active},
        )
    )
    await db.commit()
    await db.refresh(row)
    return AnnouncementOut.model_validate(row)


@router.delete("/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_announcement(
    announcement_id: int,
    current_admin: User = Depends(require_chief_editor),
    db: AsyncSession = Depends(get_db),
) -> None:
    tenant_id = require_tenant_id()
    row = (
        await db.execute(
            select(Announcement).where(
                Announcement.id == announcement_id, Announcement.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.delete(row)
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_admin.id,
            action="announcement.delete",
            target_type="announcement",
            target_id=str(announcement_id),
            payload=None,
        )
    )
    await db.commit()
