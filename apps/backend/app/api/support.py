"""Public support surface + admin ledger for the P2 brand/funding work.

Two concerns share one module because they are both "public accountability":

- ``/support/subscribe``: double opt-in email list for the editor's desk.
  Only a SHA-256 hash of the token is stored; the raw token appears once in
  the confirmation email.
- ``/support/reports``: quarterly cost ledger and editor letter. Drafts are
  admin-only; the public only sees explicitly published reports.

No cost numbers are seeded here. An empty ledger must render as "not yet
published", never as invented figures.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin, require_tenant_id
from app.core import email as email_module
from app.core.config import settings
from app.core.db import get_db
from app.core.email import smtp_configured
from app.core.email_templates import desk_subscribe_confirm
from app.core.time import utcnow
from app.models import DeskSubscriber, FinanceReport, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/support", tags=["support"])
admin_router = APIRouter(prefix="/admin", tags=["support-admin"])

TokenAction = Literal["confirm", "unsubscribe"]


def _site_base() -> str:
    base = (settings.public_base_url or settings.frontend_base_url or "").strip()
    if not base:
        # Only dev/test should hit this; production sets RUBBISH_PUBLIC_BASE_URL.
        base = "http://localhost:5173"
    return base.rstrip("/")


def _token_hash(raw: str) -> str:
    # A deployment-specific pepper means a leaked database row cannot be
    # turned into a working confirmation link without the app secret.
    key = (settings.secret_key or "rubbish-desk").encode("utf-8")
    return hmac.new(key, raw.encode("utf-8"), hashlib.sha256).hexdigest()


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; normalize before comparing."""
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    if not domain:
        return "***"
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}***@{domain}"


# ---------------------------------------------------------------------------
# Email subscription
# ---------------------------------------------------------------------------


class SubscribeRequest(BaseModel):
    email: EmailStr
    source: str = Field(default="desk", max_length=40)


class SubscribeResponse(BaseModel):
    ok: bool
    message: str


class TokenRequest(BaseModel):
    token: str = Field(min_length=16, max_length=200)


class SubscriptionStatusResponse(BaseModel):
    mail_configured: bool
    confirmed_count: int
    pending_count: int


class TokenResultResponse(BaseModel):
    ok: bool
    status: Literal["confirmed", "unsubscribed", "invalid", "expired"]
    email_masked: str | None = None
    message: str


@router.get("/subscription", response_model=SubscriptionStatusResponse)
async def subscription_status(
    db: AsyncSession = Depends(get_db),
    tenant_id=Depends(require_tenant_id),
) -> SubscriptionStatusResponse:
    """Counts only — never expose subscriber addresses publicly."""
    confirmed = int(
        (
            await db.execute(
                select(func.count())
                .select_from(DeskSubscriber)
                .where(
                    DeskSubscriber.tenant_id == tenant_id,
                    DeskSubscriber.status == "confirmed",
                )
            )
        ).scalar_one()
    )
    pending = int(
        (
            await db.execute(
                select(func.count())
                .select_from(DeskSubscriber)
                .where(
                    DeskSubscriber.tenant_id == tenant_id,
                    DeskSubscriber.status == "pending",
                )
            )
        ).scalar_one()
    )
    return SubscriptionStatusResponse(
        mail_configured=bool(smtp_configured() and settings.email_outbound_enabled),
        confirmed_count=confirmed,
        pending_count=pending,
    )


