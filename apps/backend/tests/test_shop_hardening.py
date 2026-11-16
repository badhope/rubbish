"""P1 #11 — R 币双花加固：行锁 + 原子扣减 + 确定性台账 ref。

这些用例在 SQLite（CI 主 job）上验证串行正确性：余额不足不写台账、售罄
不负库存/不重复扣款、台账↔订单 1:1 确定性 ref、award 同 ref 幂等、日/月
上限在重构后仍成立、余额非负。真并发（asyncio.gather + FOR UPDATE）由
test_shop_concurrency_pg.py 在 PostgreSQL 上单独覆盖（SQLite 行锁是 no-op）。
"""

from __future__ import annotations

import pytest
from conftest import auth_headers
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.gamification import currency
from app.domain.gamification.models import CoinPolicy, CoinPurchase, PointEvent
from app.models import User


async def _set_balance(db_session: AsyncSession, username: str, amount: int) -> None:
    from sqlalchemy import update

    await db_session.execute(
        update(User).where(User.username == username).values(coin_balance=amount)
    )
    await db_session.commit()


async def _create_item(
    client: AsyncClient, admin_user: dict, *, price: int, stock: int | None, effect: str = "none"
) -> int:
    created = await client.post(
        "/api/gamification/admin/shop/items",
        json={
            "name": "加固测试货品",
            "description": "P1 #11",
            "price_coin": price,
            "stock": stock,
            "effect": effect,
            "sort_order": 1,
        },
        headers=auth_headers(admin_user),
    )
    assert created.status_code == 200, created.text
    return int(created.json()["id"])


