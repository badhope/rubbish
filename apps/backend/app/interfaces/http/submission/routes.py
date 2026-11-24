"""Submission API routes — 作者侧（创建 / 查询 / 编辑 / 版本 / 删除 / 重投）。

编辑与互评侧见 routes_editor.py；文件上传下载见 routes_files.py。
本文件末尾通过底部 import 把三个路由文件注册到同一个 router 上
（FastAPI 拆分路由文件的惯例做法，避免循环导入）。
"""

from __future__ import annotations

import difflib
import logging
import mimetypes
from pathlib import Path
from urllib.parse import quote

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Response,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_user,
    require_editor,
    require_tenant_id,
    user_has_editor_access,
)
from app.core.db import get_db
from app.core.moderation import rejection_detail
from app.core.storage import get_storage
from app.core.time import utcnow
from app.domain.catalog.models import Resource
from app.domain.notifications import services as notifications
from app.domain.submission._helpers import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    _snapshot_submission,
    _try_delete_storage,
)
from app.domain.submission.models import Submission, SubmissionDraft, SubmissionVersion
from app.domain.submission.similarity import check_against_site
from app.interfaces.http.submission.responses import _get_or_404, _list_submissions, _to_response
from app.interfaces.http.submission.schemas import (
    AuthorResponseUpdate,
    MessageResponse,
    ResubmitRequest,
    SubmissionBatchCreate,
    SubmissionBatchItemResult,
    SubmissionBatchResponse,
    SubmissionCreate,
    SubmissionDraftPayload,
    SubmissionDraftResponse,
    SubmissionDraftState,
    SubmissionListResponse,
    SubmissionOverview,
    SubmissionResponse,
    SubmissionUpdate,
    SubmissionVersionListResponse,
    SubmissionVersionResponse,
    ReworkResponseUpdate,
    WithdrawRequest,
)
from app.models import AuditLog, Role, User, UserRole

router = APIRouter(prefix="/submissions", tags=["submissions"])
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 注册编辑/互评侧与文件侧路由（必须在 GET /{submission_id} 之前 import：
# FastAPI 按注册顺序匹配，静态路径（/pending、/me）必须先于路径参数注册）。
# 此处 router 与常量已就绪，子模块 `from .routes import router` 无循环导入。
# ---------------------------------------------------------------------------
from importlib import import_module as _import_module  # noqa: E402

# 子路由必须在 router 与常量就绪后导入：它们在本模块的 router 上继续
# 追加编辑/互评与文件端点。用 import_module 表达副作用注册，避免被
# 静态检查当成未使用导入删除。
_import_module("app.interfaces.http.submission.routes_editor")
_import_module("app.interfaces.http.submission.routes_files")


class StudioPdfRequest(BaseModel):
    """Studio 排版 PDF 的题录载荷：与网页预览同一套字段。"""

    title: str = ""
    authors: list[str] = Field(default_factory=list)
    affiliations: str | None = None
    abstract: str = ""
    keywords: list[str] = Field(default_factory=list)
    body: str = ""
    doi: str | None = None
    funding: str | None = None
    clc: str | None = None
    license: str | None = None
    track: str = "paper"


@router.post("/studio-pdf")
async def studio_pdf(
    payload: StudioPdfRequest,
    current_user: User = Depends(get_current_user),
) -> Response:
    """按 Studio 预览的题录顺序直接出 A4 PDF（不走 docx→LibreOffice）。"""
    from starlette.concurrency import run_in_threadpool

    from app.domain.submission.studio_pdf import render_studio_pdf

    if len(payload.body) > 300_000:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="正文过长，无法生成排版 PDF",
        )
    meta = {
        "title": payload.title,
        "authors": payload.authors,
        "affiliations": payload.affiliations or "",
        "abstract": payload.abstract,
        "keywords": payload.keywords,
        "doi": payload.doi,
        "funding": payload.funding,
        "clc": payload.clc,
        "license": payload.license,
        "track": payload.track,
    }
    pdf = await run_in_threadpool(render_studio_pdf, meta, payload.body)
    filename = quote(f"{(payload.title or 'paper')[:40]}-排版.pdf")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


