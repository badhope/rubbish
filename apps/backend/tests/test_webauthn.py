"""Tests for the WebAuthn / Passkeys helpers (``app.core.webauthn``).

The ``webauthn`` library is used for real where it is pure
(``generate_*_options``) and stubbed where it needs a genuine
authenticator (``verify_*_response``) — fabricating a valid attestation
or assertion signature in a unit test is not worth the complexity.

What we actually assert is the state machine around it:
challenge issuance is one-shot and TTL-bound, credentials are appended
once, sign_count advances, and every failure mode surfaces as
``ValueError`` (never an unhandled library exception).
"""

from __future__ import annotations

import base64
import json
import time
from types import SimpleNamespace
from typing import Any

import pytest
import webauthn
from webauthn.helpers.exceptions import (
    InvalidAuthenticationResponse,
    InvalidRegistrationResponse,
)

from app.core import webauthn as wa

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _user(**kwargs: Any) -> SimpleNamespace:
    defaults: dict[str, Any] = {
        "id": 1,
        "username": "alice",
        "webauthn_credentials": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _credential(
    challenge: bytes, raw_id: str = "cred-abc", **response_extra: Any
) -> dict[str, Any]:
    """Build a credential dict carrying ``challenge`` inside clientDataJSON."""
    client_data = {"type": "webauthn.create", "challenge": _b64url(challenge)}
    client_data_json = _b64url(json.dumps(client_data).encode("utf-8"))
    response: dict[str, Any] = {"clientDataJSON": client_data_json}
    response.update(response_extra)
    return {"id": raw_id, "rawId": raw_id, "response": response}


@pytest.fixture(autouse=True)
def _clean_challenge_store() -> None:
    wa._challenge_store.clear()


# ---------------------------------------------------------------------------
# byte helpers
# ---------------------------------------------------------------------------


def test_b64url_roundtrip() -> None:
    raw = b"\x00\x01\x02not-padded-\xff"
    assert wa._b64url_decode(wa._b64url_encode(raw)) == raw


def test_extract_challenge_bytes_decodes_client_data_json() -> None:
    challenge = b"0123456789abcdef"
    assert wa._extract_challenge_bytes(_credential(challenge)) == challenge


def test_extract_challenge_bytes_rejects_missing_client_data_json() -> None:
    with pytest.raises(ValueError, match="Missing clientDataJSON"):
        wa._extract_challenge_bytes({"response": {}})


def test_extract_challenge_bytes_rejects_missing_challenge() -> None:
    client_data_json = _b64url(json.dumps({"type": "webauthn.create"}).encode())
    with pytest.raises(ValueError, match="Missing challenge"):
        wa._extract_challenge_bytes({"response": {"clientDataJSON": client_data_json}})


# ---------------------------------------------------------------------------
# challenge store
# ---------------------------------------------------------------------------


def test_challenge_is_one_shot() -> None:
    challenge = b"one-shot-challenge"

    wa._store_challenge(challenge)

    assert wa._consume_challenge(challenge) is True
    # 二次使用必须失败，否则重放攻击成立
    assert wa._consume_challenge(challenge) is False


def test_consume_unknown_challenge_is_false() -> None:
    assert wa._consume_challenge(b"never-issued") is False


def test_expired_challenge_is_rejected() -> None:
    challenge = b"expiring"
    wa._store_challenge(challenge)
    # 必须与 _store_challenge 内部的 key 格式一致（带填充的 base64url）
    key = base64.urlsafe_b64encode(challenge).decode("ascii")
    wa._challenge_store[key] = time.monotonic() - 1

    assert wa._consume_challenge(challenge) is False


def test_expired_entries_are_swept_every_fiftieth_store() -> None:
    stale = b"stale-challenge"
    wa._store_challenge(stale)
    wa._challenge_store[base64.urlsafe_b64encode(stale).decode("ascii")] = time.monotonic() - 1

    # 存满 50 条触发一次惰性清理
    for i in range(49):
        wa._store_challenge(f"filler-{i}".encode())

    assert _b64url(stale) not in wa._challenge_store


# ---------------------------------------------------------------------------
# credential helpers
# ---------------------------------------------------------------------------


def test_find_credential_returns_entry_and_index() -> None:
    user = _user(webauthn_credentials=[{"id": "aa"}, {"id": "bb"}])

    assert wa._find_credential(user, "bb") == ({"id": "bb"}, 1)
    assert wa._find_credential(user, "zz") == (None, -1)


def test_get_credentials_never_returns_none() -> None:
    assert wa._get_credentials(_user()) == []


# ---------------------------------------------------------------------------
# registration
# ---------------------------------------------------------------------------


def test_generate_registration_options_returns_browser_payload() -> None:
    user = _user()

    options = wa.generate_registration_options(user)

    assert options["rp"]["id"]
    assert options["user"]["name"] == "alice"
    assert options["pubKeyCredParams"]
    assert options["authenticatorSelection"]["residentKey"] == "preferred"
    # 挑战必须入库，否则后续 verify 一定失败
    assert wa._consume_challenge(wa._b64url_decode(options["challenge"])) is True


def test_generate_registration_options_excludes_existing_credentials() -> None:
    cred_id = _b64url(b"already-registered")
    user = _user(webauthn_credentials=[{"id": cred_id, "transports": ["usb"]}])

    options = wa.generate_registration_options(user)

    assert options["excludeCredentials"] == [{"type": "public-key", "id": cred_id}]


def test_verify_registration_response_appends_credential(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user()
    options = wa.generate_registration_options(user)
    challenge = wa._b64url_decode(options["challenge"])

    monkeypatch.setattr(
        wa.webauthn,
        "verify_registration_response",
        lambda **_kw: SimpleNamespace(
            credential_id=b"new-cred-id",
            credential_public_key=b"new-public-key",
            sign_count=7,
        ),
    )

    stored = wa.verify_registration_response(
        user,
        _credential(challenge, transports=["usb", "nfc"]),
        credential_name="YubiKey 5C",
    )

    assert stored["id"] == _b64url(b"new-cred-id")
    assert stored["public_key"] == _b64url(b"new-public-key")
    assert stored["sign_count"] == 7
    assert stored["name"] == "YubiKey 5C"
    assert stored["transports"] == ["usb", "nfc"]
    assert stored["created_at"]
    # 必须真正写回用户对象，否则等于没注册
    assert user.webauthn_credentials == [stored]


def test_verify_registration_rejects_unknown_challenge() -> None:
    user = _user()

    with pytest.raises(ValueError, match="Challenge verification failed"):
        wa.verify_registration_response(user, _credential(b"not-issued-by-us"))


def test_verify_registration_wraps_library_error(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user()
    options = wa.generate_registration_options(user)
    challenge = wa._b64url_decode(options["challenge"])

    def boom(**_kw: Any) -> Any:
        raise InvalidRegistrationResponse("bad attestation")

    monkeypatch.setattr(wa.webauthn, "verify_registration_response", boom)

    with pytest.raises(ValueError, match="Registration verification failed"):
        wa.verify_registration_response(user, _credential(challenge))


# ---------------------------------------------------------------------------
# authentication
# ---------------------------------------------------------------------------


def test_generate_authentication_options_requires_registered_passkey() -> None:
    with pytest.raises(ValueError, match="no registered passkeys"):
        wa.generate_authentication_options(_user())


def test_generate_authentication_options_returns_allow_list() -> None:
    cred_id = _b64url(b"registered-cred")
    user = _user(
        webauthn_credentials=[
            {
                "id": cred_id,
                "public_key": _b64url(b"pk"),
                "sign_count": 0,
                "transports": ["internal"],
            }
        ]
    )

    options = wa.generate_authentication_options(user)

    assert options["allowCredentials"] == [
        {"type": "public-key", "id": cred_id, "transports": ["internal"]}
    ]
    assert options["userVerification"] == "preferred"
    assert wa._consume_challenge(wa._b64url_decode(options["challenge"])) is True


def test_verify_authentication_requires_credential_id() -> None:
    with pytest.raises(ValueError, match="Missing credential ID"):
        wa.verify_authentication_response(_user(), {"response": {}})


def test_verify_authentication_rejects_unknown_credential() -> None:
    user = _user(
        webauthn_credentials=[
            {"id": _b64url(b"registered-cred"), "public_key": _b64url(b"pk"), "sign_count": 0}
        ]
    )

    with pytest.raises(ValueError, match="Unknown credential"):
        wa.verify_authentication_response(user, _credential(b"whatever", raw_id="unknown"))


def test_verify_authentication_rejects_unknown_challenge() -> None:
    cred_id = _b64url(b"registered-cred")
    user = _user(
        webauthn_credentials=[{"id": cred_id, "public_key": _b64url(b"pk"), "sign_count": 0}]
    )

    with pytest.raises(ValueError, match="Challenge verification failed"):
        wa.verify_authentication_response(user, _credential(b"not-issued", raw_id=cred_id))


def test_verify_authentication_wraps_library_error(monkeypatch: pytest.MonkeyPatch) -> None:
    cred_id = _b64url(b"registered-cred")
    user = _user(
        webauthn_credentials=[{"id": cred_id, "public_key": _b64url(b"pk"), "sign_count": 0}]
    )
    options = wa.generate_authentication_options(user)
    challenge = wa._b64url_decode(options["challenge"])

    def boom(**_kw: Any) -> Any:
        raise InvalidAuthenticationResponse("bad signature")

    monkeypatch.setattr(wa.webauthn, "verify_authentication_response", boom)

    with pytest.raises(ValueError, match="Authentication verification failed"):
        wa.verify_authentication_response(user, _credential(challenge, raw_id=cred_id))


def test_verify_authentication_bumps_sign_count(monkeypatch: pytest.MonkeyPatch) -> None:
    cred_id = _b64url(b"registered-cred")
    user = _user(
        webauthn_credentials=[{"id": cred_id, "public_key": _b64url(b"pk"), "sign_count": 3}]
    )
    options = wa.generate_authentication_options(user)
    challenge = wa._b64url_decode(options["challenge"])

    monkeypatch.setattr(
        wa.webauthn,
        "verify_authentication_response",
        lambda **_kw: SimpleNamespace(new_sign_count=42),
    )

    returned = wa.verify_authentication_response(user, _credential(challenge, raw_id=cred_id))

    assert returned["sign_count"] == 42
    assert user.webauthn_credentials[0]["sign_count"] == 42


def test_real_library_is_importable() -> None:
    """Sanity: the pinned webauthn version still exposes the API we依赖."""
    assert hasattr(webauthn, "generate_registration_options")
    assert hasattr(webauthn, "generate_authentication_options")
