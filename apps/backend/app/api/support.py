"""Public cost-transparency surface + admin ledger.

The module only publishes the quarterly cost ledger and lets admins manage
draft/published reports. It does not handle donations, payment collection,
or newsletter subscriptions.

- ``/support/reports``: quarterly cost ledger. Drafts are admin-only; the
  public only sees explicitly published reports.

No cost numbers are seeded here. An empty ledger must render as "not yet
published", never as invented figures.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin, require_tenant_id
from app.core.db import get_db
from app.core.time import utcnow
from app.models import FinanceReport, User

router = APIRouter(prefix="/support", tags=["support"])
admin_router = APIRouter(prefix="/admin", tags=["support-admin"])


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
    tenant_id: UUID = Depends(require_tenant_id),
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
    tenant_id: UUID = Depends(require_tenant_id),
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
    tenant_id: UUID = Depends(require_tenant_id),
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
    tenant_id: UUID = Depends(require_tenant_id),
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
    tenant_id: UUID = Depends(require_tenant_id),
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
    tenant_id: UUID = Depends(require_tenant_id),
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


__all__ = ["admin_router", "router"]
