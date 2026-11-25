"""1.19.62 浏览器巡检中发现的两个运行时口径修复。

- SQLite 单机部署下，后台分析总览不能因为缺少 timezone() 直接 500；
- SQLite 演示库没有 alembic_version 表时，健康页不能把“迁移未知”误报成
  “数据库连接失败”，否则数据库与迁移两个检查互相矛盾。
"""

from __future__ import annotations

import pytest
from conftest import auth_headers
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_admin_analytics_summary_works_on_sqlite(
    client: AsyncClient, admin_user: dict
) -> None:
    for path in ("/catalog/1", "/catalog/1", "/forum/1"):
        resp = await client.post("/api/telemetry/pageview", json={"path": path})
        assert resp.status_code == 204, resp.text

    summary = await client.get(
        "/api/admin/analytics/summary?days=7", headers=auth_headers(admin_user)
    )
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["days"] == 7
    assert body["total"] == 3
    assert body["unique_paths"] == 2
    assert len(body["daily"]) == 7
    assert sum(item["views"] for item in body["daily"]) == 3
    assert body["paths"][0]["views"] == 2


@pytest.mark.asyncio
async def test_system_health_keeps_database_ok_without_migration_table(
    client: AsyncClient, admin_user: dict
) -> None:
    health = await client.get("/api/admin/system/health", headers=auth_headers(admin_user))
    assert health.status_code == 200, health.text
    checks = {item["key"]: item for item in health.json()["checks"]}
    assert checks["database"]["status"] == "ok", checks["database"]
    assert "连接失败" not in checks["database"]["detail"]
    # SQLite 测试库没有 alembic_version：迁移检查应是 warn/未知，而不是把
    # 数据库本身判死。
    assert checks["migration"]["status"] == "warn"
    assert "未知" in checks["migration"]["detail"]
