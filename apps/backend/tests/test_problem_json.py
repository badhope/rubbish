"""RFC 7807 problem+json envelope tests."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_validation_error_returns_problem_json(
    client: AsyncClient,
) -> None:
    r = await client.post(
        "/api/auth/register",
        json={"email": "bad", "username": "x", "password": "1"},
    )
    assert r.status_code == 422
    assert r.headers["content-type"].startswith("application/problem+json")
    body = r.json()
    assert body["status"] == 422
    assert body["title"] == "Validation error"
    assert body["type"].startswith("https://")
    assert body["instance"] == "/api/auth/register"
    # Legacy ``detail`` key still present so old clients keep working.
    assert "detail" in body
    # Per-field errors are still nested under ``errors``.
    assert isinstance(body["errors"], list) and body["errors"]
    # trace_id is the request id from contextvars (any non-empty string).
    assert body["trace_id"]


@pytest.mark.asyncio
async def test_http_exception_returns_problem_json(
    client: AsyncClient,
) -> None:
    r = await client.get("/api/auth/me")
    assert r.status_code == 401
    assert r.headers["content-type"].startswith("application/problem+json")
    body = r.json()
    assert body["status"] == 401
    assert body["type"].endswith("/http-401")
    assert body["title"] == "HTTP error"
    assert body["detail"]
    assert body["trace_id"]


@pytest.mark.asyncio
async def test_problem_json_has_trace_id_matching_request(
    client: AsyncClient,
) -> None:
    """If a header is set that propagates request_id, the body echoes it."""
    r = await client.post(
        "/api/auth/register",
        json={"email": "bad", "username": "x", "password": "1"},
        headers={"X-Request-ID": "test-request-id-abc"},
    )
    assert r.status_code == 422
    assert r.json()["trace_id"] == "test-request-id-abc"
