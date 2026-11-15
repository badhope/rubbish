"""Shared timezone-aware "now" helper.

Every model ``default=`` and every route that needs the current time
goes through :func:`utcnow`, so tests / future migrations have a single
point to mock or adjust (e.g. clock skew, monotonic clock).
"""

from __future__ import annotations

from datetime import UTC, datetime


def utcnow() -> datetime:
    """Current time as a timezone-aware datetime in UTC."""
    return datetime.now(UTC)


__all__ = ["utcnow"]
