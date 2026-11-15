"""Health endpoint tests."""

from __future__ import annotations

from httpx import AsyncClient

from app import __version__


async def test_liveness_returns_ok(client: AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body == {"status": "ok", "version": __version__}


async def test_readiness_reports_db_connected(client: AsyncClient) -> None:
    response = await client.get("/api/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body == {"status": "ok", "database": "connected"}


async def test_root_returns_app_metadata(client: AsyncClient) -> None:
    response = await client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Rubbish API"
    assert body["version"] == __version__
    assert body["docs"] == "/docs"
