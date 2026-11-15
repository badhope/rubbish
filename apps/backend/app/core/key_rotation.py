"""JWT signing key rotation with hot reload.

The M3 hardening milestone implements OAuth-style "kid" rotation:

- ``settings.secret_key`` is the **current** signing key (new tokens).
- ``settings.previous_secret_keys`` is an ordered list of **previous**
  keys (newest first) that are still trusted for **verification only**.
  Tokens minted before the rotation are still accepted until they
  expire or until the operator removes them from this list.
- During rotation the operator sets ``RUBBISH_SECRET_KEY`` to the
  new value and ``RUBBISH_PREVIOUS_SECRET_KEYS`` to the comma-
  separated list of old keys (newest first). New tokens use the new
  key; old tokens verify against the legacy list until they expire.
- Once all pre-rotation tokens have aged out, the operator clears
  ``previous_secret_keys`` and the list drops back to empty.

Hot reload: ``reload_settings()`` clears the ``get_settings`` LRU
cache so the next call returns a fresh ``Settings`` instance. The
runtime calls ``reload_settings()`` at startup and on a SIGHUP-equivalent
admin endpoint (``POST /api/admin/security/reload``). Note that rotating
the signing key without restarting is a deliberate trade-off: it lets
operators respond to a suspected key compromise without downtime,
but it relies on ``Settings`` being re-read on every hot path. The
``_active_secret_keys()`` helper below re-reads settings every call,
so it always sees the latest values; nothing in the request path
caches the key list.

Defence in depth: hot reload is gated to admin callers, and the
admin endpoint itself does not require the legacy key. If the
operator loses ALL keys, the only recovery is a process restart
with the new env vars, which is intentional.
"""

from __future__ import annotations

import threading
from typing import Any

import jwt
from jwt import PyJWTError

from app.core.config import get_settings

# Lock that serializes hot reloads so a SIGHUP and a request can't
# both observe the LRU cache clear at the same instant.
_reload_lock = threading.Lock()


def reload_settings() -> None:
    """Clear the cached Settings so the next ``get_settings()`` re-reads env.

    Safe to call from any thread. Idempotent. Use after editing
    ``RUBBISH_SECRET_KEY`` / ``RUBBISH_PREVIOUS_SECRET_KEYS`` /
    ``RUBBISH_FERNET_KEYS`` while the process is running.
    """
    with _reload_lock:
        get_settings.cache_clear()


def _parse_keys(raw: str) -> list[str]:
    """Split a comma-separated key string, dropping blanks.

    We treat each entry as opaque (any string) — JWT's HMAC algorithm
    accepts any non-empty bytes. Real keys are typically ``openssl
    rand -hex 32`` output, but length / format checks live in the
    Settings validator so a deployment cannot start with a weak key.
    """
    if not raw:
        return []
    out: list[str] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if chunk:
            out.append(chunk)
    return out


def _active_secret_keys() -> list[str]:
    """Return ``[current, *previous]`` for *verification* order.

    Verification tries the current key first, then each previous key
    in the order the operator specified (typically newest-first so
    that the most-recently-rotated-out key is checked first).
    """
    s = get_settings()
    return [s.secret_key, *_parse_keys(s.previous_secret_keys)]


def _signing_key() -> str:
    """Return the *current* key used to sign new tokens."""
    return get_settings().secret_key


def _build_decode_kwargs() -> dict[str, object]:
    """Common decode kwargs.

    We pass ``algorithms=[...]`` so a token claiming ``none`` or a
    different algorithm is rejected even if the legacy keys happen
    to verify the signature. We do NOT pass ``key=...`` here because
    PyJWT does not natively accept multiple verification keys; the
    loop below handles the fallback chain.
    """
    return {"algorithms": [get_settings().algorithm]}


def _kid_for_key(key: str) -> str:
    """Opaque, deterministic key id: SHA-256 prefix of the key."""
    import hashlib

    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def encode_jwt(claims: dict[str, object]) -> str:
    """Encode ``claims`` with the **current** signing key + algorithm.

    Adds a ``kid`` (key id) header so a downstream verifier can pick
    the right legacy key without having to try every one. The kid
    is the SHA-256 prefix of the current key; it is opaque but
    deterministic across processes (good enough for our purposes —
    a full JWKS endpoint is out of scope for M3).
    """
    key = _signing_key()
    headers: dict[str, str] = {}
    if key:
        headers["kid"] = _kid_for_key(key)
    return jwt.encode(claims, key, algorithm=get_settings().algorithm, headers=headers or None)


def _kid_to_key() -> dict[str, str]:
    """Map of ``kid`` → signing key for every active (current + previous) key."""
    out: dict[str, str] = {}
    for key in _active_secret_keys():
        if key:
            out[_kid_for_key(key)] = key
    return out


def decode_jwt(token: str, expected_type: str | None = None) -> dict[str, object] | None:
    """Decode + verify a JWT, trying the current key then every previous one.

    Returns the decoded claims dict, or ``None`` on any failure
    (signature mismatch on every key, expired, malformed, wrong
    ``type``). On success the returned dict contains all standard
    claims (``sub``, ``exp``, ``type``, ``token_version``, ``rtv``)
    plus any custom fields the issuer added.

    Key selection uses the ``kid`` header when present: the pinned key
    is tried first (fast path during steady-state rotation), then the
    full rotation chain is walked as a fallback so tokens minted before
    a rotation — or tokens whose ``kid`` we don't recognise — still
    verify (zero-downtime rotation).

    Why a loop instead of relying on a single ``key=`` parameter:
    PyJWT does not support a list of acceptable keys directly, so we
    walk the rotation chain ourselves. This is the same trick
    libraries like ``authlib`` use internally for their ``keys=``
    parameter.
    """
    kwargs: dict[str, Any] = _build_decode_kwargs()

    # Build the candidate key order: kid-pinned key first, then the rest.
    kid_map = _kid_to_key()
    ordered_keys: list[str] = []
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
    except PyJWTError:
        kid = None
    if kid is not None and kid in kid_map:
        ordered_keys.append(kid_map[kid])
    for key in _active_secret_keys():
        if key and key not in ordered_keys:
            ordered_keys.append(key)

    for key in ordered_keys:
        try:
            decoded = jwt.decode(token, key, **kwargs)
        except PyJWTError:
            continue
        if expected_type is not None and decoded.get("type") != expected_type:
            # Right key, wrong token type — don't fall through to older
            # keys; an attacker shouldn't be able to "try" type guesses.
            return None
        return decoded
    return None


__all__ = [
    "decode_jwt",
    "encode_jwt",
    "reload_settings",
]
