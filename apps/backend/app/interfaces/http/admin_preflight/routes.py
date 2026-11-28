"""Read-only preflight for admin actions.

One endpoint covers every admin form that writes a business object. Each
``kind`` receives the draft payload *before* it is sent to the real endpoint;
invalid drafts are reported as ``fail`` items instead of producing a 422 that
the UI cannot explain. The endpoint never writes, audits, or mutates.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_chief_editor, require_tenant_id
from app.core.db import get_db
from app.models import ContentReport, User, UserRole
from app.schemas import AdminPreflightItem, AdminPreflightResponse

router = APIRouter(prefix="/admin/actions", tags=["admin-preflight"])

ASSIGNABLE_ROLES = {
    "reviewer",
    "senior_reviewer",
    "editor",
    "section_editor",
    "board_editor",
    "deputy_editor",
    "chief_editor",
    "shop_manager",
}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
APPLICATION_ROLES = {"reviewer", "senior_reviewer"}


class AdminActionPreflightIn(BaseModel):
    """Permissive envelope: every field stays inside ``payload`` so a bad
    draft never gets rejected by this endpoint before it can be explained."""

    kind: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)


def _item(
    key: str, label: str, status: Literal["ok", "warn", "fail"], detail: str
) -> AdminPreflightItem:
    return AdminPreflightItem(key=key, label=label, status=status, detail=detail)


def _finish(items: list[AdminPreflightItem]) -> AdminPreflightResponse:
    if any(i.status == "fail" for i in items):
        return AdminPreflightResponse(
            status="fail", summary="有硬冲突，先修正再保存。", items=items
        )
    if any(i.status == "warn" for i in items):
        return AdminPreflightResponse(
            status="warn", summary="可以保存，但有几处要留意。", items=items
        )
    return AdminPreflightResponse(status="ok", summary="检查通过，可以保存。", items=items)


def _s(payload: dict[str, Any], key: str, default: str = "") -> str:
    value = payload.get(key)
    return str(value).strip() if value is not None else default


def _i(payload: dict[str, Any], key: str, default: int | None = None) -> int | None:
    value = payload.get(key, default)
    if value is None or isinstance(value, bool):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _b(payload: dict[str, Any], key: str, default: bool | None = None) -> bool | None:
    value = payload.get(key)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _require(value: Any, label: str) -> AdminPreflightItem:
    if value is None or value == "":
        return _item("required", label, "fail", f"{label}没有填写。")
    return _item("required", label, "ok", f"{label}已填写。")


async def _user(db: AsyncSession, tenant_id: Any, user_id: int | None) -> User | None:
    if not user_id or user_id < 1:
        return None
    return (
        await db.execute(select(User).where(User.id == user_id, User.tenant_id == tenant_id))
    ).scalar_one_or_none()


async def _roles(role_holder: User, db: AsyncSession, tenant_id: Any) -> set[str]:
    from app.models import Role

    rows = (
        await db.execute(
            select(Role.name)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(
                UserRole.user_id == role_holder.id,
                UserRole.tenant_id == tenant_id,
                Role.tenant_id == tenant_id,
            )
        )
    ).scalars()
    return set(rows.all())


async def _member_create(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    email = _s(p, "email").lower()
    username = _s(p, "username")
    role = _s(p, "role") or None
    note = _s(p, "note")
    items: list[AdminPreflightItem] = []
    items.append(
        _item(
            "email",
            "邮箱",
            "ok" if email and EMAIL_RE.match(email) else "fail",
            "邮箱格式正确。" if email and EMAIL_RE.match(email) else "邮箱为空或格式不正确。",
        )
    )
    items.append(
        _item(
            "username",
            "用户名",
            "ok" if 3 <= len(username) <= 100 else "fail",
            f"用户名 {len(username)} 字。"
            if 3 <= len(username) <= 100
            else "用户名需为 3–100 字。",
        )
    )
    items.append(
        _item(
            "role",
            "初始角色",
            "ok" if not role or role in ASSIGNABLE_ROLES else "fail",
            "未指定角色，创建后只是普通成员。"
            if not role
            else (f"将授予 {role}。" if role in ASSIGNABLE_ROLES else f"{role} 不是可分配角色。"),
        )
    )
    items.append(
        _item(
            "note",
            "邀请留言",
            "ok" if len(note) <= 300 else "fail",
            f"留言 {len(note)} 字。" if len(note) <= 300 else "邀请留言最多 300 字。",
        )
    )
    if email or username:
        rows = (
            (
                await db.execute(
                    select(User).where(
                        User.tenant_id == tenant_id,
                        or_(
                            func.lower(User.email) == email,
                            func.lower(User.username) == username.lower(),
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )
        email_hit = next((u for u in rows if u.email.lower() == email), None)
        name_hit = next((u for u in rows if u.username.lower() == username.lower()), None)
        conflicts = []
        if email_hit:
            conflicts.append(f"邮箱已被 {email_hit.username} 使用")
        if name_hit:
            conflicts.append(f"用户名已被 {name_hit.username} 使用")
        items.append(
            _item(
                "identity_unique",
                "邮箱与用户名",
                "fail" if conflicts else "ok",
                f"{'；'.join(conflicts)}。" if conflicts else "邮箱和用户名都没有重复。",
            )
        )
    return items


async def _member_active(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any], actor: User
) -> list[AdminPreflightItem]:
    uid = _i(p, "user_id")
    target_active = _b(p, "is_active")
    user = await _user(db, tenant_id, uid)
    items = [
        _item(
            "target",
            "目标成员",
            "ok" if user else "fail",
            f"成员 {user.username} 存在。" if user else "成员不存在。",
        ),
        _item(
            "self",
            "操作人",
            "fail" if user and user.id == actor.id else "ok",
            "不能修改自己的启用状态。" if user and user.id == actor.id else "不是操作人本人。",
        ),
    ]
    if user is not None and target_active is not None:
        items.append(
            _item(
                "state",
                "启用状态",
                "warn" if user.is_active == target_active else "ok",
                "账号已经是这个状态，提交不会产生变化。"
                if user.is_active == target_active
                else ("将启用账号。" if target_active else "停用后立即吊销登录令牌。"),
            )
        )
    return items


async def _member_admin(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any], actor: User
) -> list[AdminPreflightItem]:
    uid = _i(p, "user_id")
    is_admin = _b(p, "is_admin")
    user = await _user(db, tenant_id, uid)
    items = [
        _item(
            "target",
            "目标成员",
            "ok" if user else "fail",
            f"成员 {user.username} 存在。" if user else "成员不存在。",
        ),
        _item(
            "self",
            "操作人",
            "fail" if user and user.id == actor.id else "ok",
            "不能修改自己的平台管理员状态。"
            if user and user.id == actor.id
            else "不是操作人本人。",
        ),
    ]
    if user is not None and is_admin is not None:
        if not is_admin and user.is_admin:
            remaining = (
                await db.execute(
                    select(func.count(User.id)).where(
                        User.tenant_id == tenant_id,
                        User.is_admin.is_(True),
                        User.id != user.id,
                    )
                )
            ).scalar_one()
            items.append(
                _item(
                    "last_admin",
                    "管理员数量",
                    "fail" if remaining < 1 else "ok",
                    "这是最后一个管理员，降级会锁死管理入口。"
                    if remaining < 1
                    else f"降级后仍有 {remaining} 位平台管理员。",
                )
            )
        items.append(
            _item(
                "state",
                "管理员状态",
                "warn" if user.is_admin == is_admin else "ok",
                "账号已经是这个状态，提交不会产生变化。"
                if user.is_admin == is_admin
                else (
                    "会取消平台管理员权限并吊销令牌。" if not is_admin else "会授予平台管理员权限。"
                ),
            )
        )
    return items


async def _member_role(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    uid = _i(p, "user_id")
    role = _s(p, "role")
    action = _s(p, "action", "assign")
    user = await _user(db, tenant_id, uid)
    items = [
        _item(
            "target",
            "目标成员",
            "ok" if user else "fail",
            f"成员 {user.username} 存在。" if user else "成员不存在。",
        ),
        _item(
            "role",
            "角色",
            "ok" if role in ASSIGNABLE_ROLES else "fail",
            "角色可分配。" if role in ASSIGNABLE_ROLES else "角色不在可分配范围。",
        ),
        _item(
            "action",
            "动作",
            "ok" if action in {"assign", "revoke"} else "fail",
            "动作有效。" if action in {"assign", "revoke"} else "动作只能是 assign 或 revoke。",
        ),
    ]
    if user is not None and role:
        held = role in await _roles(user, db, tenant_id)
        if action == "assign":
            items.append(
                _item(
                    "role_state",
                    "当前角色",
                    "warn" if held else "ok",
                    "这个成员已经拥有该角色。" if held else "当前没有该角色，提交后会新增。",
                )
            )
        else:
            items.append(
                _item(
                    "role_state",
                    "当前角色",
                    "ok" if held else "fail",
                    "当前拥有该角色，可撤销。" if held else "当前没有该角色，撤销会返回 404。",
                )
            )
    return items


async def _member_xp(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    uid = _i(p, "user_id")
    points = _i(p, "points")
    note = _s(p, "note")
    user = await _user(db, tenant_id, uid)
    return [
        _item(
            "target",
            "目标成员",
            "ok" if user else "fail",
            f"成员 {user.username} 存在。" if user else "成员不存在。",
        ),
        _item(
            "points",
            "经验值",
            "ok" if points is not None and 1 <= points <= 10000 else "fail",
            f"将发放 {points} 经验。"
            if points is not None and 1 <= points <= 10000
            else "经验必须是 1–10000 的整数。",
        ),
        _item(
            "note",
            "备注",
            "ok" if 1 <= len(note) <= 200 else "fail",
            f"备注 {len(note)} 字。" if 1 <= len(note) <= 200 else "备注必填，最多 200 字。",
        ),
    ]


async def _member_areas(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    from app.domain.catalog.models import Discipline

    uid = _i(p, "user_id")
    user = await _user(db, tenant_id, uid)
    subject = p.get("subject_disciplines")
    reviewer = p.get("reviewer_disciplines")
    tags = p.get("reviewer_tags")
    items = [
        _item(
            "target",
            "目标成员",
            "ok" if user else "fail",
            f"成员 {user.username} 存在。" if user else "成员不存在。",
        )
    ]
    if subject is None and reviewer is None and tags is None:
        items.append(_item("provided", "更新字段", "fail", "没有选择任何要更新的领域字段。"))
        return items
    known = set(
        (await db.execute(select(Discipline.slug).where(Discipline.tenant_id == tenant_id)))
        .scalars()
        .all()
    )
    for key, label, limit in (
        ("subject_disciplines", "科目领域", 6),
        ("reviewer_disciplines", "审稿人领域", 10),
        ("reviewer_tags", "审稿能力标签", 20),
    ):
        if p.get(key) is None:
            continue
        values = p.get(key) or []
        if not isinstance(values, list):
            items.append(_item(key, label, "fail", f"{label}必须是列表。"))
            continue
        cleaned = [str(v).strip() for v in values if str(v).strip()]
        dupes = len(cleaned) != len(set(cleaned))
        unknown = [v for v in cleaned if key != "reviewer_tags" and known and v not in known]
        status = "fail" if unknown or len(cleaned) > limit else "warn" if dupes else "ok"
        detail = (
            f"{label}选了 {len(cleaned)} 个，超过上限 {limit}。"
            if len(cleaned) > limit
            else f"有未知方向：{', '.join(unknown)}。"
            if unknown
            else "有重复项，保存时会去重。"
            if dupes
            else f"{label}选了 {len(cleaned)} 个。"
        )
        items.append(_item(key, label, status, detail))
    return items


async def _claim_decision(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    from app.domain.catalog.models import AuthorClaim, Resource
    from app.domain.submission.models import Submission

    claim_id = _i(p, "claim_id")
    action = _s(p, "action")
    claim = (
        (
            await db.execute(
                select(AuthorClaim).where(
                    AuthorClaim.id == claim_id, AuthorClaim.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if claim_id
        else None
    )
    items = [
        _item(
            "target",
            "认领申请",
            "ok" if claim else "fail",
            "申请存在。" if claim else "认领申请不存在。",
        ),
        _item(
            "action",
            "处理动作",
            "ok" if action in {"approve", "reject"} else "fail",
            "动作有效。" if action in {"approve", "reject"} else "动作只能是 approve 或 reject。",
        ),
    ]
    if claim is not None:
        items.append(
            _item(
                "status",
                "申请状态",
                "ok" if claim.status == "pending" else "fail",
                "仍在等待处理。" if claim.status == "pending" else "这份申请已经处理过。",
            )
        )
        resource = (
            await db.execute(
                select(Resource).where(
                    Resource.id == claim.resource_id, Resource.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        items.append(
            _item(
                "resource",
                "作品",
                "ok" if resource else "fail",
                f"作品《{resource.title}》存在。" if resource else "作品已被删除。",
            )
        )
        if action == "approve" and resource is not None:
            items.append(
                _item(
                    "owner",
                    "当前归属",
                    "warn" if resource.owner_id and resource.owner_id != claim.user_id else "ok",
                    "作品当前已挂在另一位用户名下，批准会改归属。"
                    if resource.owner_id and resource.owner_id != claim.user_id
                    else "批准后会把作品挂到申请人名下。",
                )
            )
            existing = (
                await db.execute(
                    select(Submission.id).where(
                        Submission.resource_id == resource.id,
                        Submission.submitted_by == claim.user_id,
                        Submission.tenant_id == tenant_id,
                    )
                )
            ).scalar_one_or_none()
            items.append(
                _item(
                    "submission",
                    "关联作品记录",
                    "warn" if existing else "ok",
                    "已有这条关联记录，批准不会重复创建。"
                    if existing
                    else "批准时会创建一条 accepted 关联记录。",
                )
            )
    return items


async def _claim_assign(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    from app.domain.catalog.models import Resource

    rid = _i(p, "resource_id")
    uid = _i(p, "user_id")
    position = _i(p, "author_position")
    resource = (
        (
            await db.execute(
                select(Resource).where(Resource.id == rid, Resource.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if rid
        else None
    )
    user = await _user(db, tenant_id, uid)
    author_count = len(resource.authors or []) if resource else 0
    items = [
        _item(
            "resource",
            "作品",
            "ok" if resource else "fail",
            f"作品《{resource.title}》存在。" if resource else "作品不存在。",
        ),
        _item(
            "user",
            "目标用户",
            "ok" if user else "fail",
            f"用户 {user.username} 存在。" if user else "目标用户不存在。",
        ),
        _item(
            "position",
            "作者位次",
            "ok"
            if resource and position is not None and 1 <= position <= max(author_count, 1)
            else "fail",
            f"作品有 {author_count} 个作者位，将绑定第 {position or 1} 位。"
            if resource and position is not None and 1 <= position <= max(author_count, 1)
            else "作者位次超出这篇作品的作者数量。",
        ),
    ]
    if resource is not None and user is not None:
        already = resource.owner_id == user.id
        items.append(
            _item(
                "owner_state",
                "当前归属",
                "warn" if already else "ok",
                "作品已经挂在该用户名下，重复绑定不会改变归属。"
                if already
                else f"作品当前归属：{resource.owner_id or '未认领'}，提交后会改为 {user.username}。",
            )
        )
    return items


async def _role_application(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    from app.domain.gamification.models import RoleApplication

    aid = _i(p, "application_id")
    decision = _s(p, "decision")
    note = _s(p, "note")
    row = (
        (
            await db.execute(
                select(RoleApplication).where(
                    RoleApplication.id == aid, RoleApplication.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if aid
        else None
    )
    items = [
        _item(
            "target",
            "角色申请",
            "ok" if row else "fail",
            "申请存在。" if row else "角色申请不存在。",
        ),
        _item(
            "decision",
            "决定",
            "ok" if decision in {"approve", "reject"} else "fail",
            "决定有效。" if decision in {"approve", "reject"} else "只能是 approve 或 reject。",
        ),
        _item(
            "note",
            "处理说明",
            "ok" if len(note) <= 500 else "fail",
            f"说明 {len(note)} 字。" if len(note) <= 500 else "说明最多 500 字。",
        ),
    ]
    if row is not None:
        items.append(
            _item(
                "status",
                "申请状态",
                "ok" if row.status == "pending" else "fail",
                "仍在等待处理。" if row.status == "pending" else "这份申请已经处理过。",
            )
        )
        applicant = await _user(db, tenant_id, row.user_id)
        items.append(
            _item(
                "applicant",
                "申请人",
                "ok" if applicant else "fail",
                f"{applicant.username} 存在。" if applicant else "申请人已注销。",
            )
        )
        if applicant is not None:
            held = row.target_role in await _roles(applicant, db, tenant_id)
            items.append(
                _item(
                    "role_state",
                    "目标身份",
                    "warn" if held else "ok",
                    "申请人已经拥有该身份，批准不会重复授予。"
                    if held
                    else f"通过后会授予 {row.target_role} 身份。",
                )
            )
    return items


async def _comment_moderation(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    from app.domain.comments.models import Comment

    cid = _i(p, "comment_id")
    action = _s(p, "action")
    note = _s(p, "note")
    row = (
        (
            await db.execute(
                select(Comment).where(Comment.id == cid, Comment.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if cid
        else None
    )
    items = [
        _item(
            "target",
            "评论",
            "ok" if row else "fail",
            "评论存在。" if row else "评论不存在或已删除。",
        ),
        _item(
            "action",
            "处理动作",
            "ok" if action in {"approve", "reject"} else "fail",
            "动作有效。" if action in {"approve", "reject"} else "只能是 approve 或 reject。",
        ),
        _item(
            "note",
            "审核备注",
            "ok" if len(note) <= 500 else "fail",
            f"备注 {len(note)} 字。" if len(note) <= 500 else "备注最多 500 字。",
        ),
    ]
    if row is not None:
        target = "published" if action == "approve" else "rejected"
        items.append(
            _item(
                "status",
                "当前状态",
                "warn" if row.status == target else "ok" if row.status == "pending" else "warn",
                "评论已经是目标状态，提交不会产生变化。"
                if row.status == target
                else (
                    "评论当前不在待审状态，但可以通过或拒绝来改写结果。"
                    if row.status != "pending"
                    else "评论正在待审。"
                ),
            )
        )
    return items


async def _forum_topic(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    from app.domain.forum.models import ForumTopic

    tid = _i(p, "topic_id")
    row = (
        (
            await db.execute(
                select(ForumTopic).where(ForumTopic.id == tid, ForumTopic.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if tid
        else None
    )
    items = [
        _item(
            "target",
            "主题帖",
            "ok" if row else "fail",
            f"主题帖《{row.title}》存在。" if row else "主题帖不存在。",
        ),
        _item(
            "deleted",
            "内容状态",
            "fail" if row and row.deleted_at else "ok",
            "主题帖已删除，不能再改巡检状态。" if row and row.deleted_at else "主题帖仍在站内。",
        ),
    ]
    if row is None:
        return items

    labels = {"is_pinned": "置顶", "is_locked": "锁定"}
    for key, label in labels.items():
        if key not in p:
            continue
        target = _b(p, key)
        current = bool(getattr(row, key))
        if key == "is_pinned":
            state = "置顶" if current else "未置顶"
            action = "置顶" if target else "取消置顶"
        else:
            state = "锁定" if current else "未锁定"
            action = "锁定，普通成员不能继续回复" if target else "解锁"
        if target == current:
            items.append(_item(key, label, "warn", f"当前已经是{state}状态。"))
        else:
            items.append(_item(key, label, "ok", f"提交后会{action}。"))
    return items


async def _report_disposition(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any], actor: User
) -> list[AdminPreflightItem]:
    from app.domain.forum.models import ForumReply, ForumReport, ForumTopic

    rid = _i(p, "id")
    source = _s(p, "source", "forum")
    action = _s(p, "action")
    note = _s(p, "note")
    items: list[AdminPreflightItem] = [
        _item(
            "action",
            "处理动作",
            "ok" if action in {"dismiss", "remove_content", "suspend_author"} else "fail",
            "动作有效。"
            if action in {"dismiss", "remove_content", "suspend_author"}
            else "动作不在允许范围。",
        ),
        _item(
            "note",
            "处理说明",
            "ok" if len(note) <= 500 else "fail",
            f"说明 {len(note)} 字。" if len(note) <= 500 else "说明最多 500 字。",
        ),
    ]
    report = None
    target = None
    target_type = ""
    if source == "content":
        report = (
            (
                await db.execute(
                    select(ContentReport).where(
                        ContentReport.id == rid, ContentReport.tenant_id == tenant_id
                    )
                )
            ).scalar_one_or_none()
            if rid
            else None
        )
        if report is not None:
            target_type = report.target_type
            if report.target_type == "comment":
                from app.domain.comments.models import Comment

                target = (
                    await db.execute(
                        select(Comment).where(
                            Comment.id == report.target_id, Comment.tenant_id == tenant_id
                        )
                    )
                ).scalar_one_or_none()
            elif report.target_type == "submission":
                from app.domain.submission.models import Submission

                target = (
                    await db.execute(
                        select(Submission).where(
                            Submission.id == report.target_id, Submission.tenant_id == tenant_id
                        )
                    )
                ).scalar_one_or_none()
            else:
                items.append(
                    _item(
                        "content",
                        "被举报内容",
                        "fail",
                        f"未知的举报对象类型：{report.target_type}。",
                    )
                )
    else:
        report = (
            (
                await db.execute(
                    select(ForumReport).where(
                        ForumReport.id == rid, ForumReport.tenant_id == tenant_id
                    )
                )
            ).scalar_one_or_none()
            if rid
            else None
        )
        if report is not None:
            target_type = "topic" if report.topic_id else "reply"
            if report.topic_id:
                target = (
                    await db.execute(
                        select(ForumTopic).where(
                            ForumTopic.id == report.topic_id, ForumTopic.tenant_id == tenant_id
                        )
                    )
                ).scalar_one_or_none()
            elif report.reply_id:
                target = (
                    await db.execute(
                        select(ForumReply).where(
                            ForumReply.id == report.reply_id, ForumReply.tenant_id == tenant_id
                        )
                    )
                ).scalar_one_or_none()
    items.insert(
        0,
        _item(
            "target",
            "举报记录",
            "ok" if report else "fail",
            "举报记录存在。" if report else "举报记录不存在。",
        ),
    )
    if report is not None:
        items.append(
            _item(
                "status",
                "举报状态",
                "ok" if report.status == "open" else "fail",
                "仍在等待处理。" if report.status == "open" else "这条举报已经处理过。",
            )
        )
        if target is None:
            label = (
                "被举报的评论"
                if target_type == "comment"
                else ("被举报的作品" if target_type == "submission" else "被举报的帖子或楼层")
            )
            items.append(_item("content", "被举报内容", "fail", f"{label}已经不存在。"))
        else:
            content_deleted = (
                bool(getattr(target, "deleted_at", None))
                or getattr(target, "status", None) == "rejected"
            )
            items.append(
                _item(
                    "content",
                    "被举报内容",
                    "warn" if content_deleted else "ok",
                    "内容已经删除或下架，再移除不会产生变化。"
                    if content_deleted
                    else "内容仍在站内，执行移除后会立刻下架。",
                )
            )
        if action == "suspend_author" and target is not None:
            author_id = (
                getattr(target, "author_id", None)
                or getattr(target, "user_id", None)
                or getattr(target, "submitted_by", None)
            )
            if author_id:
                author = await _user(db, tenant_id, author_id)
                self_hit = author is not None and author.id == actor.id
                items.append(
                    _item(
                        "author",
                        "内容作者",
                        "warn" if self_hit or (author and not author.is_active) else "ok",
                        "这是你自己的内容，提交只会结案，不会停用自己的账号。"
                        if self_hit
                        else (
                            "作者账号已经停用。"
                            if author and not author.is_active
                            else f"停用 {author.username if author else '作者'} 会同时移除内容并让登录态失效。"
                        ),
                    )
                )
    return items


async def _appeal_decision(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    from app.domain.catalog.models import Appeal, Resource

    aid = _i(p, "appeal_id")
    status = _s(p, "status")
    note = _s(p, "editor_note")
    row = (
        (
            await db.execute(select(Appeal).where(Appeal.id == aid, Appeal.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if aid
        else None
    )
    items = [
        _item("target", "申诉", "ok" if row else "fail", "申诉存在。" if row else "申诉不存在。"),
        _item(
            "decision",
            "处理结果",
            "ok" if status in {"accepted", "rejected"} else "fail",
            "结果有效。" if status in {"accepted", "rejected"} else "只能是 accepted 或 rejected。",
        ),
        _item(
            "note",
            "处理说明",
            "ok" if len(note) >= 20 else "fail",
            f"说明 {len(note)} 字。" if len(note) >= 20 else "处理说明至少 20 字，作者会原样看到。",
        ),
    ]
    if row is not None:
        items.append(
            _item(
                "status",
                "申诉状态",
                "ok" if row.status == "pending" else "fail",
                "仍在等待处理。" if row.status == "pending" else "这条申诉已经处理过。",
            )
        )
        resource = (
            await db.execute(
                select(Resource).where(
                    Resource.id == row.resource_id, Resource.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if status == "accepted" and row.kind == "withdraw":
            if resource is None:
                items.append(_item("resource", "作品", "fail", "作品已不存在，无法执行撤回。"))
            else:
                items.append(
                    _item(
                        "withdraw",
                        "撤回后果",
                        "warn" if resource.publication_status != "published" else "ok",
                        "作品已经不在公开目录，撤回不会产生变化。"
                        if resource.publication_status != "published"
                        else "通过后作品会立即从公开目录下架并改为草稿。",
                    )
                )
    return items


async def _shop_item(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    from app.domain.gamification.models import CoinShopItem

    item_id = _i(p, "item_id")
    name = _s(p, "name")
    price = _i(p, "price_coin")
    stock = _i(p, "stock")
    sort = _i(p, "sort_order", 0)
    cover = _s(p, "cover_url")
    description = _s(p, "description")
    effect = _s(p, "effect", "none") or "none"
    existing = (
        (
            await db.execute(
                select(CoinShopItem).where(
                    CoinShopItem.id == item_id, CoinShopItem.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if item_id
        else None
    )
    items = [
        _item(
            "name",
            "名称",
            "ok" if 1 <= len(name) <= 100 else "fail",
            f"名称 {len(name)} 字。" if 1 <= len(name) <= 100 else "名称需为 1–100 字。",
        ),
        _item(
            "price",
            "价格",
            "ok" if price is not None and 1 <= price <= 100000 else "fail",
            f"价格 {price} 积分。"
            if price is not None and 1 <= price <= 100000
            else "价格必须是 1–100000 积分。",
        ),
        _item(
            "stock",
            "库存",
            "ok" if stock is None or 0 <= stock <= 100000 else "fail",
            f"库存 {stock if stock is not None else '不限'}。"
            if stock is None or 0 <= stock <= 100000
            else "库存需为 0–100000，留空为不限。",
        ),
        _item(
            "sort",
            "排序",
            "ok" if sort is not None and 0 <= sort <= 1000 else "fail",
            f"排序值 {sort}。" if sort is not None and 0 <= sort <= 1000 else "排序需为 0–1000。",
        ),
        _item(
            "cover",
            "封面地址",
            "ok" if len(cover) <= 500 else "fail",
            f"封面地址 {len(cover)} 字。" if len(cover) <= 500 else "封面地址最多 500 字。",
        ),
        _item(
            "description",
            "说明",
            "ok" if len(description) <= 1000 else "fail",
            f"说明 {len(description)} 字。" if len(description) <= 1000 else "说明最多 1000 字。",
        ),
        _item(
            "effect",
            "权益效果",
            "ok" if effect in {"none", "accent_unlock"} else "fail",
            "效果有效。"
            if effect in {"none", "accent_unlock"}
            else "效果只能是 none 或 accent_unlock。",
        ),
    ]
    if item_id and existing is None:
        items.append(_item("item", "货品", "fail", "要修改的货品不存在。"))
    if existing is None and name:
        duplicate = (
            await db.execute(
                select(CoinShopItem.id).where(
                    CoinShopItem.tenant_id == tenant_id, CoinShopItem.name == name
                )
            )
        ).scalar_one_or_none()
        items.append(
            _item(
                "name_unique",
                "同名货品",
                "warn" if duplicate else "ok",
                "已有同名货品，保存在同一列表里容易混淆。" if duplicate else "没有同名货品。",
            )
        )
    return items


async def _coin_rule(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    amount = _i(p, "amount")
    daily_cap = _i(p, "daily_cap", 0)
    reason = _s(p, "reason")
    active = _b(p, "is_active", True)
    items = [
        _item(
            "reason",
            "规则依据",
            "ok" if reason else "warn",
            f"规则 {reason}。" if reason else "没有选择具体规则，保存不会发生。",
        ),
        _item(
            "amount",
            "发放数量",
            "ok" if amount is not None and 0 <= amount <= 10000 else "fail",
            f"每次 {amount} 分。"
            if amount is not None and 0 <= amount <= 10000
            else "金额需为 0–10000。",
        ),
        _item(
            "daily_cap",
            "每日上限",
            "ok" if daily_cap is not None and 0 <= daily_cap <= 1000 else "fail",
            f"每日上限 {daily_cap}。"
            if daily_cap is not None and 0 <= daily_cap <= 1000
            else "每日上限需为 0–1000。",
        ),
    ]
    if active is False and amount and amount > 0:
        items.append(_item("active", "启用状态", "warn", "规则被停用后，这个金额不会实际发放。"))
    return items


async def _coin_policy(
    db: AsyncSession, tenant_id: Any, p: dict[str, Any]
) -> list[AdminPreflightItem]:
    daily = _i(p, "daily_earn_cap")
    monthly = _i(p, "monthly_issue_cap")
    return [
        _item(
            "daily",
            "每日获取上限",
            "ok" if daily is not None and 1 <= daily <= 10000 else "fail",
            f"每日上限 {daily}。"
            if daily is not None and 1 <= daily <= 10000
            else "每日上限需为 1–10000。",
        ),
        _item(
            "monthly",
            "每月发行上限",
            "ok" if monthly is not None and 1 <= monthly <= 100000000 else "fail",
            f"每月上限 {monthly}。"
            if monthly is not None and 1 <= monthly <= 100000000
            else "每月上限需为 1–100000000。",
        ),
        _item(
            "relation",
            "上限关系",
            "warn" if daily is not None and monthly is not None and daily > monthly else "ok",
            "每日上限高于每月上限，月度上限会先被用完。"
            if daily is not None and monthly is not None and daily > monthly
            else "每日上限与每月上限的关系正常。",
        ),
    ]


@router.post("/preflight", response_model=AdminPreflightResponse)
async def admin_action_preflight(
    body: AdminActionPreflightIn,
    current_admin: User = Depends(require_chief_editor),
    db: AsyncSession = Depends(get_db),
) -> AdminPreflightResponse:
    """Run one read-only check for an admin draft or disposition.

    Never writes a row and never writes an audit event; the UI uses this before
    the real endpoint, then either blocks or says why.
    """
    tenant_id = require_tenant_id()
    kind = body.kind.strip()
    if kind == "member_create":
        items = await _member_create(db, tenant_id, body.payload)
    elif kind == "member_active":
        items = await _member_active(db, tenant_id, body.payload, current_admin)
    elif kind == "member_admin":
        items = await _member_admin(db, tenant_id, body.payload, current_admin)
    elif kind == "member_role":
        items = await _member_role(db, tenant_id, body.payload)
    elif kind == "member_xp":
        items = await _member_xp(db, tenant_id, body.payload)
    elif kind == "member_areas":
        items = await _member_areas(db, tenant_id, body.payload)
    elif kind == "claim_decision":
        items = await _claim_decision(db, tenant_id, body.payload)
    elif kind == "claim_assign":
        items = await _claim_assign(db, tenant_id, body.payload)
    elif kind == "role_application":
        items = await _role_application(db, tenant_id, body.payload)
    elif kind == "comment_moderation":
        items = await _comment_moderation(db, tenant_id, body.payload)
    elif kind == "forum_topic":
        items = await _forum_topic(db, tenant_id, body.payload)
    elif kind == "report_disposition":
        items = await _report_disposition(db, tenant_id, body.payload, current_admin)
    elif kind == "appeal_decision":
        items = await _appeal_decision(db, tenant_id, body.payload)
    elif kind == "shop_item":
        items = await _shop_item(db, tenant_id, body.payload)
    elif kind == "coin_rule":
        items = await _coin_rule(db, tenant_id, body.payload)
    elif kind == "coin_policy":
        items = await _coin_policy(db, tenant_id, body.payload)
    else:
        raise HTTPException(status_code=404, detail=f"未知的预检类型：{kind}")
    return _finish(items)
