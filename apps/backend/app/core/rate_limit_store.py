"""Rate limiter store abstraction (M4 hardening).

The middleware in ``app.middleware.rate_limit`` delegates bucket
storage to a ``RateLimiterStore``. Two implementations are shipped:

- ``MemoryRateLimiterStore``: in-process sliding window. Default
  when ``SCHOLARHUB_REDIS_URL`` is empty. Fine for single-node
  deployments; loses state on restart; not safe across replicas.
- ``RedisRateLimiterStore``: uses Redis sorted sets with a fixed
  time window, atomic via Lua. Falls back to the memory store when
  Redis is unreachable so a Redis outage never denies legitimate
  traffic (fail-open for the limiter, fail-closed for the bucket —
  i.e. if Redis is down the limiter behaves as it did before M4).

The store protocol is intentionally tiny — just ``hit_and_check``
returning whether the request is allowed and the current bucket
depth. Tests in ``test_rate_limit_store.py`` cover both backends.

Why Redis instead of in-memory as the recommended default: most
production deployments run at least two replicas behind a load
balancer, and per-IP limits that count only on the local replica
are effectively halved (or worse) compared to the configured limit.
Redis is the cheapest way to keep the limit global.
"""

from __future__ import annotations

import math
import time
from collections import defaultdict
from typing import Any

from app.core.logging import get_logger

logger = get_logger("scholarhub.rate_limit_store")

# How long the breaker stays open after a Redis failure. While the
# cooldown is running, buckets are served from the memory fallback
# without re-hammering the dead server; the first request after it
# elapses probes Redis again.
_REDIS_RECOVERY_COOLDOWN_SECONDS = 5.0


class RateLimiterStore:
    """Async store interface for per-key rate-limit buckets."""

    async def hit_and_check(
        self,
        *,
        bucket_key: str,
        limit: int,
        window_seconds: float,
    ) -> tuple[bool, int]:
        """Record one hit and return ``(allowed, current_depth)``.

        ``allowed`` is False when the bucket has already accumulated
        ``limit`` or more hits in the trailing ``window_seconds``.
        ``current_depth`` is the depth AFTER this hit was recorded,
        so an over-limit response can be served with a Retry-After
        derived from the oldest entry.
        """
        raise NotImplementedError


class MemoryRateLimiterStore(RateLimiterStore):
    """In-process sliding window keyed by ``bucket_key``."""

    # Opportunistic full-graph sweep cadence: at most one sweep per
    # interval, run inside hit_and_check (which is a synchronous
    # section of the event loop, so no lock is needed).
    _SWEEP_INTERVAL_SECONDS = 60.0
    # A bucket whose newest entry is older than this is dead weight:
    # no configured window comes close to 10 minutes, so nothing live
    # can ever be collected early.
    _MAX_BUCKET_AGE_SECONDS = 600.0

    def __init__(self) -> None:
        # key -> sorted list of monotonic timestamps (oldest first)
        self._buckets: dict[str, list[float]] = defaultdict(list)
        self._last_sweep: float = time.monotonic()

    async def hit_and_check(
        self,
        *,
        bucket_key: str,
        limit: int,
        window_seconds: float,
    ) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - window_seconds
        # Reap buckets from IPs that never came back before touching
        # the defaultdict (otherwise every unique (ip, bucket) pair
        # ever seen stays resident forever).
        self._maybe_sweep(now)
        bucket = self._buckets[bucket_key]
        # Drop expired entries. We rebuild the list to keep order and
        # avoid unbounded growth (a busy key would otherwise keep every
        # timestamp from process start).
        fresh = [ts for ts in bucket if ts > cutoff]
        current_depth = len(fresh)
        # Decide first, then record. A denied request is NOT added to
        # the bucket — otherwise an attacker that hammers the endpoint
        # would keep extending their own lockout window indefinitely
        # (depth grows but never decays because every rejected hit
        # refreshes the timestamps).
        if current_depth >= limit:
            self._buckets[bucket_key] = fresh
            return (False, current_depth)
        fresh.append(now)
        self._buckets[bucket_key] = fresh
        return (True, current_depth + 1)

    def _maybe_sweep(self, now: float) -> None:
        """At most every ``_SWEEP_INTERVAL_SECONDS``, delete buckets
        whose newest entry has aged past ``_MAX_BUCKET_AGE_SECONDS``."""
        if now - self._last_sweep < self._SWEEP_INTERVAL_SECONDS:
            return
        self._last_sweep = now
        horizon = now - self._MAX_BUCKET_AGE_SECONDS
        # List entries are appended in monotonic order, so the last
        # element is the newest.
        stale = [key for key, hits in self._buckets.items() if not hits or hits[-1] <= horizon]
        for key in stale:
            del self._buckets[key]


