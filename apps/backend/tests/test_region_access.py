"""Region access + overseas read-only tests."""

from __future__ import annotations

from httpx import AsyncClient

from app.core.config import settings


async def test_restricted_region_blocks_anonymous_but_overseas_can_read(
    client: AsyncClient, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "region_access_enabled", True)
    monkeypatch.setattr(settings, "trusted_proxies_count", 1)
    monkeypatch.setattr(settings, "auth_wall_enabled", True)

    restricted = await client.get(
        "/api/catalog", headers={"x-forwarded-for": "1.0.1.1"}
    )
    assert restricted.status_code == 403
    assert restricted.json()["detail"] == "region_restricted"

    overseas = await client.get(
        "/api/catalog", headers={"x-forwarded-for": "8.8.8.8"}
    )
    assert overseas.status_code == 200

    forum = await client.get(
        "/api/forum/topics", headers={"x-forwarded-for": "8.8.8.8"}
    )
    assert forum.status_code == 200

    # Reads are open; publishing is still a write and must be authenticated.
    write = await client.post(
        "/api/forum/topics",
        headers={"x-forwarded-for": "8.8.8.8"},
        json={"board_id": 1, "title": "guest should not post", "body": "nope"},
    )
    assert write.status_code == 401


async def test_region_cookie_is_set_on_html_response(client: AsyncClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "region_access_enabled", True)
    monkeypatch.setattr(settings, "trusted_proxies_count", 1)

    response = await client.get("/", headers={"x-forwarded-for": "8.8.8.8"})
    assert response.cookies.get("rubbish_region") == "overseas"

    response = await client.get("/", headers={"x-forwarded-for": "1.0.1.1"})
    assert response.cookies.get("rubbish_region") == "restricted"
