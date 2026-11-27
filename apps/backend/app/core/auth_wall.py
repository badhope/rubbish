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

import re

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
        "/api/auth/register/email-code/request",
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
        "/api/explore/overview",
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

# Capability URLs for images embedded in public articles, topic posts and
# profiles. Browsers fetch <img src> without an Authorization header, so these
# random-filename endpoints must stay readable outside the bearer gate; the
# region middleware applies the same allowlist before it can return 403.
PUBLIC_API_PATTERNS = (
    re.compile(r"^/api/forum/images/[\w.-]+$"),
    re.compile(r"^/api/media/images/[\w.-]+$"),
    re.compile(r"^/api/users/profile-images/[\w.-]+$"),
    re.compile(r"^/api/catalog/\d+/img/[\w.-]+$"),
)

# 签名下载链接由移动端/微信内置浏览器直接打开，浏览器不会带 Bearer。
# 只放行带 ticket 参数的提交文件下载路径；票据签名、过期时间与权限仍由
# 端点自身的 _verify_download_ticket / _can_access_submission_file 校验。
_SIGNED_DOWNLOAD_PATH = re.compile(r"^/api/submissions/\d+/files(?:/[^/]+)?$")

# Personal MCP tokens are opaque `rbk_...` secrets, not JWT. They may only
# enter the two prefixes whose routers validate them; every other path still
# requires a session JWT, so a leaked MCP token cannot browse the site.
_API_TOKEN_PATH = re.compile(r"^/api/(?:ai|mcp)(?:/|$)")


def is_signed_download_request(request: Request) -> bool:
    """是否为一张带签名的提交文件下载请求。"""
    if request.method not in {"GET", "HEAD"}:
        return False
    if not request.query_params.get("ticket"):
        return False
    return bool(_SIGNED_DOWNLOAD_PATH.match(request.url.path))


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


def _api_key(request: Request) -> str | None:
    """The stdio MCP bridge sends X-API-Key instead of Authorization."""
    value = request.headers.get("x-api-key", "").strip()
    return value or None


def is_public_api_path(path: str) -> bool:
    return (
        path in PUBLIC_API_PATHS
        or any(path.startswith(p) for p in PUBLIC_API_PREFIXES)
        or any(pattern.match(path) for pattern in PUBLIC_API_PATTERNS)
    )


class AuthWallMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if not settings.auth_wall_enabled:
            return await call_next(request)

        path = request.url.path
        # Overseas guests get a narrow read-only window for published
        # articles/forum threads; everything else still needs a token.
        if getattr(request.state, "overseas_read_guest", False):
            return await call_next(request)
        # CORS preflight must pass; non-API paths (SPA shell, static files) are
        # handled by the frontend route guard.
        if (
            request.method == "OPTIONS"
            or not path.startswith("/api/")
            or is_public_api_path(path)
            or is_signed_download_request(request)
        ):
            return await call_next(request)

        token = _bearer_token(request)
        if token is not None and decode_access_token(token) is not None:
            return await call_next(request)
        # `rbk_` tokens are deliberately opaque; let the AI/MCP router verify
        # hash, expiry, revocation, tenant and scope. The wall must not decode
        # them as JWT or every MCP request dies here before reaching the route.
        if token is not None and token.startswith("rbk_") and _API_TOKEN_PATH.match(path):
            return await call_next(request)
        api_key = _api_key(request)
        if api_key is not None and api_key.startswith("rbk_") and _API_TOKEN_PATH.match(path):
            return await call_next(request)

        return JSONResponse(
            status_code=401,
            content={"detail": "authentication_required"},
            headers={
                "WWW-Authenticate": "Bearer",
                "Cache-Control": "no-store",
            },
        )
