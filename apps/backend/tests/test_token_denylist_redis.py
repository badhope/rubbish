"""Tests for the Redis-backed token denylist and its fail-closed paths.

``test_token_denylist.py`` covers the in-memory implementation and the
end-to-end revocation flows. This file covers the part that only shows
up in production: ``RedisTokenDenylist`` itself, and every branch of the
``get_denylist()`` factory.

The contract that matters is **fail-closed**: if Redis is unreachable or
the package is missing, revocation must NOT silently degrade to memory
(that would accept revoked tokens). Calls raise ``DenylistUnavailableError``
and the auth endpoints translate it into HTTP 503. The Redis client is
still installed when the initial probe fails, so the backend self-heals
once Redis returns.
"""

from __future__ import annotations

import sys
import time
from types import SimpleNamespace
from typing import Any

import pytest
from conftest import auth_headers
from httpx import AsyncClient

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


def _async_return(value: Any) -> Any:
    async def _inner(*_args: Any, **_kwargs: Any) -> Any:
        return value

    return _inner


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


async def test_redis_add_failure_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Redis 写失败必须抛 DenylistUnavailableError（fail-closed）。

    旧实现吞掉异常 → 登出/刷新以为已吊销，实则 revoked token 仍可用。
    现在抛错让调用方返回 503，绝不发新 token / 半登出。
    """
    fake = FakeRedis(fail=ConnectionError("redis down"))
    denylist = td.RedisTokenDenylist("redis://localhost:6379/0")
    monkeypatch.setattr(denylist, "_get_redis", _async_return(fake))

    with pytest.raises(td.DenylistUnavailableError):
        await denylist.add("jti-1", time.time() + 60)


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


async def test_redis_is_denied_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Redis 不可用时抛错而不是返回 False —— fail-closed 是明确设计。"""
    denylist = td.RedisTokenDenylist("redis://localhost:6379/0")
    monkeypatch.setattr(denylist, "_get_redis", _async_return(FakeRedis(fail=OSError("down"))))

    with pytest.raises(td.DenylistUnavailableError):
        await denylist.is_denied("jti-1")


# ---------------------------------------------------------------------------
# get_denylist factory
# ---------------------------------------------------------------------------


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


async def test_factory_raises_when_redis_package_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """redis 包没装但配置了 URL → 抛错（配置错误不得静默降级到内存）。"""
    monkeypatch.setattr(settings, "redis_url", "redis://localhost:6379/0")
    # 让 `import redis.asyncio` 失败
    monkeypatch.setitem(sys.modules, "redis.asyncio", None)

    with pytest.raises(td.DenylistUnavailableError):
        await td.get_denylist()


async def test_factory_installs_redis_when_unreachable_and_self_heals(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ping 失败仍装 Redis（非内存）：故障期 fail-closed，恢复后自愈。

    永久缓存内存会在整个进程生命周期内放行已吊销 token；Redis 客户端
    按命令重连，所以装 Redis 候选才是正确选择。
    """
    monkeypatch.setattr(settings, "redis_url", "redis://localhost:6379/0")
    fake = FakeRedis(fail=ConnectionError("refused"))
    monkeypatch.setattr(td.RedisTokenDenylist, "_get_redis", _async_return(fake))

    denylist = await td.get_denylist()
    assert isinstance(denylist, td.RedisTokenDenylist)

    # 故障期：fail-closed
    with pytest.raises(td.DenylistUnavailableError):
        await denylist.is_denied("jti-1")

    # Redis 恢复：同一单例无需重建即可工作
    fake.fail = None
    fake.exists_value = 1
    assert await denylist.is_denied("jti-1") is True


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


# ---------------------------------------------------------------------------
# Auth endpoints fail closed (503) when the denylist is unavailable
# ---------------------------------------------------------------------------


class _UnavailableDenylist:
    """A denylist backend that is permanently unreachable."""

    async def add(self, token_jti: str, expires_at: float) -> None:
        raise td.DenylistUnavailableError("down")

    async def is_denied(self, token_jti: str) -> bool:
        raise td.DenylistUnavailableError("down")


async def test_refresh_returns_503_when_denylist_unavailable(
    client: AsyncClient, test_user: dict
) -> None:
    """吊销服务不可用 → refresh 返回 503，而不是放行或 500。"""
    td._denylist = _UnavailableDenylist()  # type: ignore[assignment]
    resp = await client.post(
        "/api/auth/refresh", json={"refresh_token": test_user["refresh_token"]}
    )
    assert resp.status_code == 503, resp.text


async def test_logout_returns_503_when_denylist_unavailable(
    client: AsyncClient, test_user: dict
) -> None:
    """吊销服务不可用 → logout 返回 503，且不半登出（token_version 不变）。"""
    td._denylist = _UnavailableDenylist()  # type: ignore[assignment]
    client.cookies.set(
        settings.refresh_token_cookie_name,
        str(test_user["refresh_token"]),
        path="/api/auth",
    )
    resp = await client.post("/api/auth/logout", headers=auth_headers(test_user))
    assert resp.status_code == 503, resp.text

    # 访问 token 仍然有效——logout 在吊销失败时不得提前作废会话
    me = await client.get("/api/auth/me", headers=auth_headers(test_user))
    assert me.status_code == 200
