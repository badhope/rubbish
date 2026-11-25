"""Publication fan-out for author followers and discipline subscribers.

Follow relationships already existed, but nothing ever fanned a new work out
to them: following an author was a dead-end. This service keeps in-app cards
immediate and queues an independent daily email digest for readers who opted
into release email. The digest queue is not derived from in-app notifications,
so muting publication cards does not silently suppress the email.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.catalog.models import Resource
from app.domain.follows.models import AuthorFollow, DisciplineSubscription
from app.domain.notifications import services as notifications
from app.domain.submission.models import Submission

_EVENT_COPY = {
    "published": ("新作品上线", "作品已公开"),
    "correction": ("作品有更正", "公开更正"),
    "retraction": ("作品已撤回", "公开撤回"),
    "byline": ("署名信息变更", "署名变更"),
}


async def notify_publication(
    db: AsyncSession,
    *,
    tenant_id: Any,
    resources: list[Resource],
    notify_authors: bool = True,
    event_type: str = "published",
) -> dict[str, int]:
    """Create in-app notifications for authors and followers.

    Deduplicates users across author-follow and discipline-subscription so a
    reader following both does not get two cards for one work.
    """
    label, short = _EVENT_COPY.get(event_type, _EVENT_COPY["published"])
    stats = {"authors": 0, "followers": 0, "skipped": 0}
    for resource in resources:
        recipients: set[int] = set()
        author_names = [str(name) for name in (resource.authors or []) if str(name).strip()]
        if author_names:
            rows = (
                await db.execute(
                    select(AuthorFollow.user_id).where(
                        AuthorFollow.tenant_id == tenant_id,
                        AuthorFollow.author_name.in_(author_names),
                    )
                )
            ).scalars()
            recipients.update(int(uid) for uid in rows)
        if resource.discipline:
            rows = (
                await db.execute(
                    select(DisciplineSubscription.user_id).where(
                        DisciplineSubscription.tenant_id == tenant_id,
                        DisciplineSubscription.discipline == resource.discipline,
                    )
                )
            ).scalars()
            recipients.update(int(uid) for uid in rows)

        author_id = (
            await db.execute(
                select(Submission.submitted_by)
                .where(
                    Submission.tenant_id == tenant_id,
                    Submission.resource_id == resource.id,
                )
                .order_by(Submission.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if author_id is not None:
            recipients.discard(int(author_id))
            if notify_authors:
                await notifications.create(
                    db,
                    tenant_id=tenant_id,
                    user_id=int(author_id),
                    type_=f"publication.author_{event_type}",
                    title=f"你的作品已{short}：{resource.title}",
                    body=(
                        f"《{resource.title}》已经{short}，读者可以在目录页看到它。"
                        if event_type == "published"
                        else f"《{resource.title}》的公开记录已更新：{label}。"
                    ),
                    related_type="resource",
                    related_id=str(resource.id),
                )
                stats["authors"] += 1

        for uid in recipients:
            created = await notifications.create(
                db,
                tenant_id=tenant_id,
                user_id=uid,
                type_=f"publication.follower_{event_type}",
                title=f"{label}：{resource.title}",
                body=f"你关注的作者/学科有新动态：{resource.title}",
                related_type="resource",
                related_id=str(resource.id),
            )
            if created is None:
                stats["skipped"] += 1
            else:
                stats["followers"] += 1
            # Email digest is independent of in-app preferences: a reader
            # may mute publication cards but still want the daily email.
            # Queue the work before delivery; the scheduler batches it.
            if event_type == "published":
                await notifications.queue_publication_digest(
                    db,
                    tenant_id=tenant_id,
                    user_id=uid,
                    resource_id=resource.id,
                )
    return stats


__all__ = ["notify_publication"]
