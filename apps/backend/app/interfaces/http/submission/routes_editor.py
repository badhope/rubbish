"""Submission API routes — 编辑与审稿侧（送审 / 分配 / 报告 / 裁决 / 匿名稿）。

从 routes.py（52KB 单文件）拆出。router 来自 routes.py，本模块在其上
追加端点；注册顺序见 routes.py 文件末尾的底部 import。
"""

from __future__ import annotations

from types import SimpleNamespace

from fastapi import Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import (
    ROLE_EDITOR,
    ROLE_REVIEWER,
    ROLE_SENIOR_REVIEWER,
    get_current_user,
    require_chief_editor,
    require_editor,
    require_tenant_id,
    user_has_role,
)
from app.core.db import get_db
from app.core.logging import get_logger
from app.core.schemas import PaginationMeta
from app.core.time import utcnow
from app.domain.catalog.models import Resource
from app.domain.notifications import services as notifications
from app.domain.review.models import ReviewAssignment, ReviewReport
from app.domain.submission._helpers import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    _materialize_resource_from_submission,
)
from app.domain.submission.models import Submission, SubmissionVersion
from app.interfaces.http.review.coi import (
    current_coi_year,
    declaration_matches,
    declarations_for_reviewers,
    ensure_no_declared_conflict,
    institution_matches,
    name_matches_author,
)
from app.interfaces.http.review.schemas import (
    AssignmentCreate,
    AssignmentListResponse,
    AssignmentResponse,
    ReviewReportResponse,
)
from app.interfaces.http.submission.responses import _get_or_404, _list_submissions, _to_response
from app.interfaces.http.submission.routes import router
from app.interfaces.http.submission.schemas import (
    AnonymizedFileUpdate,
    MessageResponse,
    ReviewerCandidate,
    ReviewerCandidateListResponse,
    ReworkRequest,
    SubmissionDecision,
    SubmissionListResponse,
    SubmissionResponse,
    SubmissionReview,
    TriageRequest,
    WaiveReviewRequest,
)
from app.models import AuditLog, Role, User, UserRole

logger = get_logger("rubbish.submission.editor")


