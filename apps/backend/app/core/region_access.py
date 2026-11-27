"""Regional access policy for the public site.

This is deliberately an access-control layer, not a legal disclaimer:

- mainland China, Hong Kong, Macao and Taiwan: anonymous visitors only see
  the cover; they can still sign in with an existing invited account.
- other regions: anonymous visitors may read published articles and forum
  threads, but may not write, comment, react, follow, or enter account/admin
  pages.
- any visitor with a valid access token: the normal account/role checks apply.

IP geolocation is approximate and can be defeated by VPN/proxy. It is not a
substitute for actual legal compliance. The restricted ranges are a snapshot
from ipdeny.com and are only used to decide which UI shell/API read set a
request gets.
"""

from __future__ import annotations

import ipaddress
import re
from functools import lru_cache
from pathlib import Path

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.auth_wall import is_public_api_path, is_signed_download_request
from app.core.config import settings
from app.core.logging import get_logger
from app.core.mainland_gate import client_ip
from app.core.security import decode_access_token

logger = get_logger("rubbish.region_access")

REGION_COOKIE_NAME = "rubbish_region"
RESTRICTED = "restricted"
OVERSEAS = "overseas"

_DEFAULT_IP_LIST = Path(__file__).resolve().parents[1] / "data" / "restricted_service_ip_ranges.txt"

# Safe read-only endpoints for overseas guests. Everything here is published
# material; account, moderation, review, admin and write paths are absent.
_OVERSEAS_EXACT = frozenset(
    {
        "/api/catalog",
        "/api/catalog/",
        "/api/catalog/stats",
        "/api/catalog/volumes/stats",
        "/api/catalog/facets",
        "/api/catalog/editorial",
        "/api/catalog/updates",
        "/api/explore/overview",
        "/api/search",
        "/api/catalog/disciplines",
        "/api/disciplines",
        "/api/forum/topics",
        "/api/forum/topics/",
        "/api/forum/boards",
        "/api/comments",
        "/api/announcements",
        "/api/announcements/",
    }
)
# 图片能力 URL：文件名是 128 位随机串，img 标签不会带 Authorization，
# 因此必须对所有地区放行，否则大陆登录用户的正文图、头像、封面全是破图。
_PUBLIC_MEDIA_PATTERNS = (
    re.compile(r"^/api/forum/images/[\w.-]+$"),
    re.compile(r"^/api/media/images/[\w.-]+$"),
    re.compile(r"^/api/users/profile-images/[\w.-]+$"),
    re.compile(r"^/api/catalog/\d+/img/[\w.-]+$"),
)

_OVERSEAS_PATTERNS = (
    re.compile(r"^/api/catalog/\d+$"),
    re.compile(r"^/api/catalog/\d+/history$"),
    re.compile(r"^/api/catalog/\d+/reviews$"),
    re.compile(r"^/api/catalog/\d+/related$"),
    re.compile(r"^/api/catalog/\d+/img/[\w.-]+$"),
    re.compile(r"^/api/forum/topics/\d+$"),
    re.compile(r"^/api/forum/topics/\d+/replies$"),
    re.compile(r"^/api/forum/images/[\w.-]+$"),
    re.compile(r"^/api/media/images/[\w.-]+$"),
    re.compile(r"^/api/users/[^/]+/public$"),
)


@lru_cache(maxsize=4)
def _load_networks(path_value: str) -> tuple[ipaddress.BaseNetwork, ...]:
    path = Path(path_value)
    if not path.is_file():
        logger.error("region_ip_list_missing", path=str(path))
        return ()
    networks: list[ipaddress.BaseNetwork] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value or value.startswith("#"):
            continue
        try:
            networks.append(ipaddress.ip_network(value, strict=False))
        except ValueError:
            logger.warning("region_ip_list_bad_entry", value=value[:80])
    logger.info("region_ip_list_loaded", path=str(path), count=len(networks))
    return tuple(networks)


def restricted_networks() -> tuple[ipaddress.BaseNetwork, ...]:
    path = settings.region_access_restricted_ip_list_path.strip()
    return _load_networks(path or str(_DEFAULT_IP_LIST))


def is_restricted_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    # Private/loopback means the proxy header is missing, not a real visitor.
    if ip.is_private or ip.is_loopback or ip.is_reserved:
        return False
    return any(ip in network for network in restricted_networks())


def region_for_request(request: Request) -> str:
    return RESTRICTED if is_restricted_ip(client_ip(request)) else OVERSEAS


def is_public_media_path(path: str) -> bool:
    return any(pattern.match(path) for pattern in _PUBLIC_MEDIA_PATTERNS)


def is_overseas_read_request(path: str, method: str) -> bool:
    if method not in {"GET", "HEAD"}:
        return False
    return path in _OVERSEAS_EXACT or any(p.match(path) for p in _OVERSEAS_PATTERNS)


def _has_bearer(request: Request) -> bool:
    header = request.headers.get("authorization", "")
    return header.lower().startswith("bearer ") and bool(header[7:].strip())


def _valid_bearer(request: Request) -> bool:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return False
    token = header[7:].strip()
    return bool(token) and decode_access_token(token) is not None


def _has_api_key(request: Request) -> bool:
    """stdio MCP uses X-API-Key; let the AI/MCP wall validate the hash."""
    return bool(request.headers.get("x-api-key", "").strip())


def _should_set_cookie(path: str) -> bool:
    if path.startswith("/api/"):
        return False
    return not path.startswith(("/assets/", "/favicon", "/static/"))


class RegionAccessMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if not settings.region_access_enabled:
            return await call_next(request)

        path = request.url.path
        region = region_for_request(request)
        request.state.rubbish_region = region

        if (
            _valid_bearer(request)
            or _has_bearer(request)
            or _has_api_key(request)
            or is_public_api_path(path)
            or is_public_media_path(path)
            or is_signed_download_request(request)
        ):
            # A stale/expired bearer must reach AuthWall so the SPA gets a
            # 401 and can try its refresh cookie. Invalid tokens cannot read
            # anything anyway.
            response = await call_next(request)
        elif path.startswith("/api/"):
            if region == RESTRICTED:
                response = JSONResponse(
                    status_code=403,
                    content={"detail": "region_restricted"},
                    headers={"Cache-Control": "no-store"},
                )
            elif is_overseas_read_request(path, request.method):
                request.state.overseas_read_guest = True
                response = await call_next(request)
            else:
                response = await call_next(request)
        else:
            response = await call_next(request)

        if _should_set_cookie(path):
            response.set_cookie(
                REGION_COOKIE_NAME,
                region,
                max_age=86400,
                httponly=False,
                secure=settings.cookie_secure,
                samesite="lax",
            )
        return response
