"""OIDC SSO endpoints.

Two routes per provider:

  GET  /api/auth/oidc/{provider}/login    - redirect to provider's authorize URL
  GET  /api/auth/oidc/{provider}/callback  - exchange code for tokens, look
                                            up / create the local user, issue
                                            access + refresh tokens, redirect
                                            to the configured frontend URL.

Why ``authlib``: it implements the OIDC Authorization Code flow with
signature verification and id_token claims extraction. PKCE is not
currently enabled  - the deployment relies on ``client_secret_basic``
to protect the code exchange. If ``oidc_redirect_url`` is non-HTTPS,
PKCE should be added per ``[rfc9700]`` §4.7.1. Hand-rolling this flow
is the textbook source of OIDC security bugs.

Configuration is single-provider for now (Google / GitHub / Generic / Keycloak
all work via the same env vars  - see ``Settings.oidc_*``). Multi-provider
support is a config-shape change, not a code-shape one: extend the env
vars to be provider-keyed and turn ``oidc_provider`` into a list. The route
parameter ``{provider}`` already supports routing.

Security:
- ``state`` is a signed JWT carrying the CSRF nonce + provider + redirect target.
- We require ``openid email profile`` scope so userinfo always includes email.
- New users are created with a random bcrypt-hashed password (32 bytes from
  ``secrets.token_urlsafe``). They cannot log in via /auth/login because they
  never see that password  - but they can use /auth/forgot-password to set one
  if they want password access alongside OIDC.

The OIDC userinfo ``email`` field is trusted as verified when the provider
returns ``email_verified=true``; we then set ``is_email_verified=True`` on
the local user, skipping the email-loop.
"""

from __future__ import annotations

import secrets
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_tenant_id
from app.core.config import settings
from app.core.db import get_db
from app.core.logging import get_logger
from app.core.security import create_access_token, create_refresh_token, hash_password
from app.models import User


class OIDCProviderInfo(BaseModel):
    """One available OIDC provider on this deployment.

    Returned by ``GET /api/auth/oidc/providers``. The SPA renders a
    button per entry, or no button at all if the list is empty. The
    endpoint is **always** public (no auth required) so the login page
    can fetch it before the user has logged in.
    """

    slug: str
    label: str
    login_url: str


class OIDCProvidersResponse(BaseModel):
    providers: list[OIDCProviderInfo]


logger = get_logger("rubbish.oidc")

router = APIRouter(prefix="/auth/oidc", tags=["auth", "oidc"])

# State CSRF cookie. Carries the nonce from _make_state; the callback
# proves the redirect came from us by comparing it to the JWT claim.
# SameSite=Lax is required so the IdP top-level redirect back carries it.
STATE_COOKIE_NAME = "oidc_state"
STATE_COOKIE_MAX_AGE_SECONDS = 600


def _is_oidc_configured() -> bool:
    """Return True iff a provider is configured.

    Routes return 503 when OIDC is disabled (the default) so misconfigured
    deployments don't expose half-built endpoints.
    """
    return bool(
        settings.oidc_enabled
        and settings.oidc_provider
        and settings.oidc_client_id
        and settings.oidc_client_secret
        and settings.oidc_authorize_url
        and settings.oidc_token_url
        and settings.oidc_userinfo_url
        and settings.oidc_redirect_url
    )


def _build_authorize_url(state: str, code_challenge: str | None = None) -> str:
    """Build the provider's authorize URL.

    PKCE (RFC 7636): ``code_challenge`` is the SHA-256 hash of a one-shot
    ``code_verifier``. The callback exchanges the verifier for the code,
    so an attacker who intercepts the code cannot redeem it. PKCE is
    REQUIRED on every deployment that has ``oidc_pkce_required=True``
    (the default). Setting it False is documented for legacy IdPs that
    do not implement S256 \u2014 not for production convenience.
    """
    params = {
        "client_id": settings.oidc_client_id,
        "redirect_uri": settings.oidc_redirect_url,
        "response_type": "code",
        "scope": settings.oidc_scopes,
        "state": state,
    }
    if code_challenge is not None:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"
    sep = "&" if "?" in settings.oidc_authorize_url else "?"
    return f"{settings.oidc_authorize_url}{sep}{urlencode(params)}"


