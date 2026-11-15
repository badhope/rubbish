"""Email verification + password reset flow tests.

Both flows use signed JWT tokens (stateless, no DB rows). The user's
``token_version`` is the invalidation hook — bumping it on password
reset/logout invalidates outstanding verification + reset tokens
without a denylist.

The ``fake_email_sender`` fixture replaces the production sender so we
can extract the token from the captured email body.
"""

from __future__ import annotations

import re

from conftest import auth_headers
from httpx import AsyncClient

# Extracts the token query param from a deep-link URL.
_TOKEN_RE = re.compile(r"token=([\w\-.]+)")


def _extract_token(email_body: str) -> str:
    match = _TOKEN_RE.search(email_body)
    assert match, f"no token found in body: {email_body!r}"
    return match.group(1)


async def test_register_sends_verification_email(client: AsyncClient, fake_email_sender) -> None:
    response = await client.post(
        "/api/auth/register",
        json={
            "email": "verify@example.com",
            "username": "verify_user",
            "password": "password123",
        },
    )
    assert response.status_code == 201
    assert len(fake_email_sender.outbox) == 1
    mail = fake_email_sender.last()
    assert mail["to"] == "verify@example.com"
    assert "验证" in mail["subject"] and "Rubbish" in mail["subject"]
    # The deep-link must contain a non-empty token.
    assert _extract_token(mail["body"])


async def test_verify_email_succeeds(client: AsyncClient, fake_email_sender) -> None:
    await client.post(
        "/api/auth/register",
        json={
            "email": "verify2@example.com",
            "username": "verify2_user",
            "password": "password123",
        },
    )
    token = _extract_token(fake_email_sender.last()["body"])

    verify = await client.post("/api/auth/verify-email", json={"token": token})
    assert verify.status_code == 200
    assert verify.json()["message"] == "Email verified"

    # Verify /me reports is_email_verified=True.
    me = await client.post(
        "/api/auth/login",
        json={"username": "verify2_user", "password": "password123"},
    )
    me_token = me.json()["access_token"]
    me_resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {me_token}"})
    assert me_resp.json()["is_email_verified"] is True


async def test_verify_email_already_verified(client: AsyncClient, fake_email_sender) -> None:
    await client.post(
        "/api/auth/register",
        json={
            "email": "verify3@example.com",
            "username": "verify3_user",
            "password": "password123",
        },
    )
    token = _extract_token(fake_email_sender.last()["body"])

    first = await client.post("/api/auth/verify-email", json={"token": token})
    assert first.status_code == 200
    second = await client.post("/api/auth/verify-email", json={"token": token})
    assert second.status_code == 200
    assert second.json()["message"] == "Email already verified"


async def test_verify_email_invalid_token(client: AsyncClient, fake_email_sender) -> None:
    response = await client.post("/api/auth/verify-email", json={"token": "not-a-real-token"})
    assert response.status_code == 400


async def test_resend_verification(client: AsyncClient, fake_email_sender) -> None:
    await client.post(
        "/api/auth/register",
        json={
            "email": "resend@example.com",
            "username": "resend_user",
            "password": "password123",
        },
    )
    fake_email_sender.reset()
    response = await client.post(
        "/api/auth/resend-verification",
        json={"email": "resend@example.com"},
    )
    assert response.status_code == 200
    assert len(fake_email_sender.outbox) == 1


async def test_resend_verification_unknown_email_no_leak(
    client: AsyncClient, fake_email_sender
) -> None:
    """Unknown email must NOT leak account existence."""
    response = await client.post(
        "/api/auth/resend-verification",
        json={"email": "nonexistent@example.com"},
    )
    # Same response as a known account — no email sent, no leak.
    assert response.status_code == 200
    assert response.json()["message"] == ("If the account exists, a verification email was sent")
    assert len(fake_email_sender.outbox) == 0


