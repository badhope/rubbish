"""1.20.24: 主编拿到业务后台，但仍拿不到平台提权与删除账号。

覆盖：
- 主编可读成员列表、建公告、切互评盲法；
- 普通编辑仍不能读成员列表；
- 主编不能把别人设为平台管理员；
- 配置自检不写库，并能把“邀请码开关打开但没有码”判为 fail。
"""

from __future__ import annotations

import pytest
from conftest import auth_headers, register_user
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


async def _grant(client: AsyncClient, admin_user: dict, target: dict, role: str) -> dict[str, str]:
    res = await client.post(
        f"/api/admin/users/{target['user_id']}/roles",
        json={"role": role},
        headers=auth_headers(admin_user),
    )
    assert res.status_code == 201, res.text
    return auth_headers(target)


@pytest.mark.asyncio
async def test_chief_can_use_business_admin_but_editor_cannot(
    client: AsyncClient, admin_user: dict
) -> None:
    chief = await register_user(client, email="chief12024@example.com", username="chief12024")
    editor = await register_user(client, email="editor12024@example.com", username="editor12024")
    chief_headers = await _grant(client, admin_user, chief, "chief_editor")
    editor_headers = await _grant(client, admin_user, editor, "editor")

    users = await client.get("/api/admin/users", headers=chief_headers)
    assert users.status_code == 200, users.text

    editor_users = await client.get("/api/admin/users", headers=editor_headers)
    assert editor_users.status_code == 403

    created = await client.post(
        "/api/announcements",
        json={
            "slug": "chief-12024",
            "title": "主编能发公告",
            "body": "验证内容后台对主编开放。",
            "level": "info",
            "is_active": True,
        },
        headers=chief_headers,
    )
    assert created.status_code == 201, created.text

    review_mode = await client.get("/api/admin/settings/review-mode", headers=chief_headers)
    assert review_mode.status_code == 200
    switched = await client.patch(
        "/api/admin/settings/review-mode",
        json={"review_mode": "double_blind"},
        headers=chief_headers,
    )
    assert switched.status_code == 200, switched.text
    assert switched.json()["review_mode"] == "double_blind"


@pytest.mark.asyncio
async def test_chief_cannot_escalate_platform_admin(
    client: AsyncClient, admin_user: dict
) -> None:
    chief = await register_user(client, email="chief-noesc@example.com", username="chiefnoesc")
    victim = await register_user(client, email="victim12024@example.com", username="victim12024")
    chief_headers = await _grant(client, admin_user, chief, "chief_editor")

    denied = await client.patch(
        f"/api/admin/users/{victim['user_id']}/admin",
        params={"is_admin": True},
        headers=chief_headers,
    )
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_site_settings_check_blocks_invite_without_code(
    client: AsyncClient, admin_user: dict, db_session: AsyncSession
) -> None:
    headers = auth_headers(admin_user)
    before = await client.get("/api/admin/settings/site", headers=headers)
    assert before.status_code == 200
    before_json = before.json()

    checked = await client.post(
        "/api/admin/settings/site/check",
        json={"registration_invite_required": True, "registration_invite_code": ""},
        headers=headers,
    )
    assert checked.status_code == 200, checked.text
    body = checked.json()
    assert body["status"] == "fail"
    assert any(item["key"] == "registration" and item["status"] == "fail" for item in body["items"])

    # 自检只读，不落库。
    after = await client.get("/api/admin/settings/site", headers=headers)
    assert after.json() == before_json

    audit = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "admin.settings.site")
    )
    assert audit.scalars().first() is None
