"""Peer-review API routes.

Reviewer side (auth + reviewer role, see deps.require_reviewer):
  GET    /review/assignments/me           — list my assignments
  GET    /review/assignments/{id}         — view one assignment + submission details
  POST   /review/assignments/{id}/accept  — accept invitation
  POST   /review/assignments/{id}/decline — decline invitation
  POST   /review/assignments/{id}/submit  — submit review report

Editor-facing assignment management lives under ``/submissions`` for
cohesion (both modules share the Submission row). See ``submission.routes``.
"""

from __future__ import annotations

import mimetypes
from collections.abc import Sequence
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import (
    ROLE_REVIEWER,
    ROLE_SENIOR_REVIEWER,
    get_current_user,
    get_current_user_optional,
    require_editor,
    require_reviewer,
    require_tenant_id,
    user_has_role,
    user_role_names,
)
from app.core.db import get_db, paginate
from app.core.storage import get_storage
from app.core.time import utcnow
from app.domain.catalog.models import Resource
from app.domain.notifications import services as notifications
from app.domain.quality.rubric import RUBRIC_VERSION, DimensionScore, dimensions_for, evaluate
from app.domain.review.blinding import (
    get_review_mode,
    redact_manuscript_identity,
    reviewer_facing_payload,
)
from app.domain.review.models import ReviewAssignment, ReviewDraft, ReviewReport
from app.domain.submission.models import Submission
from app.interfaces.http.review.calibration import router as calibration_router
from app.interfaces.http.review.coi import ensure_no_declared_conflict, name_matches_author
from app.interfaces.http.review.coi import router as coi_router
from app.interfaces.http.review.schemas import (
    AssignmentListResponse,
    AssignmentResponse,
    ExpertiseDiscipline,
    ExpertiseTag,
    PublicExpertiseResponse,
    ReviewDraftIn,
    ReviewDraftResponse,
    ReviewReportResponse,
    ReviewSubmit,
)
from app.interfaces.http.submission.schemas import SubmissionResponse
from app.models import User

router = APIRouter(prefix="/review", tags=["review"])
router.include_router(coi_router)
router.include_router(calibration_router)

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def _normalize_review_scores(scores: dict[str, Any]) -> dict[str, Any]:
    """校验并计算审稿评分：按赛道维度（学术五维 / 荒诞六维），分数必填，理由/证据/修改意见选填。

    先让审稿人能直接给分；理由和证据填写了就保留，不填也不阻断提交或
    计分。旧版报告里的自由结构（originality: 4）仍不受理新提交。
    """
    track = str(scores.get("track") or "academic")
    if track not in ("academic", "absurd"):
        raise HTTPException(status_code=422, detail="track must be 'academic' or 'absurd'")
    raw = scores.get("dimensions")
    if not isinstance(raw, dict):
        raise HTTPException(
            status_code=422,
            detail="评分必须按赛道维度提交：scores.dimensions = {key: {score, reason?, evidence?}}",
        )
    required = [k for k, _, _ in dimensions_for(track)]
    missing = [k for k in required if k not in raw]
    if missing:
        raise HTTPException(status_code=422, detail=f"缺少维度评分：{', '.join(missing)}")
    parsed: list[DimensionScore] = []
    for key in required:
        item = raw.get(key)
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail=f"{key}: 维度评分必须是对象")
        try:
            score = int(str(item.get("score")))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=f"{key}: score 必须是 0–100 整数") from exc
        if not 0 <= score <= 100:
            raise HTTPException(status_code=422, detail=f"{key}: score 必须在 0–100")
        reason = str(item.get("reason") or "").strip()
        evidence = str(item.get("evidence") or "").strip()
        suggestion = str(item.get("suggestion") or "").strip()
        parsed.append(
            DimensionScore(
                key=key, score=score, reason=reason, evidence=evidence, suggestion=suggestion
            )
        )
    result = evaluate(parsed, track=track)
    return {
        "rubric_version": RUBRIC_VERSION,
        "track": track,
        "dimensions": {
            d.key: {
                "score": d.score,
                "reason": d.reason,
                "evidence": d.evidence,
                "suggestion": d.suggestion,
                "label": result["breakdown"][d.key]["label"],  # type: ignore[index]
                "points": result["breakdown"][d.key]["points"],  # type: ignore[index]
            }
            for d in parsed
        },
        "score": result["score"],
        "uncapped_score": result["uncapped_score"],
        "cap": result["cap"],
        "cap_notes": result["cap_notes"],
        "grade": result["grade"],
        "grade_label": result["grade_label"],
        "quartile": result["quartile"],
        "complete": result["complete"],
        "incomplete_dimensions": result["incomplete_dimensions"],
        "completeness_note": result["completeness_note"],
        "editorial_completion_required": result["editorial_completion_required"],
        "completion_owner": result["completion_owner"],
        "rejected": result["rejected"],
        "integrity_veto": result["integrity_veto"],
    }


def _to_assignment_response(
    a: ReviewAssignment, *, include_submission_title: bool = False
) -> AssignmentResponse:
    return AssignmentResponse(
        id=a.id,
        submission_id=a.submission_id,
        reviewer_id=a.reviewer_id,
        assigned_by=a.assigned_by,
        status=a.status,
        due_date=a.due_date,
        invited_at=a.invited_at,
        responded_at=a.responded_at,
        completed_at=a.completed_at,
        reviewer_username=a.reviewer.username if a.reviewer else None,
        submission_title=(
            a.submission.title if include_submission_title and a.submission else None
        ),
        last_reminded_at=a.last_reminded_at,
        reminder_count=a.reminder_count,
        report_id=a.report[0].id if a.report else None,
        attachments=(a.report[0].attachments or []) if a.report else [],
        round=a.round,
        slot=a.slot,
        is_adjudicator=a.is_adjudicator,
        is_external=a.is_external,
        external_affiliation=a.external_affiliation,
    )


