"""Admin journal volume/issue registry.

This is deliberately separate from the release gate: creating or editing an
issue never publishes a paper. It only changes the container. Individual
papers still pass the existing review/release gates.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_admin, require_tenant_id
from app.core.db import get_db
from app.core.time import utcnow
from app.domain.catalog.models import Issue, Resource, Volume
from app.domain.catalog.visibility import as_aware
from app.models import AuditLog, User

router = APIRouter(prefix="/admin/journal", tags=["journal-admin"])

ISSUE_STATUSES = ("draft", "scheduled", "live", "archived")


class VolumeCreate(BaseModel):
    number: str = Field(min_length=1, max_length=50)
    title: str | None = Field(default=None, max_length=200)
    year: int | None = None
    description: str | None = None
    cover_image: str | None = Field(default=None, max_length=500)


class VolumePatch(BaseModel):
    number: str | None = Field(default=None, min_length=1, max_length=50)
    title: str | None = Field(default=None, max_length=200)
    year: int | None = None
    description: str | None = None
    cover_image: str | None = Field(default=None, max_length=500)


class IssueCreate(BaseModel):
    number: str = Field(min_length=1, max_length=50)
    title: str | None = Field(default=None, max_length=200)
    intro: str | None = None
    cover_image: str | None = Field(default=None, max_length=500)
    status: str = Field(default="draft", pattern="^(draft|scheduled|live|archived)$")
    publish_at: datetime | None = None


class IssuePatch(BaseModel):
    number: str | None = Field(default=None, min_length=1, max_length=50)
    title: str | None = Field(default=None, max_length=200)
    intro: str | None = None
    cover_image: str | None = Field(default=None, max_length=500)
    status: str | None = Field(default=None, pattern="^(draft|scheduled|live|archived)$")
    publish_at: datetime | None = None


class IssueAssignResources(BaseModel):
    resource_ids: list[int] = Field(default_factory=list, max_length=500)


def _natural_key(value: str) -> tuple[int, int | str]:
    try:
        return (0, int(value))
    except ValueError:
        return (1, value)


def _issue_payload(issue: Issue, *, volume_number: str, article_count: int) -> dict[str, Any]:
    return {
        "id": issue.id,
        "volume_id": issue.volume_id,
        "volume": volume_number,
        "number": issue.number,
        "title": issue.title,
        "intro": issue.intro,
        "cover_image": issue.cover_image,
        "status": issue.status,
        "publish_at": issue.publish_at.isoformat() if issue.publish_at else None,
        "published_at": issue.published_at.isoformat() if issue.published_at else None,
        "article_count": article_count,
    }


async def _article_counts(db: AsyncSession, tenant_id: UUID) -> dict[int, int]:
    rows = (
        await db.execute(
            select(Resource.issue_id, func.count(Resource.id))
            .where(Resource.tenant_id == tenant_id, Resource.issue_id.is_not(None))
            .group_by(Resource.issue_id)
        )
    ).all()
    return {int(issue_id): int(count) for issue_id, count in rows if issue_id is not None}


async def _volume_rows(db: AsyncSession, tenant_id: UUID) -> list[Volume]:
    return list(
        (
            await db.execute(
                select(Volume)
                .options(selectinload(Volume.issues))
                .where(Volume.tenant_id == tenant_id)
                .order_by(Volume.number.desc())
            )
        )
        .scalars()
        .all()
    )


async def _get_volume(db: AsyncSession, tenant_id: UUID, volume_id: int) -> Volume:
    row = (
        await db.execute(
            select(Volume).where(Volume.id == volume_id, Volume.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Volume not found")
    return row


async def _get_issue(db: AsyncSession, tenant_id: UUID, issue_id: int) -> Issue:
    row = (
        await db.execute(select(Issue).where(Issue.id == issue_id, Issue.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Issue not found")
    return row


def _audit(db: AsyncSession, actor: User, action: str, target_id: int, payload: dict) -> None:
    db.add(
        AuditLog(
            tenant_id=actor.tenant_id,
            actor_user_id=actor.id,
            action=action,
            target_type="issue",
            target_id=str(target_id),
            payload=payload,
        )
    )


@router.get("/volumes")
async def list_volumes(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant_id()
    volumes = sorted(
        await _volume_rows(db, tenant_id), key=lambda row: _natural_key(row.number), reverse=True
    )
    counts = await _article_counts(db, tenant_id)
    items = []
    for volume in volumes:
        issues = []
        for issue in sorted(volume.issues, key=lambda row: _natural_key(row.number)):
            issues.append(
                _issue_payload(
                    issue,
                    volume_number=volume.number,
                    article_count=counts.get(issue.id, 0),
                )
            )
        items.append(
            {
                "id": volume.id,
                "number": volume.number,
                "title": volume.title,
                "year": volume.year,
                "description": volume.description,
                "cover_image": volume.cover_image,
                "issue_count": len(issues),
                "article_count": sum(item["article_count"] for item in issues),
                "issues": issues,
            }
        )
    return {"items": items}


@router.post("/volumes", status_code=status.HTTP_201_CREATED)
async def create_volume(
    payload: VolumeCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant_id()
    existing = (
        await db.execute(
            select(Volume).where(
                Volume.tenant_id == tenant_id,
                Volume.number == payload.number,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="卷号已存在")
    volume = Volume(tenant_id=tenant_id, **payload.model_dump())
    db.add(volume)
    await db.flush()
    _audit(db, current_admin, "journal.volume.create", volume.id, {"number": volume.number})
    await db.commit()
    return {
        "id": volume.id,
        "number": volume.number,
        "title": volume.title,
        "year": volume.year,
        "description": volume.description,
        "cover_image": volume.cover_image,
        "issue_count": 0,
        "article_count": 0,
        "issues": [],
    }


@router.patch("/volumes/{volume_id}")
async def update_volume(
    volume_id: int,
    payload: VolumePatch,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant_id()
    volume = await _get_volume(db, tenant_id, volume_id)
    data = payload.model_dump(exclude_unset=True)
    if "number" in data and data["number"] != volume.number:
        duplicate = (
            await db.execute(
                select(Volume).where(
                    Volume.tenant_id == tenant_id,
                    Volume.number == data["number"],
                    Volume.id != volume.id,
                )
            )
        ).scalar_one_or_none()
        if duplicate is not None:
            raise HTTPException(status_code=409, detail="卷号已存在")
    for key, value in data.items():
        setattr(volume, key, value)
    _audit(db, current_admin, "journal.volume.update", volume.id, {"fields": list(data)})
    await db.commit()
    return {"id": volume.id, "number": volume.number, "title": volume.title}


@router.post("/volumes/{volume_id}/issues", status_code=status.HTTP_201_CREATED)
async def create_issue(
    volume_id: int,
    payload: IssueCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant_id()
    volume = await _get_volume(db, tenant_id, volume_id)
    duplicate = (
        await db.execute(
            select(Issue).where(
                Issue.tenant_id == tenant_id,
                Issue.volume_id == volume.id,
                Issue.number == payload.number,
            )
        )
    ).scalar_one_or_none()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="该卷下期号已存在")
    if payload.status == "scheduled" and payload.publish_at is None:
        raise HTTPException(status_code=422, detail="排期期必须填写上线时间")
    issue = Issue(
        tenant_id=tenant_id,
        volume_id=volume.id,
        number=payload.number,
        title=payload.title,
        intro=payload.intro,
        cover_image=payload.cover_image,
        status=payload.status,
        publish_at=payload.publish_at,
        published_at=utcnow() if payload.status == "live" else None,
    )
    db.add(issue)
    await db.flush()
    _audit(
        db,
        current_admin,
        "journal.issue.create",
        issue.id,
        {"volume": volume.number, "number": issue.number, "status": issue.status},
    )
    await db.commit()
    return _issue_payload(issue, volume_number=volume.number, article_count=0)


@router.get("/issues/{issue_id}")
async def get_issue(
    issue_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant_id()
    issue = await _get_issue(db, tenant_id, issue_id)
    volume = await _get_volume(db, tenant_id, issue.volume_id)
    resources = list(
        (
            await db.execute(
                select(Resource)
                .where(Resource.tenant_id == tenant_id, Resource.issue_id == issue.id)
                .order_by(Resource.id.asc())
            )
        )
        .scalars()
        .all()
    )
    payload = _issue_payload(issue, volume_number=volume.number, article_count=len(resources))
    payload["resources"] = [
        {
            "id": resource.id,
            "title": resource.title,
            "publication_status": resource.publication_status,
            "issue_part": resource.issue_part,
        }
        for resource in resources
    ]
    return payload


@router.patch("/issues/{issue_id}")
async def update_issue(
    issue_id: int,
    payload: IssuePatch,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant_id()
    issue = await _get_issue(db, tenant_id, issue_id)
    volume = await _get_volume(db, tenant_id, issue.volume_id)
    data = payload.model_dump(exclude_unset=True)
    next_status = data.get("status", issue.status)
    next_publish_at = data.get("publish_at", issue.publish_at)
    if next_status == "scheduled":
        moment = as_aware(next_publish_at)
        if moment is None:
            raise HTTPException(status_code=422, detail="排期期必须填写上线时间")
        if moment <= utcnow():
            raise HTTPException(
                status_code=422, detail="排期时间必须晚于当前时间，过去时间请直接设为 live"
            )
    if next_status == "live":
        moment = as_aware(next_publish_at)
        if moment is not None and moment > utcnow():
            raise HTTPException(status_code=422, detail="上线时间在未来，状态应为 scheduled")
        if issue.published_at is None:
            issue.published_at = utcnow()
    if next_status == "draft":
        issue.published_at = None
    for key, value in data.items():
        setattr(issue, key, value)
    _audit(
        db,
        current_admin,
        "journal.issue.update",
        issue.id,
        {"fields": list(data), "volume": volume.number, "number": issue.number},
    )
    await db.commit()
    counts = await _article_counts(db, tenant_id)
    return _issue_payload(issue, volume_number=volume.number, article_count=counts.get(issue.id, 0))


@router.post("/issues/{issue_id}/resources")
async def assign_issue_resources(
    issue_id: int,
    payload: IssueAssignResources,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """Move resources into this issue.

    This changes the container only. It does not change a paper's
    publication_status; a draft paper remains invisible until it passes its
    own release gate.
    """
    tenant_id = require_tenant_id()
    issue = await _get_issue(db, tenant_id, issue_id)
    volume = await _get_volume(db, tenant_id, issue.volume_id)
    resources = list(
        (
            await db.execute(
                select(Resource).where(
                    Resource.tenant_id == tenant_id,
                    Resource.id.in_(payload.resource_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    if len(resources) != len(set(payload.resource_ids)):
        raise HTTPException(status_code=404, detail="部分资源不存在")
    for resource in resources:
        resource.issue_id = issue.id
        resource.volume = volume.number
        resource.issue = issue.number
    _audit(
        db,
        current_admin,
        "journal.issue.assign",
        issue.id,
        {"resource_ids": [resource.id for resource in resources]},
    )
    await db.commit()
    return {
        "issue_id": issue.id,
        "assigned": len(resources),
        "resource_ids": [r.id for r in resources],
    }


@router.delete("/issues/{issue_id}/resources/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_issue_resource(
    issue_id: int,
    resource_id: int,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> None:
    tenant_id = require_tenant_id()
    issue = await _get_issue(db, tenant_id, issue_id)
    resource = (
        await db.execute(
            select(Resource).where(
                Resource.tenant_id == tenant_id,
                Resource.id == resource_id,
                Resource.issue_id == issue.id,
            )
        )
    ).scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=404, detail="该文章不在本期")
    resource.issue_id = None
    resource.volume = None
    resource.issue = None
    _audit(
        db, current_admin, "journal.issue.remove_resource", issue.id, {"resource_id": resource.id}
    )
    await db.commit()


@router.post("/issues/{issue_id}/publish")
async def publish_issue_container(
    issue_id: int,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """Mark the container live. Individual papers keep their own status.

    The existing release manifest flow remains the gate for content. This
    endpoint is for an empty or already-gated issue and must not silently
    publish drafts.
    """
    tenant_id = require_tenant_id()
    issue = await _get_issue(db, tenant_id, issue_id)
    issue.status = "live"
    issue.publish_at = None
    if issue.published_at is None:
        issue.published_at = utcnow()
    _audit(db, current_admin, "journal.issue.publish", issue.id, {"number": issue.number})
    await db.commit()
    volume = await _get_volume(db, tenant_id, issue.volume_id)
    counts = await _article_counts(db, tenant_id)
    return _issue_payload(issue, volume_number=volume.number, article_count=counts.get(issue.id, 0))


@router.delete("/issues/{issue_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_empty_issue(
    issue_id: int,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> None:
    tenant_id = require_tenant_id()
    issue = await _get_issue(db, tenant_id, issue_id)
    article_count = (
        await db.execute(
            select(func.count(Resource.id)).where(
                Resource.tenant_id == tenant_id, Resource.issue_id == issue.id
            )
        )
    ).scalar_one()
    if int(article_count or 0) > 0:
        raise HTTPException(status_code=409, detail="本期还有文章，先移出文章再删除")
    _audit(db, current_admin, "journal.issue.delete", issue.id, {"number": issue.number})
    await db.delete(issue)
    await db.commit()
