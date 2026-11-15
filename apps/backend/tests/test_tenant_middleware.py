"""Tests for tenant resolution (``app.core.tenant.TenantContextMiddleware``).

Two modes are covered, because they fail in completely different ways:

- **single** — one bootstrap tenant, resolved once and cached on the
  middleware instance. A bug here means every request is unscoped.
- **multi** — tenant comes from the ``Host`` header. A bug here is a
  cross-tenant data leak, and the interesting cases are all the
  *rejection* paths: missing host, unknown host, port stripping,
  expired cache entry, DB failure.

The middleware is driven directly with fabricated ASGI scopes rather
than through ``TestClient``, so we can assert exactly which tenant id
reaches downstream code.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.core import db as db_mod
from app.core import tenant as tenant_mod
from app.core.config import settings
from app.core.tenant import (
    REQUEST_ID_CTX,
    TENANT_CONTEXT_VAR,
    TenantContextMiddleware,
    invalidate_host_cache,
)
from app.models import Tenant, TenantHost


class RecordingApp:
    """ASGI app that captures the context vars visible to downstream code."""

    def __init__(self) -> None:
        self.seen_tenant: uuid.UUID | None = None
        self.seen_request_id: str | None = None
        self.calls = 0

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        self.calls += 1
        self.seen_tenant = TENANT_CONTEXT_VAR.get()
        self.seen_request_id = REQUEST_ID_CTX.get()


async def _call(mw: TenantContextMiddleware, headers: list[tuple[bytes, bytes]]) -> None:
    scope = {"type": "http", "headers": headers}
    await mw(scope, None, None)


@pytest.fixture(autouse=True)
def _reset_state() -> Any:
    tenant_mod._host_cache.clear()
    TENANT_CONTEXT_VAR.set(None)
    yield
    tenant_mod._host_cache.clear()
    TENANT_CONTEXT_VAR.set(None)


# ---------------------------------------------------------------------------
# non-HTTP scopes
# ---------------------------------------------------------------------------


async def test_non_http_scope_passes_through_without_resolution() -> None:
    """lifespan / websocket 不该触发租户解析。"""
    inner = RecordingApp()
    mw = TenantContextMiddleware(inner)

    await mw({"type": "lifespan"}, None, None)

    assert inner.calls == 1
    assert inner.seen_tenant is None


# ---------------------------------------------------------------------------
# single-tenant mode
# ---------------------------------------------------------------------------


async def test_single_mode_resolves_and_caches_bootstrap_tenant(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """单租户模式解析 bootstrap 租户，且第二次请求不再查库。"""
    await client.get("/api/health")  # 确保 bootstrap 租户已建

    monkeypatch.setattr(settings, "tenancy_mode", "single")
    inner = RecordingApp()
    mw = TenantContextMiddleware(inner)

    await _call(mw, [])
    first_id = inner.seen_tenant
    await _call(mw, [])

    assert first_id is not None
    assert inner.seen_tenant == first_id
    # 缓存在中间件实例上，第二次不能再走 _ensure_bootstrap_tenant
    assert mw._single_mode_tenant_id == first_id


async def test_single_mode_bootstrap_is_idempotent(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """bootstrap 租户已存在时直接返回，不重复插入。"""
    await client.get("/api/health")
    monkeypatch.setattr(settings, "tenancy_mode", "single")

    mw_a = TenantContextMiddleware(RecordingApp())
    mw_b = TenantContextMiddleware(RecordingApp())
    await _call(mw_a, [])
    await _call(mw_b, [])

    assert mw_a._single_mode_tenant_id == mw_b._single_mode_tenant_id


# ---------------------------------------------------------------------------
# multi-tenant mode: rejection paths
# ---------------------------------------------------------------------------


async def test_multi_mode_without_host_header_is_unresolved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """没有 Host 头 → tenant=None，下游 RLS 默认拒绝所有行。"""
    monkeypatch.setattr(settings, "tenancy_mode", "multi")
    inner = RecordingApp()

    await _call(TenantContextMiddleware(inner), [])

    assert inner.seen_tenant is None


async def test_multi_mode_with_empty_host_is_unresolved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "tenancy_mode", "multi")
    inner = RecordingApp()

    await _call(TenantContextMiddleware(inner), [(b"host", b"   ")])

    assert inner.seen_tenant is None


async def test_multi_mode_unknown_host_is_unresolved(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    await client.get("/api/health")
    monkeypatch.setattr(settings, "tenancy_mode", "multi")
    inner = RecordingApp()

    await _call(TenantContextMiddleware(inner), [(b"host", b"nope.example.com")])

    assert inner.seen_tenant is None


async def test_multi_mode_strips_port_and_lowercases(
    client: Any, db_session: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``EXAMPLE.com:8080`` 必须命中 ``example.com`` 的映射。"""
    await client.get("/api/health")
    tenant = Tenant(slug="multi-a", name="Multi A", tenant_type="journal")
    db_session.add(tenant)
    await db_session.flush()
    db_session.add(TenantHost(tenant_id=tenant.id, host="example.com", is_active=True))
    await db_session.commit()

    monkeypatch.setattr(settings, "tenancy_mode", "multi")
    inner = RecordingApp()

    await _call(TenantContextMiddleware(inner), [(b"host", b"EXAMPLE.com:8080")])

    assert inner.seen_tenant == tenant.id


