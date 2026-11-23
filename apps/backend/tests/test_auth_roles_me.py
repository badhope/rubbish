"""角色信息贯通：/auth/me、登录响应、editor 侧互评成员候选。

- 登录响应与 /auth/me 都带 roles，前端据此渲染角色化导航；
- 互评成员候选走 /submissions/reviewer-candidates（仅 require_editor），
  非 admin 的 editor 也能拿到，普通作者 403。
"""

from __future__ import annotations

from conftest import auth_headers
from httpx import AsyncClient


async def test_login_response_includes_roles(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    """登录响应必须带 roles 字段：无角色为 []，被授予后立刻反映。"""
    login = await client.post(
        "/api/auth/login",
        json={"username": "testuser", "password": "password123"},
    )
    assert login.status_code == 200
    assert login.json()["roles"] == []

    await client.post(
        f"/api/admin/users/{test_user['user_id']}/roles",
        json={"role": "reviewer"},
        headers=auth_headers(admin_user),
    )
    relogin = await client.post(
        "/api/auth/login",
        json={"username": "testuser", "password": "password123"},
    )
    assert relogin.status_code == 200
    assert relogin.json()["roles"] == ["reviewer"]


async def test_auth_me_includes_assigned_roles(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    """/auth/me 随角色变化：授予 reviewer 后立即反映。"""
    before = await client.get("/api/auth/me", headers=auth_headers(test_user))
    assert before.status_code == 200
    assert before.json()["roles"] == []

    assign = await client.post(
        f"/api/admin/users/{test_user['user_id']}/roles",
        json={"role": "reviewer"},
        headers=auth_headers(admin_user),
    )
    assert assign.status_code == 201

    after = await client.get("/api/auth/me", headers=auth_headers(test_user))
    assert after.status_code == 200
    assert after.json()["roles"] == ["reviewer"]


async def test_users_me_includes_roles(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    await client.post(
        f"/api/admin/users/{test_user['user_id']}/roles",
        json={"role": "editor"},
        headers=auth_headers(admin_user),
    )
    resp = await client.get("/api/users/me", headers=auth_headers(test_user))
    assert resp.status_code == 200
    assert resp.json()["roles"] == ["editor"]


async def test_me_profile_separates_identity_from_activity(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    """身份组决定权限，活跃等级人人从 1 开始；上层继承下层能力。"""
    admin = await client.get("/api/me/profile", headers=auth_headers(admin_user))
    assert admin.status_code == 200
    body = admin.json()
    assert body["permission_group"]["key"] == "admin"
    assert body["permission_group"]["label"] == "站点管理组"
    assert body["activity"]["level"] == 1
    assert body["activity"]["xp"] == 0
    assert any("站点设置" in item for item in body["permissions"])
    assert any("接收互评邀请" in item for item in body["permissions"])

    member = await client.get("/api/me/profile", headers=auth_headers(test_user))
    assert member.status_code == 200
    member_body = member.json()
    assert member_body["permission_group"]["key"] == "member"
    member_level = member_body["activity"]["level"]
    assert member_level >= 1
    assert not any("站点设置" in item for item in member_body["permissions"])

    await client.post(
        f"/api/admin/users/{test_user['user_id']}/roles",
        json={"role": "editor"},
        headers=auth_headers(admin_user),
    )
    editor = await client.get("/api/me/profile", headers=auth_headers(test_user))
    assert editor.status_code == 200
    editor_body = editor.json()
    assert editor_body["permission_group"]["key"] == "review"
    # 授予身份不改变活跃等级：同一 XP 仍是同一 Level。
    assert editor_body["activity"]["level"] == member_level
    # editor 继承 reviewer，再继承 member。
    assert any("阅读与下载" in item for item in editor_body["permissions"])
    assert any("接收互评邀请" in item for item in editor_body["permissions"])
    assert any("作出通过" in item for item in editor_body["permissions"])
