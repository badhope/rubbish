"""后台每日检查接口：备份、数据库、迁移、磁盘与邮件。"""

from __future__ import annotations

from conftest import auth_headers
from httpx import AsyncClient


async def test_editor_today_aggregates_backup_and_email(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    r = await client.get("/api/admin/editor/today", headers=auth_headers(admin_user))
    assert r.status_code == 200, r.text
    keys = {check["key"] for check in r.json()["checks"]}
    assert {"backup", "database", "migration", "disk", "email"} <= keys

    r = await client.get("/api/admin/editor/today", headers=auth_headers(test_user))
    assert r.status_code == 403
