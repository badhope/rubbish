"""Daily publication digest for followers and discipline subscribers.

In-app publication fan-out stays immediate: a reader sees the card as soon
as an issue goes live.  Email is intentionally different: one message per
reader per local day, containing everything they follow that was published
in the trailing 24h.  Sending one email per work would be the fastest way to
get readers to disable email entirely.

The digest is idempotent per (tenant, user, local date).  The scheduler is
leader-elected, but the unique delivery row is a second line of defence
against a rogue second worker or a manual replay.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.email_templates import publication_digest
from app.core.logging import get_logger
from app.core.time import utcnow
from app.domain.catalog.models import Resource
from app.domain.notifications import services as notifications
from app.domain.notifications.models import (
    EmailDigestRecord,
    PublicationDigestDelivery,
    PublicationDigestItem,
)
from app.models import User

logger = get_logger("rubbish.publication_digest")

LOCAL_TZ = ZoneInfo("Asia/Shanghai")


async def run_publication_digest(
    db: AsyncSession,
    *,
    tenant_id: Any,
    now: datetime | None = None,
    force: bool = False,
) -> dict[str, int]:
    """Build and queue one daily digest per eligible reader."""
    current = now or utcnow()
    local_now = current.astimezone(LOCAL_TZ)
    today = local_now.date()
    stats = {
        "due": 0,
        "users": 0,
        "sent": 0,
        "queued": 0,
        "skipped": 0,
        "items": 0,
        "too_early": 0,
    }
    if not settings.publication_digest_enabled:
        return stats
    if not force and local_now.hour < settings.publication_digest_local_hour:
        stats["too_early"] = 1
        return stats

    rows = list(
        (
            await db.execute(
                select(PublicationDigestItem.user_id, PublicationDigestItem.resource_id)
                .where(
                    PublicationDigestItem.tenant_id == tenant_id,
                    PublicationDigestItem.delivered_at.is_(None),
                )
                .order_by(PublicationDigestItem.created_at.asc())
                .limit(5000)
            )
        ).all()
    )
    if not rows:
        return stats

    by_user: dict[int, set[int]] = {}
    for user_id, resource_id in rows:
        by_user.setdefault(int(user_id), set()).add(int(resource_id))

    existing = set(
        (
            await db.execute(
                select(PublicationDigestDelivery.user_id).where(
                    PublicationDigestDelivery.tenant_id == tenant_id,
                    PublicationDigestDelivery.digest_date == today,
                )
            )
        )
        .scalars()
        .all()
    )
    user_ids = [uid for uid in by_user if uid not in existing]
    if not user_ids:
        return stats
    stats["due"] = len(user_ids)

    users = {
        int(user.id): user
        for user in (
            await db.execute(
                select(User).where(
                    User.tenant_id == tenant_id,
                    User.id.in_(user_ids),
                    User.is_active.is_(True),
                    User.is_email_verified.is_(True),
                )
            )
        )
        .scalars()
        .all()
    }
    resources = {
        int(resource.id): resource
        for resource in (
            await db.execute(
                select(Resource).where(
                    Resource.tenant_id == tenant_id,
                    Resource.id.in_(sorted({rid for ids in by_user.values() for rid in ids})),
                )
            )
        )
        .scalars()
        .all()
    }
    base = settings.frontend_base_url.rstrip("/")
    link = f"{base}/catalog"

    for user_id, _resource_ids in by_user.items():
        if stats["users"] >= settings.publication_digest_batch_size:
            break
        user = users.get(user_id)
        if user is None:
            continue
        pending_rows = list(
            (
                await db.execute(
                    select(PublicationDigestItem)
                    .where(
                        PublicationDigestItem.tenant_id == tenant_id,
                        PublicationDigestItem.user_id == user_id,
                        PublicationDigestItem.delivered_at.is_(None),
                    )
                    .order_by(PublicationDigestItem.created_at.asc())
                    .limit(30)
                )
            )
            .scalars()
            .all()
        )
        if not pending_rows:
            continue
        if not notifications.wants(user, "email_release"):
            # Preference changed after the work was queued: close the
            # backlog instead of mailing it when the switch flips back on.
            for row in pending_rows:
                row.delivered_at = utcnow()
            continue
        items: list[dict[str, str]] = []
        for row in pending_rows:
            resource = resources.get(row.resource_id)
            if resource is None:
                continue
            authors = "、".join(str(a) for a in (resource.authors or [])[:3]) or "佚名"
            meta = f"{authors}"
            if resource.discipline:
                meta += f" · {resource.discipline}"
            items.append(
                {
                    "title": resource.title,
                    "meta": meta,
                    "url": f"{base}/catalog/{resource.id}",
                }
            )
        if not items:
            for row in pending_rows:
                row.delivered_at = utcnow()
            continue
        subject, text, html = publication_digest(
            user.username,
            items,
            window_label="自上次汇总以来",
            link=link,
        )
        try:
            status = await notifications.record_email_digest(
                db,
                tenant_id=tenant_id,
                user_id=user.id,
                event_type="publication.daily",
                recipient_email=user.email,
                subject=subject,
                text=text,
                html=html,
                related_type="release_digest",
                related_id=today.isoformat(),
            )
        except Exception as exc:
            logger.warning(
                "publication_digest_record_failed",
                user_id=user.id,
                error=str(exc)[:200],
                exc_info=True,
            )
            continue

        email_record = (
            await db.execute(
                select(EmailDigestRecord)
                .where(
                    EmailDigestRecord.tenant_id == tenant_id,
                    EmailDigestRecord.user_id == user.id,
                    EmailDigestRecord.event_type == "publication.daily",
                    EmailDigestRecord.related_id == today.isoformat(),
                )
                .order_by(EmailDigestRecord.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if status == "sent":
            delivery_status = "sent"
            stats["sent"] += 1
        elif status == "skipped_user_pref":
            delivery_status = "skipped"
            stats["skipped"] += 1
        else:
            # The outbox row exists and will retry; marking it queued here
            # prevents a second digest being enqueued on the next tick.
            delivery_status = "queued"
            stats["queued"] += 1
        for row in pending_rows:
            row.delivered_at = utcnow()
        db.add(
            PublicationDigestDelivery(
                tenant_id=tenant_id,
                user_id=user.id,
                digest_date=today,
                status=delivery_status,
                item_count=len(items),
                email_record_id=email_record.id if email_record else None,
                sent_at=utcnow() if delivery_status == "sent" else None,
            )
        )
        stats["users"] += 1
        stats["items"] += len(items)

    await db.flush()
    logger.info("publication_digest_done", tenant_id=str(tenant_id), **stats)
    return stats


__all__ = ["run_publication_digest"]
