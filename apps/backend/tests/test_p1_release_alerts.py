"""P0-3：定时发布失败时给编辑/主编发站内告警。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.notifications.models import Notification
from app.domain.release.alerts import alert_release_failure
from app.domain.release.models import ReleaseManifest
from app.models import Tenant


async def _tenant_id(db: AsyncSession):
    return (await db.execute(select(Tenant.id).where(Tenant.slug == "default"))).scalar_one()


async def test_release_failure_creates_in_app_alert_for_admin(
    db_session: AsyncSession, admin_user: dict
) -> None:
    tenant = await _tenant_id(db_session)
    manifest = ReleaseManifest(
        tenant_id=tenant,
        volume=12,
        issue=3,
        content_hash="hash-before",
        created_by=admin_user["user_id"],
    )
    count = await alert_release_failure(
        db_session,
        tenant_id=tenant,
        manifest=manifest,
        reason="gate_blocked",
        detail={"errors": 4},
    )
    await db_session.commit()

    assert count >= 1
    notes = (
        (
            await db_session.execute(
                select(Notification).where(
                    Notification.user_id == admin_user["user_id"],
                    Notification.type == "release.scheduled_failed",
                )
            )
        )
        .scalars()
        .all()
    )
    assert notes, "编辑应收到站内发布失败告警"
    assert "12/3" in notes[0].title
    assert "发布闸门" in (notes[0].body or "")


async def test_release_failure_deduplicates_creator_and_editor(
    db_session: AsyncSession, admin_user: dict
) -> None:
    """创建者本身是管理员时，不应收到两条重复站内通知。"""
    tenant = await _tenant_id(db_session)
    manifest = ReleaseManifest(
        tenant_id=tenant,
        volume=9,
        issue=1,
        content_hash="hash-before",
        created_by=admin_user["user_id"],
    )
    count = await alert_release_failure(
        db_session,
        tenant_id=tenant,
        manifest=manifest,
        reason="content_changed",
        detail={"manifest_hash": "a", "current_hash": "b"},
    )
    await db_session.commit()
    assert count == 1
