"""OIDC SSO route tests.

We don't run a full OIDC round-trip in tests (would need a fake IdP).
The behaviors that matter for the API contract are:

- When OIDC is disabled (the default), routes return 503.
- When configured provider 鈮?path provider, routes return 404.
- When OIDC is configured + provider matches + state is bad, callback 400.

These three cover the negative paths. The happy path is exercised by the
integration test in CI against a real Keycloak container.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

import pytest_asyncio
from httpx import AsyncClient


@pytest_asyncio.fixture
async def oidc_enabled_client(client: AsyncClient) -> AsyncGenerator[AsyncClient, None]:
    """Enable OIDC + configure a fake provider for the duration of the test.

    Mutates the cached ``settings`` because it's an ``lru_cache`` singleton
    in production. Restores the previous values on teardown so other tests
    see the default disabled state.
    """
    from app.core.config import settings

    prev = {
        "oidc_enabled": settings.oidc_enabled,
        "oidc_provider": settings.oidc_provider,
        "oidc_client_id": settings.oidc_client_id,
        "oidc_client_secret": settings.oidc_client_secret,
        "oidc_authorize_url": settings.oidc_authorize_url,
        "oidc_token_url": settings.oidc_token_url,
        "oidc_userinfo_url": settings.oidc_userinfo_url,
        "oidc_redirect_url": settings.oidc_redirect_url,
    }
    settings.oidc_enabled = True
    settings.oidc_provider = "google"
    settings.oidc_client_id = "test-client-id"
    settings.oidc_client_secret = "test-client-secret"
    settings.oidc_authorize_url = "https://accounts.google.com/o/oauth2/v2/auth"
    settings.oidc_token_url = "https://oauth2.googleapis.com/token"
    settings.oidc_userinfo_url = "https://openidconnect.googleapis.com/v1/userinfo"
    settings.oidc_redirect_url = "http://localhost:5173/auth/oidc/callback"
    try:
        yield client
    finally:
        for key, val in prev.items():
            setattr(settings, key, val)


async def test_oidc_login_disabled_returns_503(client: AsyncClient) -> None:
    response = await client.get("/api/auth/oidc/google/login")
    assert response.status_code == 503


async def test_oidc_callback_disabled_returns_503(client: AsyncClient) -> None:
    response = await client.get(
        "/api/auth/oidc/google/callback",
        params={"code": "fake-code", "state": "fake-state"},
    )
    assert response.status_code == 503


async def test_oidc_login_wrong_provider_404(
    oidc_enabled_client: AsyncClient,
) -> None:
    response = await oidc_enabled_client.get("/api/auth/oidc/github/login")
    assert response.status_code == 404


async def test_oidc_login_redirects_to_provider(
    oidc_enabled_client: AsyncClient,
) -> None:
    response = await oidc_enabled_client.get("/api/auth/oidc/google/login", follow_redirects=False)
    assert response.status_code in (302, 307)
    location = response.headers["location"]
    assert "accounts.google.com" in location
    assert "client_id=test-client-id" in location
    assert "state=" in location  # signed JWT state token attached


async def test_oidc_callback_bad_state_400(
    oidc_enabled_client: AsyncClient,
) -> None:
    response = await oidc_enabled_client.get(
        "/api/auth/oidc/google/callback",
        params={"code": "fake-code", "state": "garbage"},
        follow_redirects=False,
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or expired OIDC state"


# ---------------------------------------------------------------------------
# /api/auth/oidc/providers endpoint
# ---------------------------------------------------------------------------
# This endpoint is the single source of truth for the SPA login page: it
# reports which providers are actually configured on this deployment so the
# SPA can render zero or one SSO button without hardcoding env vars.
# Added 2026-07-24 hardening.


async def test_providers_disabled_returns_empty_list(client: AsyncClient) -> None:
    """When OIDC is not configured, /providers returns an empty list.

    The SPA MUST treat this as 'no SSO button'. Even if a build-time env
    var leaks into the bundle, the runtime response is authoritative.
    """
    response = await client.get("/api/auth/oidc/providers")
    assert response.status_code == 200
    assert response.json() == {"providers": []}


async def test_providers_enabled_returns_configured_provider(
    oidc_enabled_client: AsyncClient,
) -> None:
    """When configured, /providers returns exactly the one provider."""
    response = await oidc_enabled_client.get("/api/auth/oidc/providers")
    assert response.status_code == 200
    data = response.json()
    assert len(data["providers"]) == 1
    p = data["providers"][0]
    assert p["slug"] == "google"
    # No label set on the fixture -> falls back to capitalized slug.
    assert p["label"] == "Google"
    assert p["login_url"] == "/api/auth/oidc/google/login"


async def test_providers_label_override(
    oidc_enabled_client: AsyncClient,
) -> None:
    """oidc_provider_label overrides the default capitalized slug."""
    from app.core.config import settings

    settings.oidc_provider_label = "Google Workspace SSO"
    try:
        response = await oidc_enabled_client.get("/api/auth/oidc/providers")
        assert response.status_code == 200
        assert response.json()["providers"][0]["label"] == "Google Workspace SSO"
    finally:
        settings.oidc_provider_label = ""


async def test_providers_endpoint_is_public(
    client: AsyncClient,
) -> None:
    """The /providers endpoint must NOT require auth.

    Login pages call it before the user has signed in. If it required
    a token the SPA would deadlock at first load.
    """
    # No Authorization header set on the fixture client.
    response = await client.get("/api/auth/oidc/providers")
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# PKCE (RFC 7636) on /login + /callback
# ---------------------------------------------------------------------------
# Added 2026-07-24 hardening. PKCE prevents auth code interception:
# even if an attacker captures the redirect, they can't redeem the code
# without the one-shot code_verifier stored in the user's browser cookie.


async def test_login_sets_pkce_cookie_and_challenge(
    oidc_enabled_client: AsyncClient,
) -> None:
    """The login redirect sets the PKCE cookie and adds code_challenge.

    The cookie carries the verifier; the URL carries the SHA-256 challenge.
    The IdP will recompute the SHA-256 of the verifier at /callback and
    reject if it doesn't match.
    """
    response = await oidc_enabled_client.get("/api/auth/oidc/google/login", follow_redirects=False)
    assert response.status_code in (302, 307)
    location = response.headers["location"]
    assert "code_challenge=" in location
    assert "code_challenge_method=S256" in location
    # Set-Cookie carries the verifier; we only assert presence, not the
    # secret itself (the value is opaque).
    set_cookie = response.headers.get("set-cookie", "")
    assert "oidc_pkce=" in set_cookie
    assert "HttpOnly" in set_cookie


async def test_callback_without_pkce_cookie_400(
    oidc_enabled_client: AsyncClient,
) -> None:
    """Callback rejects when PKCE is required but the verifier cookie is missing.

    This is the defense against an attacker crafting a callback URL
    without ever going through our /login flow.
    """
    # Build a fake-but-decodable state JWT so we get past state validation
    # (the PKCE check happens after state validation succeeds).
    from datetime import UTC, datetime, timedelta

    import jwt as pyjwt

    from app.core.config import settings

    nonce = "test-nonce"
    state = pyjwt.encode(
        {
            "nonce": nonce,
            "provider": "google",
            "exp": datetime.now(UTC) + timedelta(minutes=10),
            "type": "oidc_state",
        },
        settings.secret_key,
        algorithm=settings.algorithm,
    )
    # Note: no cookie jar carries oidc_pkce.
    # State cookie set on the client (httpx deprecated per-request cookies) and
    # removed afterwards so the shared fixture stays clean.
    oidc_enabled_client.cookies.set("oidc_state", nonce)
    try:
        response = await oidc_enabled_client.get(
            "/api/auth/oidc/google/callback",
            params={"code": "fake-code", "state": state},
            follow_redirects=False,
        )
    finally:
        oidc_enabled_client.cookies.delete("oidc_state")
    assert response.status_code == 400
    assert "PKCE" in response.json()["detail"]


async def test_pkce_can_be_disabled_for_legacy_idp(
    oidc_enabled_client: AsyncClient,
) -> None:
    """Setting oidc_pkce_required=False skips the challenge/cookie dance.

    Documented escape hatch for legacy IdPs that don't implement S256.
    """
    from app.core.config import settings

    settings.oidc_pkce_required = False
    try:
        response = await oidc_enabled_client.get(
            "/api/auth/oidc/google/login", follow_redirects=False
        )
        location = response.headers["location"]
        assert "code_challenge=" not in location
        set_cookie = response.headers.get("set-cookie", "")
        assert "oidc_pkce=" not in set_cookie
    finally:
        settings.oidc_pkce_required = True
