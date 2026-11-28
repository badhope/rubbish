"""HTTP response serialization for submissions.

Serialization is an inbound-adapter concern: business code returns ORM
objects, only this module knows the public JSON shape.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import paginate
from app.core.tenant import require_tenant_id
from app.core.tracks import normalize_track
from app.domain.catalog.models import Resource
from app.domain.submission.models import Submission, SubmissionVersion
from app.interfaces.http.submission.schemas import SubmissionListResponse, SubmissionResponse


async def _get_or_404(db: AsyncSession, submission_id: int, *, lock: bool = False) -> Submission:
    """Fetch a submission by id (scoped to current tenant) or raise 404.

    ``lock=True`` adds ``FOR UPDATE`` so concurrent decisions/assignments
    serialize on the row instead of racing read-modify-write (SQLite: no-op).
    """
    tenant_id = require_tenant_id()
    stmt = select(Submission).where(
        Submission.id == submission_id,
        Submission.tenant_id == tenant_id,
    )
    if lock:
        stmt = stmt.with_for_update()
    entry = (await db.execute(stmt)).scalar_one_or_none()
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submission not found",
        )
    return entry


def _to_response(
    entry: Submission, review_stats: dict[Any, Any] | None = None
) -> SubmissionResponse:
    stats = review_stats or {}
    return SubmissionResponse(
        id=entry.id,
        title=entry.title,
        type=entry.type,
        track=normalize_track(getattr(entry, "track", None)),
        authors=entry.authors,
        author_affiliations=getattr(entry, "author_affiliations", None) or [],
        year=entry.year,
        venue=entry.venue,
        discipline=entry.discipline,
        subdiscipline=entry.subdiscipline,
        article_section=getattr(entry, "article_section", None),
        issue_part=getattr(entry, "issue_part", None),
        keywords=entry.keywords or [],
        jel_codes=entry.jel_codes or [],
        tags=entry.tags,
        abstract=entry.abstract,
        preview=entry.preview,
        download_url=entry.download_url,
        external_url=entry.external_url,
        anonymized_file_url=entry.anonymized_file_url,
        doi=entry.doi,
        corresponding_author_email=entry.corresponding_author_email,
        license=getattr(entry, "license", None),
        author_contributions=getattr(entry, "author_contributions", None),
        funding=getattr(entry, "funding", None),
        coi_statement=getattr(entry, "coi_statement", None),
        data_availability=getattr(entry, "data_availability", None),
        status=entry.status,
        latest_version=int(stats.get("latest_version", 1) or 1),
        admin_note=entry.admin_note,
        editor_note=entry.editor_note,
        rework_requirements=getattr(entry, "rework_requirements", None) or [],
        rework_due_at=getattr(entry, "rework_due_at", None),
        withdrawn_at=getattr(entry, "withdrawn_at", None),
        withdrawn_reason=getattr(entry, "withdrawn_reason", None),
        author_response=getattr(entry, "author_response", None),
        author_response_at=getattr(entry, "author_response_at", None),
        resource_id=entry.resource_id,
        similarity_score=getattr(entry, "similarity_score", None),
        similarity_matches=getattr(entry, "similarity_matches", None) or [],
        cover_image=entry.cover_image,
        file_path=entry.file_path,
        markdown_path=entry.markdown_path,
        source=getattr(entry, "source", "human"),
        submitted_by=entry.submitted_by,
        submitted_at=entry.submitted_at,
        reviewed_by=entry.reviewed_by,
        reviewed_at=entry.reviewed_at,
        triage_status=getattr(entry, "triage_status", None),
        triage_note=getattr(entry, "triage_note", None),
        triaged_at=getattr(entry, "triaged_at", None),
        triaged_by=getattr(entry, "triaged_by", None),
        triage_started_at=getattr(entry, "triage_started_at", None),
        triage_reminded_at=getattr(entry, "triage_reminded_at", None),
        triage_reminder_count=int(getattr(entry, "triage_reminder_count", 0) or 0),
        reports_completed=stats.get("reports_completed", 0),
        distinct_reviewers=stats.get("distinct_reviewers", 0),
        accept_recommendations=stats.get("accept_recommendations", 0),
        reject_recommendations=stats.get("reject_recommendations", 0),
        can_decide=stats.get("can_decide", False),
        review_waived=stats.get("review_waived", False),
        conflict=stats.get("conflict", False),
        adjudicator_assigned=stats.get("adjudicator_assigned", False),
        adjudicator_accepted=stats.get("adjudicator_accepted", False),
    )


async def _review_stats_for_submissions(
    db: AsyncSession, ids: list[int], tenant_id: str
) -> dict[int, dict[str, Any]]:
    """批量算当前轮互评进度，避免列表把“已有 1 份意见”显示成 0。"""
    if not ids:
        return {}
    from app.domain.review.models import ReviewAssignment, ReviewReport

    waived_rows = (
        await db.execute(
            select(Submission.id).where(
                Submission.id.in_(ids),
                Submission.tenant_id == tenant_id,
                Submission.review_waived_at.is_not(None),
            )
        )
    ).all()
    waived_ids = {int(row[0]) for row in waived_rows}

    rows = (
        await db.execute(
            select(
                ReviewAssignment.submission_id,
                ReviewAssignment.reviewer_id,
                ReviewAssignment.round,
                ReviewAssignment.is_adjudicator,
                ReviewReport.recommendation,
            )
            .join(ReviewReport, ReviewReport.assignment_id == ReviewAssignment.id)
            .where(
                ReviewAssignment.submission_id.in_(ids),
                ReviewAssignment.tenant_id == tenant_id,
                # 与 /decision 的 _ensure_accept_gate 同口径：退回/重投后
                # 旧轮 assignment 被置 cancelled，报告仍在但不能再算作本轮
                # 完成数，否则列表会显示“可裁决”而裁决接口 409。
                ReviewAssignment.status == "completed",
            )
        )
    ).all()
    # 当前轮必须按“全部指派”计算，而不是按“已有完成报告的轮次”。
    # 如果第 2 轮已指派但还没交报告，列表不能退回用第 1 轮的通过报告
    # 显示可裁决，否则又会和 /decision 的当前轮闸门错位。
    round_rows = (
        await db.execute(
            select(
                ReviewAssignment.submission_id,
                func.max(ReviewAssignment.round),
            )
            .where(
                ReviewAssignment.submission_id.in_(ids),
                ReviewAssignment.tenant_id == tenant_id,
            )
            .group_by(ReviewAssignment.submission_id)
        )
    ).all()
    current_round_by_sub = {
        int(submission_id): int(round_no or 1) for submission_id, round_no in round_rows
    }
    adjudicator_rows = (
        await db.execute(
            select(
                ReviewAssignment.submission_id,
                ReviewAssignment.round,
            ).where(
                ReviewAssignment.submission_id.in_(ids),
                ReviewAssignment.tenant_id == tenant_id,
                ReviewAssignment.is_adjudicator.is_(True),
                ReviewAssignment.status.in_(("pending", "accepted", "completed")),
            )
        )
    ).all()
    adjudicator_by_sub = {
        int(submission_id)
        for submission_id, round_no in adjudicator_rows
        if int(round_no or 1) == current_round_by_sub.get(int(submission_id), 1)
    }
    # 返修稿识别：作者每重投一次追加一个版本。只取最大版本号，不把
    # 旧版本行数当成“返修次数”误报（并发重投可能曾经撞号重试）。
    version_rows = (
        await db.execute(
            select(SubmissionVersion.submission_id, func.max(SubmissionVersion.version))
            .where(
                SubmissionVersion.submission_id.in_(ids),
                SubmissionVersion.tenant_id == tenant_id,
            )
            # PostgreSQL 不会像 SQLite 那样容忍“选了分组键却不写 GROUP BY”。
            # 生产列表一次查多条投稿，漏掉分组会直接 500；SQLite 测试发现不了。
            .group_by(SubmissionVersion.submission_id)
        )
    ).all()
    latest_version_by_sub = {
        int(submission_id): int(version_no)
        for submission_id, version_no in version_rows
        if submission_id is not None and version_no is not None
    }
    by_sub: dict[int, list[Any]] = {}
    for r in rows:
        by_sub.setdefault(r[0], []).append(r)
    # 先给每个投稿放一份零值，免审通过的投稿即便没有 completed 报告，
    # 列表也能显示 can_decide=true，与 /{id}/decision 的免审早退一致。
    out: dict[int, dict[str, Any]] = {
        int(sid): {
            "reports_completed": 0,
            "distinct_reviewers": 0,
            "accept_recommendations": 0,
            "reject_recommendations": 0,
            "conflict": False,
            "adjudicator_assigned": int(sid) in adjudicator_by_sub,
            "adjudicator_accepted": False,
            "can_decide": int(sid) in waived_ids,
            "review_waived": int(sid) in waived_ids,
            "latest_version": latest_version_by_sub.get(int(sid), 1),
        }
        for sid in ids
    }
    for sid, rs in by_sub.items():
        current_round = current_round_by_sub.get(int(sid), 1)
        cur = [x for x in rs if (x[2] or 1) == current_round and x[4] is not None]
        accept_ids = {x[1] for x in cur if x[4] == "accept"}
        reject = sum(1 for x in cur if x[4] == "reject")
        major = sum(1 for x in cur if x[4] == "major_revision")
        adj_rows = [x for x in rs if (x[2] or 1) == current_round and x[3]]
        adj_accept = any(x[4] == "accept" for x in adj_rows)
        conflict = bool(accept_ids) and (reject > 0 or major > 0)
        out[int(sid)] = {
            "reports_completed": len(cur),
            "distinct_reviewers": len({x[1] for x in cur}),
            "accept_recommendations": len(accept_ids),
            "reject_recommendations": reject,
            "conflict": conflict,
            "adjudicator_assigned": int(sid) in adjudicator_by_sub,
            "adjudicator_accepted": adj_accept,
            "can_decide": (
                int(sid) in waived_ids or (len(accept_ids) >= 1 and (not conflict or adj_accept))
            ),
            "review_waived": int(sid) in waived_ids,
            "latest_version": latest_version_by_sub.get(int(sid), 1),
        }
    return out


async def _list_submissions(
    db: AsyncSession,
    base_query: Any,
    page: int,
    page_size: int,
) -> SubmissionListResponse:
    """Paginate + serialize a submission query."""
    rows, meta = await paginate(
        db,
        base_query,
        page=page,
        page_size=page_size,
        order_by=(desc(Submission.submitted_at), Submission.id.asc()),
    )
    tenant_id = rows[0].tenant_id if rows else None
    stats = (
        await _review_stats_for_submissions(db, [r.id for r in rows], tenant_id)
        if tenant_id
        else {}
    )
    responses = [_to_response(r, stats.get(r.id)) for r in rows]
    resource_status: dict[int, str] = {}
    resource_ids = {r.resource_id for r in rows if r.resource_id is not None}
    if resource_ids:
        resource_rows = (
            await db.execute(
                select(Resource.id, Resource.publication_status).where(
                    Resource.id.in_(resource_ids)
                )
            )
        ).all()
        resource_status = {int(resource_id): str(status) for resource_id, status in resource_rows}
    for response, entry in zip(responses, rows, strict=True):
        if entry.resource_id is not None:
            response.resource_publication_status = resource_status.get(int(entry.resource_id))
    return SubmissionListResponse(
        data=responses,
        meta=meta,
    )
