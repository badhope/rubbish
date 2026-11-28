"""Email outbox delivery and retry.

The business transaction only writes an ``EmailDigestRecord`` row. Actual
SMTP delivery is attempted inline for latency, and any failure is retried
by the workflow scheduler with exponential-ish backoff. Editors can also
trigger one manually from the workbench.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.email import (
    EmailSender,
    configured_accounts,
    get_congrat_sender,
    get_email_sender,
    smtp_configured,
)
from app.core.logging import get_logger
from app.core.time import utcnow
from app.domain.notifications.models import EmailDigestRecord

logger = get_logger("rubbish.email_outbox")

MAX_ATTEMPTS = 5
RETRY_BASE_MINUTES = 5


class EmailOutboxConflict(Exception):
    """The row exists but its current state forbids another delivery."""


def _sender(channel: str) -> EmailSender:
    if channel == "congrat":
        return get_congrat_sender()
    return get_email_sender()


def _retry_delay(attempts: int) -> timedelta:
    return timedelta(minutes=min(60, RETRY_BASE_MINUTES * max(1, 2 ** (attempts - 1))))


async def deliver_record(
    db: AsyncSession,
    record: EmailDigestRecord,
    *,
    manual: bool = False,
) -> str:
    """Attempt one delivery and update the outbox row in place."""
    now = utcnow()
    if not manual and (record.attempts or 0) >= MAX_ATTEMPTS:
        record.next_retry_at = None
        record.updated_at = now
        await db.flush()
        return record.status

    if record.channel != "congrat" and not settings.email_review_digest_enabled:
        # 总闸关闭属于“暂时不可发”，不是这封邮件的失败：不消耗 attempts，
        # 等运营重新打开后继续由调度器投递。
        record.status = "skipped_disabled"
        record.last_error = "Email review digest is disabled"
        record.next_retry_at = now + timedelta(minutes=RETRY_BASE_MINUTES)
        record.updated_at = now
        await db.flush()
        return record.status
    if record.channel == "congrat" and not configured_accounts():
        record.status = "skipped_no_smtp"
        record.last_error = "No configured SMTP account"
        record.next_retry_at = now + timedelta(minutes=RETRY_BASE_MINUTES)
        record.updated_at = now
        await db.flush()
        return record.status
    if record.channel != "congrat" and not smtp_configured():
        # SMTP 未配置同理：保持可重试的 skipped 状态，等配置恢复后再发。
        record.status = "skipped_no_smtp"
        record.last_error = "SMTP is not configured or disabled"
        record.next_retry_at = now + timedelta(minutes=RETRY_BASE_MINUTES)
        record.updated_at = now
        await db.flush()
        return record.status

    record.attempts = (record.attempts or 0) + 1
    record.updated_at = now
    try:
        await _sender(record.channel).send(
            to=record.recipient_email,
            subject=record.subject,
            body=record.body or "",
            html=record.html,
        )
        record.status = "sent"
        record.sent_at = now
        record.next_retry_at = None
        record.last_error = None
        return "sent"
    except Exception as exc:  # SMTP must never break the request
        record.status = "failed"
        record.last_error = str(exc)[:1000]
        record.next_retry_at = None if manual else now + _retry_delay(record.attempts)
        logger.warning(
            "email_outbox_delivery_failed",
            record_id=record.id,
            attempts=record.attempts,
            exc_info=True,
        )
        return "failed"
    finally:
        await db.flush()


async def retry_due_emails(db: AsyncSession, *, tenant_id: Any, limit: int = 20) -> dict[str, int]:
    """Retry failed or temporarily-skipped rows whose backoff has elapsed."""
    now = utcnow()
    stmt = (
        select(EmailDigestRecord)
        .where(
            EmailDigestRecord.tenant_id == tenant_id,
            EmailDigestRecord.status.in_(("failed", "skipped_no_smtp", "skipped_disabled")),
            EmailDigestRecord.attempts < MAX_ATTEMPTS,
            EmailDigestRecord.next_retry_at.is_not(None),
            EmailDigestRecord.next_retry_at <= now,
        )
        .order_by(EmailDigestRecord.next_retry_at)
        .limit(limit)
    )
    # 多进程/人工重试同时选中同一行时，只让一个投递者拿到行锁。
    if db.get_bind().dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    rows = (await db.execute(stmt)).scalars().all()
    stats = {"checked": len(rows), "sent": 0, "failed": 0, "skipped": 0}
    for record in rows:
        status = await deliver_record(db, record)
        if status == "sent":
            stats["sent"] += 1
        elif status in ("skipped_no_smtp", "skipped_disabled"):
            stats["skipped"] += 1
        else:
            stats["failed"] += 1
    await db.commit()
    return stats


async def retry_record(db: AsyncSession, *, tenant_id: Any, record_id: int) -> EmailDigestRecord:
    stmt = select(EmailDigestRecord).where(
        EmailDigestRecord.id == record_id,
        EmailDigestRecord.tenant_id == tenant_id,
    )
    if db.get_bind().dialect.name == "postgresql":
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise LookupError("email record not found")
    if row.status == "sent":
        raise EmailOutboxConflict("这封邮件已经投递成功，不重复发送")
    if row.status == "skipped_user_pref":
        raise EmailOutboxConflict("收件人已关闭这类邮件，不能由运营代发")
    await deliver_record(db, row, manual=True)
    await db.commit()
    await db.refresh(row)
    return row


__all__ = [
    "MAX_ATTEMPTS",
    "EmailOutboxConflict",
    "deliver_record",
    "retry_due_emails",
    "retry_record",
]