@router.get("/draft", response_model=SubmissionDraftState)
async def get_submission_draft(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionDraftState:
    """作者当前的向导草稿；没有则返回 ``draft: null``，不 404。"""
    draft = (
        await db.execute(select(SubmissionDraft).where(SubmissionDraft.user_id == current_user.id))
    ).scalar_one_or_none()
    return SubmissionDraftState(
        draft=SubmissionDraftResponse.model_validate(draft) if draft else None
    )


@router.put("/draft", response_model=SubmissionDraftState)
async def save_submission_draft(
    body: SubmissionDraftPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionDraftState:
    """覆盖保存草稿（同一作者只保留一份，不产生版本噪音）。"""
    draft = (
        await db.execute(select(SubmissionDraft).where(SubmissionDraft.user_id == current_user.id))
    ).scalar_one_or_none()
    if draft is None:
        draft = SubmissionDraft(
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            payload=body.payload,
            body=body.body,
        )
        db.add(draft)
    else:
        draft.payload = body.payload
        draft.body = body.body
        draft.updated_at = utcnow()
    await db.commit()
    await db.refresh(draft)
    return SubmissionDraftState(draft=SubmissionDraftResponse.model_validate(draft))


@router.delete("/draft", response_model=MessageResponse)
async def delete_submission_draft(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """删除草稿；幂等，没有草稿也返回成功。"""
    draft = (
        await db.execute(select(SubmissionDraft).where(SubmissionDraft.user_id == current_user.id))
    ).scalar_one_or_none()
    if draft is not None:
        await db.delete(draft)
        await db.commit()
    return MessageResponse(message="draft deleted")


async def _create_submission_record(
    db: AsyncSession,
    current_user: User,
    body: SubmissionCreate,
) -> Submission:
    """Validate and stage one submission; caller owns the transaction.

    Kept separate from the HTTP endpoint so the batch route can wrap each
    row in its own savepoint: one bad import must not roll back the rows
    that already passed moderation and similarity checks.
    """
    from app.api.levels import CURRENT_RULES_VERSION

    if current_user.rules_ack_version != CURRENT_RULES_VERSION:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "rules_ack_required",
                "version": CURRENT_RULES_VERSION,
                "message": "发布前请先阅读并确认《Rubbish 写作与发布规范》。",
            },
        )
    blocked = rejection_detail(f"{body.title}\n{body.abstract}")
    if blocked is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=blocked)
    similarity_score, similarity_matches = await check_against_site(
        db,
        current_user.tenant_id,
        title=body.title,
        abstract=body.abstract,
    )
    submission = Submission(
        tenant_id=current_user.tenant_id,
        submitted_by=current_user.id,
        status="pending",
        title=body.title,
        type=body.type,
        track=body.track,
        authors=body.authors,
        author_affiliations=body.author_affiliations,
        year=body.year,
        venue=body.venue,
        discipline=body.discipline,
        subdiscipline=body.subdiscipline,
        article_section=body.article_section,
        issue_part=body.issue_part,
        keywords=body.keywords,
        jel_codes=body.jel_codes,
        tags=body.tags,
        abstract=body.abstract,
        preview=body.preview,
        download_url=str(body.download_url) if body.download_url else None,
        external_url=str(body.external_url) if body.external_url else None,
        doi=body.doi,
        corresponding_author_email=body.corresponding_author_email,
        license=body.license,
        author_contributions=body.author_contributions,
        funding=body.funding,
        coi_statement=body.coi_statement,
        data_availability=body.data_availability,
        similarity_score=similarity_score,
        similarity_matches=similarity_matches,
    )
    db.add(submission)
    await db.flush()  # 拿到 submission.id 供 v1 快照引用
    # v1 快照：保证「最初提交了什么」永远可查（版本历史从创建开始）
    await _snapshot_submission(db, submission, created_by=current_user.id)
    from app.domain.gamification import service as gamification

    await gamification.award(
        db, current_user, "submission.create", ref_type="submission", ref_id=str(submission.id)
    )
    return submission