@router.post("/subscribe", response_model=SubscribeResponse, status_code=202)
async def subscribe(
    payload: SubscribeRequest,
    db: AsyncSession = Depends(get_db),
    tenant_id=Depends(require_tenant_id),
) -> SubscribeResponse:
    """Create or rotate a pending subscription.

    The response is deliberately indistinguishable for new, existing and
    already-confirmed addresses so the endpoint cannot be used to enumerate
    who reads the journal.
    """
    email = str(payload.email).strip().lower()
    source = (payload.source or "desk").strip()[:40] or "desk"
    now = utcnow()
    existing = (
        await db.execute(
            select(DeskSubscriber).where(
                DeskSubscriber.tenant_id == tenant_id,
                DeskSubscriber.email == email,
            )
        )
    ).scalar_one_or_none()

    if existing is not None and existing.status == "confirmed":
        return SubscribeResponse(
            ok=True,
            message="如果该邮箱尚未订阅，我们会发送一封确认邮件；请以收到邮件为准。",
        )

    send_mail = True
    if existing is None:
        raw_token = secrets.token_urlsafe(32)
        subscriber = DeskSubscriber(
            tenant_id=tenant_id,
            email=email,
            token_hash=_token_hash(raw_token),
            token_expires_at=now + timedelta(days=7),
            status="pending",
            source=source,
            last_email_at=now,
        )
        db.add(subscriber)
    elif existing.status == "pending" and existing.last_email_at is not None:
        # Resend cooldown: an anonymous caller must not be able to turn a
        # public form into an email bomb aimed at one address.
        last_email_at = _as_utc(existing.last_email_at)
        if last_email_at is not None and last_email_at > now - timedelta(minutes=10):
            send_mail = False
            raw_token = ""
        else:
            raw_token = secrets.token_urlsafe(32)
            existing.token_hash = _token_hash(raw_token)
            existing.token_expires_at = now + timedelta(days=7)
            existing.source = source
            existing.last_email_at = now
    else:
        raw_token = secrets.token_urlsafe(32)
        existing.token_hash = _token_hash(raw_token)
        existing.token_expires_at = now + timedelta(days=7)
        existing.status = "pending"
        existing.source = source
        existing.last_email_at = now
        existing.confirmed_at = None
        existing.unsubscribed_at = None

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        logger.warning("desk_subscribe_duplicate_race", email_hash=_token_hash(email)[:12])
        return SubscribeResponse(
            ok=True,
            message="如果该邮箱尚未订阅，我们会发送一封确认邮件；请以收到邮件为准。",
        )

    sent = False
    if send_mail and raw_token:
        base = _site_base()
        confirm_url = f"{base}/desk/subscribe?token={raw_token}&action=confirm"
        unsubscribe_url = f"{base}/desk/subscribe?token={raw_token}&action=unsubscribe"
        subject, text, html = desk_subscribe_confirm(confirm_url, unsubscribe_url, 7)
        try:
            await email_module.get_email_sender().send(
                to=email,
                subject=subject,
                body=text,
                html=html,
            )
            sent = True
        except Exception:
            # The subscriber row stays pending and is visible to admins, so
            # a failed send is recoverable instead of silently lost.
            logger.warning("desk_subscribe_email_failed", exc_info=True)

    message = (
        "确认邮件已发送。请打开邮件里的链接完成订阅；若未收到，请检查垃圾邮件箱。"
        if sent
        else "订阅信息已登记，但邮件暂时没有发出。请稍后重试；如果持续失败，管理员可在后台看到这条待确认记录。"
    )
    return SubscribeResponse(ok=True, message=message)


@router.post("/confirm", response_model=TokenResultResponse)
async def confirm_subscription(
    payload: TokenRequest,
    db: AsyncSession = Depends(get_db),
    tenant_id=Depends(require_tenant_id),
) -> TokenResultResponse:
    token_hash = _token_hash(payload.token.strip())
    subscriber = (
        await db.execute(
            select(DeskSubscriber).where(
                DeskSubscriber.tenant_id == tenant_id,
                DeskSubscriber.token_hash == token_hash,
            )
        )
    ).scalar_one_or_none()
    if subscriber is None:
        return TokenResultResponse(
            ok=False,
            status="invalid",
            message="链接无效或已失效，请重新提交订阅。",
        )
    now = utcnow()
    if subscriber.status == "confirmed":
        return TokenResultResponse(
            ok=True,
            status="confirmed",
            email_masked=_mask_email(subscriber.email),
            message="这个邮箱已经确认订阅。",
        )
    if subscriber.status == "pending" and subscriber.token_expires_at is not None:
        expires = _as_utc(subscriber.token_expires_at)
        if expires is not None and expires < now:
            return TokenResultResponse(
                ok=False,
                status="expired",
                message="确认链接已过期，请回到主编桌重新提交订阅。",
            )
    subscriber.status = "confirmed"
    subscriber.confirmed_at = now
    subscriber.unsubscribed_at = None
    subscriber.token_expires_at = None
    await db.commit()
    return TokenResultResponse(
        ok=True,
        status="confirmed",
        email_masked=_mask_email(subscriber.email),
        message="订阅已确认。之后只会在季度公开信与编辑部重要更新时发信。",
    )


