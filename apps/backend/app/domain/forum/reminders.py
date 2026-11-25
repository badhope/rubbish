"""SLA reminder for forum topics stuck in manual review.

``review_eta_at`` was displayed in the moderation queue but never acted on:
if nobody opened the queue, an overdue topic stayed overdue silently. This
sweep nudges active editors once per review cycle, records an audit row, and
optionally emails a digest. Re-entering manual review clears
``sla_reminded_at`` so a new cycle can be reminded again.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.domain.forum.models import ForumTopic
from app.domain.notifications import services as notifications
from app.domain.submission.editor_recipients import editor_recipients
from app.models import AuditLog

logger = get_logger("rubbish.forum_reminders")


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def run_moderation_sla_reminders(db: AsyncSession, *, tenant_id: Any) -> dict[str, int]:
    """One nudge per overdue manual-review topic. Returns reminder counts."""
    now = datetime.now(UTC)
    stats = {"checked": 0, "reminded": 0, "emailed": 0}
    stale = list(
        (
            await db.execute(
                select(ForumTopic).where(
                    ForumTopic.tenant_id == tenant_id,
                    ForumTopic.moderation_status == "manual_review",
                    ForumTopic.deleted_at.is_(None),
                    ForumTopic.sla_reminded_at.is_(None),
                    ForumTopic.review_eta_at.is_not(None),
                    ForumTopic.review_eta_at <= now,
                )
            )
        )
        .scalars()
        .all()
    )
    stats["checked"] = len(stale)
    if not stale:
        await db.commit()
        return stats

    editors = await editor_recipients(db, tenant_id)
    if not editors:
        logger.warning("forum_sla_no_editor", tenant_id=str(tenant_id))
        await db.commit()
        return stats

    items: list[tuple[str, int, int]] = []
    for topic in stale:
        eta = _aware(topic.review_eta_at)
        overdue_hours = int((now - eta).total_seconds() // 3600) if eta else 0
        items.append((topic.title, topic.id, max(overdue_hours, 1)))
        for editor in editors:
            if notifications.wants(editor, "in_app_forum"):
                await notifications.create(
                    db,
                    tenant_id=tenant_id,
                    user_id=editor.id,
                    type_="forum.moderation_sla",
                    title=f"人工核验已超时 {max(overdue_hours, 1)} 小时：{topic.title}",
                    body=(
                        f"帖子 #{topic.id} 的承诺核验时间已过。请发布、退回修改或不通过；"
                        "不要让它继续停在队列里。"
                    ),
                    related_type="forum_topic",
                    related_id=str(topic.id),
                )
        topic.sla_reminded_at = now
        db.add(
            AuditLog(
                tenant_id=tenant_id,
                actor_user_id=None,
                action="forum.moderation_sla_reminder",
                target_type="forum_topic",
                target_id=str(topic.id),
                payload={"overdue_hours": max(overdue_hours, 1), "review_eta_at": str(eta)},
            )
        )
        stats["reminded"] += 1

    base = settings.frontend_base_url.rstrip("/")
    for editor in editors:
        if not notifications.wants(editor, "email_forum") or not editor.email:
            continue
        lines = [f"#{topic_id} {title}（超时 {hours} 小时）" for title, topic_id, hours in items]
        subject = f"论坛人工核验超时 {len(items)} 篇"
        text = "以下帖子已超过承诺核验时间：\n\n" + "\n".join(lines)
        html = (
            "<p>以下帖子已超过承诺核验时间，请尽快处理：</p><ul>"
            + "".join(
                f'<li><a href="{base}/admin/content?section=moderation&topic={topic_id}">'
                f"#{topic_id} {title}</a>（超时 {hours} 小时）</li>"
                for title, topic_id, hours in items
            )
            + "</ul>"
        )
        status = await notifications.record_email_digest(
            db,
            tenant_id=tenant_id,
            user_id=editor.id,
            event_type="forum.moderation_sla",
            recipient_email=editor.email,
            subject=subject,
            text=text,
            html=html,
            related_type="forum_queue",
            related_id=str(tenant_id),
        )
        if status == "sent":
            stats["emailed"] += 1

    await db.commit()
    return stats


__all__ = ["run_moderation_sla_reminders"]
