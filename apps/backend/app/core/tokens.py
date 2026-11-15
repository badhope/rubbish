"""Stateless tokens for email verification and password reset.

Both flows use signed JWT tokens carrying the user id and a fresh
purpose-specific nonce (``jti``) plus the user's current
``token_version``. The version check ties the token to the account
state at issue time — bumping ``token_version`` (password change,
logout, admin disable) invalidates outstanding verification/reset
tokens without a denylist.

Why stateless instead of DB rows:
- One less table and one less query per verification.
- Tokens auto-expire; nothing to clean up.
- The ``token_version`` check is the same mechanism used for JWT auth.

Why not reuse ``app.core.security.create_access_token``: those tokens
carry ``type: access`` and a short TTL. Verification/reset tokens need
their own ``type`` so they cannot be confused with access tokens, and
a longer TTL (verification: 24h, reset: 1h).
"""

from __future__ import annotations

from typing import Any, Literal

import jwt
from jwt import PyJWTError

from app.core.config import get_settings

VERIFY_EMAIL_TOKEN_TYPE: Literal["verify_email"] = "verify_email"
RESET_PASSWORD_TOKEN_TYPE: Literal["reset_password"] = "reset_password"


def _create_token(
    *,
    user_id: int,
    token_version: int,
    token_type: Literal["verify_email", "reset_password"],
    expires_in_seconds: int,
) -> str:
    from datetime import UTC, datetime, timedelta

    payload: dict[str, Any] = {
        "sub": str(user_id),
        "token_version": token_version,
        "type": token_type,
        "exp": datetime.now(UTC) + timedelta(seconds=expires_in_seconds),
        "jti": _random_jti(),
    }
    return jwt.encode(payload, get_settings().secret_key, algorithm=get_settings().algorithm)


def random_jti() -> str:
    """Short random token id for disambiguating tokens for the same user.

    Used by the token denylist to target individual tokens without
    revoking all sessions. 16 url-safe bytes = 128 bits of entropy.
    """
    import secrets

    return secrets.token_urlsafe(16)


def _random_jti() -> str:
    """Backward-compatible alias for ``random_jti``."""
    return random_jti()


def create_email_verification_token(user_id: int, token_version: int) -> str:
    return _create_token(
        user_id=user_id,
        token_version=token_version,
        token_type=VERIFY_EMAIL_TOKEN_TYPE,
        expires_in_seconds=get_settings().email_verification_expire_hours * 3600,
    )


def create_password_reset_token(user_id: int, token_version: int) -> str:
    return _create_token(
        user_id=user_id,
        token_version=token_version,
        token_type=RESET_PASSWORD_TOKEN_TYPE,
        expires_in_seconds=get_settings().password_reset_expire_minutes * 60,
    )


def decode_token(
    token: str, expected_type: Literal["verify_email", "reset_password"]
) -> dict[str, Any] | None:
    """Decode + type-check a verification/reset token.

    Returns the payload if the signature is valid AND the token type
    matches ``expected_type``. Returns ``None`` for any failure (bad
    signature, expired, wrong type, malformed).
    """
    try:
        payload: dict[str, Any] = jwt.decode(
            token, get_settings().secret_key, algorithms=[get_settings().algorithm]
        )
    except PyJWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    return payload