def _make_pkce_pair() -> tuple[str, str]:
    """Generate a PKCE verifier + S256 challenge.

    Returns ``(code_verifier, code_challenge)``. The verifier is stored
    in a short-lived httpOnly cookie; the challenge is sent to the IdP.
    """
    import base64
    import hashlib

    verifier = secrets.token_urlsafe(48)  # 64 chars -> 43..128 OK for RFC 7636
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _make_state(provider: str) -> tuple[str, str]:
    """Build a signed state token + its CSRF nonce.

    Returns ``(state_jwt, nonce)``. The nonce is echoed back via a short-lived
    httpOnly cookie set by the login route; the callback compares the cookie
    nonce to the JWT claim to prove the redirect originated from us (defense
    against login CSRF  - an attacker can't read or set the httpOnly cookie).
    """
    from datetime import UTC, datetime, timedelta

    import jwt

    nonce = secrets.token_urlsafe(24)
    payload = {
        "nonce": nonce,
        "provider": provider,
        "exp": datetime.now(UTC) + timedelta(minutes=10),
        "type": "oidc_state",
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm), nonce


def _verify_state(state: str, provider: str, cookie_nonce: str | None) -> bool:
    """Return True iff state JWT is valid AND its nonce matches the cookie.

    The cookie nonce is the login-CSRF defense: an attacker who tricks a
    victim into a forced OIDC callback cannot forge the victim's httpOnly
    cookie, so the nonce comparison fails.
    """
    import jwt

    if not cookie_nonce:
        return False
    try:
        payload: dict[str, Any] = jwt.decode(
            state, settings.secret_key, algorithms=[settings.algorithm]
        )
    except jwt.PyJWTError:
        return False
    if payload.get("type") != "oidc_state":
        return False
    if payload.get("provider") != provider:
        return False
    return secrets.compare_digest(str(payload.get("nonce", "")), cookie_nonce)


def _set_state_cookie(response: Response, nonce: str) -> None:
    """Attach the OIDC state nonce as a short-lived httpOnly cookie."""
    response.set_cookie(
        key=STATE_COOKIE_NAME,
        value=nonce,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=STATE_COOKIE_MAX_AGE_SECONDS,
        path="/api/auth",
    )


def _clear_state_cookie(response: Response) -> None:
    response.delete_cookie(
        key=STATE_COOKIE_NAME,
        path="/api/auth",
        samesite="lax",
    )


# PKCE cookie. Carries the code_verifier between the /login and /callback
# requests so the callback can redeem the auth code. HttpOnly so JS can't
# read it; lax SameSite so the IdP redirect back carries it.
PKCE_COOKIE_NAME = "oidc_pkce"
PKCE_COOKIE_MAX_AGE_SECONDS = 600


def _set_pkce_cookie(response: Response, verifier: str) -> None:
    response.set_cookie(
        key=PKCE_COOKIE_NAME,
        value=verifier,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=PKCE_COOKIE_MAX_AGE_SECONDS,
        path="/api/auth",
    )


def _clear_pkce_cookie(response: Response) -> None:
    response.delete_cookie(
        key=PKCE_COOKIE_NAME,
        path="/api/auth",
        samesite="lax",
    )