class RedisRateLimiterStore(RateLimiterStore):
    """Redis-backed fixed-window limiter using atomic Lua.

    Algorithm: for every hit we ZADD a unique member into a sorted
    set keyed by ``bucket_key`` with score = current epoch ms. We
    then ZREMRANGEBYSCORE to drop entries older than the window,
    ZCARD to read the current depth, and PEXPIRE to refresh the
    key's TTL so unused buckets are reclaimed. All four operations
    run inside a single Lua script so the bucket depth seen by
    concurrent callers is consistent.

    Failure mode: if the Redis call raises, we log a warning and
    fall back to an ``allow=True`` result (i.e. **fail-open**).
    Rationale: the rate limiter is a defence-in-depth control; if
    Redis is down we would rather let traffic through and risk a
    brief burst than 503 the entire API. The strict-path limits
    (login, register, etc.) remain in the memory fallback so an
    attacker cannot overwhelm the auth surface during a Redis
    outage either.

    The breaker is *timed*, not permanent: after an outage the
    next request inside a short cooldown still goes to the memory
    fallback, but once the cooldown has elapsed a single request
    probes Redis again and — if it succeeds — silently re-arms the
    Redis path. Without that probe a recovered Redis would never
    be used again for the life of the process (the limiter would
    degrade to per-replica counting forever, defeating the point
    of the shared store).
    """

    # KEYS[1] = bucket key
    # ARGV[1] = now_ms (int)
    # ARGV[2] = window_ms (int)
    # ARGV[3] = limit (int)
    # ARGV[4] = unique member (string)
    #
    # Returns {allowed (0/1), depth_after (int)}.
    _LUA_SCRIPT = """
        local key = KEYS[1]
        local now_ms = tonumber(ARGV[1])
        local window_ms = tonumber(ARGV[2])
        local limit = tonumber(ARGV[3])
        local member = ARGV[4]
        local cutoff = now_ms - window_ms
        redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
        local depth = tonumber(redis.call('ZCARD', key))
        local allowed = 0
        if depth < limit then
            redis.call('ZADD', key, now_ms, member)
            depth = depth + 1
            allowed = 1
        end
        -- TTL = window + 1s so an idle bucket is reclaimed by Redis
        redis.call('PEXPIRE', key, window_ms + 1000)
        return {allowed, depth}
    """

    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url
        self._client: Any | None = None  # lazy-init: keep import cheap when unused
        self._script_sha: str | None = None
        self._memory_fallback = MemoryRateLimiterStore()
        self._redis_failed = False  # circuit-breaker hint
        # Monotonic deadline before which the breaker stays open and
        # requests keep using the memory fallback; the first request
        # after it probes Redis again.
        self._redis_retry_at: float = 0.0

    async def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        # Imported lazily so production builds without redis still
        # import-time (we don't want a hard dep on redis-py).
        try:
            import redis.asyncio as redis_async
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "redis package is required for RedisRateLimiterStore; "
                "install with `pip install redis>=5`."
            ) from exc
        self._client = redis_async.from_url(
            self._redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_timeout=1.0,
            socket_connect_timeout=1.0,
        )
        return self._client

    async def hit_and_check(
        self,
        *,
        bucket_key: str,
        limit: int,
        window_seconds: float,
    ) -> tuple[bool, int]:
        now = time.monotonic()
        if self._redis_failed and now < self._redis_retry_at:
            # Circuit-breaker open: serve from memory until the cooldown
            # elapses instead of retrying every request against a dead
            # server. The first request after the cooldown falls through
            # and probes Redis again.
            return await self._memory_fallback.hit_and_check(
                bucket_key=bucket_key,
                limit=limit,
                window_seconds=window_seconds,
            )
        try:
            client = await self._get_client()
            now_ms = int(time.time() * 1000)
            window_ms = max(1, math.ceil(window_seconds * 1000))
            # Unique member so two hits in the same millisecond don't
            # collide and get deduplicated by ZADD.
            member = f"{now_ms}:{id(self)}:{time.monotonic_ns()}"
            sha = await self._ensure_script_loaded(client)
            try:
                result = await client.evalsha(sha, 1, bucket_key, now_ms, window_ms, limit, member)
            except Exception as exc:  # NOSCRIPT -> reload script once
                if "NOSCRIPT" in str(exc):
                    self._script_sha = None
                    sha = await self._ensure_script_loaded(client)
                    result = await client.evalsha(
                        sha, 1, bucket_key, now_ms, window_ms, limit, member
                    )
                else:
                    raise
            allowed_flag, depth = result
            # Probe succeeded: re-arm the Redis path for good.
            self._redis_failed = False
            return (bool(int(allowed_flag)), int(depth))
        except Exception as exc:
            # Fail-open: log + fall back to memory. The breaker opens
            # for the cooldown; when it expires a request probes Redis
            # again and, on success, re-arms the path above.
            if not self._redis_failed:
                logger.warning(
                    "rate_limit_redis_unavailable_falling_back_to_memory",
                    error=str(exc),
                )
            self._redis_failed = True
            self._redis_retry_at = now + _REDIS_RECOVERY_COOLDOWN_SECONDS
            return await self._memory_fallback.hit_and_check(
                bucket_key=bucket_key,
                limit=limit,
                window_seconds=window_seconds,
            )

    async def _ensure_script_loaded(self, client: Any) -> str:
        if self._script_sha is not None:
            return self._script_sha
        self._script_sha = await client.script_load(self._LUA_SCRIPT)
        return self._script_sha

    async def aclose(self) -> None:
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:  # pragma: no cover
                # Best-effort shutdown: a failed disconnect must not mask the
                # original error, but we still want a trace in debug logs.
                logger.debug("rate_limit_store_close_failed", exc_info=True)
            self._client = None


_store: RateLimiterStore | None = None


def get_rate_limiter_store() -> RateLimiterStore:
    """Return the process-wide rate limiter store.

    Selection:
    - If ``SCHOLARHUB_REDIS_URL`` is non-empty, return a
      ``RedisRateLimiterStore``.
    - Otherwise return an in-process ``MemoryRateLimiterStore``.

    The choice is made once per process; rotating from memory to
    Redis requires a restart. We deliberately do NOT pick the
    store at request time because building the Redis client is
    expensive and we don't want to do it on every request.
    """
    global _store
    if _store is not None:
        return _store
    from app.core.config import settings

    if settings.redis_url:
        _store = RedisRateLimiterStore(settings.redis_url)
    else:
        _store = MemoryRateLimiterStore()
    return _store


async def close_rate_limiter_store() -> None:
    """Release the Redis client (called from FastAPI lifespan teardown)."""
    global _store
    if _store is not None and isinstance(_store, RedisRateLimiterStore):
        await _store.aclose()
    _store = None


__all__ = [
    "MemoryRateLimiterStore",
    "RateLimiterStore",
    "RedisRateLimiterStore",
    "close_rate_limiter_store",
    "get_rate_limiter_store",
]