async def test_forgot_password_sends_reset_email(
    client: AsyncClient, test_user: dict, fake_email_sender
) -> None:
    response = await client.post(
        "/api/auth/forgot-password",
        json={"email": test_user["email"]},
    )
    assert response.status_code == 200
    assert len(fake_email_sender.outbox) == 1
    mail = fake_email_sender.last()
    assert "重置" in mail["subject"] and "Rubbish" in mail["subject"]
    assert _extract_token(mail["body"])


async def test_forgot_password_unknown_email_no_leak(
    client: AsyncClient, fake_email_sender
) -> None:
    response = await client.post(
        "/api/auth/forgot-password",
        json={"email": "nobody@example.com"},
    )
    assert response.status_code == 200
    assert response.json()["message"] == ("If the account exists, a reset email was sent")
    assert len(fake_email_sender.outbox) == 0


async def test_reset_password_succeeds(
    client: AsyncClient, test_user: dict, fake_email_sender
) -> None:
    await client.post(
        "/api/auth/forgot-password",
        json={"email": test_user["email"]},
    )
    token = _extract_token(fake_email_sender.last()["body"])

    reset = await client.post(
        "/api/auth/reset-password",
        json={"token": token, "new_password": "newpassword456"},
    )
    assert reset.status_code == 200
    assert reset.json()["message"] == "Password reset successful"

    # Old access token must be invalid (token_version was bumped).
    old_me = await client.get("/api/auth/me", headers=auth_headers(test_user))
    assert old_me.status_code == 401

    # Login with the new password succeeds.
    login = await client.post(
        "/api/auth/login",
        json={"username": test_user["username"], "password": "newpassword456"},
    )
    assert login.status_code == 200


async def test_reset_password_invalid_token(client: AsyncClient) -> None:
    response = await client.post(
        "/api/auth/reset-password",
        json={"token": "garbage", "new_password": "newpassword456"},
    )
    assert response.status_code == 400


async def test_reset_password_too_short(
    client: AsyncClient, test_user: dict, fake_email_sender
) -> None:
    await client.post(
        "/api/auth/forgot-password",
        json={"email": test_user["email"]},
    )
    token = _extract_token(fake_email_sender.last()["body"])

    response = await client.post(
        "/api/auth/reset-password",
        json={"token": token, "new_password": "short"},
    )
    assert response.status_code == 422  # min_length=8 enforced by schema


async def test_reset_token_invalid_after_logout(
    client: AsyncClient, test_user: dict, fake_email_sender
) -> None:
    """Logout bumps token_version → outstanding reset token must fail."""
    await client.post(
        "/api/auth/forgot-password",
        json={"email": test_user["email"]},
    )
    token = _extract_token(fake_email_sender.last()["body"])

    logout = await client.post("/api/auth/logout", headers=auth_headers(test_user))
    assert logout.status_code == 204

    reset = await client.post(
        "/api/auth/reset-password",
        json={"token": token, "new_password": "newpassword456"},
    )
    assert reset.status_code == 400


async def test_verify_token_invalid_after_password_reset(
    client: AsyncClient, test_user: dict, fake_email_sender
) -> None:
    """Password reset bumps token_version → outstanding verify token fails."""
    # Trigger both a verification email (via register) and a reset email
    # (via forgot-password). register already ran in the test_user fixture,
    # so we use resend-verification to get a fresh verify token.
    await client.post(
        "/api/auth/resend-verification",
        json={"email": test_user["email"]},
    )
    verify_token = _extract_token(fake_email_sender.last()["body"])

    await client.post(
        "/api/auth/forgot-password",
        json={"email": test_user["email"]},
    )
    reset_token = _extract_token(fake_email_sender.last()["body"])

    # Do the reset — bumps token_version.
    reset = await client.post(
        "/api/auth/reset-password",
        json={"token": reset_token, "new_password": "newpassword456"},
    )
    assert reset.status_code == 200

    # The verify token was issued BEFORE the reset; it must now be invalid.
    verify = await client.post("/api/auth/verify-email", json={"token": verify_token})
    assert verify.status_code == 400
    assert verify.json()["detail"] == "Verification token is no longer valid"