async def _exchange_code_for_userinfo(code: str, code_verifier: str | None) -> dict[str, Any]:
    """Exchange the auth code for an access token, then call userinfo.

    Uses ``authlib`` for both steps (token endpoint with client_secret_basic
    auth + userinfo endpoint with bearer token). Returns the userinfo JSON.

    If ``code_verifier`` is provided it is sent as the PKCE verifier so
    the IdP can validate the S256 challenge. PKCE-absent deployments
    pass ``None`` \u2014 see ``oidc_pkce_required`` setting.
    """
    from authlib.integrations.httpx_client import (  # type: ignore[import-untyped]
        AsyncOAuth2Client,
    )

    fetch_kwargs: dict[str, Any] = {
        "url": settings.oidc_token_url,
        "authorization_response": code,
        "grant_type": "authorization_code",
        "code": code,
    }
    if code_verifier is not None:
        fetch_kwargs["code_verifier"] = code_verifier

    async with AsyncOAuth2Client(
        client_id=settings.oidc_client_id,
        client_secret=settings.oidc_client_secret,
        scope=settings.oidc_scopes,
        redirect_uri=settings.oidc_redirect_url,
    ) as client:
        token = await client.fetch_token(**fetch_kwargs)
        access_token = token.get("access_token")
        if not access_token:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="OIDC provider did not return an access token",
            )
        userinfo = await client.get(settings.oidc_userinfo_url)
        if userinfo.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"OIDC userinfo endpoint returned {userinfo.status_code}",
            )
        result: dict[str, Any] = userinfo.json()
        result["_access_token"] = access_token
        return result


async def _upsert_oidc_user(db: AsyncSession, userinfo: dict[str, Any]) -> User:
    """Find or create the local user for an OIDC userinfo payload.

    Binding rule (login-CSRF / account-takeover defense): only bind the
    provider's identity to an existing local account when the provider
    returns ``email_verified=true``. An unverified email must NOT be
    auto-linked  - a malicious IdP could otherwise log in to a victim's
    local account by returning their (unverified) email.
    """
    email = userinfo.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OIDC provider did not return an email",
        )
    email_verified = bool(userinfo.get("email_verified", False))
    # Prefer ``name`` then ``preferred_username`` then ``sub`` as the username.
    username = (
        userinfo.get("preferred_username")
        or userinfo.get("name")
        or userinfo.get("sub")
        or email.split("@", 1)[0]
    )
    # Truncate to fit the column.
    username = username[:100]

    tenant_id = get_current_tenant_id()
    if tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant context not resolved",
        )
    # Scope by tenant_id too: User.email is unique per (tenant_id, email),
    # so without this filter an attacker-controlled IdP could bind to a
    # victim's account in another tenant by returning their email.
    result = await db.execute(
        select(User).where(
            User.email == email,
            User.tenant_id == tenant_id,
        )
    )
    user = result.scalar_one_or_none()
    if user is not None:
        # Refuse to bind an unverified email to an existing local account;
        # otherwise an attacker-controlled IdP could log in to a victim's
        # account by claiming their email without proof.
        if not email_verified:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="OIDC provider did not verify your email; cannot bind to existing account",
            )
        if not user.is_email_verified:
            user.is_email_verified = True
            await db.commit()
            await db.refresh(user)
        return user

    # New OIDC user  - random password; they login via OIDC. They can later
    # use /auth/forgot-password to set a password if they want.
    random_password = secrets.token_urlsafe(32)
    user = User(
        tenant_id=tenant_id,
        email=email,
        username=username,
        hashed_password=hash_password(random_password),
        is_admin=False,
        is_email_verified=email_verified,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # Username collision within the tenant  - append a random suffix
        # and retry once. If it still fails, surface a 409.
        await db.rollback()
        user.username = f"{username[:90]}-{secrets.token_hex(4)}"
        db.add(user)
        try:
            await db.commit()
        except IntegrityError as exc2:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Could not create OIDC user due to username conflict",
            ) from exc2
    await db.refresh(user)
    return user


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key=settings.refresh_token_cookie_name,
        value=refresh_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/auth",
    )


@router.get("/providers", response_model=OIDCProvidersResponse)
async def list_oidc_providers() -> OIDCProvidersResponse:
    """List OIDC providers currently enabled on this deployment.

    Always public (no auth) so the login page can fetch it before the
    user has signed in. When the deployment has no provider configured
    the response is an empty list - the SPA MUST NOT render any SSO
    button in that case. This is the single source of truth for the SPA:
    the previous ``VITE_OIDC_ENABLED`` build-time env var is replaced.
    """
    if not _is_oidc_configured():
        return OIDCProvidersResponse(providers=[])
    label = settings.oidc_provider_label or settings.oidc_provider.capitalize()
    return OIDCProvidersResponse(
        providers=[
            OIDCProviderInfo(
                slug=settings.oidc_provider,
                label=label,
                login_url=f"/api/auth/oidc/{settings.oidc_provider}/login",
            )
        ]
    )


