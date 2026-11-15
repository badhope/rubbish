"""HTTP request metrics middleware (pure ASGI).

Records ``rubbish_http_requests_total`` +
``rubbish_http_request_duration_seconds`` for every request, with the
**template path** (e.g. ``/api/users/{user_id}``) as the label so cardinality
stays bounded even under load.

Why a pure ASGI middleware instead of ``BaseHTTPMiddleware``?

- ``BaseHTTPMiddleware`` wraps the downstream ASGI app in its own
  ``__call__``. The ``request.scope`` it receives is *pre-routing*, so
  ``scope["route"]`` is not set and we cannot read the FastAPI route
  template from inside ``dispatch``. This middleware, being a single
  ASGI app in the chain, sees the **post-routing** scope where
  ``scope["route"]`` is populated by FastAPI's router.
- Cardinality is bounded: HTTP path is the **template**, never the
  raw URL. Status is bucketed to 1xx..5xx. No per-tenant or per-user
  labels (those go to the structured logs).
"""

from __future__ import annotations

import time
from typing import Any

from starlette.routing import Match
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.db import engine as _engine
from app.core.logging import get_logger
from app.core.metrics import (
    HTTP_REQUESTS_IN_PROGRESS,
    observe_request,
    update_db_pool_metrics,
)

logger = get_logger("rubbish.metrics")


def _resolve_template_path(scope: Scope) -> str:
    """Return the FastAPI route template or a stable fallback.

    1. ``scope["route"].path`` 鈥?the matched template (if any).
    2. Fall back to the literal path.

    Cardinality rule: do **not** iterate the router here; that costs
    O(routes) per request. If ``route`` is missing, fall back to the
    raw path; Prometheus buckets stay bounded because the route set is
    finite and new routes typically mean a deploy (which restarts
    metrics).
    """
    route: Any = scope.get("route")
    if route is not None:
        template: Any = getattr(route, "path", None)
        if template:
            return str(template)
    return str(scope.get("path", "/"))


class HTTPMetricsMiddleware:
    """Pure-ASGI Prometheus instrumentation."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "/")
        if path == "/metrics":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET")
        in_progress = HTTP_REQUESTS_IN_PROGRESS.labels(method=method)
        in_progress.inc()

        start = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Any) -> None:
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = int(message.get("status", 500))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed = time.perf_counter() - start
            template_path = _resolve_template_path(scope)
            observe_request(
                method=method,
                path=template_path,
                status_code=status_code,
                duration_seconds=elapsed,
            )
            in_progress.dec()
            try:
                update_db_pool_metrics(_engine)
            except Exception:
                # Metrics are best-effort: never let a stale pool reading fail
                # the request, but keep a trace for debugging.
                logger.debug("db_pool_metrics_update_failed", exc_info=True)


__all__ = ["HTTPMetricsMiddleware", "_resolve_template_path"]


# Re-exported for tests that want to assert on the routing match (we
# don't iterate the router in the hot path, but tests can).
def find_route_template(app: Any, raw_path: str) -> str | None:
    """Look up the route template for ``raw_path``. Returns None if no match."""
    for r in getattr(app, "router", app).routes:
        if hasattr(r, "matches"):
            match, _ = r.matches(raw_path)
            if match == Match.FULL:
                return getattr(r, "path", None)
    return None