def _batch_error(exc: HTTPException) -> tuple[str, str | None]:
    """Turn an HTTPException detail into a safe, user-readable batch result."""
    detail = exc.detail
    if isinstance(detail, dict):
        message = detail.get("message") or detail.get("detail") or "提交失败"
        code = detail.get("code")
        return str(message), str(code) if code else None
    return str(detail or "提交失败"), None


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
    """Submit a record for editor review.

    发布零等级门槛：注册登录即可投（只要确认当版规范）。
    唯一前置是确认当版《写作与发布规范》（rules_ack_version，见下）——这是
    合规动作而非等级门槛；确认动作在个人中心 / gamification/onboarding/author，
    同时授予作者引导积分。
    """
    submission = await _create_submission_record(db, current_user, body)
    await db.commit()
    await db.refresh(submission)
    return _to_response(submission)


@router.post("/batch", response_model=SubmissionBatchResponse)
async def create_submissions_batch(
    payload: SubmissionBatchCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionBatchResponse:
    """Create up to 50 author submissions in one request.

    Each row gets its own savepoint and its own moderation / similarity
    checks.  Successes are committed together; a failed row is reported by
    index without hiding or rolling back the rows around it.  This is the
    same write path as ``POST /submissions`` — imports still enter the
    normal editor review queue, never straight into the public catalog.
    """
    from app.api.levels import CURRENT_RULES_VERSION

    if current_user.rules_ack_version != CURRENT_RULES_VERSION:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "rules_ack_required",
                "version": CURRENT_RULES_VERSION,
                "message": "发布前请先阅读并确认《Rubbish 写作与发布规范》。",
            },
        )

    results: list[SubmissionBatchItemResult] = []
    created_count = 0
    for index, item in enumerate(payload.items):
        try:
            async with db.begin_nested():
                submission = await _create_submission_record(db, current_user, item)
            created_count += 1
            results.append(
                SubmissionBatchItemResult(
                    index=index,
                    title=item.title[:200],
                    status="created",
                    submission_id=submission.id,
                )
            )
        except HTTPException as exc:
            message, code = _batch_error(exc)
            results.append(
                SubmissionBatchItemResult(
                    index=index,
                    title=item.title[:200],
                    status="failed",
                    error=message,
                    code=code,
                )
            )
        except Exception:  # one bad row must not fail the batch
            logger.exception("Batch submission item failed", extra={"batch_index": index})
            results.append(
                SubmissionBatchItemResult(
                    index=index,
                    title=item.title[:200],
                    status="failed",
                    error="服务器未能保存该条，请稍后重试",
                    code="internal_error",
                )
            )
    await db.commit()
    return SubmissionBatchResponse(
        created_count=created_count,
        failed_count=len(results) - created_count,
        results=results,
    )


