"""Sentry error monitoring bootstrap (optional).

Design goals:

* **Zero cost when disabled** — if ``RUBBISH_SENTRY_DSN`` is empty the
  SDK is never imported. Self-hosters who don't want a third-party
  monitoring service pay nothing (no import time, no runtime hooks).
* **Graceful degradation** — a missing ``sentry-sdk`` package or a bad
  DSN logs a warning and the app keeps running. Monitoring must never
  take the service down.
* **Privacy first** — ``send_default_pii`` defaults to False because
  academic submissions carry unpublished manuscripts and (blind) reviewer
  identities.

The FastAPI/SQLAlchemy/asyncio integrations are enabled automatically by
``sentry_sdk.init`` through its auto-enabling integration mechanism, so
we don't need to list them explicitly.
"""

from __future__ import annotations

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("rubbish.monitoring")


def init_monitoring() -> bool:
    """Initialise Sentry if a DSN is configured.

    Returns True when monitoring is active, False otherwise.
    """
    if not settings.sentry_dsn:
        return False

    try:
        import sentry_sdk
    except ImportError:
        logger.warning(
            "sentry_dsn_configured_but_sdk_missing",
            hint="run: uv add sentry-sdk[fastapi]",
        )
        return False

    try:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.environment,
            release=_release(),
            traces_sample_rate=settings.sentry_traces_sample_rate,
            profiles_sample_rate=settings.sentry_profiles_sample_rate,
            send_default_pii=settings.sentry_send_default_pii,
        )
    except Exception as exc:
        logger.warning("sentry_init_failed", error=str(exc))
        return False

    logger.info("sentry_initialized", environment=settings.environment)
    return True


def _release() -> str:
    from app import __version__

    return f"rubbish-backend@{__version__}"
