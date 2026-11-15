"""Prometheus metrics + collection utilities.

Two kinds of metrics live here:

- **HTTP request metrics** (per-request Counter + Histogram).
  Updated by ``HTTPMetricsMiddleware`` (see ``app.middleware.metrics``).
- **Runtime gauges**: SQLAlchemy connection pool stats + process stats.
  Updated by ``update_runtime_metrics()`` called from a background
  loop driven by ``MetricsRefreshMiddleware`` (cheap + bounded).

Exposed at ``GET /metrics`` via ``app.api.metrics.router`` (text/plain
``CONTENT_TYPE_LATEST``). The endpoint is **not** rate-limited and
sits **inside** the tenant middleware so the request id is correlated
in logs.

Naming follows the official Prometheus best practices:
``<namespace>_<subsystem>_<metric>_<unit>``.
"""

from __future__ import annotations

from typing import Any

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
#
# Use a dedicated ``REGISTRY`` so unit tests can reset between runs without
# tripping the global ``prometheus_client.REGISTRY`` re-registration error
# ("Duplicated timeseries in CollectorRegistry").
REGISTRY = CollectorRegistry(auto_describe=True)


# ---------------------------------------------------------------------------
# HTTP request metrics
# ---------------------------------------------------------------------------

HTTP_REQUESTS_TOTAL = Counter(
    "rubbish_http_requests_total",
    "Total HTTP requests processed, labelled by method, path, and status class.",
    ["method", "path", "status"],
    registry=REGISTRY,
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "rubbish_http_request_duration_seconds",
    "HTTP request duration in seconds.",
    ["method", "path"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
    registry=REGISTRY,
)

HTTP_REQUESTS_IN_PROGRESS = Gauge(
    "rubbish_http_requests_in_progress",
    "HTTP requests currently being served.",
    ["method"],
    registry=REGISTRY,
)

# ---------------------------------------------------------------------------
# Runtime metrics
# ---------------------------------------------------------------------------

DB_POOL_SIZE = Gauge(
    "rubbish_db_pool_size",
    "SQLAlchemy engine connection pool size (current connections).",
    registry=REGISTRY,
)

DB_POOL_CHECKED_OUT = Gauge(
    "rubbish_db_pool_checked_out",
    "SQLAlchemy engine connections currently checked out.",
    registry=REGISTRY,
)

DB_POOL_OVERFLOW = Gauge(
    "rubbish_db_pool_overflow",
    "SQLAlchemy engine overflow connections beyond pool_size.",
    registry=REGISTRY,
)

RATE_LIMIT_REJECTIONS_TOTAL = Counter(
    "rubbish_rate_limit_rejections_total",
    "Number of requests rejected by the rate limiter.",
    ["path"],
    registry=REGISTRY,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _status_class(status_code: int) -> str:
    """Bucket status into 1xx/2xx/3xx/4xx/5xx so the cardinality stays bounded."""
    if status_code < 100:
        return "0xx"
    if status_code < 200:
        return "1xx"
    if status_code < 300:
        return "2xx"
    if status_code < 400:
        return "3xx"
    if status_code < 500:
        return "4xx"
    return "5xx"


def observe_request(
    method: str,
    path: str,
    status_code: int,
    duration_seconds: float,
) -> None:
    """Record one HTTP request's metrics.

    ``path`` should be the **template** path (e.g. ``/api/users/{id}``),
    not the raw URL, to keep cardinality bounded. The middleware is
    responsible for template substitution.
    """
    HTTP_REQUESTS_TOTAL.labels(method=method, path=path, status=_status_class(status_code)).inc()
    HTTP_REQUEST_DURATION_SECONDS.labels(method=method, path=path).observe(duration_seconds)


def inc_rate_limit_rejection(path: str) -> None:
    """Record one request rejected by the rate limiter, labelled by ``path``."""
    RATE_LIMIT_REJECTIONS_TOTAL.labels(path=path).inc()


def update_db_pool_metrics(engine: Any) -> None:
    """Refresh DB connection-pool gauges. Safe to call from any context.

    ``engine`` is typed as ``Any`` to avoid pulling SQLAlchemy into the
    module-level imports. ``pool`` is a public attribute on every SA
    engine.
    """
    pool = getattr(engine, "pool", None)
    if pool is None:
        return
    size = getattr(pool, "size", lambda: 0)()
    checked = getattr(pool, "checkedout", lambda: 0)()
    overflow = getattr(pool, "overflow", lambda: 0)()
    DB_POOL_SIZE.set(size() if callable(size) else size)
    DB_POOL_CHECKED_OUT.set(checked() if callable(checked) else checked)
    DB_POOL_OVERFLOW.set(overflow() if callable(overflow) else overflow)


def render_metrics() -> tuple[bytes, str]:
    """Return ``(body, content_type)`` for the ``/metrics`` endpoint."""
    return generate_latest(REGISTRY), CONTENT_TYPE_LATEST


__all__ = [
    "DB_POOL_CHECKED_OUT",
    "DB_POOL_OVERFLOW",
    "DB_POOL_SIZE",
    "HTTP_REQUESTS_IN_PROGRESS",
    "HTTP_REQUESTS_TOTAL",
    "HTTP_REQUEST_DURATION_SECONDS",
    "RATE_LIMIT_REJECTIONS_TOTAL",
    "REGISTRY",
    "inc_rate_limit_rejection",
    "observe_request",
    "render_metrics",
    "update_db_pool_metrics",
]
