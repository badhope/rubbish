"""角色信息贯通：/auth/me、登录响应、editor 侧审稿人候选。

- 登录响应与 /auth/me 都带 roles，前端据此渲染角色化导航；
- 审稿人候选走 /submissions/reviewer-candidates（仅 require_editor），
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