async def _coin_events(db_session: AsyncSession, user_id: int, reason: str) -> list[PointEvent]:
    return list(
        (
            await db_session.execute(
                select(PointEvent).where(
                    PointEvent.user_id == user_id,
                    PointEvent.identity == currency.COIN_IDENTITY,
                    PointEvent.reason == reason,
                )
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_purchase_insufficient_balance_writes_no_ledger(
    client: AsyncClient, test_user: dict, admin_user: dict, db_session: AsyncSession
) -> None:
    """余额不足 → 400，且不留下任何 shop.item 台账行（扣款与台账同事务回滚）。"""
    item_id = await _create_item(client, admin_user, price=100, stock=5)
    # test_user 初始余额 0 < 100。
    denied = await client.post(
        f"/api/gamification/shop/items/{item_id}/purchase", headers=auth_headers(test_user)
    )
    assert denied.status_code == 400, denied.text

    events = await _coin_events(db_session, int(test_user["user_id"]), "shop.item")
    assert events == []
    me = await client.get("/api/users/me", headers=auth_headers(test_user))
    assert me.json()["coin_balance"] == 0


@pytest.mark.asyncio
async def test_purchase_sold_out_second_is_non_negative(
    client: AsyncClient, test_user: dict, admin_user: dict, db_session: AsyncSession
) -> None:
    """stock=1：首购成功，二购 400；库存停在 0（不负），余额只扣一次。"""
    await _set_balance(db_session, str(test_user["username"]), 150)
    item_id = await _create_item(client, admin_user, price=100, stock=1)

    first = await client.post(
        f"/api/gamification/shop/items/{item_id}/purchase", headers=auth_headers(test_user)
    )
    assert first.status_code == 200, first.text
    assert first.json()["balance"] == 50

    second = await client.post(
        f"/api/gamification/shop/items/{item_id}/purchase", headers=auth_headers(test_user)
    )
    assert second.status_code == 400, second.text

    # 库存非负、余额未被二次扣减、台账/订单各只有一条。
    from app.domain.gamification.models import CoinShopItem

    item = (
        await db_session.execute(select(CoinShopItem).where(CoinShopItem.id == item_id))
    ).scalar_one()
    assert item.stock == 0
    me = await client.get("/api/users/me", headers=auth_headers(test_user))
    assert me.json()["coin_balance"] == 50
    assert len(await _coin_events(db_session, int(test_user["user_id"]), "shop.item")) == 1
    purchases = (
        (
            await db_session.execute(
                select(CoinPurchase).where(CoinPurchase.user_id == int(test_user["user_id"]))
            )
        )
        .scalars()
        .all()
    )
    assert len(purchases) == 1


@pytest.mark.asyncio
async def test_purchase_ledger_ref_is_deterministic_one_to_one(
    client: AsyncClient, test_user: dict, admin_user: dict, db_session: AsyncSession
) -> None:
    """台账 ref_id == purchase:{订单id}，与订单 1:1，可重放对账（非 uuid4）。"""
    await _set_balance(db_session, str(test_user["username"]), 150)
    item_id = await _create_item(client, admin_user, price=100, stock=5)

    bought = await client.post(
        f"/api/gamification/shop/items/{item_id}/purchase", headers=auth_headers(test_user)
    )
    assert bought.status_code == 200, bought.text
    purchase_id = int(bought.json()["purchase_id"])

    events = await _coin_events(db_session, int(test_user["user_id"]), "shop.item")
    assert len(events) == 1
    assert events[0].ref_id == f"purchase:{purchase_id}"
    assert events[0].ref_type == "shop_item"
    assert events[0].delta == -100


@pytest.mark.asyncio
async def test_award_same_ref_is_idempotent_single_ledger(
    client: AsyncClient, test_user: dict, db_session: AsyncSession
) -> None:
    """同一 ref 重复 award：第二次 False，台账只一条，余额只加一次。"""
    user = (
        await db_session.execute(select(User).where(User.username == test_user["username"]))
    ).scalar_one()

    first = await currency.award(
        db_session, user, "forum.topic", ref_type="topic", ref_id="t1", commit=True
    )
    assert first is True
    second = await currency.award(
        db_session, user, "forum.topic", ref_type="topic", ref_id="t1", commit=True
    )
    assert second is False

    rows = (
        (
            await db_session.execute(
                select(PointEvent).where(
                    PointEvent.user_id == user.id,
                    PointEvent.identity == currency.COIN_IDENTITY,
                    PointEvent.reason == "forum.topic",
                    PointEvent.ref_id == "t1",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert int(user.coin_balance or 0) == 1


@pytest.mark.asyncio
async def test_award_daily_cap_holds_after_refactor(
    client: AsyncClient, test_user: dict, db_session: AsyncSession
) -> None:
    """单用户日常收入日上限（默认 5 R）：第 6 次发放被挡，余额停在 5。"""
    user = (
        await db_session.execute(select(User).where(User.username == test_user["username"]))
    ).scalar_one()

    for i in range(5):
        ok = await currency.award(
            db_session, user, "forum.topic", ref_type="topic", ref_id=f"d{i}", commit=True
        )
        assert ok is True, f"award {i} should succeed"
    blocked = await currency.award(
        db_session, user, "forum.topic", ref_type="topic", ref_id="d5", commit=True
    )
    assert blocked is False
    assert int(user.coin_balance or 0) == 5


@pytest.mark.asyncio
async def test_award_monthly_cap_holds_after_refactor(
    client: AsyncClient, test_user: dict, db_session: AsyncSession
) -> None:
    """租户月发行上限：锁 coin_policy 行后 monthly 检查仍生效（这里设 3 R）。"""
    user = (
        await db_session.execute(select(User).where(User.username == test_user["username"]))
    ).scalar_one()
    db_session.add(
        CoinPolicy(
            tenant_id=user.tenant_id,
            coin_per_yuan=100,
            daily_earn_cap=100,
            monthly_issue_cap=3,
        )
    )
    await db_session.commit()

    for i in range(3):
        ok = await currency.award(
            db_session, user, "forum.topic", ref_type="topic", ref_id=f"m{i}", commit=True
        )
        assert ok is True, f"award {i} should succeed"
    blocked = await currency.award(
        db_session, user, "forum.topic", ref_type="topic", ref_id="m3", commit=True
    )
    assert blocked is False
    assert int(user.coin_balance or 0) == 3
