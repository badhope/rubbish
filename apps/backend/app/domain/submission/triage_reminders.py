"""P1-9：基础检查 48 小时自动提醒。

基础检查队列最怕“作品排进来就没人再看”。这里按发布的基础检查起始时间
（``triage_started_at``，补材料重投会重置）扫描超过 48 小时仍未处理的
pending 作品，给编辑部发一条汇总站内通知和可选邮件。只提醒一次，
避免每 6 小时重复骚扰；补材料重投后会重新计时并再次进入提醒窗口。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.email_templates import triage_overdue_digest
from app.core.logging import get_logger
from app.domain.notifications import services as notifications
from app.domain.submission.editor_recipients import editor_recipients
from app.domain.submission.models import Submission
from app.models import AuditLog, User

logger = get_logger("rubbish.triage_reminders")

TRIAGE_DUE_HOURS = 48


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def _editor_recipients(db: AsyncSession, tenant_id: Any) -> list[User]:
    """Backward-compatible name; the shared lookup owns the role set."""
    return await editor_recipients(db, tenant_id)


async def run_triage_reminders(db: AsyncSession, *, tenant_id: Any) -> dict[str, int]:
    """Nudge editors once for submissions waiting >48h in the triage queue."""
    now = datetime.now(UTC)
    cutoff = now - timedelta(hours=TRIAGE_DUE_HOURS)
    stats = {"checked": 0, "reminded": 0, "emailed": 0}
    stale = list(
        (
            await db.execute(
                select(Submission).where(
                    Submission.tenant_id == tenant_id,
                    Submission.triage_status == "pending",
                    Submission.status.in_(("pending", "resubmitted")),
                    Submission.triage_reminded_at.is_(None),
                    Submission.triage_started_at.is_not(None),
                    Submission.triage_started_at <= cutoff,
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

    editors = await _editor_recipients(db, tenant_id)
    if not editors:
        logger.warning("triage_reminder_no_editor", tenant_id=str(tenant_id))
        await db.commit()
        return stats

    items: list[tuple[str, int]] = []
    for submission in stale:
        started = _aware(submission.triage_started_at) or _aware(submission.submitted_at)
        hours = int((now - started).total_seconds() // 3600) if started else TRIAGE_DUE_HOURS
        items.append((submission.title, hours))
        for editor in editors:
            if notifications.wants(editor, "in_app_submission"):
                await notifications.create(
                    db,
                    tenant_id=tenant_id,
                    user_id=editor.id,
                    type_="submission.triage_overdue",
                    title=f"基础检查已等待 {hours} 小时：{submission.title}",
                    body=(
                        f"作品 #{submission.id} 进入基础检查队列已超过 {TRIAGE_DUE_HOURS} 小时。"
                        "请安排互评、退回修改、补材料或直接不通过。"
                    ),
                    related_type="submission",
                    related_id=str(submission.id),
                )
        submission.triage_reminded_at = now
        submission.triage_reminder_count = int(submission.triage_reminder_count or 0) + 1
        db.add(
            AuditLog(
                tenant_id=tenant_id,
                actor_user_id=None,
                action="submission.triage_overdue_reminder",
                target_type="submission",
                target_id=str(submission.id),
                payload={"hours": hours, "reminder_count": submission.triage_reminder_count},
            )
        )
        stats["reminded"] += 1

    base = settings.frontend_base_url.rstrip("/")
    for editor in editors:
        if not notifications.wants(editor, "email_submission"):
            continue
        subject, text, html = triage_overdue_digest(
            editor.username,
            items[:10],
            f"{base}/submissions/pending",
        )
        status = await notifications.record_email_digest(
            db,
            tenant_id=tenant_id,
            user_id=editor.id,
            event_type="submission.triage_overdue",
            recipient_email=editor.email,
            subject=subject,
            text=text,
            html=html,
            related_type="triage_queue",
            related_id=str(tenant_id),
        )
        if status == "sent":
            stats["emailed"] += 1

    await db.commit()
    return stats


__all__ = ["TRIAGE_DUE_HOURS", "run_triage_reminders"]
