"""Scheduled publication tests — visibility windows and the issue calendar."""

from __future__ import annotations

from datetime import timedelta

from conftest import auth_headers
from httpx import AsyncClient

from app.core.time import utcnow

_SAMPLE = {
    "type": "paper",
    "title": "Scheduled Paper",
    "authors": ["Alice"],
    "year": 2026,
    "discipline": "计算机科学",
    "abstract": "用于验证定时发布的占位摘要，长度足够。",
    "volume": "1",
    "issue": "02",
}


async def _create(client: AsyncClient, admin: dict, **overrides) -> dict:
    payload = {**_SAMPLE, **overrides}
    r = await client.post("/api/catalog", json=payload, headers=auth_headers(admin))
    assert r.status_code == 201, r.text
    return r.json()


async def test_future_publish_at_is_hidden_from_public(
    client: AsyncClient, admin_user: dict
) -> None:
    future = (utcnow() + timedelta(days=30)).isoformat()
    created = await _create(client, admin_user, title="Future Paper", publish_at=future)

    listing = await client.get("/api/catalog", params={"page_size": 100})
    assert listing.status_code == 200
    titles = [r["title"] for r in listing.json()["data"]]
    assert "Future Paper" not in titles

    detail = await client.get(f"/api/catalog/{created['id']}")
    assert detail.status_code == 404

    file_resp = await client.get(f"/api/catalog/{created['id']}/file")
    assert file_resp.status_code == 404


async def test_admin_still_sees_scheduled_records(client: AsyncClient, admin_user: dict) -> None:
    future = (utcnow() + timedelta(days=30)).isoformat()
    created = await _create(
        client, admin_user, title="Scheduled Visible To Admin", publish_at=future
    )

    listing = await client.get(
        "/api/catalog", params={"page_size": 100}, headers=auth_headers(admin_user)
    )
    assert created["id"] in [r["id"] for r in listing.json()["data"]]

    detail = await client.get(f"/api/catalog/{created['id']}", headers=auth_headers(admin_user))
    assert detail.status_code == 200


async def test_past_publish_at_is_public(client: AsyncClient, admin_user: dict) -> None:
    past = (utcnow() - timedelta(days=1)).isoformat()
    created = await _create(client, admin_user, title="Past Paper", publish_at=past)
    detail = await client.get(f"/api/catalog/{created['id']}")
    assert detail.status_code == 200
    assert detail.json()["title"] == "Past Paper"


async def test_null_publish_at_is_public_immediately(client: AsyncClient, admin_user: dict) -> None:
    created = await _create(client, admin_user, title="Immediate Paper")
    assert (await client.get(f"/api/catalog/{created['id']}")).status_code == 200


async def test_stats_and_facets_exclude_scheduled(client: AsyncClient, admin_user: dict) -> None:
    before = (await client.get("/api/catalog/stats")).json()["total"]
    future = (utcnow() + timedelta(days=10)).isoformat()
    await _create(client, admin_user, title="Queued For Stats", publish_at=future)
    after = (await client.get("/api/catalog/stats")).json()["total"]
    assert after == before

    facets = (await client.get("/api/catalog/facets")).json()
    assert all(bucket["value"] != "2099" for bucket in facets["years"])


async def test_comments_blocked_on_scheduled(client: AsyncClient, admin_user: dict) -> None:
    future = (utcnow() + timedelta(days=10)).isoformat()
    created = await _create(client, admin_user, title="Queued Comment Target", publish_at=future)
    r = await client.post(
        "/api/comments",
        json={"resource_id": created["id"], "body": "排期稿不应可评论"},
        headers=auth_headers(admin_user),
    )
    assert r.status_code == 404


async def test_issue_plan_reports_live_and_scheduled(client: AsyncClient, admin_user: dict) -> None:
    future = (utcnow() + timedelta(days=45)).isoformat()
    await _create(client, admin_user, title="Issue 09 Paper A", issue="09", publish_at=future)
    await _create(client, admin_user, title="Issue 09 Paper B", issue="09", publish_at=future)
    await _create(client, admin_user, title="Issue 08 Paper", issue="08")

    plan = await client.get("/api/catalog/issue-plan")
    assert plan.status_code == 200
    body = plan.json()
    by_issue = {entry["issue"]: entry for entry in body["entries"]}
    assert by_issue["09"]["state"] == "scheduled"
    assert by_issue["09"]["scheduled"] == 2
    assert by_issue["09"]["published"] == 0
    assert by_issue["09"]["publish_at"] is not None
    assert by_issue["08"]["state"] == "live"
    assert by_issue["08"]["published"] == 1


