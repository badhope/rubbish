"""Token denylist for fine-grained refresh-token revocation.

Provides a Redis-backed denylist with in-memory fallback. Each entry is
keyed by the token's ``jti`` (JWT ID) and expires automatically when the
token would have expired, so the denylist never grows unbounded.

Design:
- **RedisTokenDenylist**: uses ``SET key 1 EX ttl`` so the Redis server
  auto-evicts expired entries. No cleanup job needed.
- **MemoryTokenDenylist**: uses an in-process dict with lazy cleanup of
  expired entries during ``add`` and ``is_denied``.
- **Fail-open**: if Redis is unreachable (or ``redis`` package is not
  installed), ``is_denied`` returns ``False`` and ``add`` logs a warning
  — the system degrades gracefully rather than rejecting valid tokens.
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

    Redis is imported lazily — if the ``redis`` package is not installed
    the class can still be instantiated and the factory will fall back to
    ``MemoryTokenDenylist`` on first use.
    """

    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url
        self._redis: object | None = None

    async def _get_redis(self) -> object:
        """Lazy-connect to Redis, importing the package on first use."""
        if self._redis is None:
            import redis.asyncio as aioredis

            self._redis = aioredis.from_url(
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
        except Exception:
            logger.warning(
                "redis_denylist_add_failed",
                jti=token_jti,
                exc_info=True,
            )

    async def is_denied(self, token_jti: str) -> bool:
        try:
            r = await self._get_redis()
            return (await r.exists(f"{_KEY_PREFIX}{token_jti}")) > 0  # type: ignore[attr-defined,no-any-return]
        except Exception:
            logger.warning(
                "redis_denylist_check_failed_falling_open",
                jti=token_jti,
                exc_info=True,
            )
            return False


_denylist: TokenDenylist | None = None
_denylist_lock = asyncio.Lock()


async def get_denylist() -> TokenDenylist:
    """Return the configured token denylist backend (singleton).

    Uses Redis if ``RUBBISH_REDIS_URL`` is configured, otherwise
    falls back to an in-memory denylist. If Redis is configured but
    the package is not installed or the connection fails, logs a
    warning and falls back to in-memory (fail-open).
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
            except ImportError:
                logger.warning(
                    "redis_package_not_installed_falling_back_to_memory",
                )
                _denylist = MemoryTokenDenylist()
                return _denylist

            try:
                candidate = RedisTokenDenylist(settings.redis_url)
                # Quick connectivity check — fail-fast if Redis is down.
                r = await candidate._get_redis()
                await r.ping()  # type: ignore[attr-defined]
                _denylist = candidate
                logger.info("token_denylist_using_redis")
            except Exception:
                logger.warning(
                    "redis_denylist_init_failed_falling_back_to_memory",
                    exc_info=True,
                )
                _denylist = MemoryTokenDenylist()
        else:
            _denylist = MemoryTokenDenylist()
            logger.info("token_denylist_using_memory")

        return _denylist


def reset_denylist() -> None:
    """Reset the global denylist singleton (for testing)."""
    global _denylist
    _denylist = None
