"""Release dashboard access: editors can inspect the gate, outsiders cannot."""

from __future__ import annotations

from conftest import auth_headers
from httpx import AsyncClient


async def test_release_dashboard_is_visible_to_editors_only(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    user_id = int(test_user["user_id"])
    blocked = await client.get("/api/admin/releases/issues", headers=auth_headers(test_user))
    assert blocked.status_code == 403

    granted = await client.post(
        f"/api/admin/users/{user_id}/roles",
        json={"role": "editor"},
        headers=auth_headers(admin_user),
    )
    assert granted.status_code == 201, granted.text

    visible = await client.get("/api/admin/releases/issues", headers=auth_headers(test_user))
    assert visible.status_code == 200, visible.text
    assert "items" in visible.json()
