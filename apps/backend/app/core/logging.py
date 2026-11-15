"""Structured logging via structlog.

Production emits JSON lines for aggregation; development emits colored
console output. The request id from ``app.core.tenant.REQUEST_ID_CTX`` is
auto-injected into every log record via ``bind_contextvars``.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog
from structlog.contextvars import merge_contextvars

from app.core.config import settings


def configure_logging() -> None:
    """Configure root logging + structlog processors.

    Must be called once at application startup (before any handler emits).
    """
    level = settings.log_level.upper()

    # Stdlib root logger — capture everything structlog hands downstream.
    root = logging.getLogger()
    root.setLevel(level)
    # Remove pre-existing handlers (uvicorn default) to avoid duplicates.
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    root.addHandler(handler)

    shared_processors: list[Any] = [
        merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if settings.json_logs:
        renderer: Any = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=not settings.is_test)

    structlog.configure(
        processors=[*shared_processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level)),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Silence overly chatty third-party loggers in production.
    if settings.is_production:
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def get_logger(name: str) -> Any:
    """Return a bound structlog logger.

    structlog's BoundLogger typing is complex; we return Any to keep mypy
    strict mode happy without forcing callers into verbose casts.
    """
    return structlog.get_logger(name)
