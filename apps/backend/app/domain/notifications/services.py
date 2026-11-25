"""Internal service helpers for the notifications module.

Two responsibilities:

1. ``create()`` — insert an in-app ``Notification`` row in the same
   transaction as the caller's business write. Thin and synchronous
   with the caller's ``commit()``.

2. ``record_email_digest()`` — the email side-channel audit trail.
   Every review-workflow event that *would* email a user (assignment /
   reminder / decision / claim result) writes an
   ``email_digest_records`` row. When SMTP is configured and the
   switch is on it actually sends; otherwise it records the honest
   skip reason. It never raises into the business flow — the in-app
   notification is the source of truth, email is best-effort.
"""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.core.time import utcnow
from app.domain.notifications.models import EmailDigestRecord, Notification
from app.models import User

if TYPE_CHECKING:
    from uuid import UUID

logger = get_logger("rubbish.notifications")

DEFAULT_PREFS: dict[str, bool] = {
    # 站内：默认开——不打扰，但用户能在通知页看到。
    "in_app_comment": True,
    "in_app_forum": True,
    "in_app_review": True,
    "in_app_submission": True,
    "in_app_release": True,
    "in_app_publication": True,
    # 邮件：社交通知默认关；工作流邮件（互评、作品处理、发布失败）默认开，
    # 因为收件人需要据此完成一件具体的事。SMTP 未配置时只记录跳过原因。
    "email_comment": False,
    "email_forum": False,
    "email_review": True,
    "email_submission": True,
    "email_release": True,
}

# 通知类型到站内偏好键。没有列出的类型（认领、角色、反馈等）始终站内送达。
_IN_APP_PREF_BY_TYPE = {
    "comment.new": "in_app_comment",
    "forum.reply": "in_app_forum",
    "forum.moderation_sla": "in_app_forum",
}
_IN_APP_PREF_BY_PREFIX = {
    "review.": "in_app_review",
    "submission.": "in_app_submission",
    "release.": "in_app_release",
    "publication.": "in_app_publication",
}

# 邮件摘要事件到邮件偏好键。评论/论坛的调用方已先检查一遍，这里再兜底。
_EMAIL_PREF_BY_EVENT = {
    "comment.new": "email_comment",
    "forum.reply": "email_forum",
    "assigned": "email_review",
    "review_assignment": "email_review",
    "reminder": "email_review",
    "review_reminder": "email_review",
    "decision": "email_submission",
    "triage_decision": "email_submission",
    "rework_reminder": "email_submission",
    "submission.triage_overdue": "email_submission",
    "forum.moderation_sla": "email_forum",
    "appeal.decision": "email_submission",
    "release.scheduled_failed": "email_release",
}


def in_app_pref_key(type_: str) -> str | None:
    exact = _IN_APP_PREF_BY_TYPE.get(type_)
    if exact is not None:
        return exact
    for prefix, key in _IN_APP_PREF_BY_PREFIX.items():
        if type_.startswith(prefix):
            return key
    return None


def email_pref_key(event_type: str) -> str | None:
    return _EMAIL_PREF_BY_EVENT.get(event_type)


