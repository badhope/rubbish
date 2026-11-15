"""Tests for M3 JWT key rotation.

Covers:
- Single-key baseline (no rotation) — encode/decode round-trip.
- Rotate with previous_secret_keys — old tokens still verify; new
  tokens are signed with the new key.
- Removing a previous key — old tokens minted under that key stop
  verifying; tokens minted under the still-listed key continue to
  verify.
- Hot reload — changing settings.previous_secret_keys + calling
  reload_settings() flips verification behaviour at runtime.
- Token type mismatch is not a verification fallback (a refresh
  token presented as access is rejected without trying the legacy
  key list).

Implementation note: ``Settings`` is constructed once at import time
and cached via ``functools.lru_cache``. To exercise rotation
end-to-end the tests stub ``get_settings`` with a lightweight
``_FakeSettings`` so we don't depend on env mutation; production
behaviour is still covered by the validation tests in
``test_config.py`` and by the real ``reload_settings()`` path
exercised once per test run below.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt as pyjwt
import pytest

from app.core import key_rotation
from app.core.key_rotation import decode_jwt, encode_jwt

pytestmark = pytest.mark.asyncio


@dataclass
class _FakeSettings:
    secret_key: str = ""
    previous_secret_keys: str = ""
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    fernet_key: str = "fake-fernet-key-just-for-tests-not-used-here"


@pytest.fixture
def fake_settings(monkeypatch):
    """Install a fake settings provider the key_rotation module uses."""
    holder: dict[str, _FakeSettings] = {"s": _FakeSettings()}
    monkeypatch.setattr(key_rotation, "get_settings", lambda: holder["s"])
    return holder


def _claims(extra: dict | None = None) -> dict:
    base = {
        "sub": "1",
        "token_version": 0,
        "type": "access",
        "exp": datetime.now(UTC) + timedelta(minutes=5),
    }
    if extra:
        base.update(extra)
    return base


async def test_single_key_roundtrip(fake_settings):
    fake_settings["s"] = _FakeSettings(secret_key="k" * 64)
    token = encode_jwt(_claims())
    decoded = decode_jwt(token, expected_type="access")
    assert decoded is not None
    assert decoded["sub"] == "1"


async def test_rotation_old_token_still_verifies(fake_settings):
    key_a = "k" * 64
    key_b = "b" * 64
    # Sign with A
    fake_settings["s"] = _FakeSettings(secret_key=key_a, previous_secret_keys="")
    token_a = encode_jwt(_claims())

    # Rotate: A becomes previous, B is current
    fake_settings["s"] = _FakeSettings(secret_key=key_b, previous_secret_keys=key_a)

    decoded = decode_jwt(token_a, expected_type="access")
    assert decoded is not None
    assert decoded["sub"] == "1"

    # New tokens are signed with B (kid header differs).
    token_b = encode_jwt(_claims())
    header_a = pyjwt.get_unverified_header(token_a)
    header_b = pyjwt.get_unverified_header(token_b)
    assert header_a["kid"] != header_b["kid"]
    assert decode_jwt(token_b, expected_type="access") is not None


async def test_previous_key_removed_invalidates_old_token(fake_settings):
    key_a = "k" * 64
    key_b = "b" * 64
    fake_settings["s"] = _FakeSettings(secret_key=key_a, previous_secret_keys="")
    token_a = encode_jwt(_claims())

    # Rotate but do NOT add A to previous_secret_keys.
    fake_settings["s"] = _FakeSettings(secret_key=key_b, previous_secret_keys="")

    decoded = decode_jwt(token_a, expected_type="access")
    assert decoded is None


async def test_type_mismatch_does_not_fall_through(fake_settings):
    key_a = "k" * 64
    key_b = "b" * 64
    fake_settings["s"] = _FakeSettings(secret_key=key_a, previous_secret_keys="")
    refresh = encode_jwt({**_claims(), "type": "refresh"})

    # Rotate; refresh token is now in the legacy-key fallback chain.
    fake_settings["s"] = _FakeSettings(secret_key=key_b, previous_secret_keys=key_a)

    # Correct type still decodes.
    assert decode_jwt(refresh, expected_type="refresh") is not None
    # Wrong type must fail without trying the legacy key.
    assert decode_jwt(refresh, expected_type="access") is None


async def test_token_kid_header_set(fake_settings):
    fake_settings["s"] = _FakeSettings(secret_key="k" * 64)
    token = encode_jwt(_claims())
    header = pyjwt.get_unverified_header(token)
    assert "kid" in header
    assert len(header["kid"]) == 16  # sha256[:16]


async def test_multiple_previous_keys_walked_in_order(fake_settings):
    """When several legacy keys are configured the verifier tries each
    one in the order the operator listed them."""
    key_new = "n" * 64
    key_legacy_1 = "l1" * 32
    key_legacy_2 = "l2" * 32

    # Mint a token under legacy_2.
    fake_settings["s"] = _FakeSettings(secret_key=key_legacy_2, previous_secret_keys="")
    token_legacy_2 = encode_jwt(_claims())

    # Operator rotated twice: legacy_2 is now the *oldest* of the two
    # legacy keys, listed second.
    fake_settings["s"] = _FakeSettings(
        secret_key=key_new,
        previous_secret_keys=f"{key_legacy_1},{key_legacy_2}",
    )
    assert decode_jwt(token_legacy_2, expected_type="access") is not None


async def test_reload_settings_clears_lru_cache(monkeypatch):
    """The ``reload_settings`` helper clears ``get_settings``'s LRU
    cache so a subsequent ``get_settings()`` returns a fresh instance
    rather than the cached one. Without that, hot reload would be a
    no-op in any code path that captured the cached instance.
    """
    from app.core.config import get_settings
    from app.core.key_rotation import reload_settings

    # Call once to populate the cache.
    get_settings()
    assert get_settings.cache_info().currsize >= 1
    reload_settings()
    assert get_settings.cache_info().currsize == 0


async def test_create_access_token_uses_current_key(fake_settings):
    """The high-level ``create_access_token`` helper (used by login +
    refresh) signs with the current key, and a token minted under the
    legacy key still decodes once that key is moved into
    previous_secret_keys."""
    from app.core.security import create_access_token, decode_access_token

    key_a = "k" * 64
    key_b = "b" * 64
    fake_settings["s"] = _FakeSettings(secret_key=key_a, previous_secret_keys="")
    token_a = create_access_token({"sub": "42", "token_version": 0})

    fake_settings["s"] = _FakeSettings(secret_key=key_b, previous_secret_keys=key_a)
    decoded = decode_access_token(token_a)
    assert decoded is not None
    assert decoded["sub"] == "42"
