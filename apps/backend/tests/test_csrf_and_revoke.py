"""Tests for D2 (refresh-revoke-all) and D3 (CSRF middleware)."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

from app.core.config import settings


@pytest.mark.asyncio
async def test_revoke_all_kills_access_and_refresh(
    client: AsyncClient,
    test_user: dict[str, Any],
) -> None:
    """After /auth/revoke-all, both old access and old refresh fail."""
    access = test_user["token"]
    refresh = test_user["refresh_token"]

    # /me works.
    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 200

    # Revoke everything.
    r2 = await client.post("/api/auth/revoke-all", headers={"Authorization": f"Bearer {access}"})
    assert r2.status_code == 204

    # Old access token is dead (token_version bumped).
    r3 = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert r3.status_code == 401

    # Old refresh token is dead (refresh_token_version bumped).
    r4 = await client.post("/api/auth/refresh", json={"refresh_token": refresh})
    assert r4.status_code == 401


@pytest.mark.asyncio
async def test_revoke_all_requires_auth(client: AsyncClient) -> None:
    r = await client.post("/api/auth/revoke-all")
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# CSRF double-submit-cookie middleware
# ---------------------------------------------------------------------------


def _enable_csrf(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "csrf_enabled", True)


@pytest.mark.asyncio
async def test_csrf_disabled_by_default_allows_post(
    client: AsyncClient, test_user: dict[str, Any]
) -> None:
    """When csrf_enabled is False the middleware is a no-op even on POST."""
    assert settings.csrf_enabled is False  # baseline
    r = await client.post(
        "/api/auth/login",
        json={"username": "testuser", "password": "password123"},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_csrf_blocks_post_without_header(
    client: AsyncClient,
    test_user: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_csrf(monkeypatch)
    refresh = test_user["refresh_token"]

    # POST /api/auth/refresh without X-CSRF-Token + matching cookie -> 403.
    r = await client.post("/api/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_csrf_allows_post_with_matching_header_and_cookie(
    client: AsyncClient,
    test_user: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_csrf(monkeypatch)
    refresh = test_user["refresh_token"]

    csrf_value = "test-csrf-token-stable-12345"
    # httpx deprecated per-request cookies; set them on the client instead and
    # clean up so the shared fixture isn't polluted for later tests.
    client.cookies.set("csrf", csrf_value)
    try:
        r = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": refresh},
            headers={"X-CSRF-Token": csrf_value},
        )
    finally:
        client.cookies.delete("csrf")
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_csrf_blocks_mismatched_header(
    client: AsyncClient,
    test_user: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_csrf(monkeypatch)
    refresh = test_user["refresh_token"]

    client.cookies.set("csrf", "value-A")
    try:
        r = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": refresh},
            headers={"X-CSRF-Token": "value-B"},
        )
    finally:
        client.cookies.delete("csrf")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_csrf_does_not_apply_to_safe_methods(
    client: AsyncClient,
    test_user: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GET /api/auth/me must pass even with csrf_enabled on."""
    _enable_csrf(monkeypatch)
    access = test_user["token"]
    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 200
