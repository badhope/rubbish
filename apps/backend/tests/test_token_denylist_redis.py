"""Tests for the Redis-backed token denylist and its fallback paths.

``test_token_denylist.py`` covers the in-memory implementation and the
end-to-end revocation flows. This file covers the part that only shows
up in production: ``RedisTokenDenylist`` itself, and every branch of the
``get_denylist()`` factory.

The contract that matters is **fail-open**: if Redis is unreachable or
the package is missing, revocation must degrade to in-memory rather
than locking every user out or raising on the hot auth path.
"""

from __future__ import annotations

import sys
import time
from types import SimpleNamespace
from typing import Any

import pytest

from app.core import token_denylist as td
from app.core.config import settings


@pytest.fixture(autouse=True)
def _reset_singleton() -> Any:
    td.reset_denylist()
    yield
    td.reset_denylist()


class FakeRedis:
    """Records ``set`` / ``exists`` / ``ping`` calls."""

    def __init__(self, *, exists: int = 0, fail: Exception | None = None) -> None:
        self.store: dict[str, str] = {}
        self.exists_value = exists
        self.fail = fail
        self.calls: list[tuple[Any, ...]] = []

    def _maybe_fail(self) -> None:
        if self.fail is not None:
            raise self.fail

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self._maybe_fail()
        self.calls.append(("set", key, value, ex))
        self.store[key] = value

    async def exists(self, key: str) -> int:
        self._maybe_fail()
        self.calls.append(("exists", key))
        return self.exists_value

    async def ping(self) -> bool:
        self._maybe_fail()
        self.calls.append(("ping",))
        return True


# ---------------------------------------------------------------------------
# RedisTokenDenylist.add
# ---------------------------------------------------------------------------


async def test_redis_add_writes_key_with_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeRedis()
    denylist = td.RedisTokenDenylist("redis://localhost:6379/0")
    monkeypatch.setattr(denylist, "_get_redis", _async_return(fake))

    await denylist.add("jti-1", time.time() + 300)

    method, key, value, ex = fake.calls[0]
    assert (method, key, value) == ("set", f"{td._KEY_PREFIX}jti-1", "1")
    # TTL 必须为正，且不超过 token 剩余寿命（Redis 侧靠 EX 自动回收）
    assert 0 < ex <= 300


async def test_redis_add_clamps_nonpositive_ttl_to_one(monkeypatch: pytest.MonkeyPatch) -> None:
    """已过期（或时钟漂移）的 token：TTL 取 1 而不是 0/负数。

    Redis 的 ``EX 0`` 会直接报错，``EX`` 负数更糟；clamp 到 1 秒保证
    "立即作废"这个语义在任何输入下都成立。
    """
    fake = FakeRedis()
    denylist = td.RedisTokenDenylist("redis://localhost:6379/0")
    monkeypatch.setattr(denylist, "_get_redis", _async_return(fake))

    await denylist.add("jti-old", time.time() - 10_000)

    assert fake.calls[0][3] == 1


async def test_redis_add_failure_is_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Redis 写失败只记日志，绝不能让登出接口 500。"""
    fake = FakeRedis(fail=ConnectionError("redis down"))
    denylist = td.RedisTokenDenylist("redis://localhost:6379/0")
    monkeypatch.setattr(denylist, "_get_redis", _async_return(fake))

    await denylist.add("jti-1", time.time() + 60)  # should not raise


# ---------------------------------------------------------------------------
# RedisTokenDenylist.is_denied
# ---------------------------------------------------------------------------


async def test_redis_is_denied_true_when_key_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeRedis(exists=1)
    denylist = td.RedisTokenDenylist("redis://localhost:6379/0")
    monkeypatch.setattr(denylist, "_get_redis", _async_return(fake))

    assert await denylist.is_denied("jti-1") is True
    assert fake.calls[0] == ("exists", f"{td._KEY_PREFIX}jti-1")


async def test_redis_is_denied_false_when_key_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    denylist = td.RedisTokenDenylist("redis://localhost:6379/0")
    monkeypatch.setattr(denylist, "_get_redis", _async_return(FakeRedis(exists=0)))

    assert await denylist.is_denied("jti-1") is False


async def test_redis_is_denied_fails_open(monkeypatch: pytest.MonkeyPatch) -> None:
    """Redis 不可用时返回 False（放行）而不是抛错 —— fail-open 是明确设计。"""
    denylist = td.RedisTokenDenylist("redis://localhost:6379/0")
    monkeypatch.setattr(denylist, "_get_redis", _async_return(FakeRedis(fail=OSError("down"))))

    assert await denylist.is_denied("jti-1") is False


# ---------------------------------------------------------------------------
# get_denylist factory
# ---------------------------------------------------------------------------


def _async_return(value: Any) -> Any:
    async def _inner(*_args: Any, **_kwargs: Any) -> Any:
        return value

    return _inner


async def test_factory_uses_memory_without_redis_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "redis_url", "")

    assert isinstance(await td.get_denylist(), td.MemoryTokenDenylist)


async def test_factory_uses_redis_when_ping_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeRedis()
    monkeypatch.setattr(settings, "redis_url", "redis://localhost:6379/0")
    monkeypatch.setattr(td.RedisTokenDenylist, "_get_redis", _async_return(fake))

    denylist = await td.get_denylist()

    assert isinstance(denylist, td.RedisTokenDenylist)
    assert ("ping",) in fake.calls  # 必须真的探活过，而不是盲信配置


async def test_factory_falls_back_when_redis_package_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """redis 包没装 → 回退内存，而不是 ImportError 炸掉启动。"""
    monkeypatch.setattr(settings, "redis_url", "redis://localhost:6379/0")
    # 让 `import redis.asyncio` 失败
    monkeypatch.setitem(sys.modules, "redis.asyncio", None)

    denylist = await td.get_denylist()

    assert isinstance(denylist, td.MemoryTokenDenylist)


async def test_factory_falls_back_when_redis_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Redis 配置了但连不上（ping 失败）→ 回退内存。"""
    monkeypatch.setattr(settings, "redis_url", "redis://localhost:6379/0")
    monkeypatch.setattr(
        td.RedisTokenDenylist,
        "_get_redis",
        _async_return(FakeRedis(fail=ConnectionError("refused"))),
    )

    denylist = await td.get_denylist()

    assert isinstance(denylist, td.MemoryTokenDenylist)


async def test_factory_singleton_survives_concurrent_first_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """并发首次调用只能造一个实例（双重检查锁）。"""
    monkeypatch.setattr(settings, "redis_url", "")
    td.reset_denylist()

    results = [await td.get_denylist() for _ in range(5)]

    assert all(r is results[0] for r in results)


async def test_factory_second_call_returns_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "redis_url", "")
    first = await td.get_denylist()

    # 改配置不应换掉已建好的单例
    monkeypatch.setattr(settings, "redis_url", "redis://localhost:6379/0")

    assert await td.get_denylist() is first


def test_reset_denylist_clears_singleton() -> None:
    td._denylist = SimpleNamespace()  # type: ignore[assignment]

    td.reset_denylist()

    assert td._denylist is None
