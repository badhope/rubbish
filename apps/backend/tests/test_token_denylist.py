"""Tests for the JTI-based token denylist (Memory + Redis fallback)."""

from __future__ import annotations

import time
from typing import Any

import pytest
from httpx import AsyncClient

from app.core.token_denylist import (
    MemoryTokenDenylist,
    TokenDenylist,
    get_denylist,
    reset_denylist,
)
from app.core.tokens import random_jti

# ---------------------------------------------------------------------------
# Unit tests — MemoryTokenDenylist
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_memory_add_and_is_denied() -> None:
    """Adding a JTI makes is_denied return True."""
    denylist: TokenDenylist = MemoryTokenDenylist()
    jti = random_jti()
    future = time.time() + 3600

    assert not await denylist.is_denied(jti)
    await denylist.add(jti, future)
    assert await denylist.is_denied(jti)


@pytest.mark.asyncio
async def test_memory_expired_entry_not_denied() -> None:
    """An expired JTI is cleaned up and returns False."""
    denylist: TokenDenylist = MemoryTokenDenylist()
    jti = random_jti()
    past = time.time() - 60  # expired 60 seconds ago

    await denylist.add(jti, past)
    assert not await denylist.is_denied(jti)


@pytest.mark.asyncio
async def test_memory_cleanup_on_add() -> None:
    """Expired entries are pruned during add, keeping the dict bounded."""
    denylist = MemoryTokenDenylist()
    jti1 = random_jti()
    jti2 = random_jti()
    past = time.time() - 60
    future = time.time() + 3600

    # Add an expired entry and a valid one.
    await denylist.add(jti1, past)
    await denylist.add(jti2, future)

    # The expired entry should be gone; the valid one stays.
    assert not await denylist.is_denied(jti1)
    assert await denylist.is_denied(jti2)


@pytest.mark.asyncio
async def test_memory_different_jtis_independent() -> None:
    """Denying one JTI does not affect another."""
    denylist: TokenDenylist = MemoryTokenDenylist()
    jti_a = random_jti()
    jti_b = random_jti()
    future = time.time() + 3600

    await denylist.add(jti_a, future)
    assert await denylist.is_denied(jti_a)
    assert not await denylist.is_denied(jti_b)


# ---------------------------------------------------------------------------
# Unit tests — get_denylist factory
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_denylist_returns_memory_when_no_redis() -> None:
    """Without RUBBISH_REDIS_URL, the factory returns MemoryTokenDenylist."""
    reset_denylist()
    denylist = await get_denylist()
    assert isinstance(denylist, MemoryTokenDenylist)


@pytest.mark.asyncio
async def test_get_denylist_is_singleton() -> None:
    """Subsequent calls return the same instance."""
    reset_denylist()
    d1 = await get_denylist()
    d2 = await get_denylist()
    assert d1 is d2


# ---------------------------------------------------------------------------
# Integration tests — refresh-token rotation with denylist
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_rotation_denies_old_token(
    client: AsyncClient,
    test_user: dict[str, Any],
) -> None:
    """After a refresh, the old refresh token is rejected (JTI denylist)."""
    reset_denylist()
    old_refresh = test_user["refresh_token"]

    # First refresh — should succeed.
    r1 = await client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r1.status_code == 200, r1.text
    new_refresh = r1.json()["refresh_token"]
    assert new_refresh != old_refresh

    # Clear cookies so the next request uses the body token, not the
    # cookie that was just updated by the first refresh.
    client.cookies.clear()

    # Replay the old refresh token — should be denied.
    r2 = await client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r2.status_code == 401, r2.text


@pytest.mark.asyncio
async def test_refresh_rotation_new_token_works(
    client: AsyncClient,
    test_user: dict[str, Any],
) -> None:
    """After a refresh, the new token can be refreshed again."""
    reset_denylist()
    old_refresh = test_user["refresh_token"]

    r1 = await client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r1.status_code == 200, r1.text
    new_refresh = r1.json()["refresh_token"]

    # The new refresh token should work for another refresh.
    r2 = await client.post("/api/auth/refresh", json={"refresh_token": new_refresh})
    assert r2.status_code == 200, r2.text


@pytest.mark.asyncio
async def test_refresh_rotation_chain(
    client: AsyncClient,
    test_user: dict[str, Any],
) -> None:
    """A chain of 3 refreshes: each old token is denied, each new token works."""
    reset_denylist()
    token = test_user["refresh_token"]

    for _ in range(3):
        r = await client.post("/api/auth/refresh", json={"refresh_token": token})
        assert r.status_code == 200, r.text
        old_token = token
        token = r.json()["refresh_token"]
        assert token != old_token

        # Clear cookies so the replay uses the body token, not the
        # cookie that was just updated.
        client.cookies.clear()

        # Replay the just-consumed token — should be denied.
        r2 = await client.post("/api/auth/refresh", json={"refresh_token": old_token})
        assert r2.status_code == 401, r2.text


# ---------------------------------------------------------------------------
# Integration tests — logout with denylist
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_logout_denies_refresh_token(
    client: AsyncClient,
    test_user: dict[str, Any],
) -> None:
    """After logout, the current refresh token is added to the denylist."""
    reset_denylist()
    access = test_user["token"]
    refresh = test_user["refresh_token"]

    # Logout.
    r = await client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {access}"},
        json={"refresh_token": refresh},
    )
    assert r.status_code == 204

    # Old refresh token should be denied.
    r2 = await client.post("/api/auth/refresh", json={"refresh_token": refresh})
    assert r2.status_code == 401, r2.text


@pytest.mark.asyncio
async def test_logout_denies_access_token(
    client: AsyncClient,
    test_user: dict[str, Any],
) -> None:
    """After logout, the access token is invalidated via token_version bump."""
    reset_denylist()
    access = test_user["token"]

    r = await client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r.status_code == 204

    # Old access token should be denied.
    r2 = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert r2.status_code == 401


# ---------------------------------------------------------------------------
# Integration tests — revoke-all (bulk) still works
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_all_kills_refresh_via_rtv(
    client: AsyncClient,
    test_user: dict[str, Any],
) -> None:
    """Revoke-all bumps rtv — old refresh tokens fail the rtv check."""
    reset_denylist()
    access = test_user["token"]
    refresh = test_user["refresh_token"]

    r = await client.post(
        "/api/auth/revoke-all",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r.status_code == 204

    r2 = await client.post("/api/auth/refresh", json={"refresh_token": refresh})
    assert r2.status_code == 401


@pytest.mark.asyncio
async def test_revoke_all_kills_access(
    client: AsyncClient,
    test_user: dict[str, Any],
) -> None:
    """Revoke-all bumps token_version — old access tokens fail."""
    reset_denylist()
    access = test_user["token"]

    r = await client.post(
        "/api/auth/revoke-all",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r.status_code == 204

    r2 = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert r2.status_code == 401


# ---------------------------------------------------------------------------
# Unit tests — random_jti
# ---------------------------------------------------------------------------


def test_random_jti_uniqueness() -> None:
    """Generate many JTIs and verify no collisions."""
    jtis = {random_jti() for _ in range(1000)}
    assert len(jtis) == 1000


def test_random_jti_length() -> None:
    """random_jti produces a reasonable-length string."""
    jti = random_jti()
    assert 20 <= len(jti) <= 30  # 16 url-safe bytes → ~22 chars
