"""Admin operations ledger and monthly report (1.20.15)."""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
from conftest import auth_headers
from httpx import AsyncClient


async def _seed_admin_audit(
    client: AsyncClient, admin: dict, user: dict, action_prefix: str = "user.set_active"
) -> None:
    """Create at least one audit row with a known actor/action."""
    r = await client.patch(
        f"/api/admin/users/{user['user_id']}/active",
        params={"is_active": False},
        headers=auth_headers(admin),
    )
    assert r.status_code == 200
    r = await client.patch(
        f"/api/admin/users/{user['user_id']}/active",
        params={"is_active": True},
        headers=auth_headers(admin),
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_audit_logs_filter_and_export(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    await _seed_admin_audit(client, admin_user, test_user)
    admin_id = int(admin_user["user_id"])

    filtered = await client.get(
        "/api/admin/audit-logs",
        params={"action": "user.set_active", "actor_user_id": admin_id, "limit": 50},
        headers=auth_headers(admin_user),
    )
    assert filtered.status_code == 200
    rows = filtered.json()
    assert rows
    assert all(row["action"] == "user.set_active" for row in rows)
    assert all(row["actor_user_id"] == admin_id for row in rows)

    by_target = await client.get(
        "/api/admin/audit-logs",
        params={"target_type": "user", "action": "user.set_active"},
        headers=auth_headers(admin_user),
    )
    assert by_target.status_code == 200
    assert by_target.json()
    assert all(row["target_type"] == "user" for row in by_target.json())

    missing = await client.get(
        "/api/admin/audit-logs",
        params={"action": "does.not.exist"},
        headers=auth_headers(admin_user),
    )
    assert missing.status_code == 200
    assert missing.json() == []

    count = await client.get(
        "/api/admin/audit-logs/count",
        params={"action": "user.set_active"},
        headers=auth_headers(admin_user),
    )
    assert count.status_code == 200
    assert count.json()["total"] >= len(rows)

    now = datetime.now(UTC).isoformat()
    limited = await client.get(
        "/api/admin/audit-logs",
        params={"start": now, "end": now, "limit": 10},
        headers=auth_headers(admin_user),
    )
    assert limited.status_code == 200
    # The exact second boundary is intentionally tight; only assert it does not 500.
    assert isinstance(limited.json(), list)

    bad_range = await client.get(
        "/api/admin/audit-logs",
        params={"start": "2026-12-01T00:00:00+08:00", "end": "2026-11-01T00:00:00+08:00"},
        headers=auth_headers(admin_user),
    )
    assert bad_range.status_code == 422

    export = await client.get(
        "/api/admin/audit-logs/export",
        params={"action": "user.set_active"},
        headers=auth_headers(admin_user),
    )
    assert export.status_code == 200
    assert "text/csv" in export.headers["content-type"]
    assert export.headers["x-export-limit"] == "5000"
    assert "attachment" in export.headers["content-disposition"]
    assert export.text.startswith("\ufeff")
    rows = list(csv.reader(io.StringIO(export.text.lstrip("\ufeff"))))
    assert rows[0][:4] == ["id", "created_at", "actor_user_id", "actor_name"]
    assert any(row[4] == "user.set_active" for row in rows[1:])


@pytest.mark.asyncio
async def test_monthly_ops_report_and_export(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    await _seed_admin_audit(client, admin_user, test_user)
    month = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m")

    response = await client.get(
        "/api/admin/ops/monthly",
        params={"month": month},
        headers=auth_headers(admin_user),
    )
    assert response.status_code == 200
    report = response.json()
    assert report["month"] == month
    assert report["totals"]["new_users"] >= 1
    assert report["totals"]["admin_actions"] >= 1
    assert report["totals"]["active_admins"] >= 1
    assert set(report["backlog"]) == {
        "open_reports",
        "manual_review_topics",
        "pending_comments",
        "pending_submissions",
    }
    assert report["daily"]
    assert report["daily"][0]["date"].startswith(month)
    assert len(report["daily"]) in (28, 29, 30, 31)
    assert any(item["action"] == "user.set_active" for item in report["top_actions"])

    export = await client.get(
        "/api/admin/ops/monthly/export",
        params={"month": month},
        headers=auth_headers(admin_user),
    )
    assert export.status_code == 200
    assert "text/csv" in export.headers["content-type"]
    assert "attachment" in export.headers["content-disposition"]
    assert export.text.startswith("\ufeff")
    assert "月度运营报告" in export.text
    assert "日期" in export.text


@pytest.mark.asyncio
async def test_monthly_ops_rejects_bad_month(client: AsyncClient, admin_user: dict) -> None:
    response = await client.get(
        "/api/admin/ops/monthly",
        params={"month": "2026-13"},
        headers=auth_headers(admin_user),
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_ops_endpoints_require_admin(client: AsyncClient, test_user: dict) -> None:
    for path in (
        "/api/admin/ops/monthly",
        "/api/admin/ops/monthly/export",
        "/api/admin/audit-logs/export",
        "/api/admin/audit-logs/count",
    ):
        response = await client.get(path, headers=auth_headers(test_user))
        assert response.status_code == 403
