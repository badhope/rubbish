"""Volume/Issue sync helpers.

The catalog keeps legacy ``resources.volume`` / ``resources.issue`` string
columns for URL compatibility.  New writes also maintain a real
``Issue`` row and ``resources.issue_id``; this module is the single bridge
between the two representations so they cannot drift silently.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.domain.catalog.models import Issue, Resource, Volume
from app.domain.catalog.visibility import as_aware


def _issue_status(publication_status: str | None, publish_at) -> str:
    if publication_status != "published":
        return "draft"
    moment = as_aware(publish_at) if publish_at else None
    if moment is not None and moment > utcnow():
        return "scheduled"
    return "live"


async def resolve_issue(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    volume: str | None,
    issue: str | None,
    publication_status: str | None = None,
    publish_at=None,
    create: bool = True,
) -> Issue | None:
    """Find or create the Issue matching legacy strings.

    Empty volume/issue is a valid "not assigned" state and returns None.
    """
    volume_number = (volume or "").strip()
    issue_number = (issue or "").strip()
    if not volume_number or not issue_number:
        return None

    volume_row = (
        await db.execute(
            select(Volume).where(
                Volume.tenant_id == tenant_id,
                Volume.number == volume_number,
            )
        )
    ).scalar_one_or_none()
    if volume_row is None:
        if not create:
            return None
        volume_row = Volume(tenant_id=tenant_id, number=volume_number)
        db.add(volume_row)
        await db.flush()

    issue_row = (
        await db.execute(
            select(Issue).where(
                Issue.tenant_id == tenant_id,
                Issue.volume_id == volume_row.id,
                Issue.number == issue_number,
            )
        )
    ).scalar_one_or_none()
    if issue_row is None:
        if not create:
            return None
        issue_row = Issue(
            tenant_id=tenant_id,
            volume_id=volume_row.id,
            number=issue_number,
            status=_issue_status(publication_status, publish_at),
            publish_at=publish_at,
        )
        db.add(issue_row)
        await db.flush()
    else:
        # Never downgrade a live/archived issue because a new draft article
        # was added to it. Only promote draft -> scheduled/live.
        desired = _issue_status(publication_status, publish_at)
        if desired == "live" and issue_row.status in ("draft", "scheduled"):
            issue_row.status = "live"
        elif desired == "scheduled" and issue_row.status == "draft":
            issue_row.status = "scheduled"
        if issue_row.publish_at is None and publish_at is not None:
            issue_row.publish_at = publish_at
    return issue_row


async def sync_resource_issue(db: AsyncSession, resource: Resource) -> Issue | None:
    """Resolve and attach ``resource.issue_id`` from its legacy strings."""
    issue_row = await resolve_issue(
        db,
        tenant_id=resource.tenant_id,
        volume=resource.volume,
        issue=resource.issue,
        publication_status=resource.publication_status,
        publish_at=resource.publish_at,
    )
    resource.issue_id = issue_row.id if issue_row is not None else None
    return issue_row
