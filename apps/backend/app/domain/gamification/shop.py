"""积分兑换 — 货品目录、兑换、站务组管理口径。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.gamification.currency import COIN_IDENTITY
from app.domain.gamification.models import CoinPurchase, CoinShopItem, PointEvent
from app.models import User


class ShopError(Exception):
    pass


class ShopConflictError(ShopError):
    """台账唯一约束冲突（重复订单/幂等重放）→ HTTP 409。"""


async def list_items(
    db: AsyncSession, tenant_id: Any, *, include_inactive: bool = False
) -> list[CoinShopItem]:
    stmt = select(CoinShopItem).where(CoinShopItem.tenant_id == tenant_id)
    if not include_inactive:
        stmt = stmt.where(CoinShopItem.is_active.is_(True))
    return list(
        (await db.execute(stmt.order_by(CoinShopItem.sort_order.asc(), CoinShopItem.id.asc())))
        .scalars()
        .all()
    )


async def create_item(
    db: AsyncSession,
    *,
    tenant_id: Any,
    created_by: int,
    name: str,
    description: str,
    price_coin: int,
    stock: int | None,
    is_active: bool,
    effect: str,
    cover_url: str | None,
    sort_order: int,
) -> CoinShopItem:
    item = CoinShopItem(
        tenant_id=tenant_id,
        name=name.strip(),
        description=description.strip(),
        price_coin=price_coin,
        stock=stock,
        is_active=is_active,
        effect=effect,
        cover_url=cover_url,
        sort_order=sort_order,
        created_by=created_by,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def update_item(
    db: AsyncSession,
    item: CoinShopItem,
    *,
    name: str | None = None,
    description: str | None = None,
    price_coin: int | None = None,
    stock: int | None = None,
    stock_defined: bool = False,
    is_active: bool | None = None,
    effect: str | None = None,
    cover_url: str | None = None,
    cover_url_defined: bool = False,
    sort_order: int | None = None,
) -> CoinShopItem:
    if name is not None:
        item.name = name.strip()
    if description is not None:
        item.description = description.strip()
    if price_coin is not None:
        item.price_coin = price_coin
    if stock_defined:
        # 显式 null 表示恢复不限量；None 作为“未提交”不能表达这个动作。
        item.stock = stock
    if is_active is not None:
        item.is_active = is_active
    if effect is not None:
        item.effect = effect
    if cover_url_defined:
        # 显式 null 表示清空封面；未提交时保留原值。
        item.cover_url = cover_url
    if sort_order is not None:
        item.sort_order = sort_order
    await db.commit()
    await db.refresh(item)
    return item


async def purchase(db: AsyncSession, user: User, item_id: int) -> dict[str, Any]:
    # 统一锁序：先锁 User 行再锁货品行，串行化同一用户的并发购买，
    # 并在锁内重读余额/主题色状态（populate_existing 刷新 ORM 快照）。
    await db.execute(
        select(User)
        .where(User.id == user.id, User.tenant_id == user.tenant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    item = (
        await db.execute(
            select(CoinShopItem)
            .where(
                CoinShopItem.tenant_id == user.tenant_id,
                CoinShopItem.id == item_id,
                CoinShopItem.is_active.is_(True),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if item is None:
        raise ShopError("货品不存在或已下架")
    if item.stock is not None and item.stock <= 0:
        raise ShopError("货品已售罄")
    if item.effect == "accent_unlock" and user.accent_unlocked:
        raise ShopError("你已经解锁过自定义主题色")
    balance = int(user.coin_balance or 0)
    if balance < item.price_coin:
        raise ShopError(f"积分不足，还差 {item.price_coin - balance} 积分")

    # 原子扣减：余额守卫 + 行锁 + CHECK 约束三重防线。rowcount!=1 → 余额不足。
    debit = await db.execute(
        update(User)
        .where(
            User.id == user.id,
            User.tenant_id == user.tenant_id,
            User.coin_balance >= item.price_coin,
        )
        .values(coin_balance=User.coin_balance - item.price_coin)
        .execution_options(synchronize_session=False)
    )
    if getattr(debit, "rowcount", 0) != 1:
        raise ShopError("积分不足")

    if item.stock is not None:
        restock = await db.execute(
            update(CoinShopItem)
            .where(CoinShopItem.id == item.id, CoinShopItem.stock > 0)
            .values(stock=CoinShopItem.stock - 1)
            .execution_options(synchronize_session=False)
        )
        if getattr(restock, "rowcount", 0) != 1:
            # 售罄：抛错回滚整个事务（含上面的扣款），不会负库存/扣钱不发货。
            raise ShopError("货品已售罄")

    status = "paid"
    note = "待管理员人工发货"
    if item.effect == "accent_unlock":
        user.accent_unlocked = True
        status = "fulfilled"
        note = "已自动解锁自定义主题色"
    purchase = CoinPurchase(
        tenant_id=user.tenant_id,
        user_id=user.id,
        item_id=item.id,
        item_name=item.name,
        price_coin=item.price_coin,
        status=status,
        note=note,
    )
    db.add(purchase)
    await db.flush()  # 取得 purchase.id

    # 确定性 ref_id：台账↔订单 1:1，可重放对账（替代 uuid4 随机 ref）。
    db.add(
        PointEvent(
            tenant_id=user.tenant_id,
            user_id=user.id,
            identity=COIN_IDENTITY,
            delta=-item.price_coin,
            reason="shop.item",
            ref_type="shop_item",
            ref_id=f"purchase:{purchase.id}",
            note=item.name,
        )
    )
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ShopConflictError("订单台账冲突（重复购买）") from exc

    await db.commit()
    await db.refresh(user)
    await db.refresh(purchase)
    return {
        "purchase_id": purchase.id,
        "item": item.name,
        "price_coin": item.price_coin,
        "balance": int(user.coin_balance or 0),
        "status": status,
        "note": note,
    }
