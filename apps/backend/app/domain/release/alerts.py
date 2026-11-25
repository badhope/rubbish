"""P0-3：定时发布失败的主动告警。

调度器发现 content hash 变更或 gate 被拦时会 supersede manifest；仅写
审计不够——编辑不会盯着审计表。这里给当前租户的编辑/主编（以及 manifest
创建者）发站内通知，并按用户通知偏好尝试邮件。告警与业务状态在同一事务
提交；邮件发送结果写 email_digest_records，未配置 SMTP 时诚实记录为
skipped，不假装送达。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.email_templates import release_failure
from app.core.logging import get_logger
from app.domain.notifications import services as notifications
from app.domain.release.models import ReleaseManifest
from app.domain.submission.editor_recipients import editor_recipients
from app.models import User

logger = get_logger("rubbish.release_alerts")

_REASON_LABELS = {
    "content_changed": "内容哈希已变化，原定发布版本不再匹配",
    "gate_blocked": "发布闸门未通过（仍有错误或待办）",
}


async def _recipients(db: AsyncSession, tenant_id: Any, creator_id: int | None) -> list[User]:
    return await editor_recipients(db, tenant_id, include_user_id=creator_id)


async def alert_release_failure(
    db: AsyncSession,
    *,
    tenant_id: Any,
    manifest: ReleaseManifest,
    reason: str,
    detail: dict[str, Any] | None = None,
) -> int:
    """Notify editors that a scheduled release failed. Returns recipient count."""
    target = f"{manifest.volume}/{manifest.issue}"
    label = _REASON_LABELS.get(reason, reason)
    recipients = await _recipients(db, tenant_id, manifest.created_by)
    if not recipients:
        logger.warning("release_alert_no_recipient", tenant_id=str(tenant_id), target=target)
        return 0

    base = settings.frontend_base_url.rstrip("/")
    link = f"{base}/editor/issue-plan"
    subject, text, html = release_failure(
        target,
        label,
        link,
        detail=detail or {},
    )
    sent = 0
    for user in recipients:
        if notifications.wants(user, "in_app_release"):
            await notifications.create(
                db,
                tenant_id=tenant_id,
                user_id=user.id,
                type_="release.scheduled_failed",
                title=f"定时发布失败：{target}",
                body=f"{label}。请到「合集编排」核对内容；发布或重新排期需管理员确认。",
                related_type="issue",
                related_id=target,
            )
        if notifications.wants(user, "email_release"):
            await notifications.record_email_digest(
                db,
                tenant_id=tenant_id,
                user_id=user.id,
                event_type="release.scheduled_failed",
                recipient_email=user.email,
                subject=subject,
                text=text,
                html=html,
                related_type="issue",
                related_id=target,
            )
        sent += 1
    logger.info(
        "release_failure_alerted",
        target=target,
        reason=reason,
        recipients=sent,
    )
    return sent


__all__ = ["alert_release_failure"]
