"""1.19.55 reliability regressions: editor fan-out, outbox, forum SLA."""

from __future__ import annotations

from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.time import utcnow
from app.domain.forum.models import ForumTopic
from app.domain.forum.reminders import run_moderation_sla_reminders
from app.domain.notifications.email_outbox import (
    EmailOutboxConflict,
    retry_due_emails,
    retry_record,
)
from app.domain.notifications.models import EmailDigestRecord
from app.domain.submission.editor_recipients import editor_recipients
from app.models import Role, Tenant, User, UserRole


async def _tenant(db: AsyncSession) -> Tenant:
    return (await db.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()


async def _editor(db: AsyncSession, tenant_id, name: str, role_name: str) -> User:
    role = (
        await db.execute(
            select(Role).where(Role.tenant_id == tenant_id, Role.name == role_name)
        )
    ).scalar_one_or_none()
    if role is None:
        role = Role(tenant_id=tenant_id, name=role_name)
        db.add(role)
        await db.flush()
    user = User(
        tenant_id=tenant_id,
        email=f"{name}@example.com",
        username=name,
        hashed_password=hash_password("editorpass123"),
        is_active=True,
    )
    db.add(user)
    await db.flush()
    db.add(UserRole(tenant_id=tenant_id, user_id=user.id, role_id=role.id))
    await db.commit()
    return user


@pytest.mark.asyncio
async def test_editor_recipients_cover_all_editorial_seats(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    warmup = await client.get("/api/health")
    assert warmup.status_code == 200
    tenant = await _tenant(db_session)
    section = await _editor(db_session, tenant.id, "sectioned", "section_editor")
    recipients = await editor_recipients(db_session, tenant.id)
    assert section.id in {user.id for user in recipients}
    # 同一用户多角色不会产生重复收件人。
    assert len({user.id for user in recipients}) == len(recipients)


@pytest.mark.asyncio
async def test_outbox_retries_skipped_rows_without_consuming_attempts(
    db_session: AsyncSession, test_user: dict
) -> None:
    tenant = await _tenant(db_session)
    record = EmailDigestRecord(
        tenant_id=tenant.id,
        user_id=test_user["user_id"],
        event_type="submission.triage_overdue",
        recipient_email="ops@example.com",
        subject="SLA",
        body="body",
        channel="default",
        status="skipped_no_smtp",
        attempts=0,
        next_retry_at=utcnow() - timedelta(minutes=1),
    )
    db_session.add(record)
    await db_session.commit()
    stats = await retry_due_emails(db_session, tenant_id=tenant.id)
    await db_session.refresh(record)
    assert stats["checked"] == 1
    assert record.status in ("skipped_no_smtp", "sent")
    assert record.attempts == 0, "transport-unavailable must not burn retry attempts"


@pytest.mark.asyncio
async def test_outbox_refuses_to_resend_sent_row(
    db_session: AsyncSession, test_user: dict
) -> None:
    tenant = await _tenant(db_session)
    record = EmailDigestRecord(
        tenant_id=tenant.id,
        user_id=test_user["user_id"],
        event_type="submission.triage_overdue",
        recipient_email="ops@example.com",
        subject="SLA",
        body="body",
        channel="default",
        status="sent",
        attempts=1,
        sent_at=utcnow(),
    )
    db_session.add(record)
    await db_session.commit()
    with pytest.raises(EmailOutboxConflict):
        await retry_record(db_session, tenant_id=tenant.id, record_id=record.id)


@pytest.mark.asyncio
async def test_forum_sla_reminder_only_fires_once(
    db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    tenant = await _tenant(db_session)
    topic = ForumTopic(
        tenant_id=tenant.id,
        author_id=test_user["user_id"],
        title="人工核验超时样本",
        body="这是一段足够长的主题帖正文，用来验证 SLA 超时提醒只发一次。",
        moderation_status="manual_review",
        review_eta_at=utcnow() - timedelta(hours=3),
    )
    db_session.add(topic)
    await db_session.commit()
    first = await run_moderation_sla_reminders(db_session, tenant_id=tenant.id)
    await db_session.refresh(topic)
    assert first["reminded"] == 1
    assert topic.sla_reminded_at is not None
    second = await run_moderation_sla_reminders(db_session, tenant_id=tenant.id)
    assert second["reminded"] == 0