async def test_publish_issue_endpoint_releases_now(client: AsyncClient, admin_user: dict) -> None:
    future = (utcnow() + timedelta(days=60)).isoformat()
    for i in range(3):
        await _create(client, admin_user, title=f"Release Me {i}", issue="07", publish_at=future)

    before = await client.get("/api/catalog", params={"issue": "07", "page_size": 100})
    assert before.json()["meta"]["total"] == 0

    released = await client.post(
        "/api/catalog/issues/1/07/publish",
        json={"publish_at": None},
        headers=auth_headers(admin_user),
    )
    assert released.status_code == 200, released.text
    assert released.json()["state"] == "live"
    assert released.json()["published"] == 3

    after = await client.get("/api/catalog", params={"issue": "07", "page_size": 100})
    assert after.json()["meta"]["total"] == 3


async def test_publish_issue_requires_admin(client: AsyncClient, test_user: dict) -> None:
    r = await client.post(
        "/api/catalog/issues/1/01/publish",
        json={"publish_at": None},
        headers=auth_headers(test_user),
    )
    assert r.status_code == 403


async def test_publish_missing_issue_404(client: AsyncClient, admin_user: dict) -> None:
    r = await client.post(
        "/api/catalog/issues/9/99/publish",
        json={"publish_at": None},
        headers=auth_headers(admin_user),
    )
    assert r.status_code == 404


async def test_search_results_respect_visibility(
    client: AsyncClient, admin_user: dict, monkeypatch
) -> None:
    """Meilisearch 命中排期稿时，回表必须补可见性过滤，不能泄漏。"""
    from app.core import search as fulltext
    from app.core.config import settings

    future = (utcnow() + timedelta(days=20)).isoformat()
    visible = await _create(client, admin_user, title="Visible Search Hit")
    queued = await _create(client, admin_user, title="Queued Search Hit", publish_at=future)

    monkeypatch.setattr(settings, "meilisearch_url", "http://localhost:7700", raising=False)

    async def fake_search(**_kwargs):
        return [queued["id"], visible["id"]], 2

    monkeypatch.setattr(fulltext, "search_resource_ids", fake_search)
    resp = await client.get("/api/catalog", params={"q": "Search Hit"})
    assert resp.status_code == 200
    body = resp.json()
    assert [r["id"] for r in body["data"]] == [visible["id"]]
    assert body["meta"]["total"] == 1


async def test_export_excludes_scheduled(client: AsyncClient, admin_user: dict) -> None:
    future = (utcnow() + timedelta(days=20)).isoformat()
    queued = await _create(client, admin_user, title="Queued Export", publish_at=future)
    resp = await client.get("/api/export", params={"ids": [queued["id"]], "format": "json"})
    assert resp.status_code == 404


async def test_reader_history_rejects_scheduled(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    """阅读历史不能指向排期稿：否则 201/404 差异会泄露它存在。"""
    future = (utcnow() + timedelta(days=20)).isoformat()
    queued = await _create(client, admin_user, title="Queued History", publish_at=future)
    r = await client.post(f"/api/reader/history/{queued['id']}", headers=auth_headers(test_user))
    assert r.status_code == 404


async def test_reading_list_rejects_scheduled(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    future = (utcnow() + timedelta(days=20)).isoformat()
    queued = await _create(client, admin_user, title="Queued List Item", publish_at=future)
    created = await client.post(
        "/api/reading-lists", json={"name": "Scheduled Guard"}, headers=auth_headers(test_user)
    )
    assert created.status_code == 201
    r = await client.post(
        f"/api/reading-lists/{created.json()['id']}/items",
        json={"resource_id": queued["id"]},
        headers=auth_headers(test_user),
    )
    assert r.status_code == 404
