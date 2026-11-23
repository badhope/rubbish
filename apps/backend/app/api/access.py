"""Password submission endpoint for the mainland access gate."""

from __future__ import annotations

import hmac

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.core.config import settings
from app.core.logging import get_logger
from app.core.mainland_gate import (
    GATE_COOKIE_NAME,
    client_ip,
    gate_html_response,
    gate_page,
    has_valid_gate_cookie,
    is_mainland_ip,
    make_gate_token,
    safe_next,
)
from app.core.rate_limit_store import get_rate_limiter_store

logger = get_logger("rubbish.access_gate")
router = APIRouter(tags=["access"])

# A shared password is a low-entropy secret; keep brute force expensive per IP.
_GATE_ATTEMPT_LIMIT = 8
_GATE_ATTEMPT_WINDOW_SECONDS = 600


@router.get("/gate", include_in_schema=False, response_model=None)
async def gate_entry(request: Request) -> HTMLResponse | RedirectResponse:
    if not settings.mainland_gate_enabled:
        return RedirectResponse("/", status_code=303)
    if not is_mainland_ip(client_ip(request)) or has_valid_gate_cookie(request):
        return RedirectResponse("/", status_code=303)
    return HTMLResponse(
        gate_page(next_path="/"),
        status_code=403,
        headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"},
    )


@router.get("/api/access/status", include_in_schema=False)
async def gate_status(request: Request) -> JSONResponse:
    required = (
        settings.mainland_gate_enabled
        and is_mainland_ip(client_ip(request))
        and not has_valid_gate_cookie(request)
    )
    return JSONResponse(
        {
            "gate_enabled": settings.mainland_gate_enabled,
            "required": required,
        },
        headers={"Cache-Control": "no-store"},
    )


@router.post("/api/access/gate", include_in_schema=False, response_model=None)
async def submit_gate(
    request: Request,
    password: str = Form(...),
    next: str = Form("/"),
) -> HTMLResponse | RedirectResponse:
    if not settings.mainland_gate_enabled:
        return RedirectResponse("/", status_code=303)

    ip = client_ip(request)
    allowed, _depth = await get_rate_limiter_store().hit_and_check(
        bucket_key=f"mainland-gate:{ip}",
        limit=_GATE_ATTEMPT_LIMIT,
        window_seconds=_GATE_ATTEMPT_WINDOW_SECONDS,
    )
    if not allowed:
        logger.warning("mainland_gate_rate_limited", ip=ip)
        return gate_html_response(
            next_path=safe_next(next),
            status_code=429,
            error="尝试过于频繁，请十分钟后再试。",
        )

    if not hmac.compare_digest(password, settings.mainland_gate_password):
        logger.warning("mainland_gate_bad_password", ip=ip)
        return gate_html_response(
            next_path=safe_next(next),
            status_code=401,
            error="密码不正确。",
        )

    response = RedirectResponse(safe_next(next), status_code=303)
    response.set_cookie(
        GATE_COOKIE_NAME,
        make_gate_token(),
        max_age=settings.mainland_gate_cookie_days * 86400,
        httponly=True,
        secure=settings.is_production or request.url.scheme == "https",
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    logger.info("mainland_gate_opened", ip=ip)
    return response
