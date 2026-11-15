"""P1-9：初筛 48 小时提醒只发一次，补材料重投后重新计时。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.notifications.models import Notification
from app.domain.submission.models import Submission
from app.domain.submission.triage_reminders import (
    TRIAGE_DUE_HOURS,
    run_triage_reminders,
)
from app.models import Tenant


async def _tenant_id(db: AsyncSession):
    return (await db.execute(select(Tenant.id).where(Tenant.slug == "default"))).scalar_one()


async def test_triage_reminder_fires_once_and_marks_submission(
    client, db_session: AsyncSession, test_user: dict, admin_user: dict
) -> None:
    r = await client.post(
        "/api/submissions",
        json={
            "title": "初筛提醒测试稿",
            "type": "paper",
            "authors": ["提醒作者"],
            "year": 2026,
            "discipline": "计算机科学",
            "abstract": "用于验证初筛 48 小时提醒。",
        },
        headers={"Authorization": f"Bearer {test_user['token']}"},
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    tenant = await _tenant_id(db_session)
    entry = await db_session.get(Submission, sid)
    assert entry is not None
    entry.triage_started_at = datetime.now(UTC) - timedelta(hours=TRIAGE_DUE_HOURS + 2)
    entry.triage_reminded_at = None
    await db_session.commit()

    stats = await run_triage_reminders(db_session, tenant_id=tenant)
    assert stats["reminded"] == 1
    refreshed = await db_session.get(Submission, sid)
    assert refreshed is not None
    assert refreshed.triage_reminded_at is not None
    assert refreshed.triage_reminder_count == 1

    notes = (
        (
            await db_session.execute(
                select(Notification).where(
                    Notification.user_id == admin_user["user_id"],
                    Notification.type == "submission.triage_overdue",
                )
            )
        )
        .scalars()
        .all()
    )
    assert notes
    assert f"#{sid}" in (notes[0].body or "")

    # 第二轮不会重复提醒
    again = await run_triage_reminders(db_session, tenant_id=tenant)
    assert again["reminded"] == 0
