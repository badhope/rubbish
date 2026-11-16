"""P1 #11 — R 币真并发加固（PostgreSQL only）。

SQLite 的 ``with_for_update()`` 是 no-op，无法验证行锁下的并发正确性，
所以串行口径由 test_shop_hardening.py 在 SQLite 上覆盖，真并发在这里用
真实 PostgreSQL + ``asyncio.gather`` + 独立会话验证：

  * 限量库存：N 个并发购买只能成交 stock 件，库存停在 0（不负/不超卖）。
  * 限量余额：原子守卫扣减下并发购买不会把余额扣成负数（不双花）。
  * 日常上限：并发 award 被 User 行锁串行化，日上限不被丢失更新击穿。

未设置 PostgreSQL 的 ``RUBBISH_DATABASE_URL`` 时整模块跳过（与
test_rls_isolation.py 同一约定）。schema 用 Base.metadata.create_all 建，
不启用 RLS——本文件验证行锁与原子扣减，租户隔离由 RLS 测试单独覆盖。
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

DB_URL = os.environ.get("RUBBISH_DATABASE_URL", "")
if not DB_URL.startswith("postgresql"):
    pytest.skip(
        "Concurrency tests require PostgreSQL; set RUBBISH_DATABASE_URL=postgresql+asyncpg://...",
        allow_module_level=True,
    )

from app.domain.gamification import currency, shop  # noqa: E402
from app.domain.gamification.models import (  # noqa: E402
    CoinPurchase,
    CoinShopItem,
    PointEvent,
)
from app.models import Base, Tenant, User  # noqa: E402


@pytest.fixture
async def pg_engine():
    # 函数级 scope：asyncpg 连接绑定创建时的事件循环，模块级 fixture 会跨循环
    # 复用连接（"another operation is in progress"）。每个用例独立建/拆 schema，
    # 保证引擎与 asyncio.gather 的并发会话都在同一循环内。
    engine = create_async_engine(DB_URL, echo=False)
    async with engine.begin() as conn:
        # resources 的 trgm 索引依赖 pg_trgm（与 alembic 迁移一致）。
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def session_factory(pg_engine):
    return async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)


async def _seed(
    session_factory, *, balance: int, price: int, stock: int | None, effect: str = "none"
) -> tuple[uuid.UUID, int, int]:
    async with session_factory() as s:
        tenant = Tenant(slug=f"conc-{uuid.uuid4().hex[:12]}", name="Conc", is_active=True)
        s.add(tenant)
        await s.flush()
        user = User(
            tenant_id=tenant.id,
            email="conc@example.com",
            username="concuser",
            hashed_password="not-a-real-hash",
            coin_balance=balance,
        )
        s.add(user)
        await s.flush()
        item = CoinShopItem(
            tenant_id=tenant.id,
            name="并发测试货品",
            description="",
            price_coin=price,
            stock=stock,
            effect=effect,
            created_by=user.id,
        )
        s.add(item)
        await s.commit()
        return tenant.id, user.id, item.id


async def _buy(session_factory, user_id: int, item_id: int) -> bool:
    async with session_factory() as s:
        user = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
        try:
            await shop.purchase(s, user, item_id)
            return True
        except shop.ShopError:
            return False


async def _award(session_factory, user_id: int, ref_id: str) -> bool:
    async with session_factory() as s:
        user = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
        return await currency.award(
            s, user, "forum.topic", ref_type="topic", ref_id=ref_id, commit=True
        )


async def _count(session_factory, model, **filters) -> int:
    async with session_factory() as s:
        stmt = select(func.count()).select_from(model)
        for col, val in filters.items():
            stmt = stmt.where(getattr(model, col) == val)
        return int((await s.execute(stmt)).scalar_one())


@pytest.mark.asyncio
async def test_concurrent_purchase_limited_stock_no_oversell(session_factory) -> None:
    """库存 3、余额充足：8 个并发购买只成交 3 件，库存停 0，台账/订单各 3。"""
    _tenant_id, user_id, item_id = await _seed(session_factory, balance=10000, price=100, stock=3)
    results = await asyncio.gather(*[_buy(session_factory, user_id, item_id) for _ in range(8)])
    assert sum(results) == 3

    async with session_factory() as s:
        item = (
            await s.execute(select(CoinShopItem).where(CoinShopItem.id == item_id))
        ).scalar_one()
        user = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
    assert item.stock == 0
    assert user.coin_balance == 9700
    assert await _count(session_factory, CoinPurchase, user_id=user_id) == 3
    assert await _count(session_factory, PointEvent, user_id=user_id, reason="shop.item") == 3


@pytest.mark.asyncio
async def test_concurrent_purchase_limited_balance_no_double_spend(session_factory) -> None:
    """余额 250、不限量、单价 100：6 个并发购买只成交 2 件，余额停 50（非负）。"""
    _tenant_id, user_id, item_id = await _seed(session_factory, balance=250, price=100, stock=None)
    results = await asyncio.gather(*[_buy(session_factory, user_id, item_id) for _ in range(6)])
    assert sum(results) == 2

    async with session_factory() as s:
        user = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
    assert user.coin_balance == 50
    assert user.coin_balance >= 0
    assert await _count(session_factory, CoinPurchase, user_id=user_id) == 2
    assert await _count(session_factory, PointEvent, user_id=user_id, reason="shop.item") == 2


@pytest.mark.asyncio
async def test_concurrent_award_daily_cap_not_broken(session_factory) -> None:
    """日常上限 5 R：8 个并发 award（不同 ref）被行锁串行化，只发 5 次。"""
    _tenant_id, user_id, _ = await _seed(session_factory, balance=0, price=100, stock=None)
    results = await asyncio.gather(*[_award(session_factory, user_id, f"r{i}") for i in range(8)])
    assert sum(results) == 5

    async with session_factory() as s:
        user = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
    assert user.coin_balance == 5
    assert await _count(session_factory, PointEvent, user_id=user_id, reason="forum.topic") == 5
