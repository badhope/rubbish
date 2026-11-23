"""Mainland-China access gate.

The check deliberately lives at the application edge instead of the frontend:
a frontend-only gate leaks the full HTML/JS bundle and can be bypassed with a
plain HTTP client. This middleware wraps every route, including the SPA
fallback and mounted static assets, and only lets a signed gate cookie through
for addresses matched by the bundled mainland IP ranges.

The IP list is a snapshot of the public CN zone from ipdeny.com. It is not a
political boundary and it is not exact: hosting/VPN/proxy egress can be
misclassified. When the list is missing we fail open and log an error rather
than taking the whole site down for everyone.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import ipaddress
import time
from functools import lru_cache
from pathlib import Path
from string import Template

from fastapi import Request
from fastapi.responses import HTMLResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("rubbish.mainland_gate")

GATE_COOKIE_NAME = "rubbish_mainland_gate"
GATE_PATH = "/gate"
GATE_SUBMIT_PATH = "/api/access/gate"
GATE_STATUS_PATH = "/api/access/status"
# Assets are allowed so the gate page can be styled without a second origin.
# They contain no content and cannot be used to read a blocked page.
GATE_ALLOWED_PREFIXES = (
    "/assets/",
    "/favicon",
)
GATE_ALLOWED_EXACT = frozenset(
    {
        GATE_PATH,
        GATE_SUBMIT_PATH,
        GATE_STATUS_PATH,
        "/api/health",
        "/health",
    }
)
_DEFAULT_IP_LIST = Path(__file__).resolve().parents[1] / "data" / "mainland_cn_ip_ranges.txt"


def _gate_key() -> bytes:
    return hmac.new(
        settings.secret_key.encode("utf-8"),
        b"rubbish-mainland-gate-v1",
        hashlib.sha256,
    ).digest()


def make_gate_token(now: float | None = None) -> str:
    """Return a signed, time-boxed token for the gate cookie."""
    issued = int(now if now is not None else time.time())
    expires = issued + settings.mainland_gate_cookie_days * 86400
    signature = hmac.new(
        _gate_key(),
        f"v1:{expires}".encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    return f"v1.{expires}.{signature}"


def is_valid_gate_token(token: str | None, now: float | None = None) -> bool:
    if not token:
        return False
    parts = token.split(".", 2)
    if len(parts) != 3 or parts[0] != "v1":
        return False
    try:
        expires = int(parts[1])
    except ValueError:
        return False
    if expires <= int(now if now is not None else time.time()):
        return False
    expected = hmac.new(
        _gate_key(),
        f"v1:{expires}".encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, parts[2])


def has_valid_gate_cookie(request: Request) -> bool:
    return is_valid_gate_token(request.cookies.get(GATE_COOKIE_NAME))


def client_ip(request: Request) -> str:
    """Return the real client IP, respecting only configured proxy hops.

    Caddy appends the real remote address to X-Forwarded-For. A client can
    send its own forged entry, so we must count from the right; the same
    convention as the rate limiter.

    The systemd/Nginx deployment binds the app to 127.0.0.1 and often leaves
    ``trusted_proxies_count`` at 0. In that case a loopback peer is definitionally
    the local Nginx, so the last forwarded hop is the address Nginx saw.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        parts = [chunk.strip() for chunk in forwarded.split(",") if chunk.strip()]
        if parts:
            if settings.trusted_proxies_count > 0:
                index = max(0, len(parts) - settings.trusted_proxies_count)
                return parts[index]
            if request.client and _is_loopback(request.client.host):
                return parts[-1]

    real_ip = request.headers.get("x-real-ip")
    if real_ip and request.client and _is_loopback(request.client.host):
        candidate = real_ip.strip()
        try:
            ipaddress.ip_address(candidate)
            return candidate
        except ValueError:
            pass
    return request.client.host if request.client else "unknown"


def _is_loopback(value: str) -> bool:
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


@lru_cache(maxsize=4)
def _load_networks(path_value: str) -> tuple[ipaddress.BaseNetwork, ...]:
    path = Path(path_value)
    if not path.is_file():
        logger.error("mainland_ip_list_missing", path=str(path))
        return ()
    networks: list[ipaddress.BaseNetwork] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value or value.startswith("#"):
            continue
        try:
            networks.append(ipaddress.ip_network(value, strict=False))
        except ValueError:
            logger.warning("mainland_ip_list_bad_entry", value=value[:80])
    logger.info("mainland_ip_list_loaded", path=str(path), count=len(networks))
    return tuple(networks)


def mainland_networks() -> tuple[ipaddress.BaseNetwork, ...]:
    path = settings.mainland_gate_ip_list_path.strip()
    return _load_networks(path or str(_DEFAULT_IP_LIST))


def is_mainland_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    # Do not block loopback/private addresses; those mean the proxy header
    # is missing, not that the visitor is in mainland China.
    if ip.is_private or ip.is_loopback or ip.is_reserved:
        return False
    return any(ip in network for network in mainland_networks())


