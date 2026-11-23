"""Reviewer quarterly calibration (P1-10).

同一篇作品通常有多位互评成员。季度校准不评价“谁对谁错”，只把每位互评成员
相对同稿共识的平均偏移、绝对偏移和推荐分布摆出来，供主编在下一季度
定向沟通。只有编辑可见；不自动降级/封禁任何人。
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from statistics import mean
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_editor, require_tenant_id
from app.core.db import get_db
from app.core.time import utcnow
from app.domain.review.models import (
    ReviewAssignment,
    ReviewCalibrationSample,
    ReviewReport,
)
from app.domain.submission.models import Submission
from app.models import AuditLog, User

router = APIRouter(prefix="/calibration", tags=["review-calibration"])


class CalibrationReviewerRow(BaseModel):
    reviewer_id: int
    username: str
    completed_reviews: int
    avg_score: float | None = None
    avg_deviation: float | None = None
    avg_abs_deviation: float | None = None
    accept_rate: float | None = None
    flags: list[str] = Field(default_factory=list)


class CalibrationResponse(BaseModel):
    year: int
    quarter: int
    period_start: datetime
    period_end: datetime
    submission_count: int
    reviewers: list[CalibrationReviewerRow]
    generated_at: datetime


def _quarter_bounds(year: int, quarter: int) -> tuple[datetime, datetime]:
    if quarter < 1 or quarter > 4:
        raise ValueError("quarter must be 1–4")
    start_month = (quarter - 1) * 3 + 1
    start = datetime(year, start_month, 1, tzinfo=UTC)
    if quarter == 4:
        end = datetime(year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(year, start_month + 3, 1, tzinfo=UTC)
    return start, end


def _overall_score(scores: Any) -> float | None:
    if not isinstance(scores, dict):
        return None
    raw = scores.get("score")
    if isinstance(raw, (int, float)):
        return float(raw)
    dimensions = scores.get("dimensions")
    if not isinstance(dimensions, dict):
        return None
    values: list[float] = []
    for item in dimensions.values():
        if isinstance(item, dict) and isinstance(item.get("score"), (int, float)):
            values.append(float(item["score"]))
    return mean(values) if values else None


def _recommendation_value(recommendation: str) -> float:
    return {
        "accept": 1.0,
        "minor_revision": 0.75,
        "major_revision": 0.25,
        "reject": 0.0,
    }.get(recommendation, 0.5)


@router.get("", response_model=CalibrationResponse)
async def reviewer_calibration(
    year: int | None = Query(default=None, ge=2000, le=2100),
    quarter: int | None = Query(default=None, ge=1, le=4),
    _: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> CalibrationResponse:
    tenant_id = require_tenant_id()
    now = utcnow()
    target_year = year or now.year
    target_quarter = quarter or ((now.month - 1) // 3 + 1)
    start, end = _quarter_bounds(target_year, target_quarter)

    rows = (
        await db.execute(
            select(
                ReviewAssignment.reviewer_id,
                User.username,
                ReviewAssignment.submission_id,
                ReviewReport.scores,
                ReviewReport.recommendation,
            )
            .join(ReviewReport, ReviewReport.assignment_id == ReviewAssignment.id)
            .join(User, User.id == ReviewAssignment.reviewer_id)
            .where(
                ReviewAssignment.tenant_id == tenant_id,
                ReviewAssignment.status == "completed",
                ReviewAssignment.completed_at.is_not(None),
                ReviewAssignment.completed_at >= start,
                ReviewAssignment.completed_at < end,
                ReviewReport.tenant_id == tenant_id,
            )
        )
    ).all()

    # submission -> list of (reviewer_id, score)
    by_submission: dict[int, list[tuple[int, float]]] = defaultdict(list)
    for row in rows:
        score = _overall_score(row.scores)
        if score is not None:
            by_submission[row.submission_id].append((row.reviewer_id, score))

    deviations: dict[int, list[float]] = defaultdict(list)
    abs_deviations: dict[int, list[float]] = defaultdict(list)
    for reports in by_submission.values():
        if len(reports) < 2:
            continue
        consensus = mean(score for _, score in reports)
        for reviewer_id, score in reports:
            deviations[reviewer_id].append(score - consensus)
            abs_deviations[reviewer_id].append(abs(score - consensus))

    scores_by_reviewer: dict[int, list[float]] = defaultdict(list)
    recommendations_by_reviewer: dict[int, list[float]] = defaultdict(list)
    names: dict[int, str] = {}
    for row in rows:
        names[row.reviewer_id] = row.username
        score = _overall_score(row.scores)
        if score is not None:
            scores_by_reviewer[row.reviewer_id].append(score)
        recommendations_by_reviewer[row.reviewer_id].append(
            _recommendation_value(row.recommendation)
        )

    result: list[CalibrationReviewerRow] = []
    for reviewer_id, name in sorted(names.items(), key=lambda item: item[1]):
        count = len(recommendations_by_reviewer[reviewer_id])
        avg_score = (
            mean(scores_by_reviewer[reviewer_id]) if scores_by_reviewer[reviewer_id] else None
        )
        avg_dev = mean(deviations[reviewer_id]) if deviations[reviewer_id] else None
        avg_abs = mean(abs_deviations[reviewer_id]) if abs_deviations[reviewer_id] else None
        accept_rate = sum(recommendations_by_reviewer[reviewer_id]) / count * 100 if count else None
        flags: list[str] = []
        if count < 2:
            flags.append("insufficient_volume")
        if avg_dev is not None and avg_dev <= -8:
            flags.append("harsh")
        if avg_dev is not None and avg_dev >= 8:
            flags.append("lenient")
        if avg_abs is not None and avg_abs >= 15:
            flags.append("high_variance")
        result.append(
            CalibrationReviewerRow(
                reviewer_id=reviewer_id,
                username=name,
                completed_reviews=count,
                avg_score=round(avg_score, 1) if avg_score is not None else None,
                avg_deviation=round(avg_dev, 1) if avg_dev is not None else None,
                avg_abs_deviation=round(avg_abs, 1) if avg_abs is not None else None,
                accept_rate=round(accept_rate, 1) if accept_rate is not None else None,
                flags=flags,
            )
        )

    return CalibrationResponse(
        year=target_year,
        quarter=target_quarter,
        period_start=start,
        period_end=end,
        submission_count=len(by_submission),
        reviewers=result,
        generated_at=now,
    )


class CalibrationSampleScore(BaseModel):
    label: str
    score: float
    recommendation: str


class CalibrationSampleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    year: int
    quarter: int
    submission_id: int
    title: str
    abstract: str
    discipline: str
    reviewer_scores: list[CalibrationSampleScore]
    consensus_score: float | None = None
    score_spread: float | None = None
    review_count: int
    created_at: datetime


class CalibrationSampleListResponse(BaseModel):
    year: int
    quarter: int
    period_start: datetime
    period_end: datetime
    samples: list[CalibrationSampleResponse]


class CalibrationSampleCreate(BaseModel):
    year: int | None = Field(default=None, ge=2000, le=2100)
    quarter: int | None = Field(default=None, ge=1, le=4)


async def _existing_samples(
    db: AsyncSession, *, tenant_id: Any, year: int, quarter: int
) -> list[ReviewCalibrationSample]:
    return list(
        (
            await db.execute(
                select(ReviewCalibrationSample)
                .where(
                    ReviewCalibrationSample.tenant_id == tenant_id,
                    ReviewCalibrationSample.year == year,
                    ReviewCalibrationSample.quarter == quarter,
                )
                .order_by(ReviewCalibrationSample.id.asc())
            )
        )
        .scalars()
        .all()
    )


def _sample_payload(
    sample: ReviewCalibrationSample,
) -> CalibrationSampleResponse:
    return CalibrationSampleResponse(
        id=sample.id,
        year=sample.year,
        quarter=sample.quarter,
        submission_id=sample.submission_id,
        title=sample.title,
        abstract=sample.abstract,
        discipline=sample.discipline or "",
        reviewer_scores=[
            CalibrationSampleScore(
                label=str(item.get("label", "A")),
                score=float(item.get("score", 0)),
                recommendation=str(item.get("recommendation", "")),
            )
            for item in (sample.reviewer_scores or [])
            if isinstance(item, dict)
        ],
        consensus_score=sample.consensus_score,
        score_spread=sample.score_spread,
        review_count=sample.review_count,
        created_at=sample.created_at,
    )


@router.get("/samples", response_model=CalibrationSampleListResponse)
async def list_calibration_samples(
    year: int | None = Query(default=None, ge=2000, le=2100),
    quarter: int | None = Query(default=None, ge=1, le=4),
    _: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> CalibrationSampleListResponse:
    tenant_id = require_tenant_id()
    now = utcnow()
    target_year = year or now.year
    target_quarter = quarter or ((now.month - 1) // 3 + 1)
    start, end = _quarter_bounds(target_year, target_quarter)
    samples = await _existing_samples(
        db, tenant_id=tenant_id, year=target_year, quarter=target_quarter
    )
    return CalibrationSampleListResponse(
        year=target_year,
        quarter=target_quarter,
        period_start=start,
        period_end=end,
        samples=[_sample_payload(item) for item in samples],
    )


@router.post("/samples", response_model=CalibrationSampleListResponse)
async def create_calibration_samples(
    body: CalibrationSampleCreate,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> CalibrationSampleListResponse:
    """Idempotently take up to five blind samples for a quarter.

    A sample is only eligible when at least two reviewers submitted a score
    in that quarter. Re-running the endpoint returns the original snapshot
    rather than silently replacing a calibration set mid-quarter.
    """
    tenant_id = require_tenant_id()
    now = utcnow()
    target_year = body.year or now.year
    target_quarter = body.quarter or ((now.month - 1) // 3 + 1)
    start, end = _quarter_bounds(target_year, target_quarter)
    existing = await _existing_samples(
        db, tenant_id=tenant_id, year=target_year, quarter=target_quarter
    )
    if existing:
        return CalibrationSampleListResponse(
            year=target_year,
            quarter=target_quarter,
            period_start=start,
            period_end=end,
            samples=[_sample_payload(item) for item in existing],
        )

    rows = (
        await db.execute(
            select(
                Submission.id,
                Submission.title,
                Submission.abstract,
                Submission.discipline,
                ReviewAssignment.reviewer_id,
                ReviewReport.scores,
                ReviewReport.recommendation,
            )
            .join(ReviewAssignment, ReviewAssignment.submission_id == Submission.id)
            .join(ReviewReport, ReviewReport.assignment_id == ReviewAssignment.id)
            .where(
                Submission.tenant_id == tenant_id,
                Submission.status.in_(("accepted", "approved", "under_review", "resubmitted")),
                ReviewAssignment.tenant_id == tenant_id,
                ReviewAssignment.status == "completed",
                ReviewAssignment.completed_at.is_not(None),
                ReviewAssignment.completed_at >= start,
                ReviewAssignment.completed_at < end,
                ReviewReport.tenant_id == tenant_id,
            )
        )
    ).all()

    by_submission: dict[int, dict[str, Any]] = {}
    for row in rows:
        score = _overall_score(row.scores)
        if score is None:
            continue
        entry = by_submission.setdefault(
            int(row.id),
            {
                "title": row.title,
                "abstract": row.abstract,
                "discipline": row.discipline,
                "scores": [],
            },
        )
        entry["scores"].append((score, row.recommendation))

    eligible = [(sid, data) for sid, data in by_submission.items() if len(data["scores"]) >= 2]
    eligible.sort(key=lambda item: (-len(item[1]["scores"]), item[0]))
    created = 0
    for submission_id, data in eligible[:5]:
        scores = [score for score, _ in data["scores"]]
        reviewer_scores = [
            {
                "label": chr(ord("A") + index),
                "score": round(score, 1),
                "recommendation": recommendation,
            }
            for index, (score, recommendation) in enumerate(
                sorted(data["scores"], key=lambda pair: pair[0])
            )
        ]
        db.add(
            ReviewCalibrationSample(
                tenant_id=tenant_id,
                year=target_year,
                quarter=target_quarter,
                submission_id=submission_id,
                title=data["title"],
                abstract=data["abstract"],
                discipline=data["discipline"] or "",
                reviewer_scores=reviewer_scores,
                consensus_score=round(mean(scores), 1),
                score_spread=round(max(scores) - min(scores), 1),
                review_count=len(scores),
                created_by=current_user.id,
                created_at=now,
            )
        )
        created += 1
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action="review.calibration_samples",
            target_type="calibration_period",
            target_id=f"{target_year}Q{target_quarter}",
            payload={"created": created, "eligible": len(eligible)},
        )
    )
    await db.commit()
    samples = await _existing_samples(
        db, tenant_id=tenant_id, year=target_year, quarter=target_quarter
    )
    return CalibrationSampleListResponse(
        year=target_year,
        quarter=target_quarter,
        period_start=start,
        period_end=end,
        samples=[_sample_payload(item) for item in samples],
    )
