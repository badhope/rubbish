"""API-level tests for passkey registration re-authentication (P1 #8).

Adding a passkey is a sensitive credential change, so ``register/complete``
must require the account password and — when 2FA is enabled — a fresh
second factor. A hijacked session alone cannot enroll a new passkey.

The attestation verification itself is stubbed here; the real helper
state machine (challenge one-shot, sign_count, credential append) is
covered by ``test_webauthn.py``.
"""

from __future__ import annotations

from typing import Any

import pyotp
import pytest
from conftest import auth_headers
from httpx import AsyncClient

from app.api import webauthn as wa_api


def _stub_verify(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace attestation verification with a deterministic success."""
    monkeypatch.setattr(
        wa_api,
        "verify_registration_response",
        lambda user, cred, credential_name="Passkey": {
            "id": cred.get("id", "cred-1"),
            "name": credential_name,
            "created_at": "2026-11-16T00:00:00Z",
            "transports": ["internal"],
        },
    )


def _credential_body() -> dict[str, Any]:
    return {
        "id": "cred-1",
        "rawId": "cred-1",
        "type": "public-key",
        "response": {"clientDataJSON": "stub"},
    }


async def _enable_2fa(client: AsyncClient, user: dict) -> tuple[str, list[str]]:
    resp = await client.post("/api/auth/2fa/setup", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    secret = body["secret"]
    codes = body["backup_codes"]
    verify = await client.post(
        "/api/auth/2fa/verify-setup",
        json={"code": pyotp.TOTP(secret).now()},
        headers=auth_headers(user),
    )
    assert verify.status_code == 200, verify.text
    return secret, codes


async def test_register_complete_missing_password_422(
    client: AsyncClient, test_user: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """缺密码 → 422：注册 passkey 现在强制重认证。"""
    _stub_verify(monkeypatch)
    resp = await client.post(
        "/api/auth/webauthn/register/complete",
        json={"credential": _credential_body(), "name": "YubiKey"},
        headers=auth_headers(test_user),
    )
    assert resp.status_code == 422


async def test_register_complete_wrong_password_401(
    client: AsyncClient, test_user: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_verify(monkeypatch)
    resp = await client.post(
        "/api/auth/webauthn/register/complete",
        json={"credential": _credential_body(), "password": "wrong-password"},
        headers=auth_headers(test_user),
    )
    assert resp.status_code == 401


async def test_register_complete_correct_password_201(
    client: AsyncClient, test_user: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """无 2FA 时密码正确即可注册。"""
    _stub_verify(monkeypatch)
    resp = await client.post(
        "/api/auth/webauthn/register/complete",
        json={"credential": _credential_body(), "password": test_user["password"]},
        headers=auth_headers(test_user),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["name"] == "Passkey"


async def test_register_complete_2fa_requires_factor(
    client: AsyncClient, test_user: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """启用 2FA 后，仅密码不够：必须再带一个 TOTP 或备份码。"""
    _stub_verify(monkeypatch)
    _, codes = await _enable_2fa(client, test_user)

    # 密码正确但缺第二因子 → 400
    no_factor = await client.post(
        "/api/auth/webauthn/register/complete",
        json={"credential": _credential_body(), "password": test_user["password"]},
        headers=auth_headers(test_user),
    )
    assert no_factor.status_code == 400

    # 密码正确 + 有效备份码 → 201
    ok = await client.post(
        "/api/auth/webauthn/register/complete",
        json={
            "credential": _credential_body(),
            "password": test_user["password"],
            "backup_code": codes[0],
        },
        headers=auth_headers(test_user),
    )
    assert ok.status_code == 201, ok.text


async def test_register_complete_2fa_wrong_factor_401(
    client: AsyncClient, test_user: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """第二因子错误 → 401，passkey 不落库。"""
    _stub_verify(monkeypatch)
    await _enable_2fa(client, test_user)
    resp = await client.post(
        "/api/auth/webauthn/register/complete",
        json={
            "credential": _credential_body(),
            "password": test_user["password"],
            "backup_code": "bad-code",
        },
        headers=auth_headers(test_user),
    )
    assert resp.status_code == 401