def safe_next(value: str | None) -> str:
    """Only allow local absolute paths; prevent open redirects."""
    if not value:
        return "/"
    candidate = value.strip()
    if len(candidate) > 1024 or not candidate.startswith("/") or candidate.startswith("//"):
        return "/"
    if "\r" in candidate or "\n" in candidate:
        return "/"
    return candidate


def gate_page(*, next_path: str = "/", error: str = "", show_form: bool = True) -> str:
    error_html = f'<p class="error">{html.escape(error)}</p>' if error else ""
    form_html = (
        f"""
    <form method="post" action="{GATE_SUBMIT_PATH}">
      <input type="hidden" name="next" value="{html.escape(next_path, quote=True)}">
      <label for="gate-password">访问密码</label>
      <input id="gate-password" name="password" type="password"
             autocomplete="current-password" autofocus required>
      {error_html}
      <button type="submit">进入站点</button>
    </form>"""
        if show_form
        else error_html
    )
    return _GATE_TEMPLATE.substitute(
        next_path=html.escape(next_path, quote=True),
        form_html=form_html,
    )


_GATE_TEMPLATE = Template(
    """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>访问受限 · Rubbish</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: #f4f1e8;
    color: #1d1d1b;
    font-family: Georgia, "Noto Serif SC", "Songti SC", serif;
  }
  .card {
    width: min(100%, 480px);
    border-top: 3px solid #2f5d46;
    padding: 28px 28px 24px;
    background: rgba(255,255,255,.55);
    box-shadow: 0 18px 50px rgba(43,38,28,.08);
  }
  .mark {
    width: 42px; height: 42px;
    display: grid; place-items: center;
    border: 1px solid #2f5d46;
    border-radius: 50%;
    color: #2f5d46;
    font-size: 22px;
    font-weight: 700;
  }
  .kicker {
    margin: 18px 0 8px;
    color: #2f5d46;
    font: 600 10px/1.4 ui-monospace, monospace;
    letter-spacing: .22em;
  }
  h1 { margin: 0; font-size: clamp(24px, 5vw, 32px); line-height: 1.3; font-weight: 600; }
  .copy { margin: 14px 0 0; color: #5b574d; font-size: 14px; line-height: 1.9; }
  form { margin-top: 22px; }
  label { display: block; margin-bottom: 8px; font-size: 12px; color: #5b574d; }
  input {
    width: 100%;
    height: 44px;
    padding: 0 12px;
    border: 1px solid #cbc4b4;
    border-radius: 4px;
    background: #fffdf8;
    font: inherit;
    font-size: 15px;
  }
  input:focus { outline: 2px solid rgba(47,93,70,.28); border-color: #2f5d46; }
  button {
    width: 100%;
    height: 44px;
    margin-top: 12px;
    border: 0;
    border-radius: 4px;
    background: #2f5d46;
    color: #fff;
    font: 600 14px/1 ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }
  button:hover { background: #244a37; }
  .error { margin: 10px 0 0; color: #8a2f2f; font-size: 12px; line-height: 1.6; }
  .foot { margin: 22px 0 0; padding-top: 14px; border-top: 1px solid #ddd6c7; color: #777267; font-size: 11px; line-height: 1.8; }
</style>
</head>
<body>
  <main class="card">
    <div class="mark" aria-hidden="true">R</div>
    <p class="kicker">RUBBISH · ACCESS GATE</p>
    <h1>这里暂时不向该网络开放。</h1>
    <p class="copy">
      检测到你的网络出口位于中国大陆。本站目前不向该地区开放。如果你已获得站务授权，请输入访问密码。
    </p>
    $form_html
    <p class="foot">
      IP 归属按网络出口判断，可能因代理、VPN 或机房线路出现误判。
      如果你不在中国大陆却被拦下，请把出口 IP 发给站务核对。
    </p>
  </main>
</body>
</html>
"""
)


def gate_html_response(*, next_path: str, status_code: int = 403, error: str = "") -> HTMLResponse:
    return HTMLResponse(
        gate_page(next_path=next_path, error=error),
        status_code=status_code,
        headers={
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex, nofollow",
            "X-Content-Type-Options": "nosniff",
        },
    )


class MainlandGateMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if not settings.mainland_gate_enabled:
            return await call_next(request)

        path = request.url.path
        if path in GATE_ALLOWED_EXACT or any(path.startswith(p) for p in GATE_ALLOWED_PREFIXES):
            return await call_next(request)

        ip = client_ip(request)
        if not is_mainland_ip(ip) or has_valid_gate_cookie(request):
            return await call_next(request)

        next_path = path
        if request.url.query:
            next_path = f"{path}?{request.url.query}"

        if path.startswith("/api/"):
            return HTMLResponse(
                '{"detail":"mainland_gate_required","gate_url":"/gate"}',
                status_code=403,
                media_type="application/json",
                headers={"Cache-Control": "no-store"},
            )
        return gate_html_response(next_path=next_path)
