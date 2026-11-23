"""P0-3：定时发布失败时给编辑/主编发站内告警。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.domain.notifications.models import Notification
from app.domain.release.alerts import alert_release_failure
from app.domain.release.models import ReleaseManifest
from app.domain.submission.triage_reminders import _editor_recipients
from app.models import Role, Tenant, User, UserRole


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


async def test_editor_with_multiple_roles_notified_once(
    db_session: AsyncSession, admin_user: dict
) -> None:
    """同一人挂多个编辑角色时，join 出重复行由 Python 层去重，只发一条通知。

    历史上 SQL 层 ``SELECT DISTINCT`` 整行去重；PostgreSQL 下 User 行含纯
    json 列无等值运算符会直接 500。现改为 Python ``by_id`` 去重，此用例锁住
    去重行为不回归。
    """
    tenant = await _tenant_id(db_session)
    editor = User(
        tenant_id=tenant,
        email="multi@example.com",
        username="multieditor",
        hashed_password=hash_password("pass12345"),
        is_active=True,
    )
    db_session.add(editor)
    await db_session.flush()
    # fresh_database 会清空启动期种子角色，这里自建两个编辑角色并同时挂给同一人，
    # 构造 join 重复行，验证 Python 层去重只通知一次。
    editor_role = Role(tenant_id=tenant, name="editor", description="Editor")
    board_role = Role(tenant_id=tenant, name="board_editor", description="Board editor")
    db_session.add_all([editor_role, board_role])
    await db_session.flush()
    db_session.add(UserRole(tenant_id=tenant, user_id=editor.id, role_id=editor_role.id))
    db_session.add(UserRole(tenant_id=tenant, user_id=editor.id, role_id=board_role.id))
    await db_session.commit()

    manifest = ReleaseManifest(
        tenant_id=tenant,
        volume=5,
        issue=2,
        content_hash="hash-multi",
        created_by=admin_user["user_id"],
    )
    await alert_release_failure(
        db_session,
        tenant_id=tenant,
        manifest=manifest,
        reason="gate_blocked",
        detail={"errors": 1},
    )
    await db_session.commit()

    notes = (
        (await db_session.execute(select(Notification).where(Notification.user_id == editor.id)))
        .scalars()
        .all()
    )
    assert len(notes) == 1


async def test_triage_editor_recipients_deduplicate_multiple_roles(
    db_session: AsyncSession, admin_user: dict
) -> None:
    """基础检查提醒的编辑收件人同样在 Python 层去重，多角色只返回一次。

    与 ``release.alerts`` 同一类历史问题：SQL 层整行 DISTINCT 遇纯 json 列
    在 PostgreSQL 下无等值运算符会 500；此用例锁住 triage 侧 ``by_id`` 去重。
    """
    tenant = await _tenant_id(db_session)
    editor = User(
        tenant_id=tenant,
        email="triage-multi@example.com",
        username="triagemulti",
        hashed_password=hash_password("pass12345"),
        is_active=True,
    )
    db_session.add(editor)
    await db_session.flush()
    editor_role = Role(tenant_id=tenant, name="editor", description="Editor")
    board_role = Role(tenant_id=tenant, name="board_editor", description="Board editor")
    db_session.add_all([editor_role, board_role])
    await db_session.flush()
    db_session.add(UserRole(tenant_id=tenant, user_id=editor.id, role_id=editor_role.id))
    db_session.add(UserRole(tenant_id=tenant, user_id=editor.id, role_id=board_role.id))
    await db_session.commit()

    recipients = await _editor_recipients(db_session, tenant)
    ids = [u.id for u in recipients]
    assert ids.count(editor.id) == 1
    assert len(ids) == len(set(ids))
