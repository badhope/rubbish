"""Tests for Prometheus metrics + the new healthz/readyz endpoints.

These tests verify:

- ``GET /metrics`` returns Prometheus text exposition with the expected
  metric names.
- ``GET /healthz`` and ``GET /readyz`` return 200 (DB reachable).
- ``HTTPMetricsMiddleware`` records a ``rubbish_http_requests_total``
  series for each request, labelled by the route template.
- Status bucketing works (404 鈫?``4xx``, 500 鈫?``5xx``).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_metrics_endpoint_returns_prometheus_text(client: AsyncClient) -> None:
    response = await client.get("/metrics")
    assert response.status_code == 200
    body = response.text
    # Standard Prometheus content type.
    assert "text/plain" in response.headers["content-type"]
    # Custom metrics present.
    assert "rubbish_http_requests_total" in body
    assert "rubbish_http_request_duration_seconds" in body
    # DB pool gauges registered (zero-valued but present).
    assert "rubbish_db_pool_size" in body


@pytest.mark.asyncio
async def test_metrics_records_request_after_call(client: AsyncClient) -> None:
    # Hit an endpoint that is always 200, then check the counter ticked.
    await client.get("/healthz")
    response = await client.get("/metrics")
    assert response.status_code == 200
    body = response.text
    # We expect at least one samples line for /healthz.
    assert 'path="/healthz"' in body or 'path="/healthz",status="2xx"' in body


@pytest.mark.asyncio
async def test_healthz_endpoint(client: AsyncClient) -> None:
    response = await client.get("/healthz")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert "version" in payload


@pytest.mark.asyncio
async def test_readyz_endpoint(client: AsyncClient) -> None:
    response = await client.get("/readyz")
    # Test DB is in-memory SQLite 鈥?always reachable.
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["database"] == "connected"


@pytest.mark.asyncio
async def test_legacy_health_aliases_still_work(client: AsyncClient) -> None:
    """The ``/api/health`` and ``/api/health/ready`` aliases must keep working."""
    r1 = await client.get("/api/health")
    assert r1.status_code == 200
    assert r1.json()["status"] == "ok"
    r2 = await client.get("/api/health/ready")
    assert r2.status_code == 200
    assert r2.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_metrics_status_bucketing_for_404(client: AsyncClient) -> None:
    """A 404 response should land in the ``4xx`` bucket."""
    await client.get("/this-path-does-not-exist")
    body = (await client.get("/metrics")).text
    assert 'status="4xx"' in body


@pytest.mark.asyncio
async def test_metrics_db_pool_gauges_present(client: AsyncClient) -> None:
    """DB pool gauges should be exposed even before any DB request."""
    body = (await client.get("/metrics")).text
    assert "rubbish_db_pool_checked_out" in body
    assert "rubbish_db_pool_overflow" in body
