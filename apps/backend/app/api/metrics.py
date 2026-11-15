"""Prometheus metrics endpoint.

Exposes ``GET /metrics`` returning the standard ``text/plain; version=0.0.4``
Prometheus exposition format.

The endpoint is **public** (no auth, no rate limit) because Prometheus
scrapers don't authenticate. If you front the deployment with a private
network, that's enough; otherwise place behind an nginx basic-auth or
similar.

Cardinality is bounded by:

- HTTP path is the **template** (e.g. ``/api/users/{user_id}``), never
  the raw URL.
- Status is bucketed to 1xx..5xx.
- No per-tenant or per-user labels (those go to the structured logs).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response, status

from app.core.config import settings
from app.core.metrics import render_metrics

router = APIRouter(tags=["observability"])


@router.get(
    "/metrics",
    include_in_schema=False,
    response_class=Response,
)
async def metrics() -> Response:
    """Return current Prometheus metrics snapshot.

    Disabled by default: the exposition contains every route template and
    traffic volume, which is useful to an attacker mapping the deployment.
    Tests keep access so the metrics pipeline itself stays covered.
    """
    if not settings.metrics_public and not settings.is_test:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    body, content_type = render_metrics()
    return Response(content=body, media_type=content_type)


__all__ = ["router"]