async def _get_assignment_or_404(db: AsyncSession, assignment_id: int) -> ReviewAssignment:
    tenant_id = require_tenant_id()
    a = (
        await db.execute(
            select(ReviewAssignment)
            .where(
                ReviewAssignment.id == assignment_id,
                ReviewAssignment.tenant_id == tenant_id,
            )
            .options(
                selectinload(ReviewAssignment.reviewer),
                selectinload(ReviewAssignment.submission),
                selectinload(ReviewAssignment.report),
            )
        )
    ).scalar_one_or_none()
    if a is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found",
        )
    return a


async def _get_assignment_for_reviewer(
    db: AsyncSession, assignment_id: int, reviewer_id: int
) -> ReviewAssignment:
    """Fetch assignment + ensure current reviewer is the assignee."""
    a = await _get_assignment_or_404(db, assignment_id)
    if a.reviewer_id != reviewer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This assignment belongs to another reviewer",
        )
    return a


_REVIEW_DRAFT_MAX_BYTES = 256 * 1024


async def _get_draft(db: AsyncSession, assignment_id: int) -> ReviewDraft | None:
    return (
        await db.execute(select(ReviewDraft).where(ReviewDraft.assignment_id == assignment_id))
    ).scalar_one_or_none()


@router.get("/assignments/{assignment_id}/draft", response_model=ReviewDraftResponse)
async def get_review_draft(
    assignment_id: int,
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> ReviewDraftResponse:
    """读取当前审稿人未提交的草稿；没有草稿时返回 null payload。"""
    a = await _get_assignment_for_reviewer(db, assignment_id, current_user.id)
    if a.status not in ("accepted", "completed"):
        raise HTTPException(status_code=400, detail="Assignment is not editable")
    row = await _get_draft(db, a.id)
    return ReviewDraftResponse(
        payload=row.payload if row else None,
        updated_at=row.updated_at if row else None,
    )


@router.put("/assignments/{assignment_id}/draft", response_model=ReviewDraftResponse)
async def save_review_draft(
    assignment_id: int,
    body: ReviewDraftIn,
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> ReviewDraftResponse:
    """保存审稿意见草稿（同一 assignment 仅一份，覆盖写）。"""
    import json

    if len(json.dumps(body.payload, ensure_ascii=False)) > _REVIEW_DRAFT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Draft is too large")
    a = await _get_assignment_for_reviewer(db, assignment_id, current_user.id)
    if a.status != "accepted":
        raise HTTPException(
            status_code=400,
            detail=f"Assignment must be 'accepted' to save a draft (currently '{a.status}')",
        )
    row = await _get_draft(db, a.id)
    if row is None:
        row = ReviewDraft(
            tenant_id=current_user.tenant_id,
            assignment_id=a.id,
            reviewer_id=current_user.id,
            payload=body.payload,
        )
        db.add(row)
    else:
        row.payload = body.payload
        row.updated_at = utcnow()
    await db.commit()
    await db.refresh(row)
    return ReviewDraftResponse(payload=row.payload, updated_at=row.updated_at)


@router.delete("/assignments/{assignment_id}/draft", status_code=status.HTTP_204_NO_CONTENT)
async def delete_review_draft(
    assignment_id: int,
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """丢弃草稿（审稿人主动清空）。"""
    a = await _get_assignment_for_reviewer(db, assignment_id, current_user.id)
    row = await _get_draft(db, a.id)
    if row is not None:
        await db.delete(row)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/board")
async def review_board(
    viewer: User | None = Depends(get_current_user_optional),
    tenant_id=Depends(require_tenant_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """公开的「审稿围观」列表。

    只返回标题、摘要、学科和审稿人数；绝不返回作者身份、邮箱、正文或
    作品文件。读者/作者可以看到当前有哪些作品在审，审稿人可以在这里
    直接表达审稿意愿，由编辑部在指派台处理。
    """
    rows = (
        (
            await db.execute(
                select(Submission)
                .where(
                    Submission.tenant_id == tenant_id,
                    Submission.status == "under_review",
                )
                .options(selectinload(Submission.review_assignments))
                .order_by(desc(Submission.submitted_at), desc(Submission.id))
                .limit(50)
            )
        )
        .scalars()
        .all()
    )

    can_apply = False
    if viewer is not None:
        roles = set(await user_role_names(db, viewer))
        can_apply = bool(roles & {"reviewer", "senior_reviewer", "editor", "editor_in_chief"})

    items = []
    for sub in rows:
        assignments = list(sub.review_assignments or [])
        mine = [a for a in assignments if a.reviewer_id == viewer.id] if viewer else []
        items.append(
            {
                "submission_id": sub.id,
                "title": sub.title,
                "abstract": (sub.abstract or "")[:600],
                "type": sub.type,
                "track": sub.track,
                "discipline": sub.discipline,
                "subdiscipline": sub.subdiscipline,
                "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
                "reviewer_count": len(
                    [a for a in assignments if a.status in ("accepted", "completed")]
                ),
                "already_assigned": bool(mine),
            }
        )
    return {"data": items, "can_apply": can_apply, "total": len(items)}


@router.post("/board/{submission_id}/interest")
async def express_review_interest(
    submission_id: int,
    current_user: User = Depends(require_reviewer),
    tenant_id=Depends(require_tenant_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """审稿人表达审稿意愿；不直接改变指派状态，由主编在指派台决定。"""
    sub = (
        await db.execute(
            select(Submission).where(
                Submission.id == submission_id,
                Submission.tenant_id == tenant_id,
                Submission.status == "under_review",
            )
        )
    ).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="作品不在审稿中")
    existing = (
        await db.execute(
            select(ReviewAssignment).where(
                ReviewAssignment.submission_id == submission_id,
                ReviewAssignment.reviewer_id == current_user.id,
                ReviewAssignment.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="你已在这篇作品的审稿名单中")
    from app.models import AuditLog

    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action="review.interest",
            target_type="submission",
            target_id=str(submission_id),
            payload={"reviewer_username": current_user.username},
        )
    )
    # 让主编在站内通知里直接看到审稿意愿，而不是只留在审计日志。
    editor_ids = (
        (
            await db.execute(
                select(User.id).where(
                    User.tenant_id == tenant_id,
                    User.role == "editor_in_chief",
                    User.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    for editor_id in editor_ids:
        await notifications.create(
            db,
            tenant_id=tenant_id,
            user_id=editor_id,
            type_="review.interest",
            title=f"互评申请：{sub.title}",
            body=f"{current_user.username} 申请参与作品 #{submission_id} 的审稿，请到内容整理工作台处理。",
            related_type="submission",
            related_id=str(submission_id),
        )
    await db.commit()
    return {"submission_id": submission_id, "status": "recorded"}


@router.get("/assignments/me", response_model=AssignmentListResponse)
async def list_my_assignments(
    status_filter: str = Query(
        default=None,
        alias="status",
        pattern=r"^(pending|accepted|declined|completed|cancelled)$",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> AssignmentListResponse:
    """List the current reviewer's assignments (filter by status)."""
    query = (
        select(ReviewAssignment)
        .where(
            ReviewAssignment.reviewer_id == current_user.id,
            ReviewAssignment.tenant_id == current_user.tenant_id,
        )
        .options(
            selectinload(ReviewAssignment.submission),
            selectinload(ReviewAssignment.report),
        )
    )
    if status_filter is not None:
        query = query.where(ReviewAssignment.status == status_filter)
    rows, meta = await paginate(
        db,
        query,
        page=page,
        page_size=page_size,
        order_by=(desc(ReviewAssignment.invited_at), ReviewAssignment.id.asc()),
    )
    return AssignmentListResponse(
        data=[_to_assignment_response(r, include_submission_title=True) for r in rows],
        meta=meta,
    )


@router.get("/assignments/{assignment_id}", response_model=AssignmentResponse)
async def get_my_assignment(
    assignment_id: int,
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> AssignmentResponse:
    """View one assignment (reviewer only sees their own)."""
    a = await _get_assignment_for_reviewer(db, assignment_id, current_user.id)
    return _to_assignment_response(a, include_submission_title=True)


@router.get(
    "/assignments/{assignment_id}/submission",
    response_model=SubmissionResponse,
)
async def get_assignment_submission(
    assignment_id: int,
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """审稿人查看分配作品的完整内容（abstract / preview / file_path 等）。

    单盲（默认）：审稿人看到完整作品，含作者姓名。
    双盲：作者姓名/通讯邮箱/venue/DOI/提交人 id 被抹掉（见 blinding 模块），
    审稿人仍能拿到正文与所有学术内容。

    作者侧的剥离（作者看不到审稿人身份）两种模式下都生效，在
    ``submission.routes.list_review_reports`` 里处理。

    仅 pending/accepted/completed 状态可查看；declined/cancelled 不可查看。
    """
    a = await _get_assignment_for_reviewer(db, assignment_id, current_user.id)
    if a.status not in ("pending", "accepted", "completed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot view submission in status '{a.status}'",
        )
    s = a.submission
    if s is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submission not found",
        )
    mode = await get_review_mode(db, s.tenant_id)
    manuscript_body: str | None = None
    if s.markdown_path:
        try:
            raw = await get_storage().load(s.markdown_path)
            manuscript_body = raw.decode("utf-8", errors="replace")
            if mode == "double_blind":
                # 正文头部常含 byline / 通讯邮箱，不能只靠字段裁剪。
                manuscript_body = redact_manuscript_identity(manuscript_body, s.authors)
        except FileNotFoundError:
            manuscript_body = None

    payload = {
        "id": s.id,
        "title": s.title,
        "type": s.type,
        # 赛道：审稿人必须知道自己在按哪条赛道的标准评审——同一篇文字
        # 按"正经研究"评可能结构不完整，按"荒诞研究"评则完全成立。
        "track": s.track,
        "authors": s.authors,
        "year": s.year,
        "venue": s.venue,
        "discipline": s.discipline,
        "subdiscipline": s.subdiscipline,
        "keywords": s.keywords,
        "jel_codes": s.jel_codes,
        "tags": s.tags,
        "abstract": s.abstract,
        "preview": s.preview,
        "download_url": s.download_url,
        "external_url": s.external_url,
        # 双盲下作者可控外链会被 anonymize 抹掉；本字段是编辑提供的
        # 匿名稿链接，审稿人需要看到，原样透传。
        "anonymized_file_url": s.anonymized_file_url,
        "doi": s.doi,
        "corresponding_author_email": s.corresponding_author_email,
        "status": s.status,
        "admin_note": s.admin_note,
        "editor_note": s.editor_note,
        "resource_id": s.resource_id,
        "file_path": s.file_path,
        # 审稿人必须能读到完整正文，而不是只看摘要/截断预览。
        # 仅对「已分配给该审稿人」的 assignment 下发；由本端点鉴权保证。
        "manuscript_body": manuscript_body,
        "submitted_by": s.submitted_by,
        "submitted_at": s.submitted_at,
        "reviewed_by": s.reviewed_by,
        "reviewed_at": s.reviewed_at,
    }
    # admin 例外：平台管理员需要能复现问题，且其身份天然不受盲审约束。
    if not current_user.is_admin:
        # 单盲与双盲都走字段裁剪：编辑的内部备注在两种模式下都不属于
        # 审稿人可见信息（单盲只解除"作者是谁"，不解除编辑的私密评语）。
        payload = reviewer_facing_payload(payload, double_blind=(mode == "double_blind"))
    return SubmissionResponse(**payload)


@router.post(
    "/assignments/{assignment_id}/accept",
    response_model=AssignmentResponse,
)
async def accept_assignment(
    assignment_id: int,
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> AssignmentResponse:
    """Reviewer accepts the invitation."""
    a = await _get_assignment_for_reviewer(db, assignment_id, current_user.id)
    if a.submission is None or a.submission.submitted_by == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot review own submission")
    if a.submission is not None:
        # 接受邀请时再核一次：审稿人可能在收到邀请后才补报冲突。
        await ensure_no_declared_conflict(
            db,
            tenant_id=current_user.tenant_id,
            reviewer_id=current_user.id,
            submission=a.submission,
        )
    if a.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Assignment is in status '{a.status}', cannot accept",
        )
    a.status = "accepted"
    a.responded_at = utcnow()
    # 通知指派编辑：邀请被接受（否则编辑只能反复刷新工作台才知道有人应邀）
    if a.assigned_by is not None and a.assigned_by != current_user.id:
        await notifications.create(
            db,
            tenant_id=current_user.tenant_id,
            user_id=a.assigned_by,
            type_="review.accepted",
            title=f"互评邀请已被接受：{a.submission.title if a.submission else '作品 #' + str(a.submission_id)}",
            body=f"{current_user.username} 已接受《#{a.submission_id}》的互评邀请。",
        )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not update assignment (concurrent change)",
        ) from exc
    await db.refresh(a)
    return _to_assignment_response(a)


@router.post(
    "/assignments/{assignment_id}/decline",
    response_model=AssignmentResponse,
)
async def decline_assignment(
    assignment_id: int,
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> AssignmentResponse:
    """Reviewer declines the invitation."""
    a = await _get_assignment_for_reviewer(db, assignment_id, current_user.id)
    if a.status not in ("pending", "accepted"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Assignment is in status '{a.status}', cannot decline",
        )
    a.status = "declined"
    a.responded_at = utcnow()
    # 通知指派编辑：邀请被拒——编辑需要尽快改派他人，静默会让作品干等
    if a.assigned_by is not None and a.assigned_by != current_user.id:
        await notifications.create(
            db,
            tenant_id=current_user.tenant_id,
            user_id=a.assigned_by,
            type_="review.declined",
            title=f"互评邀请未被接受：{a.submission.title if a.submission else '作品 #' + str(a.submission_id)}",
            body=f"{current_user.username} 不接受《#{a.submission_id}》的互评邀请，请考虑改派其他互评成员。",
        )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not update assignment (concurrent change)",
        ) from exc
    await db.refresh(a)
    return _to_assignment_response(a)


_REVIEW_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
_REVIEW_ATTACHMENT_EXTS = {
    ".pdf",
    ".docx",
    ".doc",
    ".md",
    ".txt",
    ".zip",
    ".png",
    ".jpg",
    ".jpeg",
    ".xlsx",
    ".csv",
    # 代码/数据脚本：只作为附件下载或纯文本预览，不执行。
    ".py",
    ".ipynb",
    ".r",
    ".do",
    ".sql",
    ".sh",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".json",
    ".yaml",
    ".yml",
    ".tex",
}


def _report_response(report: ReviewReport) -> ReviewReportResponse:
    return ReviewReportResponse(
        id=report.id,
        assignment_id=report.assignment_id,
        recommendation=report.recommendation,
        scores=report.scores,
        comments_to_editor=report.comments_to_editor,
        comments_to_author=report.comments_to_author,
        attachments=report.attachments or [],
        submitted_at=report.submitted_at,
    )


@router.post(
    "/assignments/{assignment_id}/submit",
    response_model=ReviewReportResponse,
    # 201: the report is a newly created resource (T2 finding L-1 — was 200).
    status_code=status.HTTP_201_CREATED,
)
async def submit_review_report(
    assignment_id: int,
    body: ReviewSubmit,
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> ReviewReportResponse:
    """Reviewer submits the review report (terminal)."""
    a = await _get_assignment_for_reviewer(db, assignment_id, current_user.id)
    if a.submission is None or a.submission.submitted_by == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot review own submission")
    if a.status != "accepted":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Assignment must be 'accepted' to submit (currently '{a.status}')",
        )
    existing = (
        await db.execute(select(ReviewReport).where(ReviewReport.assignment_id == a.id))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A report has already been submitted for this assignment",
        )
    normalized_scores = _normalize_review_scores(body.scores)
    # 草稿已转正式报告，删除草稿行，避免下次打开时把旧内容又灌回表单。
    draft_row = await _get_draft(db, a.id)
    if draft_row is not None:
        await db.delete(draft_row)
    report = ReviewReport(
        tenant_id=current_user.tenant_id,
        assignment_id=a.id,
        recommendation=body.recommendation,
        scores=normalized_scores,
        comments_to_editor=body.comments_to_editor,
        comments_to_author=body.comments_to_author,
    )
    db.add(report)
    # 特别篇许可：审稿人在提交报告时可显式打标。只授予 true；撤标由编辑部
    # 走资源管理入口，避免一份普通审稿把既有特许误清掉。
    if body.special_issue and a.submission.resource_id:
        resource = (
            await db.execute(
                select(Resource).where(
                    Resource.id == a.submission.resource_id,
                    Resource.tenant_id == current_user.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if resource is not None:
            resource.is_special_issue = True
            resource.special_issue_reason = body.special_issue_reason or "审稿人确认篇幅特许"
            resource.special_issue_by = current_user.id
            resource.special_issue_at = utcnow()
    a.status = "completed"
    a.completed_at = utcnow()
    try:
        await db.flush()
        from app.domain.gamification import service as gamification

        await gamification.award(
            db, current_user, "review.completed", ref_type="assignment", ref_id=str(a.id)
        )
        # 等级轴：审稿人身份 +1（R 等级按完成审稿份数计）。幂等。
        from app.domain.gamification import levels_axis

        await levels_axis.award_points(
            db,
            current_user,
            "review.completed",
            ref_type="assignment",
            ref_id=str(a.id),
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not submit report (concurrent change)",
        ) from exc
    await db.refresh(report)

    # 通知编辑分配者：审稿人提交了报告
    if a.assigned_by is not None:
        await notifications.create(
            db,
            tenant_id=current_user.tenant_id,
            user_id=a.assigned_by,
            type_="review.submitted",
            title=(
                f"审稿人提交了报告：{a.submission.title if a.submission else f'#{a.submission_id}'}"
            ),
            body=f"推荐：{body.recommendation}",
            related_type="review_assignment",
            related_id=str(a.id),
        )
        await db.commit()

    return _report_response(report)


@router.post(
    "/reports/{report_id}/attachments",
    response_model=ReviewReportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_review_attachment(
    report_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> ReviewReportResponse:
    """审稿人上传批注件/补充材料。报告提交后仍可补传。"""
    report = (
        await db.execute(
            select(ReviewReport)
            .join(ReviewAssignment, ReviewAssignment.id == ReviewReport.assignment_id)
            .where(
                ReviewReport.id == report_id,
                ReviewReport.tenant_id == current_user.tenant_id,
                ReviewAssignment.reviewer_id == current_user.id,
            )
            .options(selectinload(ReviewReport.assignment))
        )
    ).scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=404, detail="Review report not found")

    original_name = file.filename or "attachment"
    suffix = Path(original_name).suffix.lower()
    if suffix not in _REVIEW_ATTACHMENT_EXTS:
        raise HTTPException(
            status_code=400,
            detail="附件仅支持 PDF / Word / Markdown / 图片 / ZIP / Excel / CSV / 代码文本",
        )
    contents = await file.read()
    if len(contents) > _REVIEW_ATTACHMENT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="附件不能超过 50 MB")
    if not contents:
        raise HTTPException(status_code=400, detail="附件为空")

    key = f"{current_user.tenant_id}/review/{report.id}/{uuid4().hex}{suffix}"
    stored_type = (
        file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    )
    await get_storage().save(key, contents, content_type=stored_type)
    items = list(report.attachments or [])
    if len(items) >= 5:
        raise HTTPException(status_code=400, detail="每份审稿报告最多上传 5 个附件")
    items.append(
        {
            "filename": original_name,
            "path": key,
            "content_type": stored_type,
            "size": len(contents),
        }
    )
    report.attachments = items
    await db.commit()
    await db.refresh(report)
    return _report_response(report)


@router.get("/reports/{report_id}/attachments/{attachment_index}")
async def download_review_attachment(
    report_id: int,
    attachment_index: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """审稿人本人、编辑、管理员可下载批注附件；作者不可下载。"""
    report = (
        await db.execute(
            select(ReviewReport)
            .where(
                ReviewReport.id == report_id,
                ReviewReport.tenant_id == current_user.tenant_id,
            )
            .options(selectinload(ReviewReport.assignment))
        )
    ).scalar_one_or_none()
    if report is None or report.assignment is None:
        raise HTTPException(status_code=404, detail="Review report not found")
    allowed = report.assignment.reviewer_id == current_user.id
    if not allowed:
        allowed = bool(getattr(current_user, "is_admin", False)) or await user_has_role(
            db, current_user, "editor"
        )
    if not allowed:
        raise HTTPException(status_code=403, detail="没有权限下载该审稿附件")
    items = list(report.attachments or [])
    if attachment_index < 0 or attachment_index >= len(items):
        raise HTTPException(status_code=404, detail="Attachment not found")
    item = items[attachment_index]
    data = await get_storage().load(str(item["path"]))
    filename = str(item.get("filename") or "attachment")
    media_type = str(item.get("content_type") or "application/octet-stream")
    disposition = f"attachment; filename*=UTF-8''{quote(filename)}"
    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": disposition},
    )


# ============================================================================
# Editor-facing endpoints (P1：双人审稿闸门)
# ============================================================================

from pydantic import BaseModel, Field  # noqa: E402


class AssignReviewersBody(BaseModel):
    reviewer_ids: list[int] = Field(min_length=1, max_length=3)
    due_days: int = Field(default=14, ge=1, le=90)
    # 主编指定的外审专家：只记录邀请性质，不另建账号。
    is_external: bool = False
    external_affiliation: str | None = Field(default=None, max_length=120)


class AdjudicateBody(BaseModel):
    reviewer_id: int = Field(ge=1)
    due_days: int = Field(default=14, ge=1, le=90)
    reason: str = Field(default="", max_length=2000)


class EditorDecisionBody(BaseModel):
    decision: str = Field(pattern="^(accept|reject|revise)$")
    reason: str = Field(default="", max_length=2000)


def _completed_reports_count(assignments: list[ReviewAssignment]) -> int:
    return sum(1 for a in assignments if a.status == "completed")


def _distinct_reviewers_completed(assignments: Sequence[ReviewAssignment]) -> int:
    return len({a.reviewer_id for a in assignments if a.status == "completed"})


@router.post("/submissions/{submission_id}/assign", status_code=status.HTTP_201_CREATED)
async def assign_reviewers(
    submission_id: int,
    body: AssignReviewersBody,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """批量指派审稿人（slot 1/2/3）。禁止指派给作品作者/共同作者。"""
    tenant_id = require_tenant_id()
    sub = (
        await db.execute(
            select(Submission)
            .where(Submission.id == submission_id, Submission.tenant_id == tenant_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    if sub.status not in ("pending", "under_review", "resubmitted"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot assign reviewer in status '{sub.status}'",
        )

    # 校验：reviewer 不能是 submitted_by；署名作者同名（疑似共同作者）
    # 由 name_matches_author 服务端拦截，与工作台冲突提示同口径。
    author_ids = {sub.submitted_by}
    for rid in body.reviewer_ids:
        if rid in author_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="禁止指派给作品作者（自审）",
            )

    existing_all = (
        (
            await db.execute(
                select(ReviewAssignment).where(
                    ReviewAssignment.submission_id == submission_id,
                    ReviewAssignment.tenant_id == tenant_id,
                )
            )
        )
        .scalars()
        .all()
    )
    # 轮次：上一轮还有 pending/accepted/completed 的，继续同一轮；
    # 全部 cancelled/declined（作者已重投）才进入下一轮。
    _rounds = [a.round or 1 for a in existing_all]
    _last_round = max(_rounds) if _rounds else 1
    _last_rows = [a for a in existing_all if (a.round or 1) == _last_round]
    if _last_rows and all(a.status in ("cancelled", "declined") for a in _last_rows):
        round_no = _last_round + 1
    else:
        round_no = _last_round
    # Slot 代表“本轮第几位审稿人”，completed/declined 也占用过编号。
    # 只看 pending/accepted 会让补派审稿人与已完成审稿人撞到同一个 slot。
    used_slots = {a.slot for a in existing_all if (a.round or 1) == round_no and a.slot}
    next_slot = 1
    created = []
    for rid in body.reviewer_ids:
        reviewer = await db.get(User, rid)
        if reviewer is None or not reviewer.is_active:
            raise HTTPException(status_code=400, detail=f"Reviewer {rid} not found or inactive")
        if not (
            await user_has_role(db, reviewer, ROLE_REVIEWER)
            or await user_has_role(db, reviewer, ROLE_SENIOR_REVIEWER)
        ):
            raise HTTPException(status_code=422, detail=f"User {rid} is not a reviewer")
        await ensure_no_declared_conflict(db, tenant_id=tenant_id, reviewer_id=rid, submission=sub)
        if name_matches_author(reviewer, sub):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "reviewer_name_conflict",
                    "message": (
                        f"审稿人 {reviewer.username} 与作品作者同名：疑似共同作者/自审，请更换审稿人。"
                    ),
                },
            )
        # 同一轮内已邀请过的不重复；旧轮 cancelled/declined 不拦新一轮
        dup = await db.execute(
            select(ReviewAssignment).where(
                ReviewAssignment.submission_id == submission_id,
                ReviewAssignment.reviewer_id == rid,
                ReviewAssignment.round == round_no,
            )
        )
        if dup.scalar_one_or_none() is not None:
            continue
        while next_slot in used_slots:
            next_slot += 1
        used_slots.add(next_slot)
        due = utcnow() + timedelta(days=body.due_days)
        a = ReviewAssignment(
            tenant_id=tenant_id,
            submission_id=submission_id,
            reviewer_id=rid,
            assigned_by=current_user.id,
            status="pending",
            due_date=due,
            round=round_no,
            slot=next_slot,
            is_external=body.is_external,
            external_affiliation=(body.external_affiliation or "").strip() or None,
        )
        db.add(a)
        created.append(a)

    if created and (sub.triage_status or "pending") in ("pending", "rework"):
        sub.triage_status = "passed"
        sub.triaged_at = utcnow()
        sub.triaged_by = current_user.id
    if sub.status == "pending" and created:
        sub.status = "under_review"
    try:
        await db.flush()
        for a in created:
            reviewer = await db.get(User, a.reviewer_id)
            if reviewer is not None:
                await notifications.create(
                    db,
                    tenant_id=tenant_id,
                    user_id=a.reviewer_id,
                    type_="review.invited",
                    title=f"您被邀请审稿：{sub.title}",
                    body=(
                        f"作品 #{sub.id} 已分配给您，截止 {(a.due_date.date().isoformat() if a.due_date else '—')}，"
                        "请前往审稿工作台回应。" + ("（外审专家邀请）" if a.is_external else "")
                    ),
                    related_type="review_assignment",
                    related_id=str(a.id),
                )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="审稿人本轮已被指派（并发或重复提交），请刷新后重试。",
        ) from exc
    return {"assigned": len(created), "submission_id": submission_id}


@router.get("/submissions/{submission_id}/matrix")
async def review_matrix(
    submission_id: int,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """审稿矩阵：每位审稿人状态/推荐/截止/超期/冲突。"""
    tenant_id = require_tenant_id()
    assignments = (
        (
            await db.execute(
                select(ReviewAssignment)
                .where(
                    ReviewAssignment.submission_id == submission_id,
                    ReviewAssignment.tenant_id == tenant_id,
                )
                .options(selectinload(ReviewAssignment.report))
                .order_by(ReviewAssignment.slot)
            )
        )
        .scalars()
        .all()
    )

    current_round = max((a.round or 1) for a in assignments) if assignments else 1
    # 只统计当前轮；旧轮报告保留展示但不计入闸门，避免重投后拿旧意见放行。
    current = [a for a in assignments if (a.round or 1) == current_round]
    now = utcnow()
    rows = []
    recommendations = []
    for a in assignments:
        status = a.status
        if a.due_date and a.status in ("pending", "accepted") and a.due_date < now:
            status = "overdue"
        rec = None
        if a.report and (a.round or 1) == current_round:
            rec = a.report[0].recommendation if a.report else None
            recommendations.append(rec)
        # reviewer username
        u = await db.get(User, a.reviewer_id)
        rows.append(
            {
                "reviewer_id": a.reviewer_id,
                "username": u.username if u else None,
                "slot": a.slot,
                "status": status,
                "recommendation": rec,
                "due_date": a.due_date.isoformat() if a.due_date else None,
                "is_overdue": status == "overdue",
                "is_adjudicator": a.is_adjudicator,
                "is_external": bool(getattr(a, "is_external", False)),
                "external_affiliation": getattr(a, "external_affiliation", None),
                "round": a.round,
                "is_current": (a.round or 1) == current_round,
            }
        )

    completed = _completed_reports_count(current)
    distinct = _distinct_reviewers_completed(current)
    accept_count = sum(1 for rec in recommendations if rec == "accept")
    reject_count = sum(1 for rec in recommendations if rec == "reject")
    major_count = sum(1 for rec in recommendations if rec == "major_revision")
    # 冲突：有录用推荐，同时有拒稿/大修；或两份意见方向完全相反。
    conflict = accept_count > 0 and (reject_count > 0 or major_count > 0)
    adjudicator_rows = [a for a in current if a.is_adjudicator]
    adjudicator_accepted = any(
        a.status == "completed" and a.report and a.report[0].recommendation == "accept"
        for a in adjudicator_rows
    )
    need_adjudication = bool(conflict and not adjudicator_accepted)

    return {
        "submission_id": submission_id,
        "assignments": rows,
        "reports_completed": completed,
        "distinct_reviewers": distinct,
        "accept_count": accept_count,
        "reject_count": reject_count,
        "major_revision_count": major_count,
        "can_decide": accept_count >= 2 and (not conflict or adjudicator_accepted),
        "conflict": conflict,
        "need_adjudication": need_adjudication,
        "adjudicator_assigned": bool(adjudicator_rows),
        "adjudicator_accepted": adjudicator_accepted,
    }


@router.post("/submissions/{submission_id}/adjudicate", status_code=status.HTTP_201_CREATED)
async def assign_adjudicator(
    submission_id: int,
    body: AdjudicateBody,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """复议：主编/编辑指定第三方裁决人，对冲突意见做独立裁决。

    只在已有至少 2 份 completed 报告时才允许发起；裁决人不能是作者，
    也不能已经参与过同一作品的评审。裁决意见同样通过
    POST /review/assignments/{id}/submit 提交，recommendation 为 accept
    时，最终录用闸门才放行。
    """
    from app.api.deps import ROLE_REVIEWER, ROLE_SENIOR_REVIEWER
    from app.models import AuditLog

    tenant_id = require_tenant_id()
    sub = (
        await db.execute(
            select(Submission).where(
                Submission.id == submission_id, Submission.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    if sub.status not in ("pending", "under_review", "resubmitted"):
        raise HTTPException(status_code=400, detail=f"Cannot adjudicate in status '{sub.status}'")
    if body.reviewer_id == sub.submitted_by:
        raise HTTPException(status_code=403, detail="Cannot assign author as adjudicator")
    reviewer = (
        await db.execute(
            select(User).where(
                User.id == body.reviewer_id,
                User.tenant_id == tenant_id,
                User.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if reviewer is None:
        raise HTTPException(status_code=400, detail="Reviewer not found or inactive")
    if not (
        await user_has_role(db, reviewer, ROLE_REVIEWER)
        or await user_has_role(db, reviewer, ROLE_SENIOR_REVIEWER)
    ):
        raise HTTPException(status_code=422, detail="Assigned user is not a reviewer")

    assignments = (
        (
            await db.execute(
                select(ReviewAssignment)
                .where(
                    ReviewAssignment.submission_id == submission_id,
                    ReviewAssignment.tenant_id == tenant_id,
                )
                .options(selectinload(ReviewAssignment.report))
                .order_by(ReviewAssignment.slot)
            )
        )
        .scalars()
        .all()
    )
    current_round = max((a.round or 1) for a in assignments) if assignments else 1
    current = [a for a in assignments if (a.round or 1) == current_round]
    distinct = _distinct_reviewers_completed(current)
    if distinct < 2:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "adjudication_requires_two_reviews",
                "message": f"第三方裁决前至少需要 2 位不同审稿人提交意见（当前 {distinct}/2）。",
                "distinct_reviewers": distinct,
            },
        )
    if any(a.reviewer_id == body.reviewer_id for a in assignments):
        raise HTTPException(status_code=409, detail="该审稿人已参与本稿评审，不能兼任第三方裁决人")
    await ensure_no_declared_conflict(
        db, tenant_id=tenant_id, reviewer_id=body.reviewer_id, submission=sub
    )

    due = utcnow() + timedelta(days=body.due_days)
    slot = max((a.slot or 0) for a in assignments) + 1
    # 裁决人与被裁决的意见必须同轮，否则矩阵当前轮只剩裁决人一份，
    # 录用闸门反而永远过不了。
    round_no = current_round
    a = ReviewAssignment(
        tenant_id=tenant_id,
        submission_id=submission_id,
        reviewer_id=body.reviewer_id,
        assigned_by=current_user.id,
        status="pending",
        due_date=due,
        round=round_no,
        slot=slot,
        is_adjudicator=True,
    )
    db.add(a)
    await db.flush()
    await notifications.create(
        db,
        tenant_id=tenant_id,
        user_id=body.reviewer_id,
        type_="review.adjudicator_invited",
        title=f"第三方裁决邀请：{sub.title}",
        body=(
            f"作品 #{sub.id} 的审稿意见存在分歧，现邀请您作为第三方裁决人。"
            f"截止 {due.date().isoformat()}。" + (f" 说明：{body.reason}" if body.reason else "")
        ),
        related_type="review_assignment",
        related_id=str(a.id),
    )
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action="review.adjudicator_assigned",
            target_type="submission",
            target_id=str(submission_id),
            payload={"reviewer_id": body.reviewer_id, "assignment_id": a.id, "reason": body.reason},
        )
    )
    await db.commit()
    return {
        "submission_id": submission_id,
        "assignment_id": a.id,
        "reviewer_id": body.reviewer_id,
        "due_date": due.isoformat(),
        "is_adjudicator": True,
    }


@router.post("/submissions/{submission_id}/decision")
async def editor_decision(
    submission_id: int,
    body: EditorDecisionBody,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """已废弃：最终裁决统一走 PATCH /submissions/{id}/decision。

    旧端点只写 AuditLog、不改业务状态，和投稿模块的真裁决端点形成两套
    互相矛盾的规则。保留路径是为了让旧客户端拿到明确指引，而不是静默
    记一条"已决定"却什么都没发生。
    """
    tenant_id = require_tenant_id()
    assignments = (
        (
            await db.execute(
                select(ReviewAssignment).where(
                    ReviewAssignment.submission_id == submission_id,
                    ReviewAssignment.tenant_id == tenant_id,
                )
            )
        )
        .scalars()
        .all()
    )
    distinct = _distinct_reviewers_completed(assignments)
    if distinct < 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"还差 {2 - distinct} 份审稿报告（已收 {distinct}/2）",
        )
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail={
            "code": "deprecated_use_submission_decision",
            "message": "最终裁决请使用 PATCH /api/submissions/{id}/decision（主编/执行编辑权限）。",
        },
    )


@router.get("/public-expertise", response_model=PublicExpertiseResponse)
async def public_expertise(
    db: AsyncSession = Depends(get_db),
) -> PublicExpertiseResponse:
    """审稿团队匿名专长画像（公开，无需登录）。

    只输出聚合计数：学科覆盖人数 + 高频能力标签，绝不携带审稿人
    id/姓名/邮箱——盲审策略下作者永远不可识别审稿人身份。
    """
    from collections import Counter

    from app.domain.catalog.models import Discipline
    from app.models import Role, UserRole

    tenant_id = require_tenant_id()
    rows = (
        await db.execute(
            select(User.id, User.reviewer_disciplines, User.reviewer_tags)
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                User.tenant_id == tenant_id,
                User.is_active.is_(True),
                UserRole.tenant_id == tenant_id,
                Role.tenant_id == tenant_id,
                Role.name.in_([ROLE_REVIEWER, ROLE_SENIOR_REVIEWER]),
            )
        )
    ).all()

    discipline_counts: Counter[str] = Counter()
    tag_counts: Counter[str] = Counter()
    tag_display: dict[str, str] = {}
    seen_ids: set[int] = set()
    for row in rows:
        if row.id in seen_ids:
            continue
        seen_ids.add(row.id)
        for slug in row.reviewer_disciplines or []:
            discipline_counts[str(slug)] += 1
        for tag in row.reviewer_tags or []:
            text = " ".join(str(tag).split()).strip()
            if not text:
                continue
            key = text.casefold()
            tag_counts[key] += 1
            tag_display.setdefault(key, text)

    disciplines = (
        (
            await db.execute(
                select(Discipline)
                .where(Discipline.tenant_id == tenant_id)
                .order_by(Discipline.name.asc())
            )
        )
        .scalars()
        .all()
    )
    return PublicExpertiseResponse(
        total_reviewers=len(seen_ids),
        disciplines=[
            ExpertiseDiscipline(
                slug=d.slug, name=d.name, reviewer_count=discipline_counts.get(d.slug, 0)
            )
            for d in disciplines
        ],
        top_tags=[
            ExpertiseTag(tag=tag_display[key], count=count)
            for key, count in tag_counts.most_common(20)
        ],
    )