async def _pref_owner(db: AsyncSession, user_id: int) -> User | None:
    return (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()


def merged_prefs(user: object) -> dict[str, bool]:
    raw = getattr(user, "notification_prefs", None) or {}
    prefs = dict(DEFAULT_PREFS)
    for key in DEFAULT_PREFS:
        if key in raw:
            prefs[key] = bool(raw[key])
    return prefs


def wants(user: object, key: str) -> bool:
    return bool(merged_prefs(user).get(key, False))


async def create(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: int,
    type_: str,
    title: str,
    body: str | None = None,
    related_type: str | None = None,
    related_id: str | None = None,
) -> Notification | None:
    """Insert a notification row and flush so the caller's transaction owns it.

    The caller is responsible for ``commit()`` — this helper only adds
    and flushes, so the notification rides on the caller's transaction
    (rollback cancels both the business write and the notification).
    """
    # ``notifications.title`` is VARCHAR(200). 作品标题没有长度上限，
    # 直接拼进通知会在长标题作品上触发 StringDataRightTruncationError，
    # 并让整个指派事务回滚（生产曾因此返回 500）。统一在写入边界截断。
    title = (title or "").strip()
    if len(title) > 200:
        title = title[:199] + "…"
    if not title:
        title = "通知"

    pref_key = in_app_pref_key(type_)
    if pref_key:
        owner = await _pref_owner(db, user_id)
        if owner is not None and not wants(owner, pref_key):
            return None

    notification = Notification(
        tenant_id=tenant_id,
        user_id=user_id,
        type=type_,
        title=title,
        body=body,
        related_type=related_type,
        related_id=related_id,
    )
    db.add(notification)
    await db.flush()
    return notification


async def record_email_digest(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: int,
    event_type: str,
    recipient_email: str,
    subject: str,
    text: str,
    html: str | None = None,
    channel: str = "default",
    related_type: str | None = None,
    related_id: str | None = None,
) -> str:
    """Write one email-digest record and best-effort send when configured.

    Returns the final ``status`` so callers/tests can assert the real
    outcome. Never raises: a broken mail transport must not roll back
    the business transaction (the in-app notification already happened).
    """
    record = EmailDigestRecord(
        tenant_id=tenant_id,
        user_id=user_id,
        event_type=event_type,
        recipient_email=recipient_email,
        subject=subject[:255],
        body=text,
        html=html,
        channel=channel,
        status="skipped_no_smtp",
        attempts=0,
        updated_at=utcnow(),
        related_type=related_type,
        related_id=related_id,
    )
    db.add(record)
    await db.flush()

    # 用户关掉这类邮件：记录为 skipped_user_pref，不尝试发送。
    pref_key = email_pref_key(event_type)
    if pref_key:
        owner = await _pref_owner(db, user_id)
        if owner is not None and not wants(owner, pref_key):
            record.status = "skipped_user_pref"
            await db.flush()
            return record.status

    # 开关关闭：记录为 skipped_disabled，不尝试发送。
    # 给一个可见的重试时间，运营重新打开总闸后由发件箱继续投递。
    if channel != "congrat" and not settings.email_review_digest_enabled:
        record.status = "skipped_disabled"
        record.next_retry_at = utcnow() + timedelta(minutes=5)
        await db.flush()
        return record.status

    from app.core.email import configured_accounts, get_email_sender, smtp_configured

    if channel == "congrat":
        if not configured_accounts():
            record.next_retry_at = utcnow() + timedelta(minutes=5)
            await db.flush()
            return record.status
    elif not smtp_configured():
        # 未配置 SMTP：保持 skipped_no_smtp，落库但不假装已发。
        # 同时给调度器一个可见的重试时间，SMTP 恢复后不会永远卡在 skipped。
        record.next_retry_at = utcnow() + timedelta(minutes=5)
        await db.flush()
        return record.status
    if channel != "congrat" and not settings.email_review_digest_enabled:
        record.next_retry_at = utcnow() + timedelta(minutes=5)
        await db.flush()
        return record.status

    record.attempts = 1
    try:
        if channel == "congrat":
            from app.core.email import get_congrat_sender

            sender = get_congrat_sender()
        else:
            sender = get_email_sender()
        await sender.send(to=recipient_email, subject=subject, body=text, html=html)
        record.status = "sent"
        record.sent_at = utcnow()
        record.next_retry_at = None
        record.last_error = None
    except Exception:
        logger.warning(
            "email_digest_send_failed",
            user_id=user_id,
            event_type=event_type,
            recipient=recipient_email,
            exc_info=True,
        )
        record.status = "failed"
        record.last_error = "SMTP delivery failed"
        record.next_retry_at = utcnow() + timedelta(minutes=5)
    await db.flush()
    return record.status


__all__ = ["DEFAULT_PREFS", "create", "merged_prefs", "record_email_digest", "wants"]
