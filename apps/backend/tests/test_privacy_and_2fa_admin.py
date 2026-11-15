"""P1-A privacy-policy + admin-2FA-required middleware tests."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

from app.core.config import settings


@pytest.mark.asyncio
async def test_privacy_endpoint_returns_html(
    client: AsyncClient,
) -> None:
    r = await client.get("/privacy")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    body = r.text
    # The policy text is the contract; spot-check the load-bearing claims.
    assert "隐私政策" in body
    assert "365" in body  # audit log retention
    assert "30" in body  # grace window
    assert "/api/users/me/export" in body
    # Rendered as a document, not a raw dump of markdown markers.
    assert "<h2>" in body
    assert "## " not in body


@pytest.mark.asyncio
async def test_privacy_endpoint_does_not_require_auth(
    client: AsyncClient,
) -> None:
    """The privacy page must be reachable without a token."""
    r = await client.get("/privacy")
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# require_2fa_for_admin middleware
# ---------------------------------------------------------------------------


def _enable_2fa_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "require_2fa_for_admin", True)


@pytest.mark.asyncio
async def test_admin_2fa_default_off_allows_access(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    """Baseline: with the policy off, an admin without TOTP can hit /admin."""
    assert settings.require_2fa_for_admin is False
    token = admin_user["token"]
    r = await client.get("/api/admin/security/status", headers={"Authorization": f"Bearer {token}"})
    # 200 or 404 is acceptable depending on what /admin/security/status does
    # without 2FA enforced; the point is "not 403 from this middleware".
    assert r.status_code != 403 or "two-factor" not in r.text.lower()


@pytest.mark.asyncio
async def test_admin_without_totp_is_blocked_when_policy_on(
    client: AsyncClient,
    admin_user: dict[str, Any],
    db_session: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_2fa_admin(monkeypatch)
    token = admin_user["token"]
    r = await client.get("/api/admin/security/status", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert "two-factor" in r.text.lower()


@pytest.mark.asyncio
async def test_admin_with_totp_can_access_when_policy_on(
    client: AsyncClient,
    admin_user: dict[str, Any],
    db_session: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Set totp_enabled_at on the admin row; the middleware should let them in."""
    _enable_2fa_admin(monkeypatch)
    from datetime import UTC, datetime

    from sqlalchemy import select

    from app.models import User

    result = await db_session.execute(select(User).where(User.id == admin_user["user_id"]))
    user = result.scalar_one()
    user.totp_enabled_at = datetime.now(UTC)
    await db_session.commit()
    token = admin_user["token"]
    r = await client.get("/api/admin/security/status", headers={"Authorization": f"Bearer {token}"})
    # /admin/security/status may legitimately 200; the point is the
    # 2FA middleware did NOT reject them.
    assert r.status_code != 403 or "two-factor" not in r.text.lower()


@pytest.mark.asyncio
async def test_admin_2fa_exempts_reload_secret_keys(
    client: AsyncClient,
    admin_user: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Reload-security-settings IS protected by 2FA (it rotates signing keys)."""
    _enable_2fa_admin(monkeypatch)
    token = admin_user["token"]
    r = await client.post(
        "/api/admin/security/reload",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403
    assert "two-factor" in r.text.lower()