@router.get("/me", response_model=SubmissionListResponse)
async def list_my_submissions(
    status_filter: str = Query(
        default=None,
        alias="status",
        pattern=r"^(pending|under_review|major_revision|minor_revision|resubmitted|rework_requested|accepted|approved|rejected|withdrawn)$",
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


@router.get("/overview", response_model=SubmissionOverview)
async def submission_overview(
    _: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> SubmissionOverview:
    """Return submission-record and unique-work counts for the content desk."""
    tenant_id = require_tenant_id()
    status_rows = (
        await db.execute(
            select(Submission.status, func.count(Submission.id))
            .where(Submission.tenant_id == tenant_id)
            .group_by(Submission.status)
        )
    ).all()
    status_counts = {str(code): int(count) for code, count in status_rows}
    total = sum(status_counts.values())

    accepted_count = status_counts.get("accepted", 0) + status_counts.get("approved", 0)
    accepted_resources = int(
        (
            await db.execute(
                select(func.count(func.distinct(Submission.resource_id))).where(
                    Submission.tenant_id == tenant_id,
                    Submission.status.in_(("accepted", "approved")),
                    Submission.resource_id.is_not(None),
                )
            )
        ).scalar_one()
        or 0
    )
    resource_total = int(
        (
            await db.execute(
                select(func.count(func.distinct(Submission.resource_id))).where(
                    Submission.tenant_id == tenant_id,
                    Submission.resource_id.is_not(None),
                )
            )
        ).scalar_one()
        or 0
    )
    resource_status_rows = (
        await db.execute(
            select(Resource.publication_status, func.count(func.distinct(Submission.resource_id)))
            .join(Resource, Resource.id == Submission.resource_id)
            .where(
                Submission.tenant_id == tenant_id,
                Submission.resource_id.is_not(None),
            )
            .group_by(Resource.publication_status)
        )
    ).all()
    resource_status = {str(code): int(count) for code, count in resource_status_rows}

    return SubmissionOverview(
        total=total,
        status_counts=status_counts,
        resource_total=resource_total,
        accepted_resources=accepted_resources,
        published=resource_status.get("published", 0),
        draft=resource_status.get("draft", 0),
        duplicate_accepted=max(accepted_count - accepted_resources, 0),
    )


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
        and not await user_has_editor_access(db, current_user)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    response = _to_response(entry)
    if entry.resource_id is not None:
        # 发布状态随详情下发：前端据此区分「已发表」与「发布前预览」。
        from app.domain.catalog.models import Resource

        response.resource_publication_status = (
            await db.execute(
                select(Resource.publication_status).where(
                    Resource.id == entry.resource_id,
                    Resource.tenant_id == entry.tenant_id,
                )
            )
        ).scalar_one_or_none()
    return response


@router.patch("/{submission_id}", response_model=SubmissionResponse)
async def update_submission(
    submission_id: int,
    body: SubmissionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """作者修改自己的作品内容（补齐修回链路的缺口）。

    此前 major/minor revision 后作者只能翻状态「重投」，却改不了
    任何内容 —— 修回等于空转。此端点让作者在以下状态可编辑：

    - ``pending``：还没进入评审，随便改；
    - ``major_revision`` / ``minor_revision``：按互评意见修改，
      改完再点重投（重投时快照为新版本）。

    under_review 不可编辑：互评成员正在看的稿子不能被作者悄悄换掉。
    终态（accepted/rejected/approved）不可编辑。
    """
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the submitter can edit the submission",
        )
    if entry.status not in ("pending", "major_revision", "minor_revision", "rework_requested"):
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
    # 标题/摘要变了，敏感词与站内相似度都必须重算；否则详情页会继续
    # 展示旧分，编辑入口就等于绕过了发布时的风控。
    if "title" in updates or "abstract" in updates:
        blocked = rejection_detail(f"{entry.title}\n{entry.abstract or ''}")
        if blocked is not None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=blocked)
        score, matches = await check_against_site(
            db,
            entry.tenant_id,
            title=entry.title,
            abstract=entry.abstract or "",
            exclude_submission_id=entry.id,
        )
        entry.similarity_score = score
        entry.similarity_matches = matches
    await db.commit()
    await db.refresh(entry)
    return _to_response(entry)


# ---------------------------------------------------------------------------
# 在线正文编辑器（2.0）：作者不依赖 Word/PDF 上传也能直接写/改正文。
# 正文以 Markdown 存入 storage（与上传转换产物同一条 markdown_path 通道），
# 阅读页 / Word 下载件 / JATS 导出自动继承，无需额外发布步骤。
# ---------------------------------------------------------------------------

MAX_ONLINE_BODY_BYTES = 1_000_000
_ONLINE_EDITABLE_STATUSES = ("pending", "major_revision", "minor_revision", "rework_requested")


class OnlineMarkdownBody(BaseModel):
    content: str = Field(min_length=1, max_length=MAX_ONLINE_BODY_BYTES)


async def _body_access_or_error(
    submission_id: int, current_user: User, db: AsyncSession, *, require_editable: bool
) -> Submission:
    entry = await _get_or_404(db, submission_id)
    is_staff = current_user.is_admin or await user_has_editor_access(db, current_user)
    if entry.submitted_by != current_user.id and not is_staff:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the submitter or editorial staff can access the body",
        )
    # 读取不限状态：互评期作者仍要能看自己的稿子与修改建议。
    # 写入门禁：编辑部改稿不受状态限制；作者本人仅在可编辑状态开放。
    if require_editable and not is_staff and entry.status not in _ONLINE_EDITABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot edit submission body in status '{entry.status}'",
        )
    return entry


