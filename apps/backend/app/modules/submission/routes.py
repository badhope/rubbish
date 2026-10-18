"""Submission API routes — author submission + editor review workflow.

Author side (auth, every user sees their own submissions only):
  POST   /submissions                     — submit a record for review
  GET    /submissions/me                  — list my submissions (filter by status)
  GET    /submissions/{id}                — view one (owner or admin only)

Editor side (admin only):
  GET    /submissions                     — list all submissions in the tenant
  GET    /submissions/pending             — list pending submissions only
  PATCH  /submissions/{id}/review         — approve / reject + (optional)
                                              link to existing catalog Resource
                                              OR materialize a new one from
                                              the submission payload.

Approval semantics:

- If the reviewer provides ``resource_id``, it must point to an existing
  catalog Resource in the same tenant; the submission is linked to it.
- If ``resource_id`` is omitted on approval, a new catalog Resource is
  materialized from the submission payload in-process by
  ``_materialize_resource_from_submission`` (same transaction as the
  status change; no cross-module HTTP call).
- Once approved, the submission is terminal: status cannot be changed.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import desc, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import (
    ROLE_EDITOR,
    ROLE_REVIEWER,
    get_current_user,
    require_admin,
    require_editor,
    require_tenant_id,
    user_has_role,
)
from app.core import search as fulltext
from app.core.db import get_db, paginate
from app.core.time import utcnow
from app.models import AuditLog, Role, User, UserRole
from app.modules.catalog.models import Resource
from app.modules.notifications import services as notifications
from app.modules.review.models import ReviewAssignment, ReviewReport
from app.modules.review.schemas import (
    AssignmentCreate,
    AssignmentListResponse,
    AssignmentResponse,
    ReviewReportResponse,
)
from app.modules.submission.models import Submission, SubmissionVersion
from app.modules.submission.schemas import (
    AnonymizedFileUpdate,
    MessageResponse,
    ResubmitRequest,
    SubmissionCreate,
    SubmissionDecision,
    SubmissionListResponse,
    SubmissionResponse,
    SubmissionReview,
    SubmissionUpdate,
    SubmissionVersionListResponse,
    SubmissionVersionResponse,
)

logger = logging.getLogger(__name__)


async def _try_delete_storage(key: str | None) -> None:
    """Best-effort storage cleanup.

    A failed delete must never block the caller's primary operation
    (e.g. deleting a submission). Orphaned objects are rare — they only
    appear when the storage backend is momentarily unreachable — and the
    operator can spot the warning in the logs.
    """
    if not key:
        return
    from app.core.storage import get_storage

    try:
        await get_storage().delete(key)
    except Exception:
        logger.warning("storage_delete_failed", key=key, exc_info=True)


router = APIRouter(prefix="/submissions", tags=["submissions"])

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


async def _get_or_404(db: AsyncSession, submission_id: int) -> Submission:
    """Fetch a submission by id (scoped to current tenant) or raise 404."""
    tenant_id = require_tenant_id()
    entry = (
        await db.execute(
            select(Submission).where(
                Submission.id == submission_id,
                Submission.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submission not found",
        )
    return entry


async def _materialize_resource_from_submission(
    db: AsyncSession, submission: Submission
) -> Resource:
    """Create a catalog Resource from a submission payload.

    Calls the same shape the catalog admin POST endpoint expects, so the
    conversion logic (preview truncation, defaults, etc.) stays where
    Resource creation belongs. We construct the ORM Resource directly
    rather than re-routing through the HTTP layer to keep it
    transactional with the review commit.
    """
    # 本地稿件文件：不再使用 /uploads 静态路径（该挂载无鉴权，任何人都能
    # 下载在审稿件，见 app/main.py 的说明）。改为物化后在下方写入指向
    # 公开端点 /api/catalog/{id}/file 的 download_url——只有进入公开目录的
    # 资源才能读到文件，未公开的投稿仍然只走鉴权端点。
    resource = Resource(
        tenant_id=submission.tenant_id,
        type=submission.type,
        title=submission.title,
        authors=submission.authors,
        year=submission.year,
        venue=submission.venue,
        discipline=submission.discipline,
        subdiscipline=submission.subdiscipline,
        tags=submission.tags,
        abstract=submission.abstract,
        preview=submission.preview,
        # download_url 在 flush 拿到 id 后回填（见下方），此处先留空。
        download_url=submission.download_url,
        external_url=submission.external_url,
        doi=submission.doi,
        # 物化时把 submission 的 keywords 带过去，与 catalog.Resource 对齐。
        # jel_codes 不在此物化——catalog.Resource 没有该列（功能未落地），
        # 此处不声称不存在的字段对齐。
        keywords=submission.keywords or None,
    )
    db.add(resource)
    await db.flush()
    if not resource.download_url and submission.file_path:
        # 稿件带着本地上传文件时，暴露一个"只读已发表资源"的公开端点，
        # 而不是把 storage 目录整个挂出去。阅读器（pdf.js）与详情页都走它。
        resource.download_url = f"/api/catalog/{resource.id}/file"
    # 同步全文索引（best-effort）。即使后续事务回滚产生幽灵文档也无害：
    # 搜索路由按 id 回读 DB，查不到的命中会被静默丢弃。
    await fulltext.index_resource(resource)
    return resource


def _to_response(entry: Submission) -> SubmissionResponse:
    return SubmissionResponse(
        id=entry.id,
        title=entry.title,
        type=entry.type,
        authors=entry.authors,
        year=entry.year,
        venue=entry.venue,
        discipline=entry.discipline,
        subdiscipline=entry.subdiscipline,
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
        status=entry.status,
        admin_note=entry.admin_note,
        editor_note=entry.editor_note,
        resource_id=entry.resource_id,
        file_path=entry.file_path,
        submitted_by=entry.submitted_by,
        submitted_at=entry.submitted_at,
        reviewed_by=entry.reviewed_by,
        reviewed_at=entry.reviewed_at,
    )


# 参与版本快照的书目字段。故意不含 status / editor_note / resource_id ——
# 那些是工作流状态而非「作者写了什么」，把它们塞进快照会让 diff 充满
# 与稿件内容无关的噪音。
_VERSIONED_FIELDS = (
    "title",
    "type",
    "authors",
    "year",
    "venue",
    "discipline",
    "subdiscipline",
    "keywords",
    "jel_codes",
    "tags",
    "abstract",
    "preview",
    "download_url",
    "external_url",
    "doi",
    "corresponding_author_email",
)


def _version_payload(entry: Submission) -> dict[str, Any]:
    """Extract the versioned bibliographic payload from a submission."""
    return {field: getattr(entry, field) for field in _VERSIONED_FIELDS}


async def _snapshot_submission(
    db: AsyncSession,
    entry: Submission,
    *,
    created_by: int | None,
    note: str | None = None,
) -> SubmissionVersion:
    """Append an immutable snapshot of ``entry`` to its version history.

    版本号取「当前最大版本 + 1」。并发重投理论上可能撞号，此时
    (submission_id, version) 唯一约束会抛 IntegrityError —— 交给调用方
    转成 409，比静默写重号安全。

    调用方负责 commit：快照必须与触发它的状态变更在同一事务里，
    否则可能出现「状态变了但没留版本」的空洞。
    """
    current_max = (
        await db.execute(
            select(func.max(SubmissionVersion.version)).where(
                SubmissionVersion.submission_id == entry.id
            )
        )
    ).scalar()
    snapshot = SubmissionVersion(
        tenant_id=entry.tenant_id,
        submission_id=entry.id,
        version=(current_max or 0) + 1,
        payload=_version_payload(entry),
        file_path=entry.file_path,
        note=note,
        created_by=created_by,
    )
    db.add(snapshot)
    return snapshot


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
    return SubmissionListResponse(
        data=[_to_response(r) for r in rows],
        meta=meta,
    )


# ---------------------------------------------------------------------------
# Author side
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=SubmissionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_submission(
    body: SubmissionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """Submit a record for editor review (auth required)."""
    submission = Submission(
        tenant_id=current_user.tenant_id,
        submitted_by=current_user.id,
        status="pending",
        title=body.title,
        type=body.type,
        authors=body.authors,
        year=body.year,
        venue=body.venue,
        discipline=body.discipline,
        subdiscipline=body.subdiscipline,
        keywords=body.keywords,
        jel_codes=body.jel_codes,
        tags=body.tags,
        abstract=body.abstract,
        preview=body.preview,
        download_url=str(body.download_url) if body.download_url else None,
        external_url=str(body.external_url) if body.external_url else None,
        doi=body.doi,
        corresponding_author_email=body.corresponding_author_email,
    )
    db.add(submission)
    await db.flush()  # 拿到 submission.id 供 v1 快照引用
    # v1 快照：保证「最初提交了什么」永远可查（版本历史从创建开始）
    await _snapshot_submission(db, submission, created_by=current_user.id)
    await db.commit()
    await db.refresh(submission)
    return _to_response(submission)


@router.get("/me", response_model=SubmissionListResponse)
async def list_my_submissions(
    status_filter: str = Query(
        default=None,
        alias="status",
        pattern=r"^(pending|under_review|major_revision|minor_revision|resubmitted|accepted|approved|rejected)$",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionListResponse:
    """List the current user's own submissions."""
    query = select(Submission).where(
        Submission.submitted_by == current_user.id,
        Submission.tenant_id == current_user.tenant_id,
    )
    if status_filter is not None:
        query = query.where(Submission.status == status_filter)
    return await _list_submissions(db, query, page, page_size)