@router.post("/unsubscribe", response_model=TokenResultResponse)
async def unsubscribe(
    payload: TokenRequest,
    db: AsyncSession = Depends(get_db),
    tenant_id=Depends(require_tenant_id),
) -> TokenResultResponse:
    token_hash = _token_hash(payload.token.strip())
    subscriber = (
        await db.execute(
            select(DeskSubscriber).where(
                DeskSubscriber.tenant_id == tenant_id,
                DeskSubscriber.token_hash == token_hash,
            )
        )
    ).scalar_one_or_none()
    if subscriber is None:
        return TokenResultResponse(
            ok=False,
            status="invalid",
            message="退订链接无效或已失效。",
        )
    subscriber.status = "unsubscribed"
    subscriber.unsubscribed_at = utcnow()
    subscriber.token_expires_at = None
    await db.commit()
    return TokenResultResponse(
        ok=True,
        status="unsubscribed",
        email_masked=_mask_email(subscriber.email),
        message="已退订。之后不会再收到主编桌邮件。",
    )


# ---------------------------------------------------------------------------
# Quarterly finance reports
# ---------------------------------------------------------------------------


class MoneyItem(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    amount_cents: int = Field(ge=0, le=10_000_000_000)
    note: str = Field(default="", max_length=200)


class FinanceReportUpsert(BaseModel):
    year: int = Field(ge=2020, le=2100)
    quarter: int = Field(ge=1, le=4)
    title: str = Field(min_length=1, max_length=200)
    summary_md: str = Field(default="", max_length=20_000)
    income_items: list[MoneyItem] = Field(default_factory=list, max_length=30)
    expense_items: list[MoneyItem] = Field(default_factory=list, max_length=30)
    currency: Literal["CNY"] = "CNY"
    published: bool = False


class FinanceReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    year: int
    quarter: int
    title: str
    summary_md: str
    income_items: list[dict[str, Any]]
    expense_items: list[dict[str, Any]]
    currency: str
    published: bool
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    created_by: int | None = None


class FinanceReportListResponse(BaseModel):
    items: list[FinanceReportResponse]
    total: int


def _as_response(report: FinanceReport) -> FinanceReportResponse:
    return FinanceReportResponse.model_validate(report)


@router.get("/reports", response_model=FinanceReportListResponse)
async def public_reports(
    limit: int = Query(default=8, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
    tenant_id=Depends(require_tenant_id),
) -> FinanceReportListResponse:
    stmt = (
        select(FinanceReport)
        .where(
            FinanceReport.tenant_id == tenant_id,
            FinanceReport.published.is_(True),
        )
        .order_by(
            FinanceReport.year.desc(),
            FinanceReport.quarter.desc(),
            FinanceReport.id.desc(),
        )
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    total = int(
        (
            await db.execute(
                select(func.count())
                .select_from(FinanceReport)
                .where(
                    FinanceReport.tenant_id == tenant_id,
                    FinanceReport.published.is_(True),
                )
            )
        ).scalar_one()
    )
    return FinanceReportListResponse(
        items=[_as_response(row) for row in rows],
        total=total,
    )


@router.get("/reports/latest", response_model=FinanceReportResponse | None)
async def latest_public_report(
    db: AsyncSession = Depends(get_db),
    tenant_id=Depends(require_tenant_id),
) -> FinanceReportResponse | None:
    report = (
        await db.execute(
            select(FinanceReport)
            .where(
                FinanceReport.tenant_id == tenant_id,
                FinanceReport.published.is_(True),
            )
            .order_by(
                FinanceReport.year.desc(),
                FinanceReport.quarter.desc(),
                FinanceReport.id.desc(),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return _as_response(report) if report is not None else None


@admin_router.get("/finance/reports", response_model=FinanceReportListResponse)
async def admin_reports(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    tenant_id=Depends(require_tenant_id),
) -> FinanceReportListResponse:
    rows = (
        (
            await db.execute(
                select(FinanceReport)
                .where(FinanceReport.tenant_id == tenant_id)
                .order_by(
                    FinanceReport.year.desc(),
                    FinanceReport.quarter.desc(),
                    FinanceReport.id.desc(),
                )
            )
        )
        .scalars()
        .all()
    )
    return FinanceReportListResponse(
        items=[_as_response(row) for row in rows],
        total=len(rows),
    )


@admin_router.post("/finance/reports", response_model=FinanceReportResponse, status_code=201)
async def create_report(
    payload: FinanceReportUpsert,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    tenant_id=Depends(require_tenant_id),
) -> FinanceReportResponse:
    report = FinanceReport(
        tenant_id=tenant_id,
        year=payload.year,
        quarter=payload.quarter,
        title=payload.title.strip(),
        summary_md=payload.summary_md.strip(),
        income_items=[item.model_dump() for item in payload.income_items],
        expense_items=[item.model_dump() for item in payload.expense_items],
        currency=payload.currency,
        published=payload.published,
        published_at=utcnow() if payload.published else None,
        created_by=admin.id,
    )
    db.add(report)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{payload.year} 年第 {payload.quarter} 季度账本已存在",
        ) from exc
    await db.refresh(report)
    return _as_response(report)


@admin_router.patch("/finance/reports/{report_id}", response_model=FinanceReportResponse)
async def update_report(
    report_id: int,
    payload: FinanceReportUpsert,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    tenant_id=Depends(require_tenant_id),
) -> FinanceReportResponse:
    report = (
        await db.execute(
            select(FinanceReport).where(
                FinanceReport.id == report_id,
                FinanceReport.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=404, detail="账本不存在")
    report.year = payload.year
    report.quarter = payload.quarter
    report.title = payload.title.strip()
    report.summary_md = payload.summary_md.strip()
    report.income_items = [item.model_dump() for item in payload.income_items]
    report.expense_items = [item.model_dump() for item in payload.expense_items]
    report.currency = payload.currency
    if payload.published and not report.published_at:
        report.published_at = utcnow()
    if not payload.published:
        report.published_at = None
    report.published = payload.published
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{payload.year} 年第 {payload.quarter} 季度账本已存在",
        ) from exc
    await db.refresh(report)
    return _as_response(report)


@admin_router.delete("/finance/reports/{report_id}", status_code=204)
async def delete_report(
    report_id: int,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    tenant_id=Depends(require_tenant_id),
) -> None:
    report = (
        await db.execute(
            select(FinanceReport).where(
                FinanceReport.id == report_id,
                FinanceReport.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=404, detail="账本不存在")
    if report.published:
        raise HTTPException(status_code=409, detail="已发布账本不能直接删除，请先取消发布")
    await db.delete(report)
    await db.commit()


# ---------------------------------------------------------------------------
# Admin subscriber list
# ---------------------------------------------------------------------------


class SubscriberResponse(BaseModel):
    id: int
    email: str
    status: str
    source: str
    created_at: datetime
    confirmed_at: datetime | None
    unsubscribed_at: datetime | None


class SubscriberListResponse(BaseModel):
    items: list[SubscriberResponse]
    total: int


@admin_router.get("/desk/subscribers", response_model=SubscriberListResponse)
async def list_subscribers(
    status_filter: Literal["pending", "confirmed", "unsubscribed"] | None = Query(
        default=None, alias="status"
    ),
    limit: int = Query(default=100, ge=1, le=500),
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    tenant_id=Depends(require_tenant_id),
) -> SubscriberListResponse:
    conds = [DeskSubscriber.tenant_id == tenant_id]
    if status_filter:
        conds.append(DeskSubscriber.status == status_filter)
    rows = (
        (
            await db.execute(
                select(DeskSubscriber)
                .where(*conds)
                .order_by(DeskSubscriber.created_at.desc(), DeskSubscriber.id.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    total = int(
        (
            await db.execute(select(func.count()).select_from(DeskSubscriber).where(*conds))
        ).scalar_one()
    )
    return SubscriberListResponse(
        items=[
            SubscriberResponse(
                id=row.id,
                email=row.email,
                status=row.status,
                source=row.source,
                created_at=row.created_at,
                confirmed_at=row.confirmed_at,
                unsubscribed_at=row.unsubscribed_at,
            )
            for row in rows
        ],
        total=total,
    )


__all__ = ["admin_router", "router"]
