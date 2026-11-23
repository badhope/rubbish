"""Notification preferences must be real switches, not decorative checkboxes."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.domain.notifications import services as notifications
from app.domain.submission import review_reminders
from app.models import User

ALL_PREF_KEYS = {
    "in_app_comment",
    "in_app_forum",
    "in_app_review",
    "in_app_submission",
    "in_app_release",
    "email_comment",
    "email_forum",
    "email_review",
    "email_submission",
    "email_release",
}


class _CaptureSender:
    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    async def send(self, *, to: str, subject: str, body: str, html: str | None = None) -> None:
        self.sent.append({"to": to, "subject": subject, "body": body, "html": html or ""})


async def _user(db_session, user_id: int) -> User:
    user = await db_session.get(User, user_id)
    assert user is not None
    return user


@pytest.mark.asyncio
async def test_notification_preferences_expose_all_ten_keys(
    client: AsyncClient, admin_user: dict
) -> None:
    response = await client.get(
        "/api/users/me/notification-preferences",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert set(data) == ALL_PREF_KEYS
    # 社交邮件默认关；工作流邮件默认开，避免互评/裁决邮件悄悄消失。
    assert data["email_comment"] is False
    assert data["email_forum"] is False
    assert data["email_review"] is True
    assert data["email_submission"] is True
    assert data["email_release"] is True


@pytest.mark.asyncio
async def test_in_app_preferences_suppress_review_and_submission_notifications(
    db_session, test_user: dict
) -> None:
    user = await _user(db_session, int(test_user["user_id"]))
    user.notification_prefs = {"in_app_review": False, "in_app_submission": False}
    await db_session.commit()

    review_note = await notifications.create(
        db_session,
        tenant_id=user.tenant_id,
        user_id=user.id,
        type_="review.invited",
        title="有一篇作品等你互评",
    )
    submission_note = await notifications.create(
        db_session,
        tenant_id=user.tenant_id,
        user_id=user.id,
        type_="submission.decision",
        title="作品有了处理结果",
    )
    assert review_note is None
    assert submission_note is None

    user.notification_prefs = {"in_app_review": True, "in_app_submission": True}
    await db_session.commit()
    review_note = await notifications.create(
        db_session,
        tenant_id=user.tenant_id,
        user_id=user.id,
        type_="review.invited",
        title="有一篇作品等你互评",
    )
    assert review_note is not None


@pytest.mark.asyncio
async def test_email_preference_skips_digest_honestly(db_session, test_user: dict) -> None:
    user = await _user(db_session, int(test_user["user_id"]))
    user.notification_prefs = {"email_review": False}
    await db_session.commit()

    status = await notifications.record_email_digest(
        db_session,
        tenant_id=user.tenant_id,
        user_id=user.id,
        event_type="assigned",
        recipient_email=user.email,
        subject="Rubbish：有一篇作品等你互评",
        text="打开互评工作台查看。",
    )
    assert status == "skipped_user_pref"


@pytest.mark.asyncio
async def test_assignment_and_decision_emails_respect_user_preferences(
    db_session, test_user: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _user(db_session, int(test_user["user_id"]))
    user.notification_prefs = {"email_review": False, "email_submission": False}
    await db_session.commit()

    sender = _CaptureSender()
    monkeypatch.setattr(review_reminders, "smtp_configured", lambda: True)
    monkeypatch.setattr(review_reminders, "get_email_sender", lambda: sender)

    await review_reminders.send_assignment_email(user, submission_title="测试作品", assignment_id=1)
    await review_reminders.send_decision_email(
        user,
        submission_title="测试作品",
        decision="accept",
        note=None,
        submission_id=1,
    )
    assert sender.sent == []

    user.notification_prefs = {"email_review": True, "email_submission": True}
    await review_reminders.send_assignment_email(user, submission_title="测试作品", assignment_id=2)
    assert len(sender.sent) == 1
    assert "/review?tab=assignments&assignment=2" in sender.sent[0]["body"]