@router.get("/pending", response_model=SubmissionListResponse)
async def list_pending_submissions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
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


@router.get("", response_model=SubmissionListResponse)
async def list_submissions(
    status_filter: str = Query(
        default=None,
        alias="status",
        pattern=r"^(pending|under_review|major_revision|minor_revision|resubmitted|accepted|approved|rejected)$",
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


@router.get("/{submission_id}", response_model=SubmissionResponse)
async def get_submission(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """View a submission. Owner sees their own; admin or editor sees any."""
    entry = await _get_or_404(db, submission_id)
    if (
        entry.submitted_by != current_user.id
        and not current_user.is_admin
        and not await user_has_role(db, current_user, ROLE_EDITOR)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    return _to_response(entry)


@router.patch("/{submission_id}", response_model=SubmissionResponse)
async def update_submission(
    submission_id: int,
    body: SubmissionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """作者修改自己的稿件内容（补齐修回链路的缺口）。

    此前 major/minor revision 后作者只能翻状态「重投」，却改不了
    任何内容 —— 修回等于空转。此端点让作者在以下状态可编辑：

    - ``pending``：还没进入评审，随便改；
    - ``major_revision`` / ``minor_revision``：按审稿意见修改，
      改完再点重投（重投时快照为新版本）。

    under_review 不可编辑：审稿人正在看的稿子不能被作者悄悄换掉。
    终态（accepted/rejected/approved）不可编辑。
    """
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the submitter can edit the submission",
        )
    if entry.status not in ("pending", "major_revision", "minor_revision"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot edit submission in status '{entry.status}'",
        )
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return _to_response(entry)
    for field, value in updates.items():
        # AnyHttpUrl 落库前转 str，与 create 端点行为一致
        if field in ("download_url", "external_url") and value is not None:
            value = str(value)
        setattr(entry, field, value)
    await db.commit()
    await db.refresh(entry)
    return _to_response(entry)


@router.get(
    "/{submission_id}/versions",
    response_model=SubmissionVersionListResponse,
)
async def list_submission_versions(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionVersionListResponse:
    """稿件版本历史（v1 = 初次提交；之后每次重投一个版本）。

    可见方：作者本人、admin/editor。审稿人故意不给 —— 双盲模式下
    历史版本可能残留身份信息，且审稿人只需要看「当前版本」。
    """
    entry = await _get_or_404(db, submission_id)
    allowed = (
        entry.submitted_by == current_user.id
        or current_user.is_admin
        or await user_has_role(db, current_user, ROLE_EDITOR)
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    rows = (
        (
            await db.execute(
                select(SubmissionVersion)
                .where(SubmissionVersion.submission_id == entry.id)
                .order_by(SubmissionVersion.version.desc())
            )
        )
        .scalars()
        .all()
    )
    return SubmissionVersionListResponse(
        data=[SubmissionVersionResponse.model_validate(v) for v in rows]
    )


# ---------------------------------------------------------------------------
# Editor review
# ---------------------------------------------------------------------------


@router.patch(
    "/{submission_id}/review",
    response_model=SubmissionResponse,
)
async def review_submission(
    submission_id: int,
    body: SubmissionReview,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """Approve or reject a pending submission (admin only).

    Terminal: once reviewed, a submission cannot be re-reviewed.
    """
    entry = await _get_or_404(db, submission_id)
    if entry.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submission has already been reviewed",
        )

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
            # The conversion stays here (orchestration); catalog owns the
            # Resource shape — we just construct it via the same fields the
            # catalog admin POST would accept.
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


@router.delete(
    "/{submission_id}",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
)
async def delete_submission(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Delete a submission. Submitter may delete their own pending only.

    Approved/rejected submissions are immutable historical records and
    cannot be deleted by the submitter (admin can via direct DB access
    if needed; not exposed via API to keep the audit trail intact).
    """
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    if entry.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a reviewed submission",
        )
    file_path = entry.file_path
    await db.delete(entry)
    await db.commit()
    # 删除稿件时应同步清理其存储文件，否则 PDF 在磁盘 / S3 上成为孤儿对象，
    # 既泄露删除行为的"残留"，也会让存储无限增长。
    await _try_delete_storage(file_path)
    return MessageResponse(message="Submission deleted")


# ---------------------------------------------------------------------------
# Editor: assign reviewer + list assignments + 4 元 decision + list reports
# ---------------------------------------------------------------------------


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
    entry = await _get_or_404(db, submission_id)
    if entry.status not in ("pending", "under_review", "resubmitted"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot assign reviewer in status '{entry.status}'",
        )
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
    # 被指派者必须持有 reviewer 角色；否则该用户在所有 /review 端点都会
    # 卡死（require_reviewer 直接 403），分配毫无意义。
    if not await user_has_role(db, reviewer, ROLE_REVIEWER):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Assigned user is not a reviewer",
        )
    assignment = ReviewAssignment(
        tenant_id=entry.tenant_id,
        submission_id=entry.id,
        reviewer_id=reviewer.id,
        assigned_by=current_user.id,
        status="pending",
        due_date=body.due_date,
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
    )


@router.get(
    "/{submission_id}/assignments",
    response_model=AssignmentListResponse,
)
async def list_assignments(
    submission_id: int,
    _: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> AssignmentListResponse:
    """列出 submission 的所有审稿分配（编辑视角，含审稿人身份）。"""
    entry = await _get_or_404(db, submission_id)
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
                )
                .order_by(ReviewAssignment.invited_at.desc())
            )
        )
        .scalars()
        .all()
    )
    from app.core.schemas import PaginationMeta

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
            select(ReviewReport, ReviewAssignment.reviewer_id)
            .join(ReviewAssignment, ReviewReport.assignment_id == ReviewAssignment.id)
            .where(
                ReviewAssignment.submission_id == entry.id,
                ReviewReport.tenant_id == entry.tenant_id,
                ReviewAssignment.status == "completed",
            )
        )
    ).all()

    out: list[ReviewReportResponse] = []
    for r, reviewer_id in rows:
        # 审稿人（非编辑非作者）：只能看**自己**那一份报告。
        # 修复前的代码让任何有 assignment 的人落进 else 分支，把该稿件全部
        # 已完成报告的 comments_to_editor（编辑机密）原样返回——甚至包括
        # 只是被邀请、尚未接受邀请的审稿人。编辑机密改为显式白名单。
        if is_reviewer and not is_editor and not is_author:
            if reviewer_id != current_user.id:
                continue
        # 作者：剥离 editor-only comments
        if is_author and not is_editor:
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
                    submitted_at=r.submitted_at,
                )
            )
    return out


@router.patch(
    "/{submission_id}/decision",
    response_model=SubmissionResponse,
)
async def editor_decision(
    submission_id: int,
    body: SubmissionDecision,
    current_user: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """编辑最终决定（4 元）。

    accept: 自动物化 catalog Resource（除非 resource_id 指定现有资源），
            submission.status = 'accepted'
    minor_revision / major_revision: status = 对应值，等作者 resubmit
    reject: status = 'rejected'（终态）

    approved / rejected 是旧 review 端点的别名，等价于 accept / reject。
    """
    entry = await _get_or_404(db, submission_id)
    # 仅 pending / under_review / resubmitted 可决断
    if entry.status not in ("pending", "under_review", "resubmitted"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot decide in status '{entry.status}'",
        )

    decision = body.decision
    # 旧别名归一化
    if decision == "approved":
        decision = "accept"
    elif decision == "rejected":
        decision = "reject"

    now = utcnow()
    entry.editor_note = body.editor_note
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
            new_resource = await _materialize_resource_from_submission(db, entry)
            entry.resource_id = new_resource.id
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
            + (f" 编辑备注：{body.editor_note}" if body.editor_note else "")
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
                "editor_note_present": bool(body.editor_note),
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


@router.post(
    "/{submission_id}/resubmit",
    response_model=SubmissionResponse,
)
async def author_resubmit(
    submission_id: int,
    body: ResubmitRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """作者收到 major_revision / minor_revision 后重新提交。

    将状态置为 under_review（编辑可再次分配/决断），并把当前（作者已
    通过 PATCH 修改过的）稿件内容快照为新版本。可选 ``note`` 记录
    「针对审稿意见做了哪些修改」，随版本一起存档并推送给编辑。

    仅作者本人可操作。body 可省略，兼容旧的无 body 调用。
    """
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the submitter can resubmit",
        )
    if entry.status not in ("major_revision", "minor_revision"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot resubmit in status '{entry.status}'",
        )
    note = body.note if body else None
    entry.status = "under_review"
    # 快照与状态变更同事务：避免「状态翻了但没留版本」的历史空洞
    snapshot = await _snapshot_submission(db, entry, created_by=current_user.id, note=note)
    # commit 后 ORM 对象过期，异步会话下惰性刷新会炸；版本号在 commit 前取出
    version_no = snapshot.version
    # 通知编辑：作者已重投（与状态变更同事务，遵循 S-3）。
    # admin 在权限模型里视同 editor（deps._user_has_role 对 admin 直接放行），
    # fan-out 必须与之对齐 —— 否则只有 admin 的小刊重投通知会石沉大海。
    editor_ids = (
        select(UserRole.user_id)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            UserRole.tenant_id == entry.tenant_id,
            Role.tenant_id == entry.tenant_id,
            Role.name == "editor",
        )
    )
    editors = (
        (
            await db.execute(
                select(User)
                .where(
                    User.tenant_id == entry.tenant_id,
                    User.is_active.is_(True),
                    (User.id.in_(editor_ids)) | (User.is_admin.is_(True)),
                )
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    notify_body = f"Submission #{entry.id}（v{version_no}）已进入 under_review，请处理。"
    if note:
        notify_body += f"\n作者修改说明：{note}"
    for editor in editors:
        await notifications.create(
            db,
            tenant_id=entry.tenant_id,
            user_id=editor.id,
            type_="submission.resubmitted",
            title=f"作者已重新提交：{entry.title}",
            body=notify_body,
            related_type="submission",
            related_id=str(entry.id),
        )
    try:
        await db.commit()
    except IntegrityError as exc:
        # (submission_id, version) 唯一约束冲突 = 并发重投撞号
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Concurrent resubmit detected, please retry",
        ) from exc
    await db.refresh(entry)
    return _to_response(entry)


# ---------------------------------------------------------------------------
# File upload (作者投稿时上传 PDF)
# ---------------------------------------------------------------------------


_ALLOWED_UPLOAD_MIMES = frozenset(
    {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/postscript",
        "text/plain",
        "application/zip",
    }
)
_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


@router.post(
    "/{submission_id}/files",
    response_model=SubmissionResponse,
)
async def upload_submission_file(
    submission_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """作者上传稿件 PDF（替换式：重复上传会覆盖 file_path）。

    限制：
    - 仅作者本人
    - submission 必须处于 pending / under_review / major_revision / minor_revision
      （under_review 允许是为了让编辑要求作者替换稿件时仍能上传）
    - accepted / rejected 终态下不可上传
    - MIME 必须在白名单内
    - 大小 ≤ 50 MB
    - 文件名经过 path 安全检查（防 ../ 穿越）
    """
    import os
    from uuid import uuid4

    from app.core.storage import get_storage

    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the submitter can upload files",
        )
    if entry.status not in (
        "pending",
        "under_review",
        "major_revision",
        "minor_revision",
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot upload files in status '{entry.status}'",
        )
    if file.content_type not in _ALLOWED_UPLOAD_MIMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type: {file.content_type}",
        )

    # 流式读 + 大小校验，避免一次性 OOM
    contents = b""
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        contents += chunk
        if len(contents) > _MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds {_MAX_UPLOAD_BYTES} bytes",
            )

    # 存储 key：{tenant_id}/{submission_id}/{uuid}{ext}
    # 用 uuid 防文件名碰撞 + 路径穿越；本地/S3 后端共用同一 key 形状，
    # 切换后端无需迁移数据库。
    original_filename = file.filename or "upload"
    ext = os.path.splitext(original_filename)[1]
    if ext and len(ext) > 20:
        ext = ext[:20]
    safe_name = f"{uuid4().hex}{ext}"
    rel_path = f"{entry.tenant_id}/{entry.id}/{safe_name}"
    old_path = entry.file_path  # 可能为 None（首次上传）
    if old_path == rel_path:  # uuid 碰撞极不可能，但保险起见跳过自删
        old_path = None
    await get_storage().save(rel_path, contents, content_type=file.content_type)
    entry.file_path = rel_path
    await db.commit()
    await db.refresh(entry)
    # 替换式上传会覆盖 file_path，被替换的旧文件若不清会被丢成孤儿对象。
    await _try_delete_storage(old_path)
    return _to_response(entry)


@router.get("/{submission_id}/files")
async def download_submission_file(
    submission_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """下载稿件文件。

    这里补上了此前缺失的链路终点：稿件此前只能上传、无法取回，
    编辑与被指派的审稿人拿不到作者的 PDF，评审无从谈起。

    可访问方：
    - 作者本人
    - admin / editor
    - 该稿件的被指派审稿人（assignment 处于 pending/accepted/completed）

    S3 后端会尽量返回 302 预签名直链（省一次服务端带宽）；本地后端
    与预签名失败时改为服务端流式返回，权限校验始终发生在这里。
    """
    import mimetypes

    from fastapi.responses import RedirectResponse, StreamingResponse

    from app.core.storage import get_storage

    entry = await _get_or_404(db, submission_id)
    if not entry.file_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This submission has no uploaded file",
        )

    allowed = entry.submitted_by == current_user.id or await user_has_role(
        db, current_user, ROLE_EDITOR
    )
    if not allowed:
        assignment = (
            (
                await db.execute(
                    select(ReviewAssignment).where(
                        ReviewAssignment.submission_id == entry.id,
                        ReviewAssignment.reviewer_id == current_user.id,
                        ReviewAssignment.status.in_(("pending", "accepted", "completed")),
                    )
                )
            )
            .scalars()
            .first()
        )
        allowed = assignment is not None
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this submission file",
        )

    # 双盲评审：原始上传文件不能交给审稿人。
    #
    # 修复前，双盲只在 JSON 字段上做抹除（authors/邮箱/submitted_by/venue/doi），
    # 文件下载端点却把**原始 PDF** 直接返回给被指派的审稿人——标题页和 PDF
    # 元数据里就是作者姓名与单位，双盲在核心流程上等于不存在。
    #
    # 第二层修复（双盲绕过 v2）：重定向目标曾用 ``download_url``，但该字段
    # **作者可控**（创建端点与作者编辑端点均可写）——作者填一条带身份的
    # URL 即可直穿双盲（重定向目标对审稿人可见，页面内容更可直接暴露身份）。
    # 现在只放行编辑端点写入的 ``anonymized_file_url``；没有匿名稿则明确报错，
    # 由编辑补上传。服务端不具备剥离 PDF 元数据的能力，不假装能做到。
    is_privileged = entry.submitted_by == current_user.id or await user_has_role(
        db, current_user, ROLE_EDITOR
    )
    if not is_privileged:
        from app.modules.review.blinding import get_review_mode

        mode = await get_review_mode(db, entry.tenant_id)
        if mode == "double_blind":
            anon_url = (entry.anonymized_file_url or "").strip()
            if anon_url.lower().startswith(("http://", "https://")):
                return RedirectResponse(anon_url, status_code=status.HTTP_302_FOUND)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Double-blind review is enabled: the original manuscript may reveal "
                    "author identity. Ask the editor to provide an anonymized version "
                    "(editor: PUT /api/submissions/{id}/anonymized-file) before reviewing."
                ),
            )

    storage = get_storage()
    url = storage.presigned_url(entry.file_path)
    if url:
        # S3 预签名 URL 直接重定向到对象存储；对象存储自身会依据客户端的
        # Range 头返回 206，无需在此追加（追加未签名的 range 参数会让
        # SigV4 签名失效，导致 SignatureDoesNotMatch → 403）。
        return RedirectResponse(url, status_code=status.HTTP_302_FOUND)

    try:
        data = await storage.load(entry.file_path)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stored file is missing",
        ) from exc

    filename = entry.file_path.rsplit("/", 1)[-1]
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

    # F9: HTTP Range 支持（本地后端）。解析 Range: bytes=start-end，
    # 返回 206 Partial Content + Content-Range 头。若 Range 非法或缺失，
    # 退回 200 全量流式。
    range_header = request.headers.get("Range")
    if range_header and range_header.startswith("bytes="):
        spec = range_header[len("bytes=") :]
        try:
            if "-" in spec:
                start_s, end_s = spec.split("-", 1)
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else len(data) - 1
            else:
                start = int(spec)
                end = len(data) - 1
            start = max(start, 0)
            end = min(end, len(data) - 1)
            if start > end or start >= len(data):
                raise ValueError("invalid range")
            chunk = data[start : end + 1]
            return Response(
                content=chunk,
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                media_type=media_type,
                headers={
                    "Content-Range": f"bytes {start}-{end}/{len(data)}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(len(chunk)),
                    "Content-Disposition": f'attachment; filename="{filename}"',
                },
            )
        except (ValueError, IndexError):
            # 非法 Range → 退回全量 200（不报错）
            pass

    return StreamingResponse(
        iter((data,)),
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Accept-Ranges": "bytes",
        },
    )