async def test_multi_mode_inactive_host_is_unresolved(
    client: Any, db_session: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """停用的 host 映射不能解析出租户（否则停用形同虚设）。"""
    await client.get("/api/health")
    tenant = Tenant(slug="multi-b", name="Multi B", tenant_type="journal")
    db_session.add(tenant)
    await db_session.flush()
    db_session.add(TenantHost(tenant_id=tenant.id, host="disabled.example.com", is_active=False))
    await db_session.commit()

    monkeypatch.setattr(settings, "tenancy_mode", "multi")
    inner = RecordingApp()

    await _call(TenantContextMiddleware(inner), [(b"host", b"disabled.example.com")])

    assert inner.seen_tenant is None


async def test_multi_mode_db_failure_is_unresolved(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """查库异常必须吞掉并返回 None，不能让请求 500。"""
    await client.get("/api/health")
    monkeypatch.setattr(settings, "tenancy_mode", "multi")

    # async_session_factory 是函数内局部 import 的，符号来自 app.core.db
    def boom(*_a: Any, **_kw: Any) -> Any:
        raise RuntimeError("db is gone")

    monkeypatch.setattr(db_mod, "async_session_factory", boom)
    inner = RecordingApp()

    await _call(TenantContextMiddleware(inner), [(b"host", b"example.com")])

    assert inner.seen_tenant is None


# ---------------------------------------------------------------------------
# host cache
# ---------------------------------------------------------------------------


async def test_host_cache_serves_repeat_lookups(
    client: Any, db_session: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    await client.get("/api/health")
    tenant = Tenant(slug="multi-c", name="Multi C", tenant_type="journal")
    db_session.add(tenant)
    await db_session.flush()
    db_session.add(TenantHost(tenant_id=tenant.id, host="cached.example.com", is_active=True))
    await db_session.commit()

    monkeypatch.setattr(settings, "tenancy_mode", "multi")

    inner = RecordingApp()
    mw = TenantContextMiddleware(inner)
    # 预热缓存
    await _call(mw, [(b"host", b"cached.example.com")])
    assert inner.seen_tenant == tenant.id

    # 现在把 DB 换成一炸就报错的桩：缓存命中就不该碰它
    def explode(*_a: Any, **_kw: Any) -> Any:
        raise AssertionError("cache miss — DB should not be hit")

    monkeypatch.setattr(db_mod, "async_session_factory", explode)
    await _call(mw, [(b"host", b"cached.example.com")])

    assert inner.seen_tenant == tenant.id


async def test_expired_host_cache_entry_falls_back_to_db(
    client: Any, db_session: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    await client.get("/api/health")
    tenant = Tenant(slug="multi-d", name="Multi D", tenant_type="journal")
    db_session.add(tenant)
    await db_session.flush()
    db_session.add(TenantHost(tenant_id=tenant.id, host="stale.example.com", is_active=True))
    await db_session.commit()

    monkeypatch.setattr(settings, "tenancy_mode", "multi")
    # 塞一条已过期的缓存，解析器应丢弃它并回落查库
    tenant_mod._host_cache["stale.example.com"] = (uuid.uuid4(), 0.0)
    inner = RecordingApp()

    await _call(TenantContextMiddleware(inner), [(b"host", b"stale.example.com")])

    assert inner.seen_tenant == tenant.id


async def test_negative_cache_prevents_repeat_db_queries(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """未知 host 也会被负缓存，避免被反复打库。"""
    await client.get("/api/health")
    monkeypatch.setattr(settings, "tenancy_mode", "multi")

    await _call(TenantContextMiddleware(RecordingApp()), [(b"host", b"ghost.example.com")])

    assert "ghost.example.com" in tenant_mod._host_cache
    cached_id, expiry = tenant_mod._host_cache["ghost.example.com"]
    assert cached_id is None
    assert expiry > 0


def test_invalidate_host_cache_one_entry() -> None:
    tenant_mod._host_cache["a.example.com"] = (uuid.uuid4(), 1e18)
    tenant_mod._host_cache["b.example.com"] = (uuid.uuid4(), 1e18)

    invalidate_host_cache("A.Example.com")  # 大小写不敏感

    assert "a.example.com" not in tenant_mod._host_cache
    assert "b.example.com" in tenant_mod._host_cache


def test_invalidate_host_cache_all() -> None:
    tenant_mod._host_cache["a.example.com"] = (uuid.uuid4(), 1e18)

    invalidate_host_cache()

    assert tenant_mod._host_cache == {}


# ---------------------------------------------------------------------------
# request id
# ---------------------------------------------------------------------------


async def test_upstream_request_id_header_is_reused() -> None:
    inner = RecordingApp()
    mw = TenantContextMiddleware(inner)

    await _call(mw, [(b"x-request-id", b"trace-abc-123")])

    assert inner.seen_request_id == "trace-abc-123"


async def test_request_id_generated_when_absent() -> None:
    inner = RecordingApp()
    mw = TenantContextMiddleware(inner)

    await _call(mw, [])

    assert inner.seen_request_id
    assert len(inner.seen_request_id) == 16
    assert inner.seen_request_id != "-"


async def test_request_id_is_reset_after_request() -> None:
    """请求结束必须还原 ContextVar，否则会串到下一个请求。"""
    mw = TenantContextMiddleware(RecordingApp())

    await _call(mw, [(b"x-request-id", b"trace-xyz")])

    assert REQUEST_ID_CTX.get() == "-"
