"""Token denylist for fine-grained refresh-token revocation.

Provides a Redis-backed denylist with an in-memory backend for dev/test.
Each entry is keyed by the token's ``jti`` (JWT ID) and expires
automatically when the token would have expired, so the denylist never
grows unbounded.

Design:
- **RedisTokenDenylist**: uses ``SET key 1 EX ttl`` so the Redis server
  auto-evicts expired entries. No cleanup job needed.
- **MemoryTokenDenylist**: uses an in-process dict with lazy cleanup of
  expired entries during ``add`` and ``is_denied``. Only selected when
  ``RUBBISH_REDIS_URL`` is empty (single-process dev/test).
- **Fail-closed**: if Redis is configured but unreachable, ``is_denied``
  and ``add`` raise ``DenylistUnavailableError`` rather than silently
  letting a revoked token through. Callers translate this into HTTP 503
  so a revocation outage is distinguishable from a genuine 401. The
  Redis client reconnects per-command, so the backend self-heals once
  Redis returns; we never permanently cache an in-memory fallback when
  Redis was requested (that would accept revoked tokens for the rest of
  the process lifetime).
"""

from __future__ import annotations

import asyncio
import time
from typing import Protocol

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("rubbish.token_denylist")

# Redis key prefix to namespace denylist entries within a shared Redis.
_KEY_PREFIX = "token_denylist:"


class DenylistUnavailableError(RuntimeError):
    """The revocation backend could not be reached or is misconfigured.

    Raised by ``RedisTokenDenylist`` (and the factory on a missing
    package) so auth callers can fail closed with HTTP 503 instead of
    treating an outage as "token not revoked".
    """


class TokenDenylist(Protocol):
    """Interface for token denylist backends."""

    async def add(self, token_jti: str, expires_at: float) -> None:
        """Add a token JTI to the denylist.

        Args:
            token_jti: The JWT ID of the token to revoke.
            expires_at: Unix timestamp (``exp`` claim) when the token
                would have naturally expired. The denylist entry is
                TTL'd to this value.
        """
        ...

    async def is_denied(self, token_jti: str) -> bool:
        """Return ``True`` if the token JTI is currently in the denylist."""
        ...


class MemoryTokenDenylist:
    """In-memory denylist with lazy expiration cleanup.

    Suitable for single-process deployments and development. Expired
    entries are pruned on every ``add`` and ``is_denied`` call so the
    dict stays bounded over time.
    """

    def __init__(self) -> None:
        self._denied: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def add(self, token_jti: str, expires_at: float) -> None:
        async with self._lock:
            self._denied[token_jti] = expires_at
            self._cleanup_expired()

    async def is_denied(self, token_jti: str) -> bool:
        async with self._lock:
            if token_jti not in self._denied:
                return False
            expires_at = self._denied[token_jti]
            if time.time() >= expires_at:
                del self._denied[token_jti]
                return False
            return True

    def _cleanup_expired(self) -> None:
        """Remove every entry whose TTL has passed."""
        now = time.time()
        expired = [jti for jti, exp in self._denied.items() if now >= exp]
        for jti in expired:
            del self._denied[jti]


class RedisTokenDenylist:
    """Redis-backed denylist using ``SET`` with ``EX`` (TTL seconds).

    Redis is imported lazily. If the package is missing the factory
    raises ``DenylistUnavailableError`` (a configuration error must not
    silently degrade to memory). Connection failures surface as
    ``DenylistUnavailableError`` per call; the underlying client
    reconnects automatically, so the backend self-heals.
    """

    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url
        self._redis: object | None = None

    async def _get_redis(self) -> object:
        """Lazy-connect to Redis, importing the package on first use."""
        if self._redis is None:
            import redis.asyncio as aioredis

            self._redis = aioredis.from_url(  # type: ignore[no-untyped-call]
                self._redis_url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        return self._redis

    async def add(self, token_jti: str, expires_at: float) -> None:
        ttl = max(1, int(expires_at - time.time()))
        try:
            r = await self._get_redis()
            await r.set(f"{_KEY_PREFIX}{token_jti}", "1", ex=ttl)  # type: ignore[attr-defined]
        except Exception as exc:
            logger.warning(
                "redis_denylist_add_failed",
                jti=token_jti,
                exc_info=True,
            )
            raise DenylistUnavailableError("Token denylist unavailable") from exc

    async def is_denied(self, token_jti: str) -> bool:
        try:
            r = await self._get_redis()
            return (await r.exists(f"{_KEY_PREFIX}{token_jti}")) > 0  # type: ignore[attr-defined,no-any-return]
        except Exception as exc:
            logger.warning(
                "redis_denylist_check_failed_failing_closed",
                jti=token_jti,
                exc_info=True,
            )
            raise DenylistUnavailableError("Token denylist unavailable") from exc


_denylist: TokenDenylist | None = None
_denylist_lock = asyncio.Lock()


async def get_denylist() -> TokenDenylist:
    """Return the configured token denylist backend (singleton).

    Uses Redis when ``RUBBISH_REDIS_URL`` is set, otherwise an in-memory
    denylist (dev/test/single-process). Fail-closed: a missing ``redis``
    package raises ``DenylistUnavailableError`` rather than silently
    downgrading. A failed connectivity probe does NOT fall back to
    memory — the Redis client is installed anyway and reconnects
    per-command, so individual calls fail closed (503) during an outage
    and recover automatically once Redis is back.
    """
    global _denylist

    if _denylist is not None:
        return _denylist

    async with _denylist_lock:
        if _denylist is not None:
            return _denylist

        if settings.redis_url:
            try:
                import redis.asyncio  # noqa: F401 — verify package is importable
            except ImportError as exc:
                logger.error("redis_package_not_installed", exc_info=True)
                raise DenylistUnavailableError(
                    "RUBBISH_REDIS_URL is set but the redis package is not installed"
                ) from exc

            candidate = RedisTokenDenylist(settings.redis_url)
            # Best-effort probe. A failure here is logged but we still
            # install the Redis client: caching a Memory denylist would
            # accept revoked tokens for the rest of the process lifetime.
            try:
                r = await candidate._get_redis()
                await r.ping()  # type: ignore[attr-defined]
                logger.info("token_denylist_using_redis")
            except Exception:
                logger.warning(
                    "redis_denylist_init_probe_failed_fail_closed",
                    exc_info=True,
                )
            _denylist = candidate
        else:
            _denylist = MemoryTokenDenylist()
            logger.info("token_denylist_using_memory")

        return _denylist


def reset_denylist() -> None:
    """Reset the global denylist singleton (for testing)."""
    global _denylist
    _denylist = None
