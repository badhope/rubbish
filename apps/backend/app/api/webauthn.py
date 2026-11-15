"""WebAuthn / Passkeys API endpoints.

Provides registration (create passkey), authentication (login with
passkey), credential listing, and credential deletion.

All endpoints live under ``/api/auth/webauthn``.

- Registration requires auth (the user is already logged in and wants
  to add a passkey as an alternative to TOTP).
- Authentication (login) does NOT require auth — the caller provides
  a username and a signed WebAuthn assertion.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_tenant_id
from app.core.config import settings
from app.core.db import get_db
from app.core.logging import get_logger
from app.core.security import create_access_token, create_refresh_token
from app.core.tokens import random_jti
from app.core.webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from app.models import User
from app.schemas import TokenResponse

router = APIRouter(prefix="/auth/webauthn", tags=["webauthn"])

logger = get_logger("rubbish.webauthn")


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class WebAuthnCredentialBody(BaseModel):
    """Raw ``PublicKeyCredential`` as sent by the browser's WebAuthn API.

    The browser sends this object after calling:
    - ``navigator.credentials.create()`` (registration)
    - ``navigator.credentials.get()`` (authentication)

    The field names match the WebAuthn spec's ``PublicKeyCredential``
    interface. ``rawId`` is the base64url-encoded credential ID without
    padding; ``response`` carries the authenticator's attestation or
    assertion.
    """

    id: str
    rawId: str = Field(default="")
    type: str = Field(default="public-key")
    response: dict[str, Any] = Field(default_factory=dict)


class WebAuthnRegisterCompleteRequest(BaseModel):
    """Body for POST /auth/webauthn/register/complete."""

    credential: WebAuthnCredentialBody
    name: str = Field(default="Passkey", max_length=128)


class WebAuthnAuthenticateBeginRequest(BaseModel):
    """Body for POST /auth/webauthn/authenticate/begin."""

    username: str = Field(min_length=1, max_length=100)


class WebAuthnAuthenticateCompleteRequest(BaseModel):
    """Body for POST /auth/webauthn/authenticate/complete."""

    username: str = Field(min_length=1, max_length=100)
    credential: WebAuthnCredentialBody


class WebAuthnCredentialResponse(BaseModel):
    """Single registered passkey entry."""

    id: str
    name: str
    created_at: str
    transports: list[str] = Field(default_factory=list)


class WebAuthnCredentialsListResponse(BaseModel):
    """List of registered passkeys."""

    credentials: list[WebAuthnCredentialResponse]


# ---------------------------------------------------------------------------
# Registration (auth required — user is already logged in)
# ---------------------------------------------------------------------------


@router.post("/register/begin")
async def register_begin(
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Start passkey registration.

    Returns a ``PublicKeyCredentialCreationOptions`` payload the browser
    feeds to ``navigator.credentials.create()``. The user must be
    authenticated (bearer token) to add a passkey to their account.
    """
    try:
        options = generate_registration_options(current_user)
    except Exception as exc:
        logger.warning("webauthn_register_begin_failed", user_id=current_user.id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate registration options",
        ) from exc
    return options