@router.get("/{provider}/login")
async def oidc_login(provider: str) -> RedirectResponse:
    """Redirect to the provider's authorize URL with a signed state token.

    The ``{provider}`` path parameter exists so the API is shape-ready for
    multi-provider, but the configured provider must match - any other
    name returns 404.

    PKCE: if ``oidc_pkce_required`` is True (the default), a one-shot
    ``code_verifier`` is generated and the S256 challenge is sent to
    the IdP. The verifier is stored in an httpOnly cookie and used by
    the callback to redeem the code. The IdP rejects the code exchange
    if the verifier does not hash to the challenge.
    """
    if not _is_oidc_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC SSO is not configured on this deployment",
        )
    if provider != settings.oidc_provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OIDC provider {provider!r} is not configured",
        )
    state, nonce = _make_state(provider)
    code_challenge: str | None = None
    pkce_verifier: str | None = None
    if settings.oidc_pkce_required:
        pkce_verifier, code_challenge = _make_pkce_pair()
    response = RedirectResponse(_build_authorize_url(state, code_challenge))
    _set_state_cookie(response, nonce)
    if pkce_verifier is not None:
        _set_pkce_cookie(response, pkce_verifier)
    return response


@router.get("/{provider}/callback")
async def oidc_callback(
    provider: str,
    code: str,
    state: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Handle the OIDC provider's redirect back to us.

    Validate state (JWT signature + nonce bound to the httpOnly state cookie)
    -> exchange code for tokens -> fetch userinfo -> upsert user -> issue access
    + refresh tokens -> redirect to the frontend with the access token in the
    URL fragment (not the query string, so it does not leak into the browser
    history / referrer / server logs the way a query param would).
    """
    if not _is_oidc_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC SSO is not configured on this deployment",
        )
    if provider != settings.oidc_provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OIDC provider {provider!r} is not configured",
        )
    cookie_nonce = request.cookies.get(STATE_COOKIE_NAME)
    if not _verify_state(state, provider, cookie_nonce):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OIDC state",
        )

    # PKCE: pull the verifier from the cookie. Required when the setting
    # is on; absent cookie => reject the callback.
    code_verifier: str | None = None
    if settings.oidc_pkce_required:
        cookie_verifier = request.cookies.get(PKCE_COOKIE_NAME)
        if not cookie_verifier:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing PKCE verifier cookie - callback may have been initiated outside the login flow",
            )
        code_verifier = cookie_verifier

    userinfo = await _exchange_code_for_userinfo(code, code_verifier)
    user = await _upsert_oidc_user(db, userinfo)

    claims = {
        "sub": str(user.id),
        "token_version": user.token_version,
        # Align with the password-login refresh path: SSO users would otherwise
        # hit "Refresh token has been rotated" on their first /auth/refresh.
        "rtv": user.refresh_token_version,
    }
    access_token = create_access_token(claims)
    refresh_token = create_refresh_token(claims)

    # Build the redirect URL with the access token in the fragment so the
    # SPA can read it client-side without it touching the network as a
    # query param. Refresh token goes ONLY in the httpOnly cookie - putting
    # it in the fragment would expose a 7-day token to any XSS script via
    # window.location.hash, defeating the httpOnly defense.
    redirect_base = settings.oidc_redirect_url
    # Strip any query/fragment from the configured redirect URL - we want
    # the bare origin + path.
    if "?" in redirect_base:
        redirect_base = redirect_base.split("?", 1)[0]
    if "#" in redirect_base:
        redirect_base = redirect_base.split("#", 1)[0]
    target = f"{redirect_base}#access_token={access_token}"

    response = RedirectResponse(url=target)
    _set_refresh_cookie(response, refresh_token)
    # State cookie is one-time - clear it once the login completed.
    _clear_state_cookie(response)
    if settings.oidc_pkce_required:
        _clear_pkce_cookie(response)
    logger.info("oidc_login_success", user_id=user.id, provider=provider)
    return response
