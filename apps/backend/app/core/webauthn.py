"""WebAuthn / Passkeys helpers.

Implements the server-side half of the WebAuthn ceremony using the
``webauthn`` library (Duo Labs, v2.x). Credential metadata is stored
as a JSONB array on the User row.

Design notes:

- Challenge storage uses an in-memory dict with lazy TTL eviction.
  In production, move to Redis (``settings.redis_url``) for multi-
  process safety. The current implementation is safe for single-
  process deployments and the dev/test workflow.

- RP (Relying Party) parameters come from settings:
  ``RUBBISH_WEBAUTHN_RP_ID``, ``RUBBISH_WEBAUTHN_RP_NAME``,
  ``RUBBISH_WEBAUTHN_ORIGIN``.

- Credential storage format (per entry in ``webauthn_credentials``):
    {
        "id": "<base64url credential id>",
        "public_key": "<base64url public key bytes>",
        "sign_count": <int>,
        "name": "<human label, e.g. 'YubiKey 5C'>",
        "created_at": "<ISO 8601 UTC>",
        "transports": ["usb", "nfc", ...],
    }
"""

from __future__ import annotations

import base64
import json
import time
from datetime import UTC, datetime
from typing import Any

import webauthn
from webauthn.helpers.exceptions import (
    InvalidAuthenticationResponse,
    InvalidRegistrationResponse,
)
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.core.config import settings
from app.models import User

# ---------------------------------------------------------------------------
# In-memory challenge store (replace with Redis for multi-process deployments)
# ---------------------------------------------------------------------------
# Stores raw challenge bytes, keyed by their base64url encoding.
# {challenge_b64url: expiry_monotonic_timestamp}
_challenge_store: dict[str, float] = {}
_CHALLENGE_TTL_SECONDS = 300  # 5 minutes


def _store_challenge(challenge: bytes) -> None:
    """Remember a challenge so it can be verified later."""
    key = base64.urlsafe_b64encode(challenge).decode("ascii")
    _challenge_store[key] = time.monotonic() + _CHALLENGE_TTL_SECONDS
    # Lazy eviction: sweep expired entries on every Nth store.
    if len(_challenge_store) % 50 == 0:
        _evict_expired()


def _consume_challenge(challenge: bytes) -> bool:
    """Verify a challenge exists and remove it (one-shot).

    Returns True if the challenge was valid and consumed, False otherwise.
    """
    key = base64.urlsafe_b64encode(challenge).decode("ascii")
    expiry = _challenge_store.pop(key, None)
    if expiry is None:
        return False
    return time.monotonic() <= expiry


def _evict_expired() -> None:
    """Remove stale entries from the store."""
    now = time.monotonic()
    expired = [k for k, v in _challenge_store.items() if now > v]
    for k in expired:
        _challenge_store.pop(k, None)


# ---------------------------------------------------------------------------
# Byte-level helpers
# ---------------------------------------------------------------------------


def _b64url_decode(s: str) -> bytes:
    """Decode a base64url string (no padding) to bytes."""
    return base64.urlsafe_b64decode(s + "==")


def _b64url_encode(b: bytes) -> str:
    """Encode bytes to a base64url string without padding."""
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def _extract_challenge_bytes(credential: dict[str, Any]) -> bytes:
    """Extract and decode the challenge from a WebAuthn credential dict.

    The browser sends ``response.clientDataJSON`` as a base64url-encoded
    JSON blob. We decode it, extract the ``challenge`` field, and decode
    that from base64url to raw bytes.
    """
    client_data_b64: str = credential.get("response", {}).get("clientDataJSON", "")
    if not client_data_b64:
        raise ValueError("Missing clientDataJSON in credential response")
    client_data_json = _b64url_decode(client_data_b64).decode("utf-8")
    client_data = json.loads(client_data_json)
    challenge_b64: str = client_data.get("challenge", "")
    if not challenge_b64:
        raise ValueError("Missing challenge in clientDataJSON")
    return _b64url_decode(challenge_b64)


# ---------------------------------------------------------------------------
# Credential helpers
# ---------------------------------------------------------------------------


def _get_credentials(user: User) -> list[dict[str, Any]]:
    """Return the user's registered credential list (never None)."""
    return user.webauthn_credentials or []


def _save_credentials(user: User, credentials: list[dict[str, Any]]) -> None:
    """Write the credential list back to the user row."""
    user.webauthn_credentials = credentials


def _find_credential(user: User, credential_id: str) -> tuple[dict[str, Any] | None, int]:
    """Return (credential_dict, index) for a credential id, or (None, -1)."""
    creds = _get_credentials(user)
    for i, c in enumerate(creds):
        if c["id"] == credential_id:
            return c, i
    return None, -1


# ---------------------------------------------------------------------------
# Registration (creating a passkey)
# ---------------------------------------------------------------------------


