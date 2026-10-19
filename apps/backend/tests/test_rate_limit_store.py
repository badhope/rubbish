"""Tests for the rate-limiter store abstraction (M4 hardening).

Covers:
- ``MemoryRateLimiterStore`` sliding-window semantics: under the
  limit, at the limit (last hit denied), over the limit (denied),
  recovery after the window slides forward.
- The store exposes the same interface to the middleware regardless
  of backend (memory vs. Redis).
- Redis backend is selected when ``settings.redis_url`` is set.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app.core.rate_limit_store import (
    MemoryRateLimiterStore,
    RateLimiterStore,
    RedisRateLimiterStore,
    get_rate_limiter_store,
)


@pytest.fixture
def memory_store() -> MemoryRateLimiterStore:
    return MemoryRateLimiterStore()


async def test_allows_under_limit(memory_store):
    for _ in range(5):
        allowed, depth = await memory_store.hit_and_check(
            bucket_key="ip1|/api/auth/login",
            limit=10,
            window_seconds=60.0,
        )
        assert allowed is True
    # Final depth is 5.
    allowed, depth = await memory_store.hit_and_check(
        bucket_key="ip1|/api/auth/login",
        limit=10,
        window_seconds=60.0,
    )
    assert allowed is True
    assert depth == 6


async def test_denies_over_limit(memory_store):
    # Fill up to the limit (5 hits, all allowed, depth 5).
    for _ in range(5):
        allowed, _ = await memory_store.hit_and_check(
            bucket_key="ip1|/api/auth/login",
            limit=5,
            window_seconds=60.0,
        )
        assert allowed is True
    # 6th hit: bucket is full, must be denied, depth still 5.
    allowed, depth = await memory_store.hit_and_check(
        bucket_key="ip1|/api/auth/login",
        limit=5,
        window_seconds=60.0,
    )
    assert allowed is False
    assert depth == 5


async def test_window_recovery(memory_store):
    """After the window slides forward, denied hits become allowed again."""
    # Window of 1 second, fill it up.
    for _ in range(3):
        allowed, _ = await memory_store.hit_and_check(
            bucket_key="ip1|x",
            limit=3,
            window_seconds=1.0,
        )
        assert allowed is True
    allowed, _ = await memory_store.hit_and_check(bucket_key="ip1|x", limit=3, window_seconds=1.0)
    assert allowed is False

    # Wait out the window.
    await asyncio.sleep(1.1)

    allowed, depth = await memory_store.hit_and_check(
        bucket_key="ip1|x", limit=3, window_seconds=1.0
    )
    assert allowed is True
    assert depth == 1  # only the new hit is in the fresh window


async def test_independent_buckets(memory_store):
    """Two distinct bucket_keys must not share counters."""
    for _ in range(3):
        allowed, _ = await memory_store.hit_and_check(
            bucket_key="ip1|a", limit=3, window_seconds=60.0
        )
        assert allowed is True
    # ip1|a is now full.
    allowed_a, _ = await memory_store.hit_and_check(
        bucket_key="ip1|a", limit=3, window_seconds=60.0
    )
    assert allowed_a is False

    # ip1|b is independent.
    allowed_b, _ = await memory_store.hit_and_check(
        bucket_key="ip1|b", limit=3, window_seconds=60.0
    )
    assert allowed_b is True


async def test_store_factory_returns_memory_when_no_redis(monkeypatch):
    from app.core import rate_limit_store as mod

    # Reset cached singleton so the factory re-runs.
    mod._store = None

    from app.core.config import settings

    monkeypatch.setattr(settings, "redis_url", "")
    store = get_rate_limiter_store()
    assert isinstance(store, MemoryRateLimiterStore)
    assert isinstance(store, RateLimiterStore)


async def test_store_factory_returns_redis_when_url_set(monkeypatch):
    from app.core import rate_limit_store as mod

    mod._store = None

    from app.core.config import settings

    monkeypatch.setattr(settings, "redis_url", "redis://localhost:6379/0")
    store = get_rate_limiter_store()
    assert isinstance(store, RedisRateLimiterStore)
    # Reset for other tests
    mod._store = None
    monkeypatch.setattr(settings, "redis_url", "")


# ---------------------------------------------------------------------------
# RedisRateLimiterStore via fakeredis (no live Redis required in CI).
# ---------------------------------------------------------------------------


async def _advance_clock() -> None:
    """Yield once so each call gets a distinct ``now_ms`` wall clock.

    Real Redis doesn't ZADD-dedupe by score, but fakeredis's Lua ZADD
    sometimes collapses two ``ZADD`` calls with the same integer score
    because of how it stores scores in a Python dict. The production
    store already adds a monotonic_ns suffix to the sorted-set member
    so the bucket key is unique; in tests we just need to bump the wall
    clock by a millisecond between hits to keep fakeredis honest.
    """
    await asyncio.sleep(0.002)


async def test_redis_store_allows_under_limit(monkeypatch):
    """Redis path: fills a bucket under the limit, then denies over the limit."""
    import fakeredis.aioredis as faio

    from app.core.rate_limit_store import RedisRateLimiterStore

    fake_client = faio.FakeRedis(decode_responses=True)
    store = RedisRateLimiterStore(redis_url="redis://test:6379/0")

    # Bypass the real ``from_url`` connect: inject the fakeredis client.
    async def _fake_get_client():
        return fake_client

    monkeypatch.setattr(store, "_get_client", _fake_get_client)

    for _ in range(5):
        allowed, depth = await store.hit_and_check(
            bucket_key="ip1|/api/auth/login",
            limit=10,
            window_seconds=60.0,
        )
        assert allowed is True
        await _advance_clock()
    allowed, depth = await store.hit_and_check(
        bucket_key="ip1|/api/auth/login",
        limit=10,
        window_seconds=60.0,
    )
    assert allowed is True
    assert depth == 6


async def test_redis_store_denies_over_limit(monkeypatch):
    import fakeredis.aioredis as faio

    from app.core.rate_limit_store import RedisRateLimiterStore

    fake_client = faio.FakeRedis(decode_responses=True)
    store = RedisRateLimiterStore(redis_url="redis://test:6379/0")

    async def _fake_get_client():
        return fake_client

    monkeypatch.setattr(store, "_get_client", _fake_get_client)

    for _ in range(5):
        allowed, _ = await store.hit_and_check(
            bucket_key="ip2|/api/auth/login",
            limit=5,
            window_seconds=60.0,
        )
        assert allowed is True
        await _advance_clock()
    allowed, depth = await store.hit_and_check(
        bucket_key="ip2|/api/auth/login",
        limit=5,
        window_seconds=60.0,
    )
    assert allowed is False
    assert depth == 5


async def test_redis_store_independent_buckets(monkeypatch):
    """Two distinct bucket_keys must not share counters in Redis either."""
    import fakeredis.aioredis as faio

    from app.core.rate_limit_store import RedisRateLimiterStore

    fake_client = faio.FakeRedis(decode_responses=True)
    store = RedisRateLimiterStore(redis_url="redis://test:6379/0")

    async def _fake_get_client():
        return fake_client

    monkeypatch.setattr(store, "_get_client", _fake_get_client)

    for _ in range(3):
        allowed, _ = await store.hit_and_check(bucket_key="ip3|a", limit=3, window_seconds=60.0)
        assert allowed is True
        await _advance_clock()
    allowed_a, _ = await store.hit_and_check(bucket_key="ip3|a", limit=3, window_seconds=60.0)
    assert allowed_a is False

    # ip3|b starts fresh.
    allowed_b, depth_b = await store.hit_and_check(bucket_key="ip3|b", limit=3, window_seconds=60.0)
    assert allowed_b is True
    assert depth_b == 1


async def test_redis_store_window_recovery(monkeypatch):
    """After the window slides forward, denied hits become allowed again."""
    import fakeredis.aioredis as faio

    from app.core.rate_limit_store import RedisRateLimiterStore

    fake_client = faio.FakeRedis(decode_responses=True)
    store = RedisRateLimiterStore(redis_url="redis://test:6379/0")

    async def _fake_get_client():
        return fake_client

    monkeypatch.setattr(store, "_get_client", _fake_get_client)

    for _ in range(3):
        allowed, _ = await store.hit_and_check(bucket_key="ip4|x", limit=3, window_seconds=1.0)
        assert allowed is True
        await _advance_clock()
    allowed, _ = await store.hit_and_check(bucket_key="ip4|x", limit=3, window_seconds=1.0)
    assert allowed is False

    # Wait out the window.
    await asyncio.sleep(1.1)

    allowed, depth = await store.hit_and_check(bucket_key="ip4|x", limit=3, window_seconds=1.0)
    assert allowed is True
    assert depth == 1


async def test_redis_store_fails_open_when_unreachable(monkeypatch):
    """When Redis raises, the store falls back to memory (fail-open).

    The result must be (allowed, depth) — never a crash. After a
    transient outage the breaker resets and the next request uses
    Redis again.
    """
    from app.core.rate_limit_store import RedisRateLimiterStore

    store = RedisRateLimiterStore(redis_url="redis://nonexistent:6379/0")

    # Force _get_client to raise on every call.
    async def _broken():
        raise ConnectionError("simulated Redis outage")

    monkeypatch.setattr(store, "_get_client", _broken)

    # First call: should succeed via memory fallback.
    allowed, depth = await store.hit_and_check(
        bucket_key="ip5|/api/auth/login",
        limit=10,
        window_seconds=60.0,
    )
    assert allowed is True
    assert depth == 1

    # Circuit-breaker is now tripped: subsequent calls bypass Redis.
    allowed, _ = await store.hit_and_check(
        bucket_key="ip5|/api/auth/login",
        limit=10,
        window_seconds=60.0,
    )
    assert allowed is True


# ---------------------------------------------------------------------------
# Circuit-breaker recovery (the "stale breaker" regression).
# ---------------------------------------------------------------------------


async def test_redis_store_breaker_stays_open_during_cooldown(monkeypatch):
    """While the cooldown runs, the broken client is NOT probed."""
    from app.core.rate_limit_store import RedisRateLimiterStore

    store = RedisRateLimiterStore(redis_url="redis://nonexistent:6379/0")
    probes = {"n": 0}

    async def broken():
        probes["n"] += 1
        raise ConnectionError("simulated Redis outage")

    monkeypatch.setattr(store, "_get_client", broken)

    await store.hit_and_check(bucket_key="ip7|a", limit=10, window_seconds=60.0)
    assert store._redis_failed is True
    assert probes["n"] == 1

    # Cooldown not elapsed yet: must NOT probe Redis again.
    await store.hit_and_check(bucket_key="ip7|a", limit=10, window_seconds=60.0)
    assert probes["n"] == 1


async def test_redis_store_recovers_after_outage(monkeypatch):
    """A transient outage must not disable Redis for the whole process.

    Once the cooldown has elapsed, the next request probes Redis
    again; on success the breaker closes and the shared bucket is
    used for real.
    """
    import fakeredis.aioredis as faio

    from app.core import rate_limit_store as mod
    from app.core.rate_limit_store import RedisRateLimiterStore

    fake_client = faio.FakeRedis(decode_responses=True)
    store = RedisRateLimiterStore(redis_url="redis://test:6379/0")

    calls = {"n": 0}

    async def flaky_get_client():
        calls["n"] += 1
        if calls["n"] == 1:
            raise ConnectionError("simulated Redis outage")
        return fake_client

    monkeypatch.setattr(store, "_get_client", flaky_get_client)
    # Compress the cooldown so the recovery probe fires on the 2nd call.
    monkeypatch.setattr(mod, "_REDIS_RECOVERY_COOLDOWN_SECONDS", 0.0)

    # First call: outage -> memory fallback (still allowed, fail-open).
    allowed, _ = await store.hit_and_check(bucket_key="ip6|a", limit=10, window_seconds=60.0)
    assert allowed is True
    assert store._redis_failed is True

    # Second call: cooldown elapsed -> Redis is probed and answers.
    allowed, depth = await store.hit_and_check(bucket_key="ip6|a", limit=10, window_seconds=60.0)
    assert allowed is True
    assert depth == 1
    assert store._redis_failed is False

    # The bucket now really lives in Redis (visible to a second replica).
    other = RedisRateLimiterStore(redis_url="redis://test:6379/0")

    async def _fake_get_client():
        return fake_client

    monkeypatch.setattr(other, "_get_client", _fake_get_client)
    await _advance_clock()
    allowed, depth = await other.hit_and_check(bucket_key="ip6|a", limit=10, window_seconds=60.0)
    assert allowed is True
    assert depth == 2  # the probe hit above was recorded in the shared bucket


# ---------------------------------------------------------------------------
# Memory store reaping (the "stale buckets" memory-growth regression).
# ---------------------------------------------------------------------------


async def test_memory_store_sweeps_stale_buckets(memory_store):
    """Bucket keys from IPs that never return must not accumulate."""
    from app.core.rate_limit_store import MemoryRateLimiterStore

    await memory_store.hit_and_check(bucket_key="ip1|_global", limit=10, window_seconds=60.0)
    assert memory_store._buckets

    # Sweeping "now" keeps fresh buckets.
    memory_store._maybe_sweep(time.monotonic())
    assert "ip1|_global" in memory_store._buckets

    # Sweeping in the far future drops them.
    far = time.monotonic() + MemoryRateLimiterStore._MAX_BUCKET_AGE_SECONDS + 1.0
    memory_store._maybe_sweep(far)
    assert "ip1|_global" not in memory_store._buckets
    assert memory_store._buckets == {}


async def test_memory_store_auto_sweeps_during_hits(monkeypatch):
    """The sweep also runs automatically inside hit_and_check."""
    monkeypatch.setattr(MemoryRateLimiterStore, "_SWEEP_INTERVAL_SECONDS", 0.0)
    store = MemoryRateLimiterStore()

    await store.hit_and_check(bucket_key="ip1|_global", limit=10, window_seconds=60.0)
    assert "ip1|_global" in store._buckets

    # Simulate a bucket whose last hit is older than the max age, then
    # let a hit on a different key trigger the opportunistic sweep.
    store._buckets["ip1|_global"] = [
        time.monotonic() - MemoryRateLimiterStore._MAX_BUCKET_AGE_SECONDS - 1.0
    ]
    await store.hit_and_check(bucket_key="ip2|_global", limit=10, window_seconds=60.0)
    assert "ip1|_global" not in store._buckets
    assert "ip2|_global" in store._buckets
