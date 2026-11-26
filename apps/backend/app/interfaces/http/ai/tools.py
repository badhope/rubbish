"""MCP tool registry for Rubbish.

One registry serves both the stdio bridge and the remote `/api/mcp` endpoint.
Every handler calls the same domain route function as the web UI, so role
gates, audit rows, notifications, quality gates and revision rules cannot be
bypassed by using a token instead of a browser session.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from sqlalchemy import func, select

from app.api.levels import CURRENT_RULES_VERSION
from app.core.moderation import rejection_detail
from app.core.time import utcnow
from app.domain.review.models import ReviewAssignment
from app.domain.submission.models import Submission, SubmissionVersion
from app.domain.submission.similarity import check_against_site
from app.interfaces.http.ai.scopes import (
    SCOPE_EDITORIAL_DECIDE,
    SCOPE_EDITORIAL_READ,
    SCOPE_EDITORIAL_TRIAGE,
    SCOPE_LABELS,
    SCOPE_PROFILE_READ,
    SCOPE_REVIEW_READ,
    SCOPE_REVIEW_WRITE,
    SCOPE_SUBMISSION_READ,
    SCOPE_SUBMISSION_WRITE,
    TokenIdentity,
    normalize_dt,
)
from app.interfaces.http.review.schemas import AssignmentCreate, ReviewSubmit
from app.interfaces.http.submission.responses import _get_or_404, _to_response
from app.interfaces.http.submission.schemas import (
    SubmissionCreate,
    SubmissionDecision,
    SubmissionUpdate,
    TriageRequest,
)
from app.models import AuditLog

MAX_AI_SUBMISSIONS_PER_HOUR = 10
MAX_BODY_BYTES = 1_000_000
_PLACEHOLDER_RE = re.compile(r"(?i)\b(?:todo|tbd|todo\(|lorem ipsum|待补充|此处省略|placeholder)\b")
_DANGEROUS_HTML_RE = re.compile(r"(?i)<\s*(?:script|iframe|object|embed)\b|javascript\s*:|on\w+\s*=")


class ToolInputError(ValueError):
    """Bad arguments from the model; surfaced as a readable MCP error."""


@dataclass
class ToolContext:
    identity: TokenIdentity
    db: Any  # AsyncSession

    @property
    def user(self):
        return self.identity.user

    @property
    def token(self):
        return self.identity.token

    @property
    def tenant_id(self):
        return self.identity.user.tenant_id


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]
    scopes: tuple[str, ...]
    handler: Callable[[ToolContext, dict[str, Any]], Awaitable[Any]]


def _text(value: Any) -> str:
    return str(value or "").strip()


def _required_text(args: dict[str, Any], key: str, *, max_length: int = 100_000) -> str:
    value = _text(args.get(key))
    if not value:
        raise ToolInputError(f"{key} 不能为空")
    if len(value) > max_length:
        raise ToolInputError(f"{key} 超过 {max_length} 字符上限")
    return value


def _optional_text(args: dict[str, Any], key: str, *, max_length: int = 100_000) -> str | None:
    value = args.get(key)
    if value is None:
        return None
    value = _text(value)
    if len(value) > max_length:
        raise ToolInputError(f"{key} 超过 {max_length} 字符上限")
    return value or None


def _required_int(args: dict[str, Any], key: str, *, minimum: int | None = None) -> int:
    try:
        value = int(args[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise ToolInputError(f"{key} 必须是整数") from exc
    if minimum is not None and value < minimum:
        raise ToolInputError(f"{key} 必须 >= {minimum}")
    return value


def _optional_int(args: dict[str, Any], key: str, *, minimum: int | None = None) -> int | None:
    if key not in args or args.get(key) is None:
        return None
    return _required_int(args, key, minimum=minimum)


def _require_confirm(args: dict[str, Any], action: str) -> None:
    if args.get("confirm") is not True:
        raise ToolInputError(
            f"{action} 需要显式传 confirm=true；AI 必须确认这是用户授权的真实写操作，不能默认执行。"
        )


def _body_quality_errors(body_markdown: str, abstract: str, title: str) -> list[str]:
    errors: list[str] = []
    plain = re.sub(r"\s+", "", body_markdown)
    if len(body_markdown.encode("utf-8")) > MAX_BODY_BYTES:
        errors.append(f"正文超过 {MAX_BODY_BYTES} 字节上限")
    if len(plain) < 30:
        errors.append("正文有效内容不足 30 字；请提交完整文章，而不是占位稿")
    if len(abstract.strip()) < 20:
        errors.append("摘要少于 20 字；编辑器与读者需要可读的摘要")
    if len(title.strip()) < 2:
        errors.append("标题过短")
    if _DANGEROUS_HTML_RE.search(body_markdown):
        errors.append("正文包含脚本/危险 HTML，MCP 投稿不接受可执行页面代码")
    if _PLACEHOLDER_RE.search(body_markdown) or _PLACEHOLDER_RE.search(abstract):
        errors.append("正文或摘要仍含 TODO/待补充/placeholder 等占位内容")
    return errors


def _body_quality_warnings(body_markdown: str, abstract: str, title: str, keywords: list[str]) -> list[str]:
    warnings: list[str] = []
    if len(re.sub(r"\s+", "", body_markdown)) < 300:
        warnings.append("正文少于 300 字；请确认这是完整的短文而不是提纲")
    if len(abstract.strip()) < 100:
        warnings.append("摘要少于 100 字；建议补充问题、方法与结论")
    if len(keywords) < 3:
        warnings.append("关键词少于 3 个；检索与分派会缺少信号")
    if title.strip().startswith(("论", "浅析", "试论")):
        warnings.append("标题以“论/浅析/试论”开头，站内规范更偏好一句人话标题")
    return warnings


def _quality_payload(
    title: str, abstract: str, body: str | None, keywords: list[str]
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    if len(abstract.strip()) < 20:
        errors.append("摘要少于 20 字；编辑器与读者需要可读的摘要")
    if len(title.strip()) < 2:
        errors.append("标题过短")
    if body:
        body_errors = _body_quality_errors(body, abstract, title)
        # 摘要/标题错误已在上面收集，避免重复提示。
        errors.extend(item for item in body_errors if "摘要少于" not in item and "标题过短" not in item)
    warnings = _body_quality_warnings(body or "", abstract, title, keywords) if body else []
    if not body and len(abstract.strip()) < 100:
        warnings.append("摘要少于 100 字；建议补充问题、方法与结论")
    if len(keywords) < 3:
        warnings.append("关键词少于 3 个；检索与分派会缺少信号")
    return errors, warnings


async def _latest_version(ctx: ToolContext, submission: Submission) -> int:
    value = (
        await ctx.db.execute(
            select(func.max(SubmissionVersion.version)).where(
                SubmissionVersion.submission_id == submission.id,
                SubmissionVersion.tenant_id == submission.tenant_id,
            )
        )
    ).scalar()
    return int(value or 1)


async def _latest_versions(ctx: ToolContext, ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    rows = (
        await ctx.db.execute(
            select(SubmissionVersion.submission_id, func.max(SubmissionVersion.version)).where(
                SubmissionVersion.tenant_id == ctx.tenant_id,
                SubmissionVersion.submission_id.in_(ids),
            ).group_by(SubmissionVersion.submission_id)
        )
    ).all()
    return {int(sid): int(version) for sid, version in rows}


def _submission_summary(entry: Submission, latest_version: int, *, replayed: bool = False) -> dict[str, Any]:
    return {
        "id": entry.id,
        "title": entry.title,
        "status": entry.status,
        "type": entry.type,
        "latest_version": latest_version,
        "source": entry.source,
        "similarity_score": entry.similarity_score,
        "submitted_at": entry.submitted_at,
        "replayed": replayed,
    }


async def _context(ctx: ToolContext, args: dict[str, Any]) -> Any:
    from app.api.deps import effective_permission_role, user_role_names

    role = await effective_permission_role(ctx.db, ctx.user)
    return {
        "user": {
            "id": ctx.user.id,
            "username": ctx.user.username,
            "display_name": ctx.user.display_name,
            "is_admin": ctx.user.is_admin,
        },
        "permission_role": role,
        "roles": await user_role_names(ctx.db, ctx.user),
        "token": {
            "id": ctx.token.id,
            "name": ctx.token.name,
            "prefix": ctx.token.token_prefix,
            "scopes": ctx.identity.scopes,
        },
        "rules": {
            "current_version": CURRENT_RULES_VERSION,
            "acknowledged_version": ctx.user.rules_ack_version,
            "acknowledged": ctx.user.rules_ack_version == CURRENT_RULES_VERSION,
        },
    }


async def _rules(ctx: ToolContext, args: dict[str, Any]) -> Any:
    return {
        "version": CURRENT_RULES_VERSION,
        "acknowledged": ctx.user.rules_ack_version == CURRENT_RULES_VERSION,
        "ack_url": "/me?tab=settings&section=profile",
        "hard_rules": [
            "不编造数据、引用、图片出处；无法核查的材料要标为设定。",
            "虚构/讽刺写作必须在标题区或正文开头标出“虚构创作”。",
            "不点名真实个人、单位、病历、聊天记录；不碰隐私与名誉侵权。",
            "正文不含可执行脚本、iframe 或危险 HTML。",
            "MCP 投稿只进入编辑队列，不等于自动发表；发表仍由有终审权的人/Token 决定。",
        ],
        "tool_flow": [
            "先 get_context，确认身份、Token 作用域与规则确认状态。",
            "投稿前 preflight_submission，检查必填字段、敏感词、站内相似度与正文质量。",
            "投稿后 list_my_submissions 核对状态；修回用 update/save_body/resubmit。",
            "互评成员先 get_review_task 读匿名稿，submit_review_report 提交五维评分。",
            "编辑先 get_editor_workbench / list_triage_queue，decision 必带 expected_status 与 expected_latest_version。",
        ],
        "scopes": [{"scope": scope, "label": SCOPE_LABELS[scope]} for scope in SCOPE_LABELS],
    }


async def _ack_rules(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "确认发布规范")
    version = _required_text(args, "rules_version", max_length=20)
    if version != CURRENT_RULES_VERSION:
        raise ToolInputError(
            f"版本不匹配：当前规范是 {CURRENT_RULES_VERSION}，你传的是 {version}。请先 get_editorial_rules。"
        )
    ctx.user.rules_ack_version = CURRENT_RULES_VERSION
    ctx.user.rules_ack_at = utcnow()
    ctx.db.add(
        AuditLog(
            tenant_id=ctx.tenant_id,
            actor_user_id=ctx.user.id,
            action="ai.rules_ack",
            target_type="user",
            target_id=str(ctx.user.id),
            payload={"rules_version": CURRENT_RULES_VERSION, "via": "mcp"},
        )
    )
    await ctx.db.commit()
    return {"rules_version": CURRENT_RULES_VERSION, "acknowledged": True}


async def _preflight(ctx: ToolContext, args: dict[str, Any]) -> Any:
    body = _optional_text(args, "body_markdown", max_length=MAX_BODY_BYTES)
    data = {key: value for key, value in args.items() if key not in ("body_markdown", "confirm")}
    try:
        parsed = SubmissionCreate.model_validate(data)
    except ValidationError as exc:
        return {
            "ok": False,
            "errors": [f"{'.'.join(str(p) for p in item['loc'])}: {item['msg']}" for item in exc.errors()],
            "warnings": [],
            "similarity_score": None,
            "similarity_matches": [],
        }
    errors, warnings = _quality_payload(parsed.title, parsed.abstract, body, parsed.keywords or [])
    if not body and not (parsed.download_url or parsed.external_url):
        errors.append("必须提供 body_markdown，或 download_url/external_url 之一，不能只交题录")
    if errors:
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "similarity_score": None,
            "similarity_matches": [],
            "rules_acknowledged": ctx.user.rules_ack_version == CURRENT_RULES_VERSION,
        }
    blocked = rejection_detail(f"{parsed.title}\n{parsed.abstract}\n{body or ''}")
    if blocked is not None:
        return {
            "ok": False,
            "errors": [f"内容安全拦截：{blocked}"],
            "warnings": warnings,
            "similarity_score": None,
            "similarity_matches": [],
            "rules_acknowledged": ctx.user.rules_ack_version == CURRENT_RULES_VERSION,
        }
    score, matches = await check_against_site(
        ctx.db,
        ctx.tenant_id,
        title=parsed.title,
        abstract=parsed.abstract,
    )
    return {
        "ok": True,
        "errors": [],
        "warnings": warnings,
        "similarity_score": score,
        "similarity_matches": matches,
        "rules_acknowledged": ctx.user.rules_ack_version == CURRENT_RULES_VERSION,
        "next": "rules_ack_required" if ctx.user.rules_ack_version != CURRENT_RULES_VERSION else "submit_paper",
    }


async def _submit(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "投稿")
    key = _required_text(args, "idempotency_key", max_length=100)
    body = _optional_text(args, "body_markdown", max_length=MAX_BODY_BYTES)
    data = {key_: value for key_, value in args.items() if key_ not in ("body_markdown", "confirm", "idempotency_key")}
    try:
        parsed = SubmissionCreate.model_validate(data)
    except ValidationError as exc:
        raise ToolInputError(
            "投稿字段校验失败：" + "；".join(
                f"{'.'.join(str(p) for p in item['loc'])}: {item['msg']}" for item in exc.errors()
            )
        ) from exc

    if ctx.user.rules_ack_version != CURRENT_RULES_VERSION:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "rules_ack_required",
                "version": CURRENT_RULES_VERSION,
                "message": "请先调用 acknowledge_rules（确认当前规范）再投稿。",
                "ack_url": "/me?tab=settings&section=profile",
            },
        )

    existing = (
        await ctx.db.execute(
            select(Submission).where(
                Submission.tenant_id == ctx.tenant_id,
                Submission.submitted_by == ctx.user.id,
                Submission.client_ref == key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _submission_summary(existing, await _latest_version(ctx, existing), replayed=True)

    errors, warnings = _quality_payload(parsed.title, parsed.abstract, body, parsed.keywords or [])
    if not body and not (parsed.download_url or parsed.external_url):
        errors.append("必须提供 body_markdown，或 download_url/external_url 之一，不能只交题录")
    if errors:
        raise ToolInputError("；".join(errors))

    blocked = rejection_detail(f"{parsed.title}\n{parsed.abstract}\n{body or ''}")
    if blocked is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=blocked)

    now = utcnow()
    started = normalize_dt(ctx.token.window_started_at)
    if started is None or now - started >= timedelta(hours=1):
        ctx.token.window_started_at = now
        ctx.token.window_count = 0
    if (ctx.token.window_count or 0) >= MAX_AI_SUBMISSIONS_PER_HOUR:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"该 Token 每小时最多投稿 {MAX_AI_SUBMISSIONS_PER_HOUR} 篇，请稍后再试",
        )

    from app.interfaces.http.submission.routes import _create_submission_record

    submission = await _create_submission_record(ctx.db, ctx.user, parsed, body_markdown=body)
    submission.source = "ai"
    submission.client_ref = key
    ctx.token.window_count = (ctx.token.window_count or 0) + 1
    ctx.db.add(
        AuditLog(
            tenant_id=ctx.tenant_id,
            actor_user_id=ctx.user.id,
            action="ai.submission.create",
            target_type="submission",
            target_id=str(submission.id),
            payload={
                "token_id": ctx.token.id,
                "client_ref": key,
                "similarity_score": submission.similarity_score,
                "has_body": bool(body),
            },
        )
    )
    await ctx.db.commit()
    await ctx.db.refresh(submission)
    result = _submission_summary(submission, await _latest_version(ctx, submission))
    result["warnings"] = warnings
    result["quality"] = "passed"
    return result


async def _list_own(ctx: ToolContext, args: dict[str, Any]) -> Any:
    limit = min(_optional_int(args, "limit", minimum=1) or 20, 50)
    stmt = select(Submission).where(
        Submission.tenant_id == ctx.tenant_id,
        Submission.submitted_by == ctx.user.id,
    )
    status_filter = _optional_text(args, "status_filter", max_length=32)
    if status_filter:
        stmt = stmt.where(Submission.status == status_filter)
    rows = (await ctx.db.execute(stmt.order_by(Submission.id.desc()).limit(limit))).scalars().all()
    versions = await _latest_versions(ctx, [row.id for row in rows])
    return {
        "data": [_submission_summary(row, versions.get(row.id, 1)) for row in rows],
        "count": len(rows),
    }


async def _get_own(ctx: ToolContext, args: dict[str, Any]) -> Any:
    submission_id = _required_int(args, "submission_id", minimum=1)
    entry = (
        await ctx.db.execute(
            select(Submission).where(
                Submission.id == submission_id,
                Submission.tenant_id == ctx.tenant_id,
                Submission.submitted_by == ctx.user.id,
            )
        )
    ).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="不是你的作品，或作品不存在")
    latest = await _latest_version(ctx, entry)
    payload = _to_response(entry, {"latest_version": latest}).model_dump(mode="json")
    if args.get("include_body") is True and entry.markdown_path:
        from app.core.storage import get_storage

        try:
            raw = await get_storage().load(entry.markdown_path)
            payload["body_markdown"] = raw.decode("utf-8", errors="replace")
        except FileNotFoundError:
            payload["body_markdown"] = ""
    return payload


async def _update_own(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "修改作品")
    submission_id = _required_int(args, "submission_id", minimum=1)
    patch = args.get("patch")
    if not isinstance(patch, dict) or not patch:
        raise ToolInputError("patch 必须是非空对象")
    try:
        body = SubmissionUpdate.model_validate(patch)
    except ValidationError as exc:
        raise ToolInputError(f"patch 字段校验失败：{exc.errors()}") from exc
    expected = _optional_int(args, "expected_latest_version", minimum=1)
    if expected is not None:
        entry = await _get_or_404(ctx.db, submission_id)
        if await _latest_version(ctx, entry) != expected:
            raise HTTPException(status_code=409, detail="作品版本已变化，请重新 get_my_submission 后再修改")
    from app.interfaces.http.submission.routes import update_submission

    result = await update_submission(submission_id, body, ctx.user, ctx.db)
    return result.model_dump(mode="json")


async def _save_body(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "保存正文")
    submission_id = _required_int(args, "submission_id", minimum=1)
    content = _required_text(args, "content", max_length=MAX_BODY_BYTES)
    # 单独保存正文时没有题录，只做危险 HTML/占位检查；长度下限仍生效。
    if len(re.sub(r"\s+", "", content)) < 30:
        raise ToolInputError("正文有效内容不足 30 字")
    if _DANGEROUS_HTML_RE.search(content):
        raise ToolInputError("正文包含脚本/危险 HTML")
    if _PLACEHOLDER_RE.search(content):
        raise ToolInputError("正文仍含 TODO/待补充/placeholder 等占位内容")
    expected = _optional_int(args, "expected_latest_version", minimum=1)
    entry = await _get_or_404(ctx.db, submission_id)
    if entry.submitted_by != ctx.user.id:
        raise HTTPException(status_code=403, detail="只能保存自己的作品正文")
    if expected is not None and await _latest_version(ctx, entry) != expected:
        raise HTTPException(status_code=409, detail="作品版本已变化，请重新读取后再保存")
    from app.interfaces.http.submission.routes import OnlineMarkdownBody, save_submission_markdown

    result = await save_submission_markdown(submission_id, OnlineMarkdownBody(content=content), ctx.user, ctx.db)
    return _submission_summary(result, await _latest_version(ctx, result))


async def _resubmit(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "重新提交")
    submission_id = _required_int(args, "submission_id", minimum=1)
    expected = _optional_int(args, "expected_latest_version", minimum=1)
    entry = await _get_or_404(ctx.db, submission_id)
    if entry.submitted_by != ctx.user.id:
        raise HTTPException(status_code=403, detail="只能重新提交自己的作品")
    if expected is not None and await _latest_version(ctx, entry) != expected:
        raise HTTPException(status_code=409, detail="作品版本已变化，请重新读取后再重投")
    from app.interfaces.http.submission.routes import ResubmitRequest, author_resubmit

    result = await author_resubmit(submission_id, ResubmitRequest(note=_optional_text(args, "note", max_length=5000)), ctx.user, ctx.db)
    return _submission_summary(result, await _latest_version(ctx, result))


async def _respond(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "回复互评意见")
    submission_id = _required_int(args, "submission_id", minimum=1)
    response = _required_text(args, "response", max_length=20_000)
    from app.interfaces.http.submission.routes import AuthorResponseUpdate, author_response

    result = await author_response(submission_id, AuthorResponseUpdate(response=response), ctx.user, ctx.db)
    return _submission_summary(result, await _latest_version(ctx, result))


async def _withdraw(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "撤稿")
    submission_id = _required_int(args, "submission_id", minimum=1)
    reason = _required_text(args, "reason", max_length=2000)
    from app.interfaces.http.submission.routes import WithdrawRequest, author_withdraw

    result = await author_withdraw(submission_id, WithdrawRequest(reason=reason), ctx.user, ctx.db)
    return _submission_summary(result, await _latest_version(ctx, result))


async def _list_assignments(ctx: ToolContext, args: dict[str, Any]) -> Any:
    status_filter = _optional_text(args, "status_filter", max_length=32)
    stmt = select(ReviewAssignment).where(
        ReviewAssignment.tenant_id == ctx.tenant_id,
        ReviewAssignment.reviewer_id == ctx.user.id,
    )
    if status_filter:
        stmt = stmt.where(ReviewAssignment.status == status_filter)
    rows = (await ctx.db.execute(stmt.order_by(ReviewAssignment.invited_at.desc()).limit(50))).scalars().all()
    return {
        "data": [
            {
                "assignment_id": row.id,
                "submission_id": row.submission_id,
                "status": row.status,
                "round": row.round,
                "slot": row.slot,
                "due_date": row.due_date,
                "completed_at": row.completed_at,
                "reminder_count": row.reminder_count,
            }
            for row in rows
        ],
        "count": len(rows),
    }


async def _review_task(ctx: ToolContext, args: dict[str, Any]) -> Any:
    assignment_id = _required_int(args, "assignment_id", minimum=1)
    from app.interfaces.http.review.routes import get_assignment_submission, get_my_assignment

    assignment = await get_my_assignment(assignment_id, ctx.user, ctx.db)
    submission = await get_assignment_submission(assignment_id, ctx.user, ctx.db)
    payload = submission.model_dump(mode="json")
    return {"assignment": assignment.model_dump(mode="json"), "submission": payload}


async def _accept_review(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "接受互评邀请")
    assignment_id = _required_int(args, "assignment_id", minimum=1)
    from app.interfaces.http.review.routes import accept_assignment

    result = await accept_assignment(assignment_id, ctx.user, ctx.db)
    return result.model_dump(mode="json")


async def _decline_review(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "拒绝互评邀请")
    assignment_id = _required_int(args, "assignment_id", minimum=1)
    from app.interfaces.http.review.routes import decline_assignment

    result = await decline_assignment(assignment_id, ctx.user, ctx.db)
    return result.model_dump(mode="json")


async def _submit_review(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "提交互评报告")
    assignment_id = _required_int(args, "assignment_id", minimum=1)
    recommendation = _required_text(args, "recommendation", max_length=32)
    scores = args.get("scores")
    if not isinstance(scores, dict):
        raise ToolInputError("scores 必须是对象，含 dimensions 五维评分")
    comments_to_author = _required_text(args, "comments_to_author", max_length=20_000)
    if len(comments_to_author) < 30:
        raise ToolInputError("comments_to_author 少于 30 字；请给作者可执行的修改说明")
    try:
        body = ReviewSubmit.model_validate(
            {
                "recommendation": recommendation,
                "scores": scores,
                "comments_to_editor": _optional_text(args, "comments_to_editor", max_length=20_000),
                "comments_to_author": comments_to_author,
                "is_anonymous": args.get("is_anonymous", True) is not False,
            }
        )
    except ValidationError as exc:
        raise ToolInputError(f"互评字段校验失败：{exc.errors()}") from exc
    from app.interfaces.http.review.routes import _normalize_review_scores, submit_review_report

    normalized = _normalize_review_scores(body.scores)
    for key, dimension in normalized["dimensions"].items():
        if len(str(dimension.get("reason") or "").strip()) < 10:
            raise ToolInputError(f"{key}: 必须写至少 10 字评分理由")
        if len(str(dimension.get("evidence") or "").strip()) < 10:
            raise ToolInputError(f"{key}: 必须写至少 10 字正文证据")
    result = await submit_review_report(assignment_id, body, ctx.user, ctx.db)
    return result.model_dump(mode="json")


async def _my_timeline(ctx: ToolContext, args: dict[str, Any]) -> Any:
    submission_id = _required_int(args, "submission_id", minimum=1)
    entry = await _get_or_404(ctx.db, submission_id)
    if entry.submitted_by != ctx.user.id:
        raise HTTPException(status_code=403, detail="只能查看自己作品的时间线")
    from app.interfaces.http.submission.routes_editor import submission_timeline

    return await submission_timeline(submission_id, ctx.user, ctx.db)


async def _my_reports(ctx: ToolContext, args: dict[str, Any]) -> Any:
    submission_id = _required_int(args, "submission_id", minimum=1)
    entry = await _get_or_404(ctx.db, submission_id)
    if entry.submitted_by != ctx.user.id:
        raise HTTPException(status_code=403, detail="只能查看自己作品的互评意见")
    from app.interfaces.http.submission.routes_editor import list_review_reports

    rows = await list_review_reports(submission_id, ctx.user, ctx.db)
    return [item.model_dump(mode="json") for item in rows]


async def _editor_submission(ctx: ToolContext, args: dict[str, Any]) -> Any:
    submission_id = _required_int(args, "submission_id", minimum=1)
    entry = await _get_or_404(ctx.db, submission_id)
    latest = await _latest_version(ctx, entry)
    payload = _to_response(entry, {"latest_version": latest}).model_dump(mode="json")
    if args.get("include_body") is True and entry.markdown_path:
        from app.core.storage import get_storage

        try:
            raw = await get_storage().load(entry.markdown_path)
            payload["body_markdown"] = raw.decode("utf-8", errors="replace")
        except FileNotFoundError:
            payload["body_markdown"] = ""
    return payload


async def _workbench(ctx: ToolContext, args: dict[str, Any]) -> Any:
    from app.interfaces.http.review.workbench import editor_workbench

    return await editor_workbench(current_user=ctx.user, db=ctx.db)


async def _triage_queue(ctx: ToolContext, args: dict[str, Any]) -> Any:
    from app.interfaces.http.submission.routes_editor import list_triage_queue

    page = _optional_int(args, "page", minimum=1) or 1
    page_size = min(_optional_int(args, "page_size", minimum=1) or 20, 100)
    result = await list_triage_queue(page=page, page_size=page_size, _=ctx.user, db=ctx.db)
    return result.model_dump(mode="json")


async def _reviewers(ctx: ToolContext, args: dict[str, Any]) -> Any:
    from app.interfaces.http.submission.routes_editor import list_reviewer_candidates

    result = await list_reviewer_candidates(
        limit=min(_optional_int(args, "limit", minimum=1) or 200, 200),
        submission_id=_optional_int(args, "submission_id", minimum=1),
        _=ctx.user,
        db=ctx.db,
    )
    return result.model_dump(mode="json")


async def _triage(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "基础检查")
    submission_id = _required_int(args, "submission_id", minimum=1)
    expected_status = _required_text(args, "expected_status", max_length=32)
    expected_latest = _required_int(args, "expected_latest_version", minimum=1)
    entry = await _get_or_404(ctx.db, submission_id)
    latest = await _latest_version(ctx, entry)
    if entry.status != expected_status or latest != expected_latest:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "stale_triage",
                "message": "作品状态或版本已变化，请重新读取后再做基础检查",
                "actual_status": entry.status,
                "actual_latest_version": latest,
            },
        )
    decision = _required_text(args, "decision", max_length=32)
    note = _optional_text(args, "note", max_length=2000) or ""
    from app.interfaces.http.submission.routes_editor import triage_submission

    result = await triage_submission(submission_id, TriageRequest(decision=decision, note=note), ctx.user, ctx.db)
    return result.model_dump(mode="json")


async def _assign(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "指派互评成员")
    submission_id = _required_int(args, "submission_id", minimum=1)
    expected_status = _required_text(args, "expected_status", max_length=32)
    expected_latest = _required_int(args, "expected_latest_version", minimum=1)
    entry = await _get_or_404(ctx.db, submission_id)
    latest = await _latest_version(ctx, entry)
    if entry.status != expected_status or latest != expected_latest:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "stale_assignment",
                "message": "作品状态或版本已变化，请重新读取后再分派",
                "actual_status": entry.status,
                "actual_latest_version": latest,
            },
        )
    reviewer_id = _required_int(args, "reviewer_id", minimum=1)
    due_date = args.get("due_date")
    if isinstance(due_date, str) and due_date:
        try:
            due_date = datetime.fromisoformat(due_date.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ToolInputError("due_date 必须是 ISO 8601 时间") from exc
    from app.interfaces.http.submission.routes_editor import assign_reviewer

    result = await assign_reviewer(
        submission_id,
        AssignmentCreate(reviewer_id=reviewer_id, due_date=due_date),
        ctx.user,
        ctx.db,
    )
    return result.model_dump(mode="json")


async def _decide(ctx: ToolContext, args: dict[str, Any]) -> Any:
    _require_confirm(args, "终审决定")
    submission_id = _required_int(args, "submission_id", minimum=1)
    decision = _required_text(args, "decision", max_length=32)
    expected_status = _required_text(args, "expected_status", max_length=32)
    expected_latest = _required_int(args, "expected_latest_version", minimum=1)
    entry = await _get_or_404(ctx.db, submission_id)
    latest = await _latest_version(ctx, entry)
    if entry.status != expected_status or latest != expected_latest:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "stale_decision",
                "message": "作品状态或版本已变化，请重新读取后再决定",
                "actual_status": entry.status,
                "actual_latest_version": latest,
            },
        )
    note = _optional_text(args, "editor_note", max_length=5000)
    if decision in ("minor_revision", "major_revision", "reject") and (not note or len(note) < 10):
        raise ToolInputError("退回修改或不通过必须写至少 10 字 editor_note")
    if decision == "accept" and args.get("publication_status") not in ("published", "draft"):
        raise ToolInputError("通过必须显式指定 publication_status=published 或 draft")
    body = SubmissionDecision(
        decision=decision,
        editor_note=note,
        resource_id=_optional_int(args, "resource_id", minimum=1),
        publication_status=args.get("publication_status", "published"),
        force_accept_d_grade=args.get("force_accept_d_grade", False) is True,
        arbitration_note=_optional_text(args, "arbitration_note", max_length=5000),
        accept_after_revision=args.get("accept_after_revision", False) is True,
    )
    from app.interfaces.http.submission.routes_editor import editor_decision

    result = await editor_decision(submission_id, body, ctx.user, ctx.db)
    return _submission_summary(result, await _latest_version(ctx, result))


async def _timeline(ctx: ToolContext, args: dict[str, Any]) -> Any:
    submission_id = _required_int(args, "submission_id", minimum=1)
    from app.interfaces.http.submission.routes_editor import submission_timeline

    return await submission_timeline(submission_id, ctx.user, ctx.db)


async def _reports(ctx: ToolContext, args: dict[str, Any]) -> Any:
    submission_id = _required_int(args, "submission_id", minimum=1)
    from app.interfaces.http.submission.routes_editor import list_review_reports

    result = await list_review_reports(submission_id, ctx.user, ctx.db)
    return [item.model_dump(mode="json") for item in result]


def _submission_schema(*, include_body: bool, include_idempotency: bool = False) -> dict[str, Any]:
    props: dict[str, Any] = {
        "title": {"type": "string", "maxLength": 1000},
        "type": {"type": "string", "enum": ["paper", "book", "dataset", "tutorial"], "default": "paper"},
        "authors": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "author_affiliations": {"type": "array", "items": {"type": "string"}},
        "year": {"type": "integer"},
        "discipline": {"type": "string"},
        "subdiscipline": {"type": "string"},
        "article_section": {"type": "string"},
        "issue_part": {"type": "string"},
        "keywords": {"type": "array", "items": {"type": "string"}},
        "jel_codes": {"type": "array", "items": {"type": "string"}},
        "tags": {"type": "array", "items": {"type": "string"}},
        "abstract": {"type": "string", "maxLength": 20000},
        "preview": {"type": "string", "maxLength": 5000},
        "download_url": {"type": "string"},
        "external_url": {"type": "string"},
        "doi": {"type": "string"},
        "corresponding_author_email": {"type": "string"},
        "license": {"type": "string"},
        "author_contributions": {"type": "string"},
        "funding": {"type": "string"},
        "coi_statement": {"type": "string"},
        "data_availability": {"type": "string"},
        "confirm": {"type": "boolean"},
    }
    if include_body:
        props["body_markdown"] = {"type": "string", "maxLength": MAX_BODY_BYTES}
    if include_idempotency:
        props["idempotency_key"] = {"type": "string", "minLength": 8, "maxLength": 100}
    required = ["title", "authors", "year", "discipline", "abstract", "confirm"]
    if include_idempotency:
        required.append("idempotency_key")
    return {"type": "object", "properties": props, "required": required}


TOOL_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        "get_context",
        "读取当前 Token 的身份、角色、作用域、规则确认状态。任何工作流开始前先调用。",
        {"type": "object", "properties": {}},
        (SCOPE_PROFILE_READ,),
        _context,
    ),
    ToolSpec(
        "get_editorial_rules",
        "读取当前《写作与发布规范》版本、硬规则和推荐工具顺序。",
        {"type": "object", "properties": {}},
        (SCOPE_PROFILE_READ,),
        _rules,
    ),
    ToolSpec(
        "acknowledge_rules",
        "确认当前发布规范（写账号规则确认 + 审计）。只有用户明确要求代确认时才能调用。",
        {
            "type": "object",
            "properties": {
                "rules_version": {"type": "string", "description": "必须等于当前版本，先读 get_editorial_rules"},
                "confirm": {"type": "boolean", "description": "必须显式 true"},
            },
            "required": ["rules_version", "confirm"],
        },
        (SCOPE_SUBMISSION_WRITE,),
        _ack_rules,
    ),
    ToolSpec(
        "preflight_submission",
        "投稿前干跑：字段校验、敏感词、站内相似度、正文质量与占位内容检查。不写库。",
        _submission_schema(include_body=True),
        (SCOPE_SUBMISSION_WRITE,),
        _preflight,
    ),
    ToolSpec(
        "submit_paper",
        "以当前账号投稿。正文写入 v1 版本快照；进入编辑队列，不会自动发表。",
        _submission_schema(include_body=True, include_idempotency=True),
        (SCOPE_SUBMISSION_WRITE,),
        _submit,
    ),
    ToolSpec(
        "list_my_submissions",
        "查看自己的投稿列表、状态、站内相似度与最新版本。",
        {
            "type": "object",
            "properties": {
                "status_filter": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
            },
        },
        (SCOPE_SUBMISSION_READ,),
        _list_own,
    ),
    ToolSpec(
        "get_my_submission",
        "读取自己的单篇作品；可要求返回 Markdown 正文。",
        {
            "type": "object",
            "properties": {
                "submission_id": {"type": "integer", "minimum": 1},
                "include_body": {"type": "boolean", "default": False},
            },
            "required": ["submission_id"],
        },
        (SCOPE_SUBMISSION_READ,),
        _get_own,
    ),
    ToolSpec(
        "get_my_submission_timeline",
        "作者查看自己作品的全流程时间线（匿名化互评成员）。",
        {
            "type": "object",
            "properties": {"submission_id": {"type": "integer", "minimum": 1}},
            "required": ["submission_id"],
        },
        (SCOPE_SUBMISSION_READ,),
        _my_timeline,
    ),
    ToolSpec(
        "get_my_submission_reports",
        "作者查看自己作品的互评意见（只给作者评论，不含审稿人身份）。",
        {
            "type": "object",
            "properties": {"submission_id": {"type": "integer", "minimum": 1}},
            "required": ["submission_id"],
        },
        (SCOPE_SUBMISSION_READ,),
        _my_reports,
    ),
    ToolSpec(
        "update_my_submission",
        "修改自己处于可编辑状态的作品题录。",
        {
            "type": "object",
            "properties": {
                "submission_id": {"type": "integer", "minimum": 1},
                "patch": {"type": "object", "description": "SubmissionUpdate 字段对象"},
                "expected_latest_version": {"type": "integer", "minimum": 1},
                "confirm": {"type": "boolean"},
            },
            "required": ["submission_id", "patch", "confirm"],
        },
        (SCOPE_SUBMISSION_WRITE,),
        _update_own,
    ),
    ToolSpec(
        "save_my_submission_body",
        "保存自己的 Markdown 正文（可编辑状态）。",
        {
            "type": "object",
            "properties": {
                "submission_id": {"type": "integer", "minimum": 1},
                "content": {"type": "string", "maxLength": MAX_BODY_BYTES},
                "expected_latest_version": {"type": "integer", "minimum": 1},
                "confirm": {"type": "boolean"},
            },
            "required": ["submission_id", "content", "confirm"],
        },
        (SCOPE_SUBMISSION_WRITE,),
        _save_body,
    ),
    ToolSpec(
        "resubmit_my_submission",
        "作者修回后重新提交，生成新版本并回到编辑队列。",
        {
            "type": "object",
            "properties": {
                "submission_id": {"type": "integer", "minimum": 1},
                "note": {"type": "string", "maxLength": 5000},
                "expected_latest_version": {"type": "integer", "minimum": 1},
                "confirm": {"type": "boolean"},
            },
            "required": ["submission_id", "confirm"],
        },
        (SCOPE_SUBMISSION_WRITE,),
        _resubmit,
    ),
    ToolSpec(
        "respond_to_reviewers",
        "作者逐条回复互评意见（Response to Reviewers）。",
        {
            "type": "object",
            "properties": {
                "submission_id": {"type": "integer", "minimum": 1},
                "response": {"type": "string", "maxLength": 20000},
                "confirm": {"type": "boolean"},
            },
            "required": ["submission_id", "response", "confirm"],
        },
        (SCOPE_SUBMISSION_WRITE,),
        _respond,
    ),
    ToolSpec(
        "withdraw_my_submission",
        "作者撤稿；保留版本、互评与审计。",
        {
            "type": "object",
            "properties": {
                "submission_id": {"type": "integer", "minimum": 1},
                "reason": {"type": "string", "minLength": 4, "maxLength": 2000},
                "confirm": {"type": "boolean"},
            },
            "required": ["submission_id", "reason", "confirm"],
        },
        (SCOPE_SUBMISSION_WRITE,),
        _withdraw,
    ),
    ToolSpec(
        "list_my_review_assignments",
        "互评成员查看自己的邀请、截止时间和状态。",
        {
            "type": "object",
            "properties": {"status_filter": {"type": "string"}},
        },
        (SCOPE_REVIEW_READ,),
        _list_assignments,
    ),
    ToolSpec(
        "get_review_task",
        "互评成员读取一条分配任务和匿名稿正文。",
        {
            "type": "object",
            "properties": {"assignment_id": {"type": "integer", "minimum": 1}},
            "required": ["assignment_id"],
        },
        (SCOPE_REVIEW_READ,),
        _review_task,
    ),
    ToolSpec(
        "accept_review_assignment",
        "接受互评邀请（自动做作者同名/利益冲突检查）。",
        {
            "type": "object",
            "properties": {
                "assignment_id": {"type": "integer", "minimum": 1},
                "confirm": {"type": "boolean"},
            },
            "required": ["assignment_id", "confirm"],
        },
        (SCOPE_REVIEW_WRITE,),
        _accept_review,
    ),
    ToolSpec(
        "decline_review_assignment",
        "拒绝互评邀请并通知指派编辑。",
        {
            "type": "object",
            "properties": {
                "assignment_id": {"type": "integer", "minimum": 1},
                "confirm": {"type": "boolean"},
            },
            "required": ["assignment_id", "confirm"],
        },
        (SCOPE_REVIEW_WRITE,),
        _decline_review,
    ),
    ToolSpec(
        "submit_review_report",
        "提交五维/荒诞六维互评报告；AI 额外强制每维理由与正文证据各至少 10 字。",
        {
            "type": "object",
            "properties": {
                "assignment_id": {"type": "integer", "minimum": 1},
                "recommendation": {
                    "type": "string",
                    "enum": ["accept", "minor_revision", "major_revision", "reject"],
                },
                "scores": {"type": "object", "description": "含 rubric_version/track/dimensions"},
                "comments_to_editor": {"type": "string", "maxLength": 20000},
                "comments_to_author": {"type": "string", "minLength": 30, "maxLength": 20000},
                "is_anonymous": {"type": "boolean", "default": True},
                "confirm": {"type": "boolean"},
            },
            "required": ["assignment_id", "recommendation", "scores", "comments_to_author", "confirm"],
        },
        (SCOPE_REVIEW_WRITE,),
        _submit_review,
    ),
    ToolSpec(
        "get_editor_workbench",
        "内容台四栏（待指派/互评中/修改中/待复核）及每篇状态。",
        {"type": "object", "properties": {}},
        (SCOPE_EDITORIAL_READ,),
        _workbench,
    ),
    ToolSpec(
        "list_triage_queue",
        "基础检查队列（最早提交优先）。",
        {
            "type": "object",
            "properties": {
                "page": {"type": "integer", "minimum": 1, "default": 1},
                "page_size": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
            },
        },
        (SCOPE_EDITORIAL_READ,),
        _triage_queue,
    ),
    ToolSpec(
        "list_reviewer_candidates",
        "可指派的互评成员与可解释匹配分。",
        {
            "type": "object",
            "properties": {
                "submission_id": {"type": "integer", "minimum": 1},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 100},
            },
        },
        (SCOPE_EDITORIAL_READ,),
        _reviewers,
    ),
    ToolSpec(
        "triage_submission",
        "基础检查：送互评 / 退回修改 / 补材料 / 直接不通过。",
        {
            "type": "object",
            "properties": {
                "submission_id": {"type": "integer", "minimum": 1},
                "decision": {
                    "type": "string",
                    "enum": ["send_to_review", "return_for_revision", "request_materials", "desk_reject"],
                },
                "note": {"type": "string", "maxLength": 2000},
                "expected_status": {"type": "string"},
                "expected_latest_version": {"type": "integer", "minimum": 1},
                "confirm": {"type": "boolean"},
            },
            "required": ["submission_id", "decision", "expected_status", "expected_latest_version", "confirm"],
        },
        (SCOPE_EDITORIAL_TRIAGE,),
        _triage,
    ),
    ToolSpec(
        "assign_reviewer",
        "给作品指派一位互评成员；作者、同名、利益冲突由服务端硬拦截。",
        {
            "type": "object",
            "properties": {
                "submission_id": {"type": "integer", "minimum": 1},
                "reviewer_id": {"type": "integer", "minimum": 1},
                "due_date": {"type": "string", "description": "ISO 8601，可选"},
                "expected_status": {"type": "string"},
                "expected_latest_version": {"type": "integer", "minimum": 1},
                "confirm": {"type": "boolean"},
            },
            "required": [
                "submission_id",
                "reviewer_id",
                "expected_status",
                "expected_latest_version",
                "confirm",
            ],
        },
        (SCOPE_EDITORIAL_TRIAGE,),
        _assign,
    ),
    ToolSpec(
        "get_editor_submission",
        "编辑读取任意作品的完整题录与状态；可附带 Markdown 正文。",
        {
            "type": "object",
            "properties": {
                "submission_id": {"type": "integer", "minimum": 1},
                "include_body": {"type": "boolean", "default": False},
            },
            "required": ["submission_id"],
        },
        (SCOPE_EDITORIAL_READ,),
        _editor_submission,
    ),
    ToolSpec(
        "get_submission_timeline",
        "作品全流程时间线（发布、版本、邀请、报告、作者回复、裁决）。",
        {
            "type": "object",
            "properties": {"submission_id": {"type": "integer", "minimum": 1}},
            "required": ["submission_id"],
        },
        (SCOPE_EDITORIAL_READ,),
        _timeline,
    ),
    ToolSpec(
        "get_submission_reports",
        "读取一篇作品的全部互评报告（编辑视角）。",
        {
            "type": "object",
            "properties": {"submission_id": {"type": "integer", "minimum": 1}},
            "required": ["submission_id"],
        },
        (SCOPE_EDITORIAL_READ,),
        _reports,
    ),
    ToolSpec(
        "decide_submission",
        "终审决定：通过/小改/大改/不通过。必须带 expected_status 与 expected_latest_version 防陈旧决策。",
        {
            "type": "object",
            "properties": {
                "submission_id": {"type": "integer", "minimum": 1},
                "decision": {"type": "string", "enum": ["accept", "minor_revision", "major_revision", "reject"]},
                "expected_status": {"type": "string"},
                "expected_latest_version": {"type": "integer", "minimum": 1},
                "editor_note": {"type": "string", "maxLength": 5000},
                "publication_status": {"type": "string", "enum": ["published", "draft"], "default": "published"},
                "force_accept_d_grade": {"type": "boolean", "default": False},
                "accept_after_revision": {"type": "boolean", "default": False},
                "arbitration_note": {"type": "string", "maxLength": 5000},
                "confirm": {"type": "boolean"},
            },
            "required": ["submission_id", "decision", "expected_status", "expected_latest_version", "confirm"],
        },
        (SCOPE_EDITORIAL_DECIDE,),
        _decide,
    ),
)

_TOOL_BY_NAME = {tool.name: tool for tool in TOOL_SPECS}




def _required_role(tool: ToolSpec) -> str:
    """工具所需的最低真实角色。

    直接调用路由函数会绕过 FastAPI 的 Depends；角色门禁必须在调度器
    再执行一次，否则“建 Token 时是编辑、后来被降级”的账号仍能继续裁决。
    """
    if SCOPE_EDITORIAL_DECIDE in tool.scopes:
        return "editor_in_chief"
    if SCOPE_EDITORIAL_READ in tool.scopes or SCOPE_EDITORIAL_TRIAGE in tool.scopes:
        return "editor"
    if SCOPE_REVIEW_READ in tool.scopes or SCOPE_REVIEW_WRITE in tool.scopes:
        return "reviewer"
    return "user"


def tools_for_scopes(scopes: list[str], role: str | None = None) -> list[dict[str, Any]]:
    from app.api.deps import PERMISSION_RANK

    items: list[dict[str, Any]] = []
    for tool in TOOL_SPECS:
        if not all(scope in scopes for scope in tool.scopes):
            continue
        if role is not None and PERMISSION_RANK.get(role, 0) < PERMISSION_RANK[_required_role(tool)]:
            continue
        items.append(
            {
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.input_schema,
            }
        )
    return items


def _mcp_result(value: Any, *, is_error: bool = False) -> dict[str, Any]:
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(jsonable_encoder(value), ensure_ascii=False, separators=(",", ":")),
            }
        ],
        "isError": is_error,
    }


async def execute_tool(
    ctx: ToolContext, name: str, arguments: dict[str, Any] | None
) -> dict[str, Any]:
    tool = _TOOL_BY_NAME.get(name)
    if tool is None:
        return _mcp_result({"error": f"未知工具：{name}"}, is_error=True)
    missing = [scope for scope in tool.scopes if scope not in ctx.identity.scopes]
    if missing:
        return _mcp_result(
            {
                "error": "missing_scope",
                "required": list(tool.scopes),
                "missing": missing,
                "message": "Token 权限不足，请到设置 → AI 接入重新授权。",
            },
            is_error=True,
        )
    # 直接调路由函数不会触发 Depends；真实角色必须在这里再验一次。
    from app.api.deps import PERMISSION_RANK, effective_permission_role

    actual_role = await effective_permission_role(ctx.db, ctx.user)
    required_role = _required_role(tool)
    if PERMISSION_RANK[actual_role] < PERMISSION_RANK[required_role]:
        return _mcp_result(
            {
                "error": "role_required",
                "required_role": required_role,
                "actual_role": actual_role,
                "message": "账号当前角色低于该工具要求；Token 作用域不能替代真实角色。",
            },
            is_error=True,
        )
    try:
        result = await tool.handler(ctx, dict(arguments or {}))
    except HTTPException as exc:
        detail = exc.detail
        return _mcp_result(
            {"error": detail if isinstance(detail, dict) else str(detail), "status": exc.status_code},
            is_error=True,
        )
    except ToolInputError as exc:
        return _mcp_result({"error": str(exc), "status": 400}, is_error=True)
    except ValidationError as exc:
        return _mcp_result({"error": "参数校验失败", "details": exc.errors()}, is_error=True)
    except Exception as exc:  # keep the MCP process alive; log through caller
        return _mcp_result({"error": f"{type(exc).__name__}: {exc}", "status": 500}, is_error=True)
    return _mcp_result(result, is_error=False)


__all__ = [
    "TOOL_SPECS",
    "ToolContext",
    "ToolSpec",
    "execute_tool",
    "tools_for_scopes",
]