def generate_registration_options(
    user: User,
) -> dict[str, Any]:
    """Build a PublicKeyCredentialCreationOptions dict for the browser.

    The caller (API endpoint) serialises the returned dict to JSON and
    sends it to the client. The client calls ``navigator.credentials.create()``
    with it and POSTs the resulting ``PublicKeyCredential`` back to
    ``/register/complete``.
    """
    user_id_bytes = str(user.id).encode("utf-8")

    # Exclude already-registered credential IDs so the authenticator
    # does not offer to re-register the same key.
    existing_creds = _get_credentials(user)
    exclude_credentials: list[PublicKeyCredentialDescriptor] = []
    for c in existing_creds:
        exclude_credentials.append(PublicKeyCredentialDescriptor(id=_b64url_decode(c["id"])))

    options = webauthn.generate_registration_options(
        rp_id=settings.webauthn_rp_id,
        rp_name=settings.webauthn_rp_name,
        user_id=user_id_bytes,
        user_name=user.username,
        user_display_name=user.username,
        attestation=AttestationConveyancePreference.NONE,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=None,
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=exclude_credentials,
    )

    _store_challenge(options.challenge)

    return {
        "rp": {"id": options.rp.id, "name": options.rp.name},
        "user": {
            "id": _b64url_encode(options.user.id),
            "name": options.user.name,
            "displayName": options.user.display_name,
        },
        "challenge": _b64url_encode(options.challenge),
        "pubKeyCredParams": [
            {"type": "public-key", "alg": p.alg} for p in options.pub_key_cred_params
        ],
        "timeout": options.timeout,
        "excludeCredentials": [
            {"type": "public-key", "id": _b64url_encode(c.id)}
            for c in (options.exclude_credentials or [])
        ],
        "authenticatorSelection": {
            "residentKey": (
                options.authenticator_selection.resident_key.value  # type: ignore[union-attr]
                if options.authenticator_selection
                else "preferred"
            ),
            "userVerification": (
                options.authenticator_selection.user_verification.value  # type: ignore[union-attr]
                if options.authenticator_selection
                else "preferred"
            ),
        },
        "attestation": options.attestation.value,
    }


def verify_registration_response(
    user: User,
    credential: dict[str, Any],
    credential_name: str = "Passkey",
) -> dict[str, Any]:
    """Verify a registration response from ``navigator.credentials.create()``.

    On success, appends the credential to the user's ``webauthn_credentials``
    and returns the new credential entry.

    Raises ``ValueError`` on any verification failure.
    """
    # Extract and verify the challenge (one-shot).
    challenge_bytes = _extract_challenge_bytes(credential)
    if not _consume_challenge(challenge_bytes):
        raise ValueError("Challenge verification failed — expired or never issued")

    # The webauthn library accepts the raw dict (or JSON string) directly.
    try:
        verification = webauthn.verify_registration_response(
            credential=credential,
            expected_challenge=challenge_bytes,
            expected_origin=settings.webauthn_origin,
            expected_rp_id=settings.webauthn_rp_id,
            require_user_verification=False,
        )
    except InvalidRegistrationResponse as exc:
        raise ValueError(f"Registration verification failed: {exc}") from exc

    new_credential = {
        "id": _b64url_encode(verification.credential_id),
        "public_key": _b64url_encode(verification.credential_public_key),
        "sign_count": verification.sign_count,
        "name": credential_name,
        "created_at": datetime.now(UTC).isoformat(),
        "transports": credential.get("response", {}).get("transports", []),
    }

    creds = _get_credentials(user)
    creds.append(new_credential)
    _save_credentials(user, creds)

    return new_credential


# ---------------------------------------------------------------------------
# Authentication (logging in with a passkey)
# ---------------------------------------------------------------------------


def generate_authentication_options(
    user: User,
) -> dict[str, Any]:
    """Build a PublicKeyCredentialRequestOptions dict for the browser.

    Returns a challenge + list of allowed credential IDs so the client
    can call ``navigator.credentials.get()``.

    Raises ``ValueError`` when the user has no registered passkeys.
    """
    creds = _get_credentials(user)
    if not creds:
        raise ValueError("User has no registered passkeys")

    allow_credentials: list[PublicKeyCredentialDescriptor] = []
    for c in creds:
        allow_credentials.append(
            PublicKeyCredentialDescriptor(
                id=_b64url_decode(c["id"]),
                transports=c.get("transports", []),
            )
        )

    options = webauthn.generate_authentication_options(
        rp_id=settings.webauthn_rp_id,
        allow_credentials=allow_credentials,
        user_verification=UserVerificationRequirement.PREFERRED,
    )

    _store_challenge(options.challenge)

    return {
        "challenge": _b64url_encode(options.challenge),
        "timeout": options.timeout,
        "rpId": options.rp_id,
        "allowCredentials": [
            {
                "type": "public-key",
                "id": _b64url_encode(c.id),
                "transports": c.transports,
            }
            for c in allow_credentials
        ],
        "userVerification": options.user_verification.value,  # type: ignore[union-attr]
    }


def verify_authentication_response(
    user: User,
    credential: dict[str, Any],
) -> dict[str, Any]:
    """Verify an authentication response from ``navigator.credentials.get()``.

    On success, bumps the stored ``sign_count`` on the credential and
    returns the verified credential entry.

    Raises ``ValueError`` on any verification failure.
    """
    # Find the matching stored credential.
    raw_id: str = credential.get("rawId") or credential.get("id", "")
    if not raw_id:
        raise ValueError("Missing credential ID in authentication response")

    stored, idx = _find_credential(user, raw_id)
    if stored is None:
        raise ValueError("Unknown credential — not registered by this user")

    # Extract and verify the challenge (one-shot).
    challenge_bytes = _extract_challenge_bytes(credential)
    if not _consume_challenge(challenge_bytes):
        raise ValueError("Challenge verification failed — expired or never issued")

    try:
        verification = webauthn.verify_authentication_response(
            credential=credential,
            expected_challenge=challenge_bytes,
            expected_origin=settings.webauthn_origin,
            expected_rp_id=settings.webauthn_rp_id,
            credential_public_key=_b64url_decode(stored["public_key"]),
            credential_current_sign_count=stored["sign_count"],
            require_user_verification=False,
        )
    except InvalidAuthenticationResponse as exc:
        raise ValueError(f"Authentication verification failed: {exc}") from exc

    # Update sign count.
    creds = _get_credentials(user)
    creds[idx]["sign_count"] = verification.new_sign_count
    _save_credentials(user, creds)

    return stored
