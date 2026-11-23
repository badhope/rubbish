"""Global login wall for the API surface.

The site is private by default: every business API needs a valid access
token, with a deliberately small allowlist for sign-in, registration,
password recovery, health checks and the public capability probe.

The wall only verifies the JWT signature/expiry. Account state (disabled
users, token-version revocation, tenant scope) is still enforced by the
normal endpoint dependencies; a token that passes here but fails there
gets the usual 401 and the SPA refreshes or signs out.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.config import settings
from app.core.security import decode_access_token

# Exact paths that must stay reachable before a user has a token.
PUBLIC_API_PATHS = frozenset(
    {
        "/api/auth/captcha",
        "/api/auth/register",
        "/api/auth/login",
        "/api/auth/login/2fa",
        "/api/auth/refresh",
        "/api/auth/verify-email",
        "/api/auth/resend-verification",
        "/api/auth/forgot-password",
        "/api/auth/reset-password",
        "/api/auth/email-code/request",
        "/api/auth/email-code/verify",
        "/api/auth/2fa/authenticate",
        "/api/capabilities",
        "/api/health",
        "/api/health/ready",
        "/api/privacy",
        "/api/telemetry/pageview",
    }
)

# Prefixes that contain more than one pre-login step.
PUBLIC_API_PREFIXES = (
    # OIDC providers, redirect start and callback all happen before a token exists.
    "/api/auth/oidc/",
    # Passkey assertion begins before login; registration/credential management stays locked.
    "/api/auth/webauthn/authenticate/",
    # The old mainland gate endpoints remain callable if an operator re-enables it.
    "/api/access/",
)


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


def _is_public(path: str) -> bool:
    return path in PUBLIC_API_PATHS or any(path.startswith(p) for p in PUBLIC_API_PREFIXES)


class AuthWallMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if not settings.auth_wall_enabled:
            return await call_next(request)

        path = request.url.path
        # CORS preflight must pass; non-API paths (SPA shell, static files) are
        # handled by the frontend route guard.
        if request.method == "OPTIONS" or not path.startswith("/api/") or _is_public(path):
            return await call_next(request)

        token = _bearer_token(request)
        if token is not None and decode_access_token(token) is not None:
            return await call_next(request)

        return JSONResponse(
            status_code=401,
            content={"detail": "authentication_required"},
            headers={
                "WWW-Authenticate": "Bearer",
                "Cache-Control": "no-store",
            },
        )