@router.get("/{submission_id}/markdown")
async def get_submission_markdown(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """读取在线正文（作者本人 / 内容整理，不限作品状态）。"""
    entry = await _body_access_or_error(submission_id, current_user, db, require_editable=False)
    if not entry.markdown_path:
        return {"content": ""}
    from app.core.storage import get_storage

    try:
        data = await get_storage().load(entry.markdown_path)
    except FileNotFoundError:
        return {"content": ""}
    return {"content": data.decode("utf-8", errors="replace")}


@router.put("/{submission_id}/markdown")
async def save_submission_markdown(
    submission_id: int,
    body: OnlineMarkdownBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """保存在线正文（作者可编辑状态 / 编辑部）。

    与 update_submission 同一权限门。每次保存写入新 storage key 并替换
    markdown_path，旧文件清理（与上传替换同一策略），避免孤儿对象。
    """
    from uuid import uuid4

    entry = await _body_access_or_error(submission_id, current_user, db, require_editable=True)
    from app.core.storage import get_storage

    rel_path = f"{entry.tenant_id}/{entry.id}/{uuid4().hex}.md"
    await get_storage().save(rel_path, body.content.encode("utf-8"), content_type="text/markdown")
    old_md = entry.markdown_path
    entry.markdown_path = rel_path
    await db.commit()
    await db.refresh(entry)
    await _try_delete_storage(old_md)
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
    """作品版本历史（v1 = 初次提交；之后每次重投一个版本）。

    可见方：作者本人、admin/editor。互评成员故意不给 —— 双盲模式下
    历史版本可能残留身份信息，且互评成员只需要看「当前版本」。
    """
    entry = await _get_or_404(db, submission_id)
    allowed = (
        entry.submitted_by == current_user.id
        or current_user.is_admin
        or await user_has_editor_access(db, current_user)
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


@router.get("/{submission_id}/versions/{version}/diff")
async def diff_submission_version(
    submission_id: int,
    version: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """对比指定版本与上一版：正文行级 diff + 题录字段变更。"""
    entry = await _get_or_404(db, submission_id)
    allowed = (
        entry.submitted_by == current_user.id
        or current_user.is_admin
        or await user_has_editor_access(db, current_user)
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Access denied")
    rows = (
        (
            await db.execute(
                select(SubmissionVersion)
                .where(
                    SubmissionVersion.submission_id == entry.id,
                    SubmissionVersion.version.in_((version, version - 1)),
                )
                .order_by(SubmissionVersion.version)
            )
        )
        .scalars()
        .all()
    )
    current = next((r for r in rows if r.version == version), None)
    if current is None:
        raise HTTPException(status_code=404, detail="版本不存在")
    previous = next((r for r in rows if r.version == version - 1), None)
    left = (previous.body if previous and previous.body else "") if previous else ""
    right = current.body or ""
    body_diff = list(
        difflib.unified_diff(
            left.splitlines(),
            right.splitlines(),
            fromfile=f"v{previous.version}" if previous else "v0",
            tofile=f"v{current.version}",
            lineterm="",
            n=3,
        )
    )
    if len(body_diff) > 600:
        body_diff = body_diff[:600] + ["… diff 过长，已截断"]
    fields = (
        "title",
        "abstract",
        "preview",
        "keywords",
        "authors",
        "author_affiliations",
        "discipline",
        "subdiscipline",
        "doi",
    )
    before = (previous.payload if previous else {}) or {}
    after = current.payload or {}
    field_changes = []
    for key in fields:
        old = before.get(key)
        new = after.get(key)
        if old != new:
            field_changes.append({"field": key, "before": old, "after": new})
    return {
        "from_version": previous.version if previous else 0,
        "to_version": current.version,
        "body_diff": body_diff,
        "field_changes": field_changes,
        "has_body_diff": bool(left or right),
    }


@router.get("/{submission_id}/versions/{version}/file")
async def download_submission_version(
    submission_id: int,
    version: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """下载某一历史版本的原件（作者本人 / 编辑 / 管理员）。"""
    entry = await _get_or_404(db, submission_id)
    allowed = (
        entry.submitted_by == current_user.id
        or current_user.is_admin
        or await user_has_editor_access(db, current_user)
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    row = (
        await db.execute(
            select(SubmissionVersion).where(
                SubmissionVersion.submission_id == entry.id,
                SubmissionVersion.version == version,
            )
        )
    ).scalar_one_or_none()
    if row is None or not row.file_path:
        raise HTTPException(status_code=404, detail="该版本没有可下载的原件")
    try:
        data = await get_storage().load(row.file_path)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="该版本原件已不在存储中，无法下载；当前版本仍可正常下载",
        ) from exc
    name = Path(str(row.file_path)).name or f"v{version}"
    media_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
    )


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
    # 删除作品时应同步清理其存储文件，否则 PDF 在磁盘 / S3 上成为孤儿对象，
    # 既泄露删除行为的"残留"，也会让存储无限增长。
    await _try_delete_storage(file_path)
    return MessageResponse(message="Submission deleted")


@router.post(
    "/{submission_id}/withdraw",
    response_model=SubmissionResponse,
)
async def author_withdraw(
    submission_id: int,
    body: WithdrawRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """作者主动撤稿：保留版本、互评报告和审计，不删除任何历史。"""
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the submitter can withdraw")
    if entry.status in ("accepted", "approved", "rejected", "withdrawn"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot withdraw in terminal status '{entry.status}'",
        )
    from sqlalchemy import update as _update

    from app.domain.review.models import ReviewAssignment as _RA

    open_reviewer_ids = (
        (
            await db.execute(
                select(_RA.reviewer_id)
                .where(
                    _RA.submission_id == entry.id,
                    _RA.tenant_id == entry.tenant_id,
                    _RA.status.in_(("pending", "accepted")),
                )
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    cancelled = (
        await db.execute(
            _update(_RA)
            .where(
                _RA.submission_id == entry.id,
                _RA.tenant_id == entry.tenant_id,
                _RA.status.in_(("pending", "accepted")),
            )
            .values(status="cancelled")
        )
    ).rowcount or 0
    entry.status = "withdrawn"
    entry.withdrawn_at = utcnow()
    entry.withdrawn_reason = " ".join(body.reason.split()).strip()[:2000]
    entry.rework_due_at = None
    # 通知互评成员与编辑：任务不是凭空消失，而是作者明确撤稿。
    for reviewer_id in open_reviewer_ids:
        await notifications.create(
            db,
            tenant_id=entry.tenant_id,
            user_id=reviewer_id,
            type_="review.assignment_cancelled",
            title=f"互评任务已撤回：{entry.title}",
            body=f"作者已撤回作品 #{entry.id}，本轮互评任务关闭，无需再提交。",
            related_type="submission",
            related_id=str(entry.id),
        )
    editors = (
        (
            await db.execute(
                select(User).where(
                    User.tenant_id == entry.tenant_id,
                    User.is_active.is_(True),
                    User.id.in_(
                        select(UserRole.user_id)
                        .join(Role, Role.id == UserRole.role_id)
                        .where(
                            UserRole.tenant_id == entry.tenant_id,
                            Role.tenant_id == entry.tenant_id,
                            Role.name.in_(("editor", "chief_editor")),
                        )
                    )
                    | User.is_admin.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    for editor in editors:
        await notifications.create(
            db,
            tenant_id=entry.tenant_id,
            user_id=editor.id,
            type_="submission.withdrawn",
            title=f"作者已撤稿：{entry.title}",
            body=f"作品 #{entry.id} 已由作者撤回。\n原因：{entry.withdrawn_reason}",
            related_type="submission",
            related_id=str(entry.id),
        )
    db.add(
        AuditLog(
            tenant_id=entry.tenant_id,
            actor_user_id=current_user.id,
            action="submission.withdrawn",
            target_type="submission",
            target_id=str(entry.id),
            payload={
                "reason": entry.withdrawn_reason,
                "assignments_cancelled": cancelled,
                "reviewers_notified": len(open_reviewer_ids),
            },
        )
    )
    await db.commit()
    await db.refresh(entry)
    return _to_response(entry)


@router.put(
    "/{submission_id}/rework-response",
    response_model=SubmissionResponse,
)
async def author_rework_response(
    submission_id: int,
    body: ReworkResponseUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """作者逐条回应退回要求；不改变作品状态，也不替代重投。"""
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the submitter can respond")
    if entry.status != "rework_requested":
        raise HTTPException(status_code=400, detail="Not in rework_requested status")
    requirements = [dict(item) for item in (entry.rework_requirements or [])]
    if not requirements:
        raise HTTPException(status_code=409, detail="No structured requirements to respond to")
    by_id = {str(item.get("id")): item for item in requirements}
    seen: set[str] = set()
    for update in body.items:
        if update.requirement_id in seen:
            raise HTTPException(status_code=400, detail="Duplicate requirement id")
        seen.add(update.requirement_id)
        item = by_id.get(update.requirement_id)
        if item is None:
            raise HTTPException(status_code=400, detail="Requirement id not found")
        item["status"] = update.status
        item["response"] = " ".join(update.note.split()).strip()[:2000]
        item["updated_at"] = utcnow().isoformat()
    entry.rework_requirements = requirements
    await db.commit()
    await db.refresh(entry)
    return _to_response(entry)


@router.put(
    "/{submission_id}/response",
    response_model=SubmissionResponse,
)
async def author_response(
    submission_id: int,
    body: AuthorResponseUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """作者逐条回复互评成员（Response to Reviewers）。

    与重投时的版本修改说明分开保存：编辑在裁决/查看作品时直接可见。
    仅作者本人、且作品至少有一份已完成互评报告时可写。
    """
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the submitter can respond to reviewers",
        )
    if entry.status not in (
        "under_review",
        "major_revision",
        "minor_revision",
        "resubmitted",
        "rework_requested",
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot respond to reviewers in status '{entry.status}'",
        )
    from app.domain.review.models import ReviewAssignment as _RA, ReviewReport as _RR

    completed = (
        await db.execute(
            select(func.count())
            .select_from(_RR)
            .join(_RA, _RR.assignment_id == _RA.id)
            .where(
                _RA.submission_id == entry.id,
                _RA.tenant_id == entry.tenant_id,
                _RA.status.in_(("completed", "cancelled")),
            )
        )
    ).scalar_one()
    if completed == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No completed review report to respond to yet",
        )
    text = (body.response or "").strip()
    entry.author_response = text or None
    entry.author_response_at = utcnow() if text else None
    await db.commit()
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
    """作者收到 major_revision / minor_revision / rework_requested 后重新提交。

    将状态置为 under_review（编辑可再次分配/决断），并把当前（作者已
    通过 PATCH 修改过的）作品内容快照为新版本。可选 ``note`` 记录
    「针对互评意见做了哪些修改」，随版本一起存档并推送给编辑。

    仅作者本人可操作。body 可省略，兼容旧的无 body 调用。
    """
    entry = await _get_or_404(db, submission_id)
    if entry.submitted_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the submitter can resubmit",
        )
    if entry.status not in ("major_revision", "minor_revision", "rework_requested"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot resubmit in status '{entry.status}'",
        )
    note = body.note if body else None
    entry.status = "under_review"
    entry.rework_due_at = None
    # 补材料后重投：回到基础检查队列，而不是直接进入已送互评状态。
    if (entry.triage_status or "") == "materials":
        entry.status = "resubmitted"
        entry.triage_status = "pending"
        entry.triaged_at = None
        entry.triaged_by = None
        entry.triage_started_at = utcnow()
    # 作者修回后，上一轮的互评意见不能再计入新一轮闸门；否则“退回修改后
    # 重投”会拿旧通过意见直接放行。旧报告保留在 review_reports 里供
    # 追溯，但本轮 assignment 置 cancelled，必须重新分派互评。
    from sqlalchemy import update as _update

    from app.domain.review.models import ReviewAssignment as _RA

    _rounds = (
        await db.execute(
            select(func.max(_RA.round)).where(
                _RA.submission_id == entry.id,
                _RA.tenant_id == entry.tenant_id,
            )
        )
    ).scalar()
    if _rounds:
        await db.execute(
            _update(_RA)
            .where(
                _RA.submission_id == entry.id,
                _RA.tenant_id == entry.tenant_id,
                _RA.round == _rounds,
                _RA.status.in_(("pending", "accepted", "completed")),
            )
            .values(status="cancelled")
        )
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
                select(User).where(
                    User.tenant_id == entry.tenant_id,
                    User.is_active.is_(True),
                    (User.id.in_(editor_ids)) | (User.is_admin.is_(True)),
                )
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
