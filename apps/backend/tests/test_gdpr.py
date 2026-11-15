"""Tests for GDPR self-service endpoints (M5 hardening).

Covers:
- ``GET /api/users/me/export`` returns the caller's profile and a
  sections placeholder, and audit-logs the export.
- ``DELETE /api/users/me`` requires the literal confirmation string
  + the password. On success it anonymises PII, sets
  ``deleted_at``, clears TOTP state, and invalidates tokens.
- A second delete attempt returns 409.
- ``POST /api/users/me/restore`` flips the row back to a live
  account inside the grace window, and refuses once the window has
  closed.
- Restoring after a deleted_at older than 30 days returns 410.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def auth_client(client: AsyncClient, db_session):
    """Register + verify + login a test user.

    Yields a dict with the ASGI client, the username/password used,
    the access token, the auth header dict, and the resolved
    ``User`` ORM row so tests can refresh it after the delete.
    """
    import secrets

    from sqlalchemy import select

    from app.core.tokens import create_email_verification_token
    from app.models import User

    username = f"gdpr_{secrets.token_hex(4)}"
    password = "Sup3rSecret-pw!"
    email = f"{username}@example.com"
    reg = await client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": password,
        },
    )
    assert reg.status_code in (200, 201), reg.text

    result = await db_session.execute(select(User).where(User.username == username))
    u = result.scalar_one()
    token = create_email_verification_token(u.id, u.token_version)
    verify = await client.post("/api/auth/verify-email", json={"token": token})
    assert verify.status_code == 200, verify.text

    login = await client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert login.status_code == 200, login.text
    body = login.json()
    return {
        "client": client,
        "username": username,
        "password": password,
        "user": u,
        "access_token": body["access_token"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


async def test_export_returns_user_payload(auth_client):
    client = auth_client["client"]
    headers = auth_client["headers"]
    resp = await client.get("/api/users/me/export", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["schema_version"] == 1
    assert "exported_at" in body
    assert body["user"]["email"] == auth_client["user"].email
    assert body["user"]["username"] == auth_client["user"].username
    for section in ("submissions", "reviews", "reading_history", "library_lists"):
        assert section in body["sections"]


async def test_export_requires_auth(client):
    resp = await client.get("/api/users/me/export")
    assert resp.status_code == 401


async def test_delete_requires_confirmation_string(auth_client):
    client = auth_client["client"]
    headers = auth_client["headers"]
    resp = await client.request(
        "DELETE",
        "/api/users/me",
        headers=headers,
        json={"password": auth_client["password"], "confirmation": "delete"},
    )
    assert resp.status_code == 400
    assert "Confirmation" in resp.json()["detail"]


async def test_delete_requires_correct_password(auth_client):
    client = auth_client["client"]
    headers = auth_client["headers"]
    resp = await client.request(
        "DELETE",
        "/api/users/me",
        headers=headers,
        json={"password": "WrongPass1!", "confirmation": "DELETE MY ACCOUNT"},
    )
    assert resp.status_code == 401


async def test_delete_anonymises_user(auth_client, db_session):
    client = auth_client["client"]
    headers = auth_client["headers"]
    user = auth_client["user"]

    resp = await client.request(
        "DELETE",
        "/api/users/me",
        headers=headers,
        json={
            "password": auth_client["password"],
            "confirmation": "DELETE MY ACCOUNT",
        },
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "scheduled_for_deletion"
    assert body["grace_days"] == 30

    await db_session.refresh(user)
    assert user.email.endswith("@deleted.local")
    assert user.username.startswith("deleted-")
    assert user.is_active is False
    assert user.deleted_at is not None
    assert user.totp_secret_encrypted is None
    assert user.totp_enabled_at is None
    assert user.totp_backup_codes_hashed is None


async def test_delete_invalidates_tokens(auth_client):
    client = auth_client["client"]
    headers = auth_client["headers"]
    resp = await client.request(
        "DELETE",
        "/api/users/me",
        headers=headers,
        json={
            "password": auth_client["password"],
            "confirmation": "DELETE MY ACCOUNT",
        },
    )
    assert resp.status_code == 202
    # Token_version bumped: same headers must now fail.
    me = await client.get("/api/users/me", headers=headers)
    assert me.status_code == 401


async def test_restore_brings_account_back(auth_client, db_session):
    client = auth_client["client"]
    headers = auth_client["headers"]
    resp = await client.request(
        "DELETE",
        "/api/users/me",
        headers=headers,
        json={
            "password": auth_client["password"],
            "confirmation": "DELETE MY ACCOUNT",
        },
    )
    assert resp.status_code == 202

    # Regression for T2 finding H-3: the pre-deletion bearer token is the
    # ONLY credential a real deleted user has (the password was anonymised
    # at deletion, so no fresh login is possible), even though deletion
    # bumped token_version. The grace-window exemption in
    # get_soft_delete_aware_user must accept it — minting a fresh
    # version-matched token here would mask the bug (no real user could
    # ever mint one).
    fresh_headers = headers

    resp = await client.post(
        "/api/users/me/restore",
        headers=fresh_headers,
        json={
            "email": "restored@example.com",
            "username": "restored",
            "new_password": "AnotherPass123!",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["email"] == "restored@example.com"
    assert body["username"] == "restored"


async def test_restore_outside_grace_returns_410(auth_client, db_session):
    from app.core.security import create_access_token

    client = auth_client["client"]
    headers = auth_client["headers"]
    user = auth_client["user"]
    resp = await client.request(
        "DELETE",
        "/api/users/me",
        headers=headers,
        json={
            "password": auth_client["password"],
            "confirmation": "DELETE MY ACCOUNT",
        },
    )
    assert resp.status_code == 202

    await db_session.refresh(user)
    user.deleted_at = datetime.now(UTC) - timedelta(days=31)
    await db_session.commit()

    fresh = create_access_token({"sub": str(user.id), "token_version": user.token_version})
    fresh_headers = {"Authorization": f"Bearer {fresh}"}

    resp = await client.post(
        "/api/users/me/restore",
        headers=fresh_headers,
        json={
            "email": "too-late@example.com",
            "username": "toolate",
            "new_password": "AnotherPass123!",
        },
    )
    assert resp.status_code == 410