@router.get("/triage", response_model=SubmissionListResponse)
async def list_triage_queue(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    _: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> SubmissionListResponse:
    """P1-9 初筛队列：只返回尚未初筛的 pending 稿件，最老的排前面。"""
    tenant_id = require_tenant_id()
    base = select(Submission).where(
        Submission.tenant_id == tenant_id,
        Submission.status.in_(("pending", "resubmitted")),
        Submission.triage_status == "pending",
    )
    total = int(
        (
            await db.execute(
                select(func.count(Submission.id)).where(
                    Submission.tenant_id == tenant_id,
                    Submission.status.in_(("pending", "resubmitted")),
                    Submission.triage_status == "pending",
                )
            )
        ).scalar_one()
    )
    rows = (
        (
            await db.execute(
                base.order_by(Submission.submitted_at.asc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    return SubmissionListResponse(
        data=[_to_response(row) for row in rows],
        meta=PaginationMeta(
            total=total,
            page=page,
            page_size=page_size,
            total_pages=(total + page_size - 1) // page_size,
        ),
    )


@router.post("/{submission_id}/triage", response_model=SubmissionResponse)
async def triage_submission(
    submission_id: int,
    body: TriageRequest,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """P1-9 两段式初筛：先由编辑判断，再进入同行评审或退回。

    - send_to_review：记录“已送外审”，状态仍为 pending，随后分派审稿人；
    - return_for_revision：置 major_revision，作者可修改后重投；
    - desk_reject：直接拒稿，不进入同行评审。
    """
    entry = await _get_or_404(db, submission_id)
    if current_user.id == entry.submitted_by:
        raise HTTPException(status_code=403, detail="Cannot triage own submission")
    if entry.status not in ("pending", "resubmitted"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot triage submission in status '{entry.status}'",
        )
    if (entry.triage_status or "pending") != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Submission already triaged as '{entry.triage_status}'",
        )
    note = body.note.strip()
    if (
        body.decision in ("return_for_revision", "desk_reject", "request_materials")
        and len(note) < 10
    ):
        raise HTTPException(
            status_code=422,
            detail="退回修改、补材料或直接拒稿必须写至少 10 字理由，作者需要知道下一步怎么做。",
        )

    now = utcnow()
    entry.triage_note = note or None
    entry.triaged_at = now
    entry.triaged_by = current_user.id
    if body.decision == "send_to_review":
        entry.triage_status = "passed"
    elif body.decision == "return_for_revision":
        entry.triage_status = "rework"
        entry.status = "major_revision"
        entry.editor_note = note
        entry.reviewed_by = current_user.id
        entry.reviewed_at = now
    elif body.decision == "request_materials":
        # 补材料是独立的初筛状态：作者补齐后重投，稿件重新进入初筛队列，
        # 不与“退回修改”的大修语义混在一起。
        entry.triage_status = "materials"
        entry.status = "major_revision"
        entry.editor_note = note
        entry.reviewed_by = current_user.id
        entry.reviewed_at = now
    else:
        entry.triage_status = "rejected"
        entry.status = "rejected"
        entry.editor_note = note
        entry.reviewed_by = current_user.id
        entry.reviewed_at = now

    if body.decision in ("return_for_revision", "desk_reject", "request_materials"):
        if body.decision == "return_for_revision":
            type_ = "submission.triage_rework"
            title = f"稿件需要修改：{entry.title}"
            body_text = (
                f"稿件 #{entry.id} 已完成编辑部初筛。\n"
                "修改后可在「我的提交」中重新提交。\n"
                f"编辑部说明：{note}"
            )
        elif body.decision == "request_materials":
            type_ = "submission.triage_materials"
            title = f"稿件需要补充材料：{entry.title}"
            body_text = (
                f"稿件 #{entry.id} 初筛时发现材料不完整。\n"
                "请按编辑部说明补齐材料后在「我的提交」中重新提交；补齐后稿件会重新进入初筛队列。\n"
                f"编辑部说明：{note}"
            )
        else:
            type_ = "submission.triage_rejected"
            title = f"稿件未通过初筛：{entry.title}"
            body_text = (
                f"稿件 #{entry.id} 已完成编辑部初筛。\n本次不进入同行评审。\n编辑部说明：{note}"
            )
        await notifications.create(
            db,
            tenant_id=entry.tenant_id,
            user_id=entry.submitted_by,
            type_=type_,
            title=title,
            body=body_text,
            related_type="submission",
            related_id=str(entry.id),
        )
    db.add(
        AuditLog(
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            action="submission.triage",
            target_type="submission",
            target_id=str(entry.id),
            payload={"decision": body.decision, "note": note},
        )
    )
    await db.commit()
    await db.refresh(entry)
    return _to_response(entry)


@router.get("/pending", response_model=SubmissionListResponse)
async def list_pending_submissions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    # 赛道分栏已随赛道下线移除（见 core/tracks.py）：编辑队列不再按
    # track 分组，文章气质由 absurdity_index 表达。
    _: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> SubmissionListResponse:
    """List pending submissions awaiting review (editor+).

    包含 pending（待分配审稿人）与 under_review（已分配审稿人但未出决定）。
    """
    tenant_id = require_tenant_id()
    query = select(Submission).where(
        Submission.status.in_(("pending", "under_review")),
        Submission.tenant_id == tenant_id,
    )
    return await _list_submissions(db, query, page, page_size)


def _norm_terms(values: list[str] | None) -> set[str]:
    """Normalize free-text keywords/tags for overlap scoring."""
    return {str(value).strip().lower() for value in (values or []) if str(value).strip()}


def _candidate_score(
    *,
    current: Submission | None,
    history: list[Submission],
    active_count: int,
    reviewer_tags: list[str] | None = None,
    reviewer_disciplines: list[str] | None = None,
    discipline_names: dict[str, str] | None = None,
) -> tuple[int, list[str], list[str]]:
    """A transparent, explainable 0–100 match score.

    This is deliberately not a black-box model: editors must be able to see
    why someone ranks first. We use the metadata that already exists (discipline,
    subdiscipline, keywords/tags, review history, current load) rather than
    pretending the platform has expertise tags it does not have yet.
    """
    reasons: list[str] = []
    matched: list[str] = []
    score = 0
    if current is not None:
        if current.discipline and any(item.discipline == current.discipline for item in history):
            score += 40
            reasons.append(f"同学科：{current.discipline}")
        declared_names = {
            (discipline_names or {}).get(slug, slug) for slug in (reviewer_disciplines or [])
        }
        if current.discipline and current.discipline in declared_names:
            score += 35
            reasons.append(f"自选学科命中：{current.discipline}")
        if current.subdiscipline and any(
            item.subdiscipline == current.subdiscipline for item in history
        ):
            score += 15
            reasons.append(f"同子领域：{current.subdiscipline}")

        current_terms = _norm_terms([*current.keywords, *current.tags])
        history_terms: set[str] = set()
        for item in history:
            history_terms.update(_norm_terms([*item.keywords, *item.tags]))
        overlap = sorted(current_terms & history_terms)
        if overlap:
            score += min(30, len(overlap) * 6)
            matched = overlap[:5]
            reasons.append(f"关键词重合：{', '.join(matched)}")

        tag_overlap = sorted(current_terms & _norm_terms(reviewer_tags))
        if tag_overlap:
            score += min(25, len(tag_overlap) * 8)
            if not matched:
                matched = tag_overlap[:5]
            reasons.append(f"能力标签重合：{', '.join(tag_overlap[:5])}")

    completed = len(history)
    if completed:
        score += min(10, completed * 2)
        reasons.append(f"已完成 {completed} 篇审稿")
    if active_count:
        score -= min(20, active_count * 5)
        reasons.append(f"当前在审 {active_count} 篇")
    else:
        reasons.append("当前无在审任务")

    return max(0, min(100, score)), reasons, matched


@router.get("/reviewer-candidates", response_model=ReviewerCandidateListResponse)
async def list_reviewer_candidates(
    limit: int = Query(default=200, ge=1, le=200),
    submission_id: int | None = Query(default=None, ge=1),
    _: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> ReviewerCandidateListResponse:
    """可被指派的审稿人 + 可解释匹配分。

    供编辑工作台的下拉使用：之前走 /admin/users，非 admin 的 editor
    会拿到 403，导致「没有可指派的审稿人」。L6 资深审稿人与 L5 共用
    候选池（与 require_reviewer 同口径）。传 ``submission_id`` 时按
    学科/子领域/关键词重合、历史审稿量与当前负载排序；不传时仍按
    用户名返回，保持旧调用兼容。
    """
    tenant_id = require_tenant_id()
    rows = (
        await db.execute(
            select(
                User.id,
                User.username,
                User.email,
                User.affiliation,
                User.department,
                User.reviewer_tags,
                User.reviewer_disciplines,
            )
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                User.tenant_id == tenant_id,
                User.is_active.is_(True),
                UserRole.tenant_id == tenant_id,
                Role.tenant_id == tenant_id,
                Role.name.in_([ROLE_REVIEWER, ROLE_SENIOR_REVIEWER]),
            )
            .order_by(User.username.asc())
            .limit(limit)
        )
    ).all()
    reviewer_ids = [row.id for row in rows]
    if not reviewer_ids:
        return ReviewerCandidateListResponse(data=[])

    current = None
    if submission_id is not None:
        current = (
            await db.execute(
                select(Submission).where(
                    Submission.id == submission_id,
                    Submission.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if current is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found"
            )

    # One aggregate query for completed history and one for active load,
    # instead of N+1 per candidate.
    history_rows = (
        await db.execute(
            select(ReviewAssignment.reviewer_id, Submission)
            .join(Submission, ReviewAssignment.submission_id == Submission.id)
            .where(
                ReviewAssignment.tenant_id == tenant_id,
                ReviewAssignment.reviewer_id.in_(reviewer_ids),
                ReviewAssignment.status == "completed",
                Submission.tenant_id == tenant_id,
            )
        )
    ).all()
    history_by_reviewer: dict[int, list[Submission]] = {}
    for reviewer_id, submission in history_rows:
        history_by_reviewer.setdefault(reviewer_id, []).append(submission)

    active_counts = dict(
        (
            await db.execute(
                select(ReviewAssignment.reviewer_id, func.count(ReviewAssignment.id))
                .where(
                    ReviewAssignment.tenant_id == tenant_id,
                    ReviewAssignment.reviewer_id.in_(reviewer_ids),
                    ReviewAssignment.status.in_(["pending", "accepted"]),
                )
                .group_by(ReviewAssignment.reviewer_id)
            )
        ).all()
    )

    coi_year = current_coi_year()
    declarations = await declarations_for_reviewers(
        db, tenant_id=tenant_id, reviewer_ids=reviewer_ids, year=coi_year
    )

    from app.domain.catalog.models import Discipline

    discipline_names: dict[str, str] = {
        slug: name
        for slug, name in (
            await db.execute(
                select(Discipline.slug, Discipline.name).where(
                    Discipline.tenant_id == tenant_id
                )
            )
        ).all()
    }

    candidates: list[ReviewerCandidate] = []
    for row in rows:
        history = history_by_reviewer.get(row.id, [])
        active_count = int(active_counts.get(row.id, 0))
        score, reasons, matched = _candidate_score(
            current=current,
            history=history,
            active_count=active_count,
            reviewer_tags=list(getattr(row, "reviewer_tags", None) or []),
            reviewer_disciplines=list(getattr(row, "reviewer_disciplines", None) or []),
            discipline_names=discipline_names,
        )
        declaration = declarations.get(row.id)
        conflict_reasons = (
            declaration_matches(declaration, current)
            if current is not None and declaration is not None
            else []
        )
        if current is not None:
            candidate_user = SimpleNamespace(
                affiliation=getattr(row, "affiliation", None),
                department=getattr(row, "department", None),
            )
            conflict_reasons = [
                *conflict_reasons,
                *institution_matches(candidate_user, current),
            ]
        candidates.append(
            ReviewerCandidate(
                id=row.id,
                username=row.username,
                email=row.email,
                score=score if current is not None else 0,
                active_assignments=active_count,
                completed_reviews=len(history),
                matched_keywords=matched,
                match_reasons=reasons,
                reviewer_tags=list(getattr(row, "reviewer_tags", None) or []),
                reviewer_disciplines=list(getattr(row, "reviewer_disciplines", None) or []),
                coi_declared=declaration is not None,
                coi_year=coi_year,
                conflict=bool(conflict_reasons),
                conflict_reasons=conflict_reasons,
            )
        )
    if current is not None:
        candidates.sort(key=lambda item: (-item.score, item.active_assignments, item.username))
    return ReviewerCandidateListResponse(data=candidates)


@router.get("", response_model=SubmissionListResponse)
async def list_submissions(
    status_filter: str = Query(
        default=None,
        alias="status",
        pattern=r"^(pending|under_review|major_revision|minor_revision|resubmitted|rework_requested|accepted|approved|rejected)$",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    _: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> SubmissionListResponse:
    """List all submissions in the tenant (editor+)."""
    tenant_id = require_tenant_id()
    query = select(Submission).where(Submission.tenant_id == tenant_id)
    if status_filter is not None:
        query = query.where(Submission.status == status_filter)
    return await _list_submissions(db, query, page, page_size)


async def _ensure_accept_gate(db: AsyncSession, entry: Submission) -> None:
    """录用闸门：免审留痕，或当前轮 ≥2 名不同审稿人给出录用推荐。

    ``/decision`` 与遗留 ``/review`` 别名共用此闸门，确保任何录用路径
    都不能绕过同行评审。意见冲突（录用 vs 拒稿/大修）须先经第三方裁决。
    不满足时抛 ``HTTPException(409)``；已 waive-review 的稿件直接放行。
    """
    if entry.review_waived_at:
        return
    current_round = (
        await db.execute(
            select(func.max(ReviewAssignment.round)).where(
                ReviewAssignment.submission_id == entry.id,
                ReviewAssignment.tenant_id == entry.tenant_id,
            )
        )
    ).scalar() or 1
    rows = (
        await db.execute(
            select(
                ReviewAssignment.reviewer_id,
                ReviewAssignment.is_adjudicator,
                ReviewReport.recommendation,
            )
            .join(ReviewReport, ReviewReport.assignment_id == ReviewAssignment.id)
            .where(
                ReviewAssignment.submission_id == entry.id,
                ReviewAssignment.tenant_id == entry.tenant_id,
                ReviewAssignment.status == "completed",
                ReviewAssignment.round == current_round,
            )
        )
    ).all()
    accept_ids = {rid for rid, _adj, rec in rows if rec == "accept"}
    reject_count = sum(1 for _rid, _adj, rec in rows if rec == "reject")
    major_count = sum(1 for _rid, _adj, rec in rows if rec == "major_revision")
    adjudicator_accept = any(rec == "accept" and bool(adj) for _rid, adj, rec in rows)
    completed_reviews = len(rows)

    if len(accept_ids) < 2:
        _code = "no_completed_reviews" if completed_reviews == 0 else "insufficient_accept_reviews"
        _message = (
            "该稿件尚无已完成的审稿意见，不能直接录用。"
            "请先分配审稿人并等待意见返回；如确需免评审录用，请先调用 waive-review 记录理由。"
            if completed_reviews == 0
            else (
                f"发表需要至少 2 名不同审稿人给出录用推荐，当前只有 "
                f"{len(accept_ids)} 名（已完成报告 {completed_reviews} 份）。"
                "请继续送审，或在意见冲突时指定第三方裁决人。"
            )
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": _code,
                "message": _message,
                "accept_recommendations": len(accept_ids),
                "completed_reviews": completed_reviews,
            },
        )
    if (reject_count or major_count) and not adjudicator_accept:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "review_conflict_requires_adjudication",
                "message": (
                    "审稿意见存在冲突（录用 vs 拒稿/大修），不能直接录用。"
                    "请先指定第三方裁决人，并等待其给出录用意见。"
                ),
                "accept_recommendations": len(accept_ids),
                "reject_recommendations": reject_count,
                "major_revision_recommendations": major_count,
            },
        )


@router.patch(
    "/{submission_id}/review",
    response_model=SubmissionResponse,
)
async def review_submission(
    submission_id: int,
    body: SubmissionReview,
    current_user: User = Depends(require_chief_editor),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """遗留录用/拒稿端点——``/decision`` 的受闸门别名（已弃用）。

    历史上此端点允许 admin 零审稿直接 approved，绕过整个评审环节。
    现与 ``/decision`` 共用 ``_ensure_accept_gate``：approved 必须满足
    ≥2 名录用审稿人或已 waive-review。新代码请用 ``PATCH /{id}/decision``。
    Terminal: once reviewed, a submission cannot be re-reviewed.
    """
    entry = await _get_or_404(db, submission_id, lock=True)
    if entry.submitted_by == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot review own submission")
    if entry.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submission has already been reviewed",
        )

    # 录用闸门先于任何状态变更：零审稿/冲突意见不得直接 approved。
    if body.status == "approved":
        await _ensure_accept_gate(db, entry)

    now = utcnow()
    entry.status = body.status
    entry.admin_note = body.admin_note
    entry.reviewed_by = current_user.id
    entry.reviewed_at = now

    if body.status == "approved":
        if body.resource_id is not None:
            # Link to existing catalog Resource — must exist in this tenant.
            existing = (
                await db.execute(
                    select(Resource).where(
                        Resource.id == body.resource_id,
                        Resource.tenant_id == current_user.tenant_id,
                    )
                )
            ).scalar_one_or_none()
            if existing is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Provided resource_id does not exist",
                )
            entry.resource_id = existing.id
        else:
            # Materialize a new catalog Resource from the submission payload.
            new_resource = await _materialize_resource_from_submission(db, entry)
            entry.resource_id = new_resource.id

    # Audit: reviewer's approve/reject decision is a destructive state
    # transition (terminal). Log actor + outcome so the trail survives
    # even if the submission row is later purged. Written in the SAME
    # transaction as the state change (before commit) per S-3.
    db.add(
        AuditLog(
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            action="submission.review",
            target_type="submission",
            target_id=str(entry.id),
            payload={
                "status": entry.status,
                "resource_id": entry.resource_id,
                "admin_note_present": bool(entry.admin_note),
                "via": "legacy_review_alias",
            },
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Submission could not be reviewed (concurrent update)",
        ) from exc
    await db.refresh(entry)
    return _to_response(entry)


@router.post(
    "/{submission_id}/assignments",
    response_model=AssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def assign_reviewer(
    submission_id: int,
    body: AssignmentCreate,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> AssignmentResponse:
    """编辑分配审稿人。submission 必须处于 pending / under_review / resubmitted。

    分配后 submission 自动从 pending → under_review（仅 pending 时）。
    """
    entry = await _get_or_404(db, submission_id, lock=True)
    if entry.status not in ("pending", "under_review", "resubmitted"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot assign reviewer in status '{entry.status}'",
        )
    if current_user.id == entry.submitted_by:
        raise HTTPException(status_code=403, detail="Cannot assign reviewers to own submission")
    if body.reviewer_id == entry.submitted_by:
        raise HTTPException(status_code=403, detail="Cannot assign author as reviewer")
    # 审稿人必须存在且属于当前租户
    reviewer = (
        await db.execute(
            select(User).where(
                User.id == body.reviewer_id,
                User.tenant_id == entry.tenant_id,
                User.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if reviewer is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reviewer not found or inactive",
        )
    # 被指派者必须持有 reviewer / senior_reviewer 角色；否则该用户在所有
    # /review 端点都会卡死（require_reviewer 直接 403），分配毫无意义。
    # L6 资深审稿人与 L5 共用同一个评审端点与候选池，这里必须同口径，
    # 否则候选下拉里能选到、点下去却 422。
    if not (
        await user_has_role(db, reviewer, ROLE_REVIEWER)
        or await user_has_role(db, reviewer, ROLE_SENIOR_REVIEWER)
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Assigned user is not a reviewer",
        )
    await ensure_no_declared_conflict(
        db,
        tenant_id=entry.tenant_id,
        reviewer_id=reviewer.id,
        submission=entry,
    )
    if name_matches_author(reviewer, entry):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "reviewer_name_conflict",
                "message": (
                    f"审稿人 {reviewer.username} 与稿件作者同名：疑似共同作者/自审，请更换审稿人。"
                ),
            },
        )
    if (entry.triage_status or "pending") in ("pending", "rework"):
        entry.triage_status = "passed"
        entry.triaged_at = utcnow()
        entry.triaged_by = current_user.id

    existing_all = (
        (
            await db.execute(
                select(ReviewAssignment).where(
                    ReviewAssignment.submission_id == entry.id,
                    ReviewAssignment.tenant_id == entry.tenant_id,
                )
            )
        )
        .scalars()
        .all()
    )
    _rounds = [a.round or 1 for a in existing_all]
    _last_round = max(_rounds) if _rounds else 1
    _last_rows = [a for a in existing_all if (a.round or 1) == _last_round]
    if _last_rows and all(a.status in ("cancelled", "declined") for a in _last_rows):
        round_no = _last_round + 1
    else:
        round_no = _last_round
    used_slots = {a.slot for a in existing_all if (a.round or 1) == round_no and a.slot}
    next_slot = 1
    while next_slot in used_slots:
        next_slot += 1

    assignment = ReviewAssignment(
        tenant_id=entry.tenant_id,
        submission_id=entry.id,
        reviewer_id=reviewer.id,
        assigned_by=current_user.id,
        status="pending",
        due_date=body.due_date,
        round=round_no,
        slot=next_slot,
    )
    try:
        db.add(assignment)
        if entry.status == "pending":
            entry.status = "under_review"
        # 先 flush：重复分配会在此触发唯一约束（而非在 notifications/commit
        # 内部，那样会绕过下面的 409 处理），同时让 assignment.id 可用于通知。
        await db.flush()
        # 通知审稿人（与状态变更同事务，遵循 S-3：通知/审计并入主事务）
        await notifications.create(
            db,
            tenant_id=entry.tenant_id,
            user_id=reviewer.id,
            type_="review.invited",
            title=f"您被邀请审稿：{entry.title}",
            body=f"Submission #{entry.id} 已分配给您，请前往审稿工作台回应。",
            related_type="review_assignment",
            related_id=str(assignment.id),
        )
        # S-3：审计写入并入主事务（commit 前 add）。
        db.add(
            AuditLog(
                tenant_id=current_user.tenant_id,
                actor_user_id=current_user.id,
                action="submission.assign_reviewer",
                target_type="submission",
                target_id=str(entry.id),
                payload={
                    "reviewer_id": reviewer.id,
                    "assignment_id": assignment.id,
                },
            )
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reviewer already assigned or concurrent update",
        ) from exc
    await db.refresh(assignment)
    # 邮件通知审稿人（best-effort：未配置 SMTP 时静默跳过，不影响指派）
    from app.domain.submission.review_reminders import send_assignment_email

    await send_assignment_email(reviewer, submission_title=entry.title, assignment_id=assignment.id)
    return AssignmentResponse(
        id=assignment.id,
        submission_id=assignment.submission_id,
        reviewer_id=assignment.reviewer_id,
        assigned_by=assignment.assigned_by,
        status=assignment.status,
        due_date=assignment.due_date,
        invited_at=assignment.invited_at,
        responded_at=assignment.responded_at,
        completed_at=assignment.completed_at,
        reviewer_username=reviewer.username,
        submission_title=entry.title,
        last_reminded_at=assignment.last_reminded_at,
        reminder_count=assignment.reminder_count,
        round=assignment.round,
        slot=assignment.slot,
        is_adjudicator=assignment.is_adjudicator,
        is_external=assignment.is_external,
        external_affiliation=assignment.external_affiliation,
    )


@router.get(
    "/{submission_id}/assignments",
    response_model=AssignmentListResponse,
)
async def list_assignments(
    submission_id: int,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> AssignmentListResponse:
    """列出 submission 的所有审稿分配（编辑视角，含审稿人身份）。"""
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot manage own submission reviews")
    rows = (
        (
            await db.execute(
                select(ReviewAssignment)
                .where(
                    ReviewAssignment.submission_id == entry.id,
                    ReviewAssignment.tenant_id == entry.tenant_id,
                )
                .options(
                    selectinload(ReviewAssignment.reviewer),
                    selectinload(ReviewAssignment.submission),
                    selectinload(ReviewAssignment.report),
                )
                .order_by(ReviewAssignment.invited_at.desc())
            )
        )
        .scalars()
        .all()
    )

    total = len(rows)
    page_size = total or 1
    return AssignmentListResponse(
        data=[
            AssignmentResponse(
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
                submission_title=entry.title,
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
            for a in rows
        ],
        meta=PaginationMeta(total=total, page=1, page_size=page_size, total_pages=1),
    )


@router.delete(
    "/{submission_id}/assignments/{assignment_id}",
    response_model=MessageResponse,
)
async def cancel_assignment(
    submission_id: int,
    assignment_id: int,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """编辑撤销审稿人邀请。已 completed 的不可撤销（保留审稿历史）。"""
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot manage own submission reviews")
    a = (
        await db.execute(
            select(ReviewAssignment).where(
                ReviewAssignment.id == assignment_id,
                ReviewAssignment.submission_id == entry.id,
                ReviewAssignment.tenant_id == entry.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if a is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found",
        )
    if a.status == "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel a completed assignment (review report exists)",
        )
    a.status = "cancelled"
    # S-3：审计写入并入主事务（commit 前 add）。
    db.add(
        AuditLog(
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            action="submission.cancel_reviewer",
            target_type="submission",
            target_id=str(entry.id),
            payload={"assignment_id": a.id, "reviewer_id": a.reviewer_id},
        )
    )
    await db.commit()
    return MessageResponse(message="Assignment cancelled")


@router.get(
    "/{submission_id}/reports",
    response_model=list[ReviewReportResponse],
)
async def list_review_reports(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ReviewReportResponse]:
    """列出 submission 的所有审稿报告。

    - 编辑（admin/editor）：看完整报告（含 editor-only comments）
    - 作者：只看 comments_to_author（单盲：不暴露审稿人身份）
    - 审稿人自己：看自己的报告
    """
    entry = await _get_or_404(db, submission_id)
    # 单盲：编辑（admin 或有 editor 角色）看完整报告；
    # 作者只看 comments_to_author；被指派审稿人可看自己评审的稿件报告
    # （含自己写的 editor-only comments）。无上述身份者 403。
    is_editor = current_user.is_admin or await user_has_role(db, current_user, ROLE_EDITOR)
    is_author = entry.submitted_by == current_user.id
    is_reviewer = False
    if not is_editor and not is_author:
        assignment = (
            await db.execute(
                select(ReviewAssignment).where(
                    ReviewAssignment.submission_id == entry.id,
                    ReviewAssignment.reviewer_id == current_user.id,
                    ReviewAssignment.status.in_(("pending", "accepted", "completed")),
                )
            )
        ).scalar_one_or_none()
        is_reviewer = assignment is not None
        if not is_reviewer:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied",
            )

    rows = (
        await db.execute(
            select(ReviewReport, ReviewAssignment.reviewer_id, User.username)
            .join(ReviewAssignment, ReviewReport.assignment_id == ReviewAssignment.id)
            .join(User, User.id == ReviewAssignment.reviewer_id)
            .where(
                ReviewAssignment.submission_id == entry.id,
                ReviewReport.tenant_id == entry.tenant_id,
                ReviewAssignment.status == "completed",
            )
        )
    ).all()

    out: list[ReviewReportResponse] = []
    for r, reviewer_id, reviewer_username in rows:
        # 审稿人（非编辑非作者）：只能看**自己**那一份报告。
        # 修复前的代码让任何有 assignment 的人落进 else 分支，把该稿件全部
        # 已完成报告的 comments_to_editor（编辑机密）原样返回——甚至包括
        # 只是被邀请、尚未接受邀请的审稿人。编辑机密改为显式白名单。
        if is_reviewer and not is_editor and not is_author:
            if reviewer_id != current_user.id:
                continue
        # 作者：剥离 editor-only comments
        if is_author:
            out.append(
                ReviewReportResponse(
                    id=r.id,
                    assignment_id=r.assignment_id,
                    recommendation=r.recommendation,
                    scores=r.scores,
                    comments_to_editor=None,
                    comments_to_author=r.comments_to_author,
                    submitted_at=r.submitted_at,
                )
            )
        else:
            out.append(
                ReviewReportResponse(
                    id=r.id,
                    assignment_id=r.assignment_id,
                    recommendation=r.recommendation,
                    scores=r.scores,
                    comments_to_editor=r.comments_to_editor,
                    comments_to_author=r.comments_to_author,
                    attachments=r.attachments or [],
                    reviewer_id=reviewer_id,
                    reviewer_username=reviewer_username,
                    submitted_at=r.submitted_at,
                )
            )
    return out


@router.get("/{submission_id}/timeline")
async def submission_timeline(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """论文全流程时间线：投稿、版本、邀请/拒审、报告、作者回复、裁决。

    编辑可看全部稿件；作者只能看自己的稿件。审稿人不在本端点暴露
    其他审稿人的意见，避免绕过单盲。时间线用于主编追溯「从投稿到
    录用」的每一步，不替代审计日志。
    """
    entry = await _get_or_404(db, submission_id)
    is_editor = current_user.is_admin or await user_has_role(db, current_user, ROLE_EDITOR)
    if not is_editor and entry.submitted_by != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    # 双盲下作者不得经由时间线反推审稿人身份（邀请/接受/报告事件都点名）。
    # 编辑视图与单盲作者视图保持原样。函数级导入规避模块环。
    from app.domain.review.blinding import get_review_mode

    hide_reviewers = not is_editor and await get_review_mode(db, entry.tenant_id) == "double_blind"

    events: list[dict] = []

    def add(at, kind: str, title: str, detail: str | None = None) -> None:
        if at is not None:
            events.append({"at": at, "kind": kind, "title": title, "detail": detail})

    add(entry.submitted_at, "submitted", "作者提交稿件", f"状态 {entry.status}")

    versions = (
        (
            await db.execute(
                select(SubmissionVersion)
                .where(
                    SubmissionVersion.submission_id == entry.id,
                    SubmissionVersion.tenant_id == entry.tenant_id,
                )
                .order_by(SubmissionVersion.version)
            )
        )
        .scalars()
        .all()
    )
    for v in versions:
        if v.version > 1:
            add(
                v.created_at,
                "version",
                f"重投 v{v.version}",
                v.note or "作者提交了新版本",
            )

    assignments = (
        (
            await db.execute(
                select(ReviewAssignment)
                .where(
                    ReviewAssignment.submission_id == entry.id,
                    ReviewAssignment.tenant_id == entry.tenant_id,
                )
                .options(
                    selectinload(ReviewAssignment.reviewer),
                    selectinload(ReviewAssignment.report),
                )
                .order_by(ReviewAssignment.invited_at)
            )
        )
        .scalars()
        .all()
    )
    # 稳定匿名标签：按 invited_at 顺序给不同审稿人编号，重复 reviewer_id
    # 复用同一标签，避免作者靠事件顺序反推身份。
    reviewer_labels: dict[int, str] = {}
    for a in assignments:
        if a.reviewer_id not in reviewer_labels:
            reviewer_labels[a.reviewer_id] = f"审稿人{len(reviewer_labels) + 1}"
    for a in assignments:
        if hide_reviewers:
            who = reviewer_labels[a.reviewer_id]
        else:
            who = a.reviewer.username if a.reviewer else f"#{a.reviewer_id}"
        add(
            a.invited_at,
            "assignment",
            f"邀请审稿人 {who}",
            f"第 {a.round or 1} 轮 · 槽位 {a.slot} · 当前状态 {a.status}",
        )
        if a.responded_at and a.status in ("accepted", "completed"):
            add(a.responded_at, "assignment_response", f"{who} 接受审稿邀请", None)
        if a.status == "declined":
            add(a.responded_at or a.invited_at, "assignment_declined", f"{who} 拒绝审稿", "需改派")
        if a.status == "cancelled":
            add(a.responded_at or a.invited_at, "assignment_cancelled", f"{who} 的邀请已撤销", None)
        if a.completed_at:
            add(a.completed_at, "review_completed", f"{who} 提交审稿报告", None)
        for report in a.report or []:
            add(
                report.submitted_at,
                "review_report",
                f"{who} 的审稿意见",
                f"推荐：{report.recommendation}；给作者意见：{(report.comments_to_author or '无')[:80]}",
            )

    if entry.author_response_at:
        add(
            entry.author_response_at,
            "author_response",
            "作者逐条回复审稿人",
            (entry.author_response or "")[:120],
        )
    if entry.reviewed_at:
        add(entry.reviewed_at, "decision", "编辑作出决定", entry.status)

    events.sort(key=lambda e: e["at"])
    return {
        "submission_id": entry.id,
        "title": entry.title,
        "status": entry.status,
        "events": events,
    }


@router.patch(
    "/{submission_id}/decision",
    response_model=SubmissionResponse,
)
async def editor_decision(
    submission_id: int,
    body: SubmissionDecision,
    current_user: User = Depends(require_chief_editor),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """编辑最终决定（4 元）。

    accept: 自动物化 catalog Resource（除非 resource_id 指定现有资源），
            submission.status = 'accepted'。默认录用即刊（published）；
            body.publication_status='draft' 时暂存为草稿，进入刊前整理
            阶段（编辑/作者可预览，admin 刊出）。
    minor_revision / major_revision: status = 对应值，等作者 resubmit
    reject: status = 'rejected'（终态）

    approved / rejected 是旧 review 端点的别名，等价于 accept / reject。

    权限：仅 L8 执行编辑 / L9 主编（require_chief_editor）。L7 栏目编辑
    按分工只有初审、送审与推荐权，无最终裁决权。
    """
    entry = await _get_or_404(db, submission_id, lock=True)
    # 仅 pending / under_review / resubmitted 可决断
    if entry.status not in ("pending", "under_review", "resubmitted"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot decide in status '{entry.status}'",
        )

    if entry.submitted_by == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot decide own submission")

    decision = body.decision
    # 旧别名归一化
    if decision == "approved":
        decision = "accept"
    elif decision == "rejected":
        decision = "reject"

    # 录用闸门（与遗留 /review 别名共用 _ensure_accept_gate）：至少 2 名
    # 不同审稿人提交"录用"推荐才允许 accept；只有 1 份、或录用 vs 拒稿/大修
    # 冲突时须先经第三方裁决。desk accept 是需明确声明的例外——先走
    # POST /{id}/waive-review 记录理由与审计，再裁决。详见 helper docstring。
    if decision == "accept":
        await _ensure_accept_gate(db, entry)

    now = utcnow()
    _editor_note = (body.editor_note or "").strip()
    if body.arbitration_note and body.arbitration_note.strip():
        _editor_note = (
            _editor_note + "\n\n【冲突裁决理由】" + body.arbitration_note.strip()
        ).strip()
    entry.editor_note = _editor_note or None
    entry.reviewed_by = current_user.id
    entry.reviewed_at = now

    if decision == "accept":
        if body.resource_id is not None:
            existing = (
                await db.execute(
                    select(Resource).where(
                        Resource.id == body.resource_id,
                        Resource.tenant_id == entry.tenant_id,
                    )
                )
            ).scalar_one_or_none()
            if existing is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Provided resource_id does not exist",
                )
            entry.resource_id = existing.id
        else:
            new_resource = await _materialize_resource_from_submission(
                db, entry, publication_status=body.publication_status
            )
            entry.resource_id = new_resource.id
        # 评分低于 40（不合格）不能直接录用：rubric v3.0 的处置语义是
        # "<40 = rejected"。这不是提示而是硬约束——否则评分体系对最终
        # 处置没有任何约束力，编辑部可以一边给不合格分一边照发，分数
        # 就成了装饰。F（40–54）与 D-（55–57，borderline）均可发表。
        target_resource = (
            await db.execute(
                select(Resource).where(
                    Resource.id == entry.resource_id,
                    Resource.tenant_id == entry.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if (
            target_resource is not None
            and target_resource.quality_score is not None
            and target_resource.quality_score < 40
            and not body.force_accept_d_grade
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "rejected_requires_rework",
                    "score": float(target_resource.quality_score),
                    "message": (
                        "该稿件质量评分低于 40 分（不合格），按规范不能直接录用。"
                        "请先调用 rework 端点打回审稿人补审或要求作者修改；"
                        "如确需破例，请传 force_accept_d_grade=true 并在备注中写明理由。"
                    ),
                },
            )
        entry.status = "accepted"
    elif decision in ("major_revision", "minor_revision"):
        entry.status = decision
    elif decision == "reject":
        entry.status = "rejected"
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown decision: {decision}",
        )

    # 终局/修回决定后，当前轮未完成的审稿邀请不应继续挂在审稿人工作台上。
    # 此前 accept/reject 只改稿件状态，pending/accepted 的 assignment 会一直
    # 留在「待审稿」，审稿人看到的是一篇已经录用/退稿的稿件。
    if decision in ("accept", "reject", "major_revision", "minor_revision"):
        await db.execute(
            update(ReviewAssignment)
            .where(
                ReviewAssignment.submission_id == entry.id,
                ReviewAssignment.tenant_id == entry.tenant_id,
                ReviewAssignment.status.in_(["pending", "accepted"]),
            )
            .values(status="cancelled", responded_at=now)
        )

    # 积分结算：作者侧（录用 60 / 拒稿 5）+ 编辑侧（每次裁决 8）。
    # 与业务同一事务，决策失败不会留下孤立积分。
    #
    # 修回（major/minor）**不发任何终态积分**：它既不是终点，也不该被
    # 记成"拒稿"。此前用 `"accepted" if accept else "rejected"` 的三元式，
    # 导致修回被记成 submission.rejected（+5），而幂等键是
    # (user, action, ref_id=submission_id)，于是后续真正的拒稿奖励会被
    # 静默吞掉——账面上作者"因为被要求修改而拿到了拒稿分"。
    from app.domain.gamification import service as gamification

    author = (
        await db.execute(select(User).where(User.id == entry.submitted_by))
    ).scalar_one_or_none()
    if author is not None:
        if decision == "accept":
            await gamification.award(
                db,
                author,
                "submission.accepted",
                ref_type="submission",
                ref_id=str(entry.id),
            )
        elif decision == "reject":
            await gamification.award(
                db,
                author,
                "submission.rejected",
                ref_type="submission",
                ref_id=str(entry.id),
            )
    await gamification.award(
        db,
        current_user,
        "editor.decision",
        ref_type="submission",
        ref_id=str(entry.id),
    )

    # --- 等级轴（v1.14）：身份内积分，与上面的荣誉 XP 正交 ---
    # 正式论文（paper）录用：作者 +60；娱乐/吐槽稿（essay）录用：delta=0 仅记活跃。
    # 编辑裁决：editor 身份 +8。全部幂等（同一 submission 只记一次）。
    from app.domain.gamification import levels_axis

    if author is not None:
        if decision == "accept":
            if (entry.content_track or "paper") == "paper":
                await levels_axis.award_points(
                    db,
                    author,
                    "submission.accepted",
                    ref_type="submission",
                    ref_id=str(entry.id),
                    note=entry.title[:120],
                )
            else:
                # 娱乐/吐槽轨：不推进等级，只留一条活跃度流水。
                await levels_axis.award_points(
                    db,
                    author,
                    "submission.accepted.essay",
                    ref_type="submission",
                    ref_id=str(entry.id),
                )
    if decision in ("accept", "reject", "major_revision", "minor_revision"):
        await levels_axis.award_points(
            db,
            current_user,
            "editor.decision",
            ref_type="submission",
            ref_id=str(entry.id),
        )

    # 通知作者。录用时 related 指向物化出的公开目录条目而非 submission，
    # 作者点通知即可直达自己已发表的文章（目录详情页对访客也公开）。
    decision_labels = {
        "accept": "录用",
        "reject": "拒稿",
        "minor_revision": "小修",
        "major_revision": "大修",
    }
    accepted = decision == "accept" and entry.resource_id is not None
    await notifications.create(
        db,
        tenant_id=entry.tenant_id,
        user_id=entry.submitted_by,
        type_="submission.decision",
        title=f"稿件决定通知：{entry.title}",
        body=(
            f"您的稿件 #{entry.id} 收到编辑决定：{decision_labels.get(decision, decision)}。"
            + (f" 编辑备注：{entry.editor_note}" if entry.editor_note else "")
            + ("（文章已收录进公开目录，点击查看发表页面）" if accepted else "")
        ),
        related_type="resource" if accepted else "submission",
        related_id=str(entry.resource_id) if accepted else str(entry.id),
    )
    # S-3：审计写入并入主事务（commit 前 add）。
    db.add(
        AuditLog(
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            action="submission.decision",
            target_type="submission",
            target_id=str(entry.id),
            payload={
                "decision": decision,
                "resource_id": entry.resource_id,
                "editor_note_present": bool(entry.editor_note),
                "arbitration_note_present": bool(body.arbitration_note),
            },
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not apply decision (concurrent update)",
        ) from exc
    await db.refresh(entry)
    # 裁决邮件通知作者（best-effort；未配置 SMTP 时静默跳过）
    try:
        author = (
            await db.execute(select(User).where(User.id == entry.submitted_by))
        ).scalar_one_or_none()
        if author is not None:
            from app.domain.submission.review_reminders import send_decision_email

            await send_decision_email(
                author,
                submission_title=entry.title,
                decision=decision,
                note=body.editor_note,
            )
    except Exception:
        logger.warning("decision_email_dispatch_failed", submission_id=entry.id, exc_info=True)
    return _to_response(entry)


@router.post(
    "/{submission_id}/rework",
    response_model=SubmissionResponse,
)
async def request_rework(
    submission_id: int,
    body: ReworkRequest,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """把稿件打回：通知审稿人补审 / 通知作者修改。

    D 级（<60 分）的标准处置。D 不是"拒绝"，是"当前不合格"——最常见的
    成因是审稿人没细看，而不是稿子真的无救。直接拒稿会冤枉作者，直接
    录用会放进垃圾，打回是最诚实的处置。

    两条通知同时发出，因为两件事都要有人做：

    1. **给审稿人**：附上具体缺陷清单，要求补审或说明为何应拒。
       审稿人可以选择"我漏看了，补意见"或"我看清了，就是该拒"——
       这个选择权必须留给审稿人，不能由编辑代劳。
    2. **给作者**：列出逐条修改要求，让作者知道该改什么，而不是
       只收到一句"不合格"。

    状态置为 ``under_review``（2.0 主编口径：打回**先打回给审稿人**，不直接
    通知作者——审稿人补审/说明后，编辑部再凭任一复审意见做最终决定
    （录用发布或要求作者修改）；此时才需要作者出面。作者侧在复审结束前
    不感知打回，避免"被退稿"的误伤。
    """
    if len(body.requirements) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="打回必须列出至少 3 条具体修改要求——只说'不合格'对作者没有帮助。",
        )
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot request rework on own submission")
    if entry.status in ("accepted", "approved", "rejected"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot request rework in terminal status '{entry.status}'",
        )

    # 2.0 主编口径：打回先回到审稿环节（under_review），由审稿人复审；
    # 只有复审确认需要作者修改时，才经由 decide(major/minor) 通知作者。
    entry.status = "under_review"
    entry.editor_note = body.note
    requirements_text = "\n".join(f"{i + 1}. {r}" for i, r in enumerate(body.requirements))

    # 作者也要知道稿件被退回修改：状态回到 under_review，作者仍可继续
    # 上传修订稿；如果只通知审稿人，作者会在不知情的情况下等下去。
    await notifications.create(
        db,
        tenant_id=entry.tenant_id,
        user_id=entry.submitted_by,
        type_="submission.rework_requested",
        title=f"稿件需要修改：{entry.title}",
        body=(
            f"稿件 #{entry.id} 已被编辑部退回修改，当前进入复审阶段。\n"
            f"修改要求：\n{requirements_text}\n\n"
            "你可以在「我的提交」中上传修订稿；审稿人复审后编辑部会给出下一步决定。"
        ),
        related_type="submission",
        related_id=str(entry.id),
    )

    # 通知审稿人：该稿被打回，需要补审或说明（这是打回此刻的唯一外发通知）
    from app.domain.review.models import ReviewAssignment

    reviewers = (
        (
            await db.execute(
                select(ReviewAssignment.reviewer_id).where(
                    ReviewAssignment.submission_id == entry.id,
                    ReviewAssignment.tenant_id == entry.tenant_id,
                    ReviewAssignment.status.in_(("pending", "accepted", "completed")),
                )
            )
        )
        .scalars()
        .all()
    )
    for reviewer_id in set(reviewers):
        await notifications.create(
            db,
            tenant_id=entry.tenant_id,
            user_id=reviewer_id,
            type_="review.rework_requested",
            title=f"审稿被打回，请补审：{entry.title}",
            body=(
                f"稿件 #{entry.id} 的质量评分为 D 级（<60），编辑部要求补审。\n"
                "请二选一：\n"
                "（a）补充/修正审稿意见，特别是以下方面；\n"
                "（b）说明为何该稿确实应当拒稿。\n\n"
                f"需要补审的方面：\n{requirements_text}"
            ),
            related_type="submission",
            related_id=str(entry.id),
        )

    # 若该稿还没有任何审稿指派，编辑部需要先指派审稿人复审——写一条
    # 提醒给当前编辑，避免稿件卡在无人可审的状态。
    if not reviewers:
        await notifications.create(
            db,
            tenant_id=entry.tenant_id,
            user_id=current_user.id,
            type_="review.rework_needs_assignment",
            title=f"打回稿件尚无审稿人，请先指派复审：{entry.title}",
            body=(
                f"稿件 #{entry.id} 已按主编口径转入复审（under_review），"
                "但还没有任何审稿指派。\n请先在审稿管理页指派一名或多名审稿人"
                "（可多人同审，任一复审意见即可支撑最终决定）。\n\n"
                f"需要补审的方面：\n{requirements_text}"
            ),
            related_type="submission",
            related_id=str(entry.id),
        )

    db.add(
        AuditLog(
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            action="submission.rework_requested",
            target_type="submission",
            target_id=str(entry.id),
            payload={
                "requirements": body.requirements,
                "reviewers_notified": len(set(reviewers)),
            },
        )
    )
    await db.commit()
    await db.refresh(entry)
    return _to_response(entry)


@router.post(
    "/{submission_id}/waive-review",
    response_model=SubmissionResponse,
)
async def waive_review(
    submission_id: int,
    body: WaiveReviewRequest,
    current_user: User = Depends(require_chief_editor),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """声明该稿件免于同行评审（desk accept 的前置步骤）。

    存在的理由：真实期刊确实有不需要外审的稿件（约稿、编委特稿、纪念
    专辑、明确的重复发表撤稿复核）。但"可以不审"必须是一个**被记录、
    有理由、可追责**的例外，而不是沉默的默认路径——否则任何拿到编辑
    权限的账号都能绕过整个评审流程直接发文，而事后无从分辨"快"与"漏"。

    权限与裁决同级（require_chief_editor）：能免审的人必须也能负责。

    幂等：重复调用只更新理由并追加审计，不报错（编辑部可能在裁决前
    多次斟酌措辞）。
    """
    if len(body.reason.strip()) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="免评审理由至少 10 个字，且会写入审计日志与作者通知。",
        )
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot waive review on own submission")
    if entry.status in ("accepted", "approved", "rejected"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot waive review in terminal status '{entry.status}'",
        )

    entry.review_waived_at = utcnow()
    entry.review_waived_by = current_user.id
    entry.review_waive_reason = body.reason.strip()
    db.add(
        AuditLog(
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            action="submission.review_waived",
            target_type="submission",
            target_id=str(entry.id),
            # 理由必须进审计：这是"为什么这篇没走同行评审"的唯一书面依据。
            payload={"reason": entry.review_waive_reason},
        )
    )
    await db.commit()
    await db.refresh(entry)
    return _to_response(entry)


@router.put(
    "/{submission_id}/anonymized-file",
    response_model=SubmissionResponse,
)
async def set_anonymized_file(
    submission_id: int,
    body: AnonymizedFileUpdate,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """编辑设置/清除双盲评审用的匿名稿外链。

    背景（双盲绕过修复）：``download_url`` / ``external_url`` 都是**作者
    可控**字段（创建端点与作者编辑端点均可写）。双盲下若把审稿人放行到
    这些链接，作者填一条带身份的 URL 即可直穿双盲。因此审稿人视角只认
    本端点写入的 ``anonymized_file_url``。

    传 ``null`` 清除（例如作者补充了合规的匿名稿链接后不再需要）。
    """
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot manage own submission reviews")

    url = str(body.anonymized_file_url) if body.anonymized_file_url else None
    if url is not None and not url.lower().startswith(("http://", "https://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="anonymized_file_url must be an http(s) URL",
        )

    entry.anonymized_file_url = url
    db.add(
        AuditLog(
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            action="submission.anonymized_file",
            target_type="submission",
            target_id=str(entry.id),
            payload={"set": url is not None},
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not update anonymized file URL (concurrent change)",
        ) from exc
    await db.refresh(entry)
    return _to_response(entry)
