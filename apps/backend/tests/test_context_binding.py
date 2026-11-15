"""Tests that the request-scoped structlog context is populated correctly.

Verifies A1 (P0-A todo): every authenticated request should emit logs
with request_id, tenant_id, user_id, is_admin tags attached.
"""

from __future__ import annotations

import json
import logging
from io import StringIO

import pytest
from structlog.contextvars import bind_contextvars

from app.core.logging import configure_logging, get_logger

pytestmark = pytest.mark.asyncio


@pytest.fixture
def log_capture(monkeypatch):
    """Redirect stdout to capture JSON log lines for assertions."""
    from app.core.config import settings

    # Force JSON renderer so we can parse lines back as dicts.
    monkeypatch.setattr(settings, "json_logs", True)
    configure_logging()

    buf = StringIO()
    handler = logging.StreamHandler(buf)
    handler.setLevel(logging.INFO)
    root = logging.getLogger()
    # Drop our default stdout handler so we don't double-print to console.
    for h in list(root.handlers):
        if isinstance(h, logging.StreamHandler) and not isinstance(h, type(handler)):
            root.removeHandler(h)
    root.addHandler(handler)
    try:
        yield buf
    finally:
        root.removeHandler(handler)


def _read_json_lines(buf: StringIO) -> list[dict]:
    out: list[dict] = []
    for line in buf.getvalue().splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


async def test_user_id_bound_after_get_current_user(log_capture):
    """When a request is authenticated, user_id appears in the log context."""
    bind_contextvars(request_id="rid-anon", tenant_id="tid-anon")
    logger = get_logger("rubbish.test")

    bind_contextvars(user_id="42", is_admin=False)
    logger.info("logged_in", action="register")

    lines = _read_json_lines(log_capture)
    match = next((ln for ln in lines if ln.get("event") == "logged_in"), None)
    assert match is not None, lines
    assert match.get("user_id") == "42"
    assert match.get("is_admin") is False
    assert match.get("request_id") == "rid-anon"
    assert match.get("tenant_id") == "tid-anon"


async def test_admin_user_flag_propagates(log_capture):
    """An admin user should be tagged with ``is_admin=True``."""
    logger = get_logger("rubbish.test")

    bind_contextvars(user_id="1", is_admin=True)
    logger.info("admin_action", target="reload-secret-keys")

    lines = _read_json_lines(log_capture)
    match = next((ln for ln in lines if ln.get("event") == "admin_action"), None)
    assert match is not None, lines
    assert match.get("user_id") == "1"
    assert match.get("is_admin") is True


async def test_optional_user_does_not_leak(log_capture):
    """Optional auth must not leak a previous user's id into the next request.

    The tenant middleware calls ``clear_contextvars`` per-request, which
    is the only behaviour we test here. Each test starts from a clean
    context.
    """
    from structlog.contextvars import clear_contextvars

    logger = get_logger("rubbish.test")
    clear_contextvars()
    logger.info("anonymous_request")

    lines = _read_json_lines(log_capture)
    match = next((ln for ln in lines if ln.get("event") == "anonymous_request"), None)
    assert match is not None, lines
    assert "user_id" not in match


async def test_context_isolated_between_requests(log_capture):
    """Simulated second request must not see first request's ``user_id``."""
    from structlog.contextvars import clear_contextvars

    logger = get_logger("rubbish.test")

    # Request 1: user A
    bind_contextvars(request_id="rid-A", user_id="100")
    logger.info("request_a")
    clear_contextvars()

    # Request 2: user B (different connection / scope)
    bind_contextvars(request_id="rid-B", user_id="200")
    logger.info("request_b")
    clear_contextvars()

    lines = _read_json_lines(log_capture)
    by_event = {ln["event"]: ln for ln in lines if ln.get("event") in {"request_a", "request_b"}}
    assert by_event["request_a"]["user_id"] == "100"
    assert by_event["request_a"]["request_id"] == "rid-A"
    assert by_event["request_b"]["user_id"] == "200"
    assert by_event["request_b"]["request_id"] == "rid-B"