@router.post("/register/complete", status_code=status.HTTP_201_CREATED)
async def register_complete(
    payload: WebAuthnRegisterCompleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WebAuthnCredentialResponse:
    """Complete passkey registration.

    Accepts the ``PublicKeyCredential`` returned by the browser after
    a successful ``navigator.credentials.create()`` call. Verifies the
    attestation and stores the credential on the user's account.

    The ``name`` field is an optional human-readable label (e.g.
    "YubiKey 5C" or "iPhone Touch ID").
    """
    credential_dict = payload.credential.model_dump()
    # Ensure ``rawId`` is populated — the browser sends ``id`` and
    # ``rawId``, but some libraries omit one.
    if not credential_dict.get("rawId"):
        credential_dict["rawId"] = credential_dict.get("id", "")

    try:
        new_cred = verify_registration_response(
            current_user, credential_dict, credential_name=payload.name
        )
    except ValueError as exc:
        logger.warning(
            "webauthn_register_complete_failed",
            user_id=current_user.id,
            error=str(exc),
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(current_user)

    logger.info(
        "webauthn_credential_registered",
        user_id=current_user.id,
        credential_id=new_cred["id"],
    )
    return WebAuthnCredentialResponse(
        id=new_cred["id"],
        name=new_cred["name"],
        created_at=new_cred["created_at"],
        transports=new_cred.get("transports", []),
    )


# ---------------------------------------------------------------------------
# Authentication (login — no auth required)
# ---------------------------------------------------------------------------


@router.post("/authenticate/begin")
async def authenticate_begin(
    payload: WebAuthnAuthenticateBeginRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Start passkey login.

    Provide a username; the server returns a
    ``PublicKeyCredentialRequestOptions`` payload with the allowed
    credential IDs for that user. The browser calls
    ``navigator.credentials.get()`` with it and POSTs the resulting
    assertion to ``/authenticate/complete``.
    """
    tenant_id = require_tenant_id()
    result = await db.execute(
        select(User).where(
            User.username == payload.username,
            User.tenant_id == tenant_id,
        )
    )
    user = result.scalar_one_or_none()

    # Anti-enumeration: return the same error whether the user exists
    # or not, and whether they have passkeys or not.
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    try:
        options = generate_authentication_options(user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning(
            "webauthn_authenticate_begin_failed",
            username=payload.username,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate authentication options",
        ) from exc

    return options


@router.post("/authenticate/complete", response_model=TokenResponse)
async def authenticate_complete(
    request: Request,
    response: Response,
    payload: WebAuthnAuthenticateCompleteRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Complete passkey login.

    Accepts the ``PublicKeyCredential`` returned by the browser after
    a successful ``navigator.credentials.get()`` call, verifies the
    assertion, and issues access + refresh tokens.
    """
    tenant_id = require_tenant_id()
    result = await db.execute(
        select(User).where(
            User.username == payload.username,
            User.tenant_id == tenant_id,
        )
    )
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    credential_dict = payload.credential.model_dump()
    if not credential_dict.get("rawId"):
        credential_dict["rawId"] = credential_dict.get("id", "")

    try:
        verify_authentication_response(user, credential_dict)
    except ValueError as exc:
        logger.warning(
            "webauthn_authenticate_complete_failed",
            user_id=user.id,
            error=str(exc),
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(user)

    logger.info("webauthn_authenticate_success", user_id=user.id)

    # Issue tokens — same pattern as auth.py's _issue_tokens.
    return _issue_tokens(user, response)


# ---------------------------------------------------------------------------
# Credential management (auth required)
# ---------------------------------------------------------------------------


@router.get("/credentials", response_model=WebAuthnCredentialsListResponse)
async def list_credentials(
    current_user: User = Depends(get_current_user),
) -> WebAuthnCredentialsListResponse:
    """List all registered passkeys for the current user."""
    creds = current_user.webauthn_credentials or []
    return WebAuthnCredentialsListResponse(
        credentials=[
            WebAuthnCredentialResponse(
                id=c["id"],
                name=c.get("name", "Passkey"),
                created_at=c.get("created_at", ""),
                transports=c.get("transports", []),
            )
            for c in creds
        ]
    )


@router.delete("/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential(
    credential_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a registered passkey.

    The credential ID is the base64url-encoded string returned by the
    registration ceremony (same as ``rawId`` from the browser).
    """
    creds = current_user.webauthn_credentials or []
    new_creds = [c for c in creds if c["id"] != credential_id]

    if len(new_creds) == len(creds):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credential not found",
        )

    current_user.webauthn_credentials = new_creds if new_creds else None
    await db.commit()

    logger.info(
        "webauthn_credential_deleted",
        user_id=current_user.id,
        credential_id=credential_id,
    )


# ---------------------------------------------------------------------------
# Token issuance (shared with auth.py)
# ---------------------------------------------------------------------------


def _issue_tokens(user: User, response: Response) -> TokenResponse:
    """Helper: build access+refresh tokens and set the refresh cookie.

    Mirrors ``auth._issue_tokens`` — kept here so the webauthn module
    does not import from the auth module (avoids circular imports).
    """
    base_claims = {"sub": str(user.id), "token_version": user.token_version}
    access_token = create_access_token(base_claims)
    refresh_claims = {
        **base_claims,
        "rtv": user.refresh_token_version,
        "jti": random_jti(),
    }
    refresh_token = create_refresh_token(refresh_claims)

    # Set refresh cookie (same as auth._set_refresh_cookie).
    response.set_cookie(
        key=settings.refresh_token_cookie_name,
        value=refresh_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/auth",
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user_id=user.id,
        username=user.username,
        is_admin=user.is_admin,
    )
