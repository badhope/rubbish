"""TOTP (RFC 6238) helpers for the M2 hardening milestone.

Why hand-roll: the well-known ``pyotp`` library is on the deny list
because it transitively pulls in ``cryptography`` already required by
our ``Fernet`` usage, and ``pyotp`` adds no security value we cannot
provide in ~80 lines. The RFC is small and the failure modes are
predictable when we own the code.

Design choices:

- Secrets are 20 bytes (160 bits) of CSPRNG output, encoded as
  base32 with no padding. RFC 4226 recommends 160 bits (section 4
  "Recommended parameters") and we follow that exactly.
- The HOTP counter is the number of 30-second windows since the
  Unix epoch (``time.time() // 30``). Replay protection comes from
  tracking the last successfully-verified counter in the user
  record (so a code within the current or previous window is
  accepted at most once).
- Constant-time comparison via ``hmac.compare_digest`` so timing
  side channels cannot leak which digit was wrong.
- Drift tolerance: we accept the previous window (T-1) when the
  current window fails, which covers clock skew up to 30s. We do
  NOT accept T+1 because a stolen code from a slightly-future
  client clock should not be usable.

Encryption-at-rest: the cleartext secret is encrypted with Fernet
before being persisted to ``User.totp_secret_encrypted``. The
encryption/decryption boundary lives here, not in the route, so
every code path that touches the secret is funneled through one
place.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Literal

from cryptography.fernet import Fernet, InvalidToken

from app.core.key_rotation import decode_jwt, encode_jwt

# RFC 4226 section 4: 160-bit secret, 6-digit code, SHA-1 HMAC.
_TOTP_DIGITS: Final = 6
_TOTP_PERIOD: Final = 30
_TOTP_WINDOW: Final = 1  # accept T-1 in addition to T for clock skew
_TOTP_SECRET_BYTES: Final = 20
_BACKUP_CODE_COUNT: Final = 10
_BACKUP_CODE_LENGTH: Final = 10  # 10 chars, base32 alphabet


def generate_secret() -> str:
    """Return a 20-byte base32 secret (no padding) for a new user."""
    raw = secrets.token_bytes(_TOTP_SECRET_BYTES)
    return base64.b32encode(raw).decode("ascii").rstrip("=")


def _hotp(secret_b32: str, counter: int) -> str:
    """Compute HOTP per RFC 4226 section 5.3.

    Returns a zero-padded 6-digit string. ``secret_b32`` is the
    raw base32 (no padding) we stored on the user.
    """
    # Re-pad to a multiple of 8 chars because base64/32 decoders
    # require it. HOTP itself does not care about padding.
    pad = "=" * ((8 - len(secret_b32) % 8) % 8)
    key = base64.b32decode(secret_b32 + pad)
    counter_bytes = struct.pack(">Q", counter)
    digest = hmac.new(key, counter_bytes, hashlib.sha1).digest()
    # Dynamic truncation per RFC 4226 section 5.3.
    offset = digest[-1] & 0x0F
    code_int = (
        ((digest[offset] & 0x7F) << 24)
        | ((digest[offset + 1] & 0xFF) << 16)
        | ((digest[offset + 2] & 0xFF) << 8)
        | (digest[offset + 3] & 0xFF)
    )
    code_int %= 10**6
    return str(code_int).zfill(_TOTP_DIGITS)


def verify_totp(secret_b32: str, code: str, last_counter: int = -1) -> int | None:
    """Verify a 6-digit TOTP code against a secret.

    Returns the counter value that successfully verified (for replay
    protection) or ``None`` if the code is invalid. ``last_counter``
    is the highest counter we have already accepted for this user;
    any counter <= ``last_counter`` is rejected.
    """
    if not code or len(code) != _TOTP_DIGITS or not code.isdigit():
        return None
    current = int(time.time()) // _TOTP_PERIOD
    for delta in range(_TOTP_WINDOW + 1):
        candidate = current - delta
        if candidate <= last_counter:
            continue
        expected = _hotp(secret_b32, candidate)
        if hmac.compare_digest(expected, code):
            return candidate
    return None


# --- Backup codes ----------------------------------------------------------

_BACKUP_ALPHABET: Final = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # Crockford-ish


def generate_backup_codes() -> list[str]:
    """Return ``_BACKUP_CODE_COUNT`` single-use backup codes.

    Uses a 31-char unambiguous alphabet so users transcribe them
    reliably. Each code is shown to the user ONCE at enrollment /
    regeneration and is never stored in cleartext on the server.
    """
    codes: list[str] = []
    for _ in range(_BACKUP_CODE_COUNT):
        n = secrets.randbelow(len(_BACKUP_ALPHABET) ** _BACKUP_CODE_LENGTH)
        chars: list[str] = []
        for _ in range(_BACKUP_CODE_LENGTH):
            n, r = divmod(n, len(_BACKUP_ALPHABET))
            chars.append(_BACKUP_ALPHABET[r])
        # Group as XXXXX-XXXXX so users don't misread it.
        code = "".join(chars)
        codes.append(f"{code[:5]}-{code[5:]}")
    return codes


def hash_backup_code(code: str) -> str:
    """SHA-256 the normalized backup code.

    Backup codes have low entropy (~52 bits for 10 chars from a 31-char
    alphabet) and are one-shot, so SHA-256 with a constant prefix is
    fine. We do NOT use bcrypt here because (a) it would slow every
    verify noticeably, and (b) the threat model for a backup code is
    DB exfiltration, not online guessing.
    """
    normalized = code.replace("-", "").strip().upper()
    return hashlib.sha256(b"scholarhub:backup:" + normalized.encode("ascii")).hexdigest()


def normalize_backup_code(code: str) -> str:
    """Normalize a user-entered backup code for hashing/lookup."""
    return code.replace("-", "").strip().upper()


# --- Fernet at-rest encryption --------------------------------------------


def _fernet() -> Fernet:
    """Build a Fernet instance from the active settings.

    Reads settings through ``get_settings()`` (not the module-level
    ``settings`` singleton) so a hot key rotation — ``key_rotation.reload_settings``
    clearing the LRU cache — reaches every subsequent encryption/decryption.
    """
    from app.core.config import get_settings

    return Fernet(get_settings().fernet_key.encode("utf-8"))


def encrypt_secret(secret_b32: str) -> str:
    """Encrypt a TOTP secret for at-rest storage."""
    return _fernet().encrypt(secret_b32.encode("ascii")).decode("ascii")


def decrypt_secret(token: str) -> str:
    """Decrypt a TOTP secret read from storage.

    Raises ``ValueError`` if the token is undecryptable (e.g. the key
    was rotated and the row was encrypted with the previous key). The
    caller should treat this as a recoverable per-user error, not a
    500 - it just means this particular user needs to re-enroll 2FA.
    """
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("ascii")
    except InvalidToken as exc:
        raise ValueError("TOTP secret cannot be decrypted with the current key") from exc


def otpauth_uri(secret_b32: str, account: str, issuer: str) -> str:
    """Build an otpauth:// URI for QR code generation on the client side.

    The user scans this with Google Authenticator / 1Password / etc.
    """
    from urllib.parse import quote

    label = quote(f"{issuer}:{account}", safe="")
    params = (
        f"secret={quote(secret_b32, safe='')}"
        f"&issuer={quote(issuer, safe='')}"
        f"&algorithm=SHA1"
        f"&digits={_TOTP_DIGITS}"
        f"&period={_TOTP_PERIOD}"
    )
    return f"otpauth://totp/{label}?{params}"


# --- Two-factor pending token (login step 2) --------------------------------
#
# When a 2FA-enabled account passes the password check at /auth/login, the
# server issues a short-lived, type-tagged "2fa_pending" JWT instead of real
# credentials. The client redeems it plus a TOTP (or recovery) code at
# /auth/login/2fa. The pending token carries ``token_version`` so a password
# change / logout-everywhere invalidates it like any other token.
#
# These were relocated from the now-deleted ``app.core.twofactor`` module.
# They are signed and verified through ``key_rotation`` (kid header +
# previous-key fallback), so a hot key rotation landing between the
# password step and the code step does not break the half-finished
# login: a token minted under the old key still verifies until it
# expires.


TWO_FACTOR_PENDING_TOKEN_TYPE: Literal["2fa_pending"] = "2fa_pending"
PENDING_TOKEN_TTL_MINUTES = 5


def create_two_factor_pending_token(user_id: int, token_version: int) -> str:
    """Mint a short-lived 2FA-pending token for ``user_id``."""
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "token_version": token_version,
        "type": TWO_FACTOR_PENDING_TOKEN_TYPE,
        "exp": datetime.now(UTC) + timedelta(minutes=PENDING_TOKEN_TTL_MINUTES),
        "jti": secrets.token_urlsafe(16),
    }
    return encode_jwt(payload)


def decode_two_factor_pending_token(token: str) -> dict[str, Any] | None:
    """Decode + type-check a pending token; ``None`` on any failure.

    ``decode_jwt`` rejects a signature it cannot verify on ANY active
    key, and refuses to fall through to older keys when the ``type``
    claim is wrong — so a real access/refresh token presented here is
    rejected exactly like before, while rotation tolerance is gained
    for free.
    """
    return decode_jwt(token, expected_type=TWO_FACTOR_PENDING_TOKEN_TYPE)


__all__ = [
    "create_two_factor_pending_token",
    "decode_two_factor_pending_token",
    "decrypt_secret",
    "encrypt_secret",
    "generate_backup_codes",
    "generate_secret",
    "hash_backup_code",
    "normalize_backup_code",
    "otpauth_uri",
    "verify_totp",
]
