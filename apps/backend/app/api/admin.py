"""Admin endpoints: list users, enable/disable users, list audit logs,
manage role assignments.

All endpoints require ``is_admin=True``. Per-tenant scoping is enforced
both at the application layer (explicit ``tenant_id`` filter on every
query) and by RLS in production. An admin in tenant A cannot read
tenant B's data.
"""

from __future__ import annotations

import csv
import io
import json
import os
import secrets
import shutil
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app import __version__
from app.api.deps import require_admin, require_editor, require_tenant_id
from app.core.config import settings
from app.core.db import get_db
from app.core.email import get_email_sender
from app.core.email_templates import account_created
from app.core.key_rotation import _active_secret_keys, _signing_key, reload_settings
from app.core.logging import get_logger
from app.core.security import hash_password
from app.core.site_settings import get_all_site_flags, set_site_flag
from app.models import AuditLog, Role, User, UserRole
from app.schemas import (
    AdminUserAreasUpdate,
    AdminUserCreate,
    AdminUserCreateResponse,
    RoleAssign,
    SiteSettingsResponse,
    SiteSettingsUpdate,
    UserResponse,
)

router = APIRouter(prefix="/admin", tags=["admin"])

logger = get_logger("rubbish.admin")

# Allowlist of assignable role names; mirrors Role.name values. Admin
# privilege is governed by User.is_admin, not by role membership.
#
# 作者/读者不再作为可分配角色：读者身份 = 注册即得，作者身份 = 确认
# 《写作规范》即得（users.rules_ack_version），二者是"身份"不是"角色"，
# 由编辑部手工分配只会造成授权逻辑混乱（2026-11 收窄口径）。
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

ROLE_LABELS = {
    "reviewer": "互评成员",
    "senior_reviewer": "资深互评成员",
    "editor": "内容整理",
    "section_editor": "分区整理",
    "board_editor": "内容策展",
    "deputy_editor": "内容副主管",
    "chief_editor": "内容主管",
    "shop_manager": "经验管理员",
    "editor_in_chief": "总协调",
    "admin": "站务",
}


@router.get("/security/status")
async def security_status(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Report the JWT signing key state for the running process.

    Operators call this to confirm a rotation landed: the
    ``active_keys`` count goes up by 1 immediately after a successful
    ``POST /admin/security/reload`` if ``RUBBISH_PREVIOUS_SECRET_KEYS``
    was populated. The actual key material is NEVER returned — only
    the SHA-256 prefix (kid) so a dashboard can show which key signed
    a given token.
    """
    import hashlib

    keys = _active_secret_keys()
    current = _signing_key()
    admin_total = 0
    admin_without_2fa = 0
    try:
        admin_total = int(
            (
                await db.execute(text("SELECT count(*) FROM users WHERE is_admin = true"))
            ).scalar_one()
        )
        admin_without_2fa = int(
            (
                await db.execute(
                    text(
                        "SELECT count(*) FROM users "
                        "WHERE is_admin = true AND totp_enabled_at IS NULL"
                    )
                )
            ).scalar_one()
        )
    except Exception:
        # 统计失败不影响密钥状态；页面会显示未知而不是误报为零。
        admin_total = -1
        admin_without_2fa = -1
    return {
        "signing_key_count": len(keys),
        "previous_key_count": max(0, len(keys) - 1),
        # Public prefix only — never the key itself.
        "signing_key_kid": hashlib.sha256(current.encode("utf-8")).hexdigest()[:16]
        if current
        else None,
        # Operator-facing signal: did the most recent decode actually
        # consult a fallback key? Useful when verifying a rotation
        # worked in production.
        "rotation_window_open": len(keys) > 1,
        # Access model, surfaced so the admin security panel shows what is
        # actually enforcing the wall rather than guessing from env files.
        "auth_wall_enabled": settings.auth_wall_enabled,
        "mainland_gate_enabled": settings.mainland_gate_enabled,
        "region_access_enabled": settings.region_access_enabled,
        "registration_invite_required": bool(settings.registration_invite_code.strip()),
        "registration_email_code_required": settings.registration_email_code_required,
        "require_2fa_for_admin": settings.require_2fa_for_admin,
        "admin_total": admin_total,
        "admin_without_2fa": admin_without_2fa,
    }


@router.post("/security/reload", status_code=status.HTTP_204_NO_CONTENT)
async def reload_security_settings(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> None:
    """Re-read ``RUBBISH_*`` env vars without restarting the process.

    Use this after rotating ``RUBBISH_SECRET_KEY`` /
    ``RUBBISH_PREVIOUS_SECRET_KEYS`` / ``RUBBISH_FERNET_KEYS``.
    New tokens use the new key immediately; tokens already in
    flight verify against the previous-key list until they expire.

    Audit-logged so a compromised admin cannot quietly rotate the
    signing key without a record.
    """
    reload_settings()
    db.add(
        AuditLog(
            tenant_id=current_admin.tenant_id,
            actor_user_id=current_admin.id,
            action="security.reload",
            target_type="security",
            target_id=None,
            payload={"keys_after_reload": len(_active_secret_keys())},
        )
    )
    await db.commit()
    logger.info("security_settings_reloaded", actor=current_admin.id)


async def _user_with_roles(db: AsyncSession, user: User) -> UserResponse:
    """Build a UserResponse and populate its role-name list for the current tenant."""
    result = await db.execute(
        select(Role.name)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(
            UserRole.user_id == user.id,
            UserRole.tenant_id == user.tenant_id,
            Role.tenant_id == user.tenant_id,
        )
    )
    role_names = sorted({r for r in result.scalars() if r})
    resp = UserResponse.model_validate(user)
    resp.roles = role_names
    from app.api.levels import level_of

    # UserResponse 的 ORM 直出分支会丢掉 xp（它是列，但 model_validator
    # 只挑选显式白名单字段）。后台成员列表要显示活跃等级，不能把所有人的
    # 累计经验都报成 0，否则管理员看到的等级与实际 XP 脱节。
    resp.xp = user.xp or 0
    resp.level = await level_of(db, user)
    return resp


@router.patch("/users/{user_id}/areas", response_model=UserResponse)
async def update_user_areas(
    user_id: int,
    payload: AdminUserAreasUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> UserResponse:
    """站务维护成员领域：科目领域、审稿领域与审稿能力标签。

    这是成员自助资料之外唯一的代改入口，用于申请人资料缺失时补齐；
    每次改动写审计日志，便于回溯是谁改了谁的领域。
    """
    from app.domain.catalog.models import Discipline

    tenant_id = require_tenant_id()
    user = (
        await db.execute(select(User).where(User.id == user_id, User.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not payload.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="没有要更新的领域字段",
        )

    known = set(
        (await db.execute(select(Discipline.slug).where(Discipline.tenant_id == tenant_id)))
        .scalars()
        .all()
    )
    changes: dict[str, object] = {}
    for field_name, label in (
        ("subject_disciplines", "科目领域"),
        ("reviewer_disciplines", "审稿领域"),
    ):
        if field_name not in payload.model_fields_set:
            continue
        values = [slug for slug in (getattr(payload, field_name) or []) if slug]
        if known:
            unknown = [slug for slug in values if slug not in known]
            if unknown:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"未知{label}：{', '.join(unknown)}",
                )
        deduped = list(dict.fromkeys(values))
        setattr(user, field_name, deduped)
        changes[field_name] = deduped
    if "reviewer_tags" in payload.model_fields_set:
        tags = [tag.strip() for tag in (payload.reviewer_tags or []) if tag and tag.strip()]
        tags = list(dict.fromkeys(tags))[:20]
        user.reviewer_tags = tags
        changes["reviewer_tags"] = tags

    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_admin.id,
            action="user.update_areas",
            target_type="user",
            target_id=str(user.id),
            payload=changes,
        )
    )
    await db.commit()
    await db.refresh(user)
    return await _user_with_roles(db, user)


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: str = Query(default="", max_length=200, description="按用户名或邮箱模糊匹配"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[UserResponse]:
    """List users in the current tenant, newest first.

    ``q`` 是服务端过滤：前端原先只在「当前这一页 50 条」里做本地过滤，
    用户超过 50 个以后，搜一个确实存在的账号会显示「暂无用户」——
    看起来像数据丢了。过滤必须在分页之前发生。
    """
    tenant_id = require_tenant_id()
    stmt = select(User).where(User.tenant_id == tenant_id)
    term = q.strip()
    if term:
        like = f"%{term.lower()}%"
        stmt = stmt.where(
            or_(func.lower(User.username).like(like), func.lower(User.email).like(like))
        )
    result = await db.execute(stmt.order_by(User.id.desc()).limit(limit).offset(offset))
    users = result.scalars().all()
    return [await _user_with_roles(db, u) for u in users]


@router.post(
    "/users",
    response_model=AdminUserCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_invited_user(
    payload: AdminUserCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> AdminUserCreateResponse:
    """Create a staff account on behalf of an editor and send the invite.

    The account is created with an unusable random password: the invitee is
    expected to sign in with an email login code. That keeps the "no
    self-registration needed" workflow without ever returning a password
    through the API.
    """
    tenant_id = require_tenant_id()
    if payload.role is not None and payload.role not in ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Role '{payload.role}' is not assignable",
        )
    email = str(payload.email).strip().lower()
    username = payload.username.strip()
    existing = (
        await db.execute(
            select(User).where(
                User.tenant_id == tenant_id,
                or_(
                    func.lower(User.email) == email,
                    func.lower(User.username) == username.lower(),
                ),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该邮箱或用户名已存在",
        )

    user = User(
        tenant_id=tenant_id,
        email=email,
        username=username,
        hashed_password=hash_password(secrets.token_urlsafe(32)),
        is_active=True,
        is_admin=False,
        is_email_verified=False,
    )
    db.add(user)
    await db.flush()

    if payload.role is not None:
        role = await _get_or_create_role(db, tenant_id, payload.role)
        db.add(UserRole(tenant_id=tenant_id, user_id=user.id, role_id=role.id))

    invite_sent = False
    invite_error: str | None = None
    if payload.role is not None:
        link = f"{settings.frontend_base_url.rstrip('/')}/login"
        try:
            subject, text, html = account_created(
                username=user.username,
                role_label=ROLE_LABELS[payload.role],
                link=link,
                note=payload.note.strip(),
            )
            await get_email_sender().send(to=user.email, subject=subject, body=text, html=html)
            invite_sent = True
        except Exception as exc:
            invite_error = str(exc)[:300]
            logger.warning("admin_user_invite_failed", user_id=user.id, exc_info=True)

    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_admin.id,
            action="user.admin_create",
            target_type="user",
            target_id=str(user.id),
            payload={
                "role": payload.role,
                "invite_sent": invite_sent,
                "email": user.email,
            },
        )
    )
    await db.commit()
    await db.refresh(user)
    return AdminUserCreateResponse(
        user=await _user_with_roles(db, user),
        invite_sent=invite_sent,
        invite_error=invite_error,
    )


@router.patch("/users/{user_id}/active", response_model=UserResponse)
async def set_user_active(
    user_id: int,
    is_active: bool,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> UserResponse:
    """Enable or disable a user. Disabling yourself is refused.

    When disabling, bump both token_version AND refresh_token_version
    so the disabled user's outstanding tokens (access + refresh) become
    invalid immediately, not just on next login.
    """
    if user_id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change your own active state from this endpoint",
        )
    tenant_id = require_tenant_id()
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.tenant_id == tenant_id,
        )
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    previous = user.is_active
    user.is_active = is_active
    if not is_active:
        # Disable invalidates every token we've ever handed out so the
        # user can't keep using a still-valid access/refresh token.
        user.token_version += 1
        user.refresh_token_version += 1
    # Audit trail: record who flipped whose active flag, in the same
    # transaction so the log row never exists without the change.
    db.add(
        AuditLog(
            tenant_id=current_admin.tenant_id,
            actor_user_id=current_admin.id,
            action="user.set_active",
            target_type="user",
            target_id=str(user.id),
            payload={"field": "is_active", "old": previous, "new": is_active},
        )
    )
    await db.commit()
    await db.refresh(user)
    return await _user_with_roles(db, user)


@router.patch("/users/{user_id}/admin", response_model=UserResponse)
async def set_user_admin(
    user_id: int,
    is_admin: bool,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> UserResponse:
    """设置/取消平台管理员（提权为 admin）。

    ``is_admin`` 是平台级特权（可管理所有用户、改评分、看审计），不是租户
    角色。此前只能靠直接改数据库，前端「用户管理」页只读展示，导致
    "把某人提成管理员"在界面上无路可走。

    安全约束（三条都必要）：
    1. 不能改自己的 admin 状态——防止误操作把自己锁在门外；
    2. 不能把最后一个管理员降级——否则无人可管理系统；
    3. 提权/降权都写审计（谁在什么时候给了谁特权）。
    """
    if user_id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能修改自己的管理员状态（避免把自己锁在门外）",
        )
    tenant_id = require_tenant_id()
    result = await db.execute(select(User).where(User.id == user_id, User.tenant_id == tenant_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # 降级检查：至少保留一个管理员
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
        if remaining < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="不能取消最后一个管理员——否则无人可管理系统",
            )

    previous = user.is_admin
    user.is_admin = is_admin
    if not is_admin:
        # 降权即吊销全部令牌：旧 access token 里的 is_admin 判断会随
        # 下次请求回查数据库失效，但 refresh token 仍能换新 access，
        # 所以必须同时 bump 两个版本号，确保彻底退出特权。
        user.token_version += 1
        user.refresh_token_version += 1
    db.add(
        AuditLog(
            tenant_id=current_admin.tenant_id,
            actor_user_id=current_admin.id,
            action="user.set_admin",
            target_type="user",
            target_id=str(user.id),
            payload={"field": "is_admin", "old": previous, "new": is_admin},
        )
    )
    await db.commit()
    await db.refresh(user)
    return await _user_with_roles(db, user)


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> None:
    """Permanently delete a user (admin housekeeping for test/spam accounts).

    防护：管理员账号（含自己）不可删除，避免锁死管理入口；目标不存在
    或不属于本租户 → 404。关联内容按外键级联清理（users 的全部外键均
    为 CASCADE 或 SET NULL，无 RESTRICT），删除动作写入审计日志且与
    变更同事务。
    """
    tenant_id = require_tenant_id()
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.tenant_id == tenant_id,
        )
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.is_admin or user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrator accounts cannot be deleted",
        )
    username = user.username
    await db.delete(user)
    # Audit trail: record who deleted whom, same transaction as the delete.
    db.add(
        AuditLog(
            tenant_id=current_admin.tenant_id,
            actor_user_id=current_admin.id,
            action="user.deleted",
            target_type="user",
            target_id=str(user_id),
            payload={"username": username},
        )
    )
    await db.commit()


async def _get_or_create_role(db: AsyncSession, tenant_id: UUID, role_name: str) -> Role:
    """Get or create a role row (name is unique per tenant)."""
    role = (
        await db.execute(
            select(Role).where(
                Role.tenant_id == tenant_id,
                Role.name == role_name,
            )
        )
    ).scalar_one_or_none()
    if role is not None:
        return role
    role = Role(tenant_id=tenant_id, name=role_name)
    db.add(role)
    await db.flush()
    return role


@router.post(
    "/users/{user_id}/roles",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def assign_role(
    user_id: int,
    body: RoleAssign,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> UserResponse:
    """Assign a role to a user (idempotent per tenant: returns the current state if already assigned)."""
    if body.role not in ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Role '{body.role}' is not assignable",
        )
    tenant_id = require_tenant_id()
    user = (
        await db.execute(
            select(User).where(
                User.id == user_id,
                User.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    role = await _get_or_create_role(db, tenant_id, body.role)
    # Idempotent: if already assigned, return without re-inserting.
    existing = (
        await db.execute(
            select(UserRole).where(
                UserRole.user_id == user.id,
                UserRole.role_id == role.id,
                UserRole.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            UserRole(
                tenant_id=tenant_id,
                user_id=user.id,
                role_id=role.id,
            )
        )
        db.add(
            AuditLog(
                tenant_id=current_admin.tenant_id,
                actor_user_id=current_admin.id,
                action="user.assign_role",
                target_type="user",
                target_id=str(user.id),
                payload={"role": body.role},
            )
        )
        await db.commit()
    await db.refresh(user)
    return await _user_with_roles(db, user)


@router.delete(
    "/users/{user_id}/roles/{role_name}",
    response_model=UserResponse,
)
async def revoke_role(
    user_id: int,
    role_name: str,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> UserResponse:
    """Revoke a role from a user (returns 404 when absent, so silent success never misleads the frontend)."""
    tenant_id = require_tenant_id()
    if role_name not in ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Role '{role_name}' is not revocable via this endpoint",
        )
    user = (
        await db.execute(
            select(User).where(
                User.id == user_id,
                User.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    role = (
        await db.execute(
            select(Role).where(
                Role.tenant_id == tenant_id,
                Role.name == role_name,
            )
        )
    ).scalar_one_or_none()
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Role '{role_name}' not found in this tenant",
        )
    link = (
        await db.execute(
            select(UserRole).where(
                UserRole.user_id == user.id,
                UserRole.role_id == role.id,
                UserRole.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not have this role",
        )
    await db.delete(link)
    db.add(
        AuditLog(
            tenant_id=current_admin.tenant_id,
            actor_user_id=current_admin.id,
            action="user.revoke_role",
            target_type="user",
            target_id=str(user.id),
            payload={"role": role_name},
        )
    )
    await db.commit()
    await db.refresh(user)
    return await _user_with_roles(db, user)


def _audit_conditions(
    tenant_id: UUID,
    action: str | None,
    actor_user_id: int | None,
    target_type: str | None,
    start: datetime | None,
    end: datetime | None,
) -> list[Any]:
    conditions: list[Any] = [AuditLog.tenant_id == tenant_id]
    if action and action.strip():
        conditions.append(AuditLog.action.startswith(action.strip()[:64]))
    if actor_user_id is not None:
        conditions.append(AuditLog.actor_user_id == actor_user_id)
    if target_type and target_type.strip():
        conditions.append(AuditLog.target_type == target_type.strip()[:64])
    start_utc = (
        start.astimezone(UTC)
        if start and start.tzinfo
        else start.replace(tzinfo=UTC)
        if start
        else None
    )
    end_utc = (
        end.astimezone(UTC) if end and end.tzinfo else end.replace(tzinfo=UTC) if end else None
    )
    if start_utc and end_utc and start_utc > end_utc:
        raise HTTPException(status_code=422, detail="start must be before end")
    if start_utc:
        conditions.append(AuditLog.created_at >= start_utc)
    if end_utc:
        conditions.append(AuditLog.created_at <= end_utc)
    return conditions


async def _audit_rows(
    db: AsyncSession, conditions: list[Any], limit: int, offset: int
) -> list[AuditLog]:
    result = await db.execute(
        select(AuditLog)
        .where(*conditions)
        # id 决胜：同秒写入的日志行排序稳定，审计页不抖动。
        .order_by(desc(AuditLog.created_at), AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars())


async def _audit_actor_names(db: AsyncSession, logs: list[AuditLog]) -> dict[int, str]:
    actor_ids = {log.actor_user_id for log in logs if log.actor_user_id is not None}
    if not actor_ids:
        return {}
    actors = await db.execute(
        select(User.id, User.username, User.display_name).where(User.id.in_(actor_ids))
    )
    return {row.id: (row.display_name or row.username) for row in actors}


@router.get("/audit-logs", response_model=list[dict[str, Any]])
async def list_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None, max_length=64),
    actor_user_id: int | None = Query(default=None, ge=1),
    target_type: str | None = Query(default=None, max_length=64),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    """List audit log entries with optional action/actor/target/date filters."""
    tenant_id = require_tenant_id()
    conditions = _audit_conditions(tenant_id, action, actor_user_id, target_type, start, end)
    logs = await _audit_rows(db, conditions, limit, offset)
    actor_names = await _audit_actor_names(db, logs)
    return [
        {
            "id": log.id,
            "tenant_id": str(log.tenant_id) if log.tenant_id else None,
            "actor_user_id": log.actor_user_id,
            "actor_name": actor_names.get(log.actor_user_id) if log.actor_user_id else None,
            "action": log.action,
            "target_type": log.target_type,
            "target_id": log.target_id,
            "payload": log.payload,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]


@router.get("/audit-logs/count")
async def count_audit_logs(
    action: str | None = Query(default=None, max_length=64),
    actor_user_id: int | None = Query(default=None, ge=1),
    target_type: str | None = Query(default=None, max_length=64),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, int]:
    """Count filtered audit rows so pagination does not guess from page fullness."""
    tenant_id = require_tenant_id()
    conditions = _audit_conditions(tenant_id, action, actor_user_id, target_type, start, end)
    total = (await db.execute(select(func.count(AuditLog.id)).where(*conditions))).scalar_one()
    return {"total": int(total)}


@router.get("/audit-logs/export")
async def export_audit_logs(
    action: str | None = Query(default=None, max_length=64),
    actor_user_id: int | None = Query(default=None, ge=1),
    target_type: str | None = Query(default=None, max_length=64),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> Response:
    """Export filtered audit history as UTF-8 CSV (capped at 5000 rows)."""
    tenant_id = require_tenant_id()
    conditions = _audit_conditions(tenant_id, action, actor_user_id, target_type, start, end)
    logs = await _audit_rows(db, conditions, 5000, 0)
    actor_names = await _audit_actor_names(db, logs)

    buf = io.StringIO()
    # BOM 让 Excel 直接按 UTF-8 打开中文，避免乱码。
    buf.write("\ufeff")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(
        [
            "id",
            "created_at",
            "actor_user_id",
            "actor_name",
            "action",
            "target_type",
            "target_id",
            "payload",
        ]
    )
    for log in logs:
        writer.writerow(
            [
                log.id,
                log.created_at.isoformat(),
                log.actor_user_id or "",
                actor_names.get(log.actor_user_id, "") if log.actor_user_id else "",
                log.action,
                log.target_type or "",
                log.target_id or "",
                json.dumps(log.payload, ensure_ascii=False, separators=(",", ":"))
                if log.payload
                else "",
            ]
        )
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="rubbish-audit-{stamp}.csv"',
            "X-Export-Limit": "5000",
        },
    )


@router.get("/ops/monthly")
async def monthly_ops_report(
    month: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """Read-only monthly operations report for the current tenant."""
    from app.domain.ops.monthly import LOCAL_TZ, build_monthly_report

    tenant_id = require_tenant_id()
    target = month or datetime.now(LOCAL_TZ).strftime("%Y-%m")
    try:
        return await build_monthly_report(db, tenant_id, target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/ops/monthly/export")
async def export_monthly_ops_report(
    month: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> Response:
    """Export the monthly operations report as UTF-8 CSV."""
    from app.domain.ops.monthly import LOCAL_TZ, build_monthly_report

    tenant_id = require_tenant_id()
    target = month or datetime.now(LOCAL_TZ).strftime("%Y-%m")
    try:
        report = await build_monthly_report(db, tenant_id, target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["月度运营报告", target])
    writer.writerow([])
    writer.writerow(["指标", "数值"])
    for key, value in report["totals"].items():
        writer.writerow([key, value])
    writer.writerow([])
    writer.writerow(["处置动作", "数量"])
    for key, value in report["moderation_breakdown"].items():
        writer.writerow([key, value])
    writer.writerow([])
    writer.writerow(["日期", "新增成员", "投稿", "新增作品", "主题帖", "回帖", "评论", "后台动作"])
    for row in report["daily"]:
        writer.writerow(
            [
                row["date"],
                row["new_users"],
                row["submissions"],
                row["resources"],
                row["forum_topics"],
                row["forum_replies"],
                row["comments"],
                row["admin_actions"],
            ]
        )
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="rubbish-ops-{target}.csv"',
        },
    )


@router.get("/settings/site", response_model=SiteSettingsResponse)
async def get_site_settings(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> SiteSettingsResponse:
    """读取本租户的运营开关（注册验证码 / 作者 DOI 入口）。"""
    tenant_id = require_tenant_id()
    flags = await get_all_site_flags(db, tenant_id)
    return SiteSettingsResponse(**flags)


@router.patch("/settings/site", response_model=SiteSettingsResponse)
async def update_site_settings(
    payload: SiteSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> SiteSettingsResponse:
    """局部更新运营开关；未传的键保持不变，写审计日志。"""
    tenant_id = require_tenant_id()
    updates = payload.model_dump(exclude_none=True)
    for key, value in updates.items():
        await set_site_flag(db, tenant_id, key, bool(value))
    if updates:
        db.add(
            AuditLog(
                tenant_id=tenant_id,
                actor_user_id=current_admin.id,
                action="admin.settings.site",
                target_type="tenant",
                target_id=str(tenant_id),
                payload=updates,
            )
        )
        await db.commit()
    flags = await get_all_site_flags(db, tenant_id)
    return SiteSettingsResponse(**flags)


@router.get("/maintenance/email-status")
async def email_status(
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """邮件通道自检：是否配置、SMTP 是否可达（不发送真实邮件）。"""
    from app.core.email import (
        configured_accounts,
        get_email_sender,
        smtp_configured,
        verify_smtp_connection,
    )
    from app.core.mail_guard import guard_stats

    ok, detail = await verify_smtp_connection()
    accounts = configured_accounts()
    sender = get_email_sender()
    pool = sender.status_snapshot() if hasattr(sender, "status_snapshot") else []
    return {
        "configured": smtp_configured(),
        "reachable": ok,
        "detail": detail,
        "backend": settings.email_backend,
        "outbound_enabled": settings.email_outbound_enabled,
        # 发件身份列表：只回地址与主机，绝不回授权码。
        "accounts": [
            {"from_address": a.from_address, "host": a.host, "port": a.port} for a in accounts
        ],
        "pool": pool,
        "from_address": accounts[0].from_address if accounts else "",
        "guard": guard_stats(),
    }


# ---------------------------------------------------------------------------
# 作者认领审批（Author Claim review）
#
# 作者对"无人认领"的存量文章发起认领（见 catalog.routes.claim_resource），
# 编辑部在这里批准 / 拒绝。批准 = 创建一条 accepted 关联作品记录，把文章
# 正式挂到认领人名下；拒绝 = 保留申请记录供仲裁。
# ---------------------------------------------------------------------------


class ClaimDecision(BaseModel):
    action: str  # "approve" | "reject"
    note: str | None = None


def _mark_author_position_claimed(
    resource: Any,
    position: int | None,
    user_id: int,
    user_email: str | None,
    user_username: str | None = None,
) -> None:
    """把 resource.authors_meta 里对应作者位标记为已认领。

    - position 为 1-based；缺失时默认第 1 位。
    - 未初始化 authors_meta 时按 authors 列表补齐（全部 claimed=false）。
    - 已认领位的 email / username 在此拷入账号资料，公开面才透出；未认领位为 null。
    """
    count = len(resource.authors or [])
    if count == 0:
        return
    pos = position or 1
    idx = max(0, min(pos - 1, count - 1))
    meta = list(resource.authors_meta or [])
    # 补齐到与 authors 等长，每条至少带 name（AuthorMeta 必填）
    while len(meta) < count:
        meta.append({"name": resource.authors[len(meta)]})
    entry = dict(meta[idx] or {})
    entry.setdefault("name", resource.authors[idx])
    entry["claimed"] = True
    entry["user_id"] = user_id
    if user_email:
        entry["email"] = user_email
    if user_username:
        entry["username"] = user_username
    roles = entry.get("roles") or (["first"] if idx == 0 else [])
    entry["roles"] = [r for r in roles if r in ("first", "corresponding")] or (
        ["first"] if idx == 0 else []
    )
    meta[idx] = entry
    resource.authors_meta = meta


@router.get("/claims")
async def list_claims(
    claim_status: str = Query(default="pending", pattern="^(pending|approved|rejected|all)$"),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    """认领申请列表（站务组审批台）。"""
    from app.domain.catalog.models import AuthorClaim, Resource

    tenant_id = require_tenant_id()
    stmt = (
        select(AuthorClaim, Resource.title, User.username)
        .join(Resource, Resource.id == AuthorClaim.resource_id)
        .join(User, User.id == AuthorClaim.user_id)
        .where(AuthorClaim.tenant_id == tenant_id)
        .order_by(desc(AuthorClaim.created_at))
        .limit(200)
    )
    if claim_status != "all":
        stmt = stmt.where(AuthorClaim.status == claim_status)
    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": claim.id,
            "resource_id": claim.resource_id,
            "resource_title": title,
            "user_id": claim.user_id,
            "username": username,
            "note": claim.note,
            "status": claim.status,
            "author_position": claim.author_position,
            "evidence_type": claim.evidence_type,
            "evidence_value": claim.evidence_value,
            "decision_note": claim.decision_note,
            "created_at": claim.created_at,
            "decided_at": claim.decided_at,
        }
        for claim, title, username in rows
    ]


@router.post("/claims/{claim_id}/decision")
async def decide_claim(
    claim_id: int,
    body: ClaimDecision,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """批准 / 拒绝一篇认领申请。

    批准会创建一条 ``accepted`` 关联作品记录（submitted_by = 认领人，
    resource_id 指向文章），使"我的文章"等 Submission 链路功能生效；
    同时给认领人发通知。全程写审计日志。
    """
    from app.core.time import utcnow
    from app.domain.catalog.models import AuthorClaim, Resource
    from app.domain.notifications import services as notifications
    from app.domain.submission.models import Submission

    if body.action not in ("approve", "reject"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="action 必须是 approve 或 reject"
        )

    tenant_id = require_tenant_id()
    claim = (
        await db.execute(
            select(AuthorClaim).where(
                AuthorClaim.id == claim_id, AuthorClaim.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if claim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    if claim.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该申请已处理")

    resource = (
        await db.execute(
            select(Resource).where(
                Resource.id == claim.resource_id, Resource.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")

    if body.action == "approve":
        # P0：批准即绑定 owner_id——这是认领的权威归属，POST claim 据此 403。
        resource.owner_id = claim.user_id
        # P1：把对应作者位标记为已认领，拷入账号邮箱（公开面据此透出）。
        claimer = (
            await db.execute(select(User.email, User.username).where(User.id == claim.user_id))
        ).first()
        claimer_email = claimer[0] if claimer else None
        claimer_username = claimer[1] if claimer else None
        _mark_author_position_claimed(
            resource, claim.author_position, claim.user_id, claimer_email, claimer_username
        )
        # 防重复：同一资源已有该用户名下的发布就不重复建
        existing_sub = (
            await db.execute(
                select(Submission.id).where(
                    Submission.resource_id == resource.id,
                    Submission.submitted_by == claim.user_id,
                    Submission.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if existing_sub is None:
            db.add(
                Submission(
                    tenant_id=tenant_id,
                    submitted_by=claim.user_id,
                    resource_id=resource.id,
                    title=resource.title,
                    type=resource.type,
                    authors=resource.authors,
                    year=resource.year,
                    venue=resource.venue,
                    discipline=resource.discipline,
                    subdiscipline=resource.subdiscipline,
                    keywords=resource.keywords or [],
                    jel_codes=[],
                    tags=resource.tags or [],
                    abstract=resource.abstract or "",
                    preview=resource.preview or "",
                    status="accepted",
                    admin_note="作者认领批准后自动创建的关联作品记录",
                )
            )
        claim.status = "approved"
        notify_title = f"认领已批准：{resource.title}"
        notify_body = "内容整理已批准你对该作品的认领，作品已挂到你的名下。"
        # 活跃经验：认领审核通过 +20（幂等，同一 claim 只记一次）。
        # 旧身份内积分账本仍保留，但它不参与全站 Level 展示。
        from app.domain.gamification import levels_axis
        from app.domain.gamification import service as gamification

        claim_user = (
            await db.execute(select(User).where(User.id == claim.user_id))
        ).scalar_one_or_none()
        if claim_user is not None:
            await levels_axis.award_points(
                db,
                claim_user,
                "claim.approve",
                ref_type="author_claim",
                ref_id=str(claim.id),
                note=resource.title[:120],
            )
            await gamification.award(
                db,
                claim_user,
                "claim.approve",
                ref_type="author_claim",
                ref_id=str(claim.id),
                points=20,
                note=resource.title[:120],
            )
    else:
        claim.status = "rejected"
        notify_title = f"认领未通过：{resource.title}"
        notify_body = "内容整理未能确认你与该作品的作者关系。如有异议，请通过申诉渠道联系站务组。"

    if body.note:
        claim.decision_note = body.note
        notify_body += f"\n内容整理备注：{body.note}"
    claim.decided_by = current_admin.id
    claim.decided_at = utcnow()

    await notifications.create(
        db,
        tenant_id=tenant_id,
        user_id=claim.user_id,
        type_="claim.decision",
        title=notify_title,
        body=notify_body,
        related_type="resource",
        related_id=str(claim.resource_id),
    )
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_admin.id,
            action="catalog.claim.decision",
            target_type="author_claim",
            target_id=str(claim.id),
            payload={
                "action": body.action,
                "resource_id": claim.resource_id,
                "user_id": claim.user_id,
            },
        )
    )
    await db.commit()
    return {"id": claim.id, "status": claim.status}


class AssignOwnerBody(BaseModel):
    user_id: int
    author_position: int | None = None


@router.post("/resources/{resource_id}/assign-owner")
async def assign_owner(
    resource_id: int,
    body: AssignOwnerBody,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """驳回后把某作者位直接绑给指定用户（逐位绑定，可多次调用）。

    - 设置 resource.owner_id = user_id（权威归属）；
    - 标记对应 author_position 为已认领，拷入该用户账号邮箱；
    - 每次写审计日志。
    """
    from app.domain.catalog.models import Resource

    tenant_id = require_tenant_id()
    resource = (
        await db.execute(
            select(Resource).where(Resource.id == resource_id, Resource.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")

    target = (
        await db.execute(select(User.email, User.username).where(User.id == body.user_id))
    ).first()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="目标用户不存在")
    target_email, target_username = target[0], target[1]

    resource.owner_id = body.user_id
    _mark_author_position_claimed(
        resource, body.author_position, body.user_id, target_email, target_username
    )
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_admin.id,
            action="catalog.resource.assign_owner",
            target_type="resource",
            target_id=str(resource_id),
            payload={"user_id": body.user_id, "author_position": body.author_position},
        )
    )
    await db.commit()
    return {
        "resource_id": resource_id,
        "owner_id": body.user_id,
        "author_position": body.author_position,
    }


class AuthorInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    affiliation: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=255)
    roles: list[str] = Field(default_factory=list)
    order: int = Field(ge=1)


class AuthorsEditBody(BaseModel):
    authors: list[AuthorInput] = Field(min_length=1)


def _validate_authors(authors: list[AuthorInput]) -> None:
    """校验：≥1 位；第一作者唯一；通讯作者唯一（允许留空）；order 连续唯一；
    通讯位 email 格式合法。"""
    orders = [a.order for a in authors]
    if sorted(orders) != list(range(1, len(authors) + 1)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="order 必须从 1 连续且唯一"
        )
    first = [a for a in authors if "first" in a.roles]
    if len(first) != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="必须有且仅有一位第一作者"
        )
    corr = [a for a in authors if "corresponding" in a.roles]
    if len(corr) > 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="通讯作者至多一位")
    import re

    for a in corr:
        if a.email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", a.email):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="通讯作者邮箱格式不合法"
            )


@router.put("/resources/{resource_id}/authors")
async def edit_resource_authors(
    resource_id: int,
    body: AuthorsEditBody,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """管理端编辑文章作者位（发布前）：保存 names + structured authors_meta。"""
    from app.domain.catalog.models import Resource

    tenant_id = require_tenant_id()
    resource = (
        await db.execute(
            select(Resource).where(Resource.id == resource_id, Resource.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")

    _validate_authors(body.authors)
    ordered = sorted(body.authors, key=lambda a: a.order)
    resource.authors = [a.name for a in ordered]
    prev_meta = list(resource.authors_meta or [])
    new_meta: list[dict[str, Any]] = []
    for i, a in enumerate(ordered):
        prior = prev_meta[i] if i < len(prev_meta) and isinstance(prev_meta[i], dict) else {}
        new_meta.append(
            {
                "name": a.name,
                "affiliation": a.affiliation,
                "email": a.email,
                "roles": [r for r in a.roles if r in ("first", "corresponding")]
                or (["first"] if i == 0 else []),
                # 保留既有认领状态（管理员手动改稿不剥夺已认领位）
                "claimed": bool(prior.get("claimed")),
                "user_id": prior.get("user_id"),
                "username": prior.get("username"),
            }
        )
    resource.authors_meta = new_meta
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_admin.id,
            action="catalog.resource.authors_edit",
            target_type="resource",
            target_id=str(resource_id),
            payload={"authors": [a.name for a in ordered]},
        )
    )
    await db.commit()
    return {"resource_id": resource_id, "authors": resource.authors}


@router.put("/submissions/{submission_id}/authors")
async def edit_submission_authors(
    submission_id: int,
    body: AuthorsEditBody,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """管理端编辑发布作者位（发布前）：保存到 submission.authors。"""
    from app.domain.submission.models import Submission

    tenant_id = require_tenant_id()
    sub = (
        await db.execute(
            select(Submission).where(
                Submission.id == submission_id, Submission.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    _validate_authors(body.authors)
    ordered = sorted(body.authors, key=lambda a: a.order)
    sub.authors = [a.name for a in ordered]
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_admin.id,
            action="catalog.submission.authors_edit",
            target_type="submission",
            target_id=str(submission_id),
            payload={"authors": [a.name for a in ordered]},
        )
    )
    await db.commit()
    return {"submission_id": submission_id, "authors": sub.authors}


def _alembic_head() -> str | None:
    """用 Alembic 自己的迁移图取 head。

    不能靠正则扫 ``down_revision``：历史迁移里既有元组（多父分支），
    也有重复 revision id；手写差集会漏父分支，把旧分支误判成 head。
    """
    root = Path(__file__).resolve().parents[2]
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        cfg = Config(str(root / "alembic.ini"))
        cfg.set_main_option("script_location", str(root / "alembic"))
        return ScriptDirectory.from_config(cfg).get_current_head()
    except Exception:
        # 迁移图异常时不猜 head，让健康页显示“未知”而不是错误版本。
        return None


@router.get("/editor/today")
async def editor_today(
    _editor: User = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Editor-in-chief Today: reuse the aggregate health snapshot.

    ``require_admin`` remains on the full management page; this route gives
    editors the same read-only aggregate without granting user management.
    """
    return await system_health(_admin=_editor, db=db)


@router.get("/system/health")
async def system_health(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """运营级健康总览：数据库、迁移、磁盘、积压、邮件与版本。

    只返回聚合数字与状态，不返回连接串、主机名、密钥等敏感信息。
    """
    started = time.perf_counter()
    db_revision = None
    counts: dict[str, int] = {}
    try:
        await db.execute(text("SELECT 1"))
        db_latency_ms = round((time.perf_counter() - started) * 1000, 1)
    except Exception:
        db_latency_ms = None

    # 迁移版本是独立检查：SQLite 演示库没有 alembic_version 表时，
    # 不能把“迁移未知”误报成“数据库连接失败”。
    if db_latency_ms is not None:
        try:
            row = (
                await db.execute(text("SELECT version_num FROM alembic_version"))
            ).scalar_one_or_none()
            db_revision = str(row) if row else None
        except Exception:
            db_revision = None
        table_queries = {
            "users": "SELECT count(*) FROM users",
            "resources": "SELECT count(*) FROM resources",
            "submissions": "SELECT count(*) FROM submissions",
        }
        for label, sql in table_queries.items():
            try:
                counts[label] = int((await db.execute(text(sql))).scalar_one())
            except Exception:
                counts[label] = -1

    # 轻量反作弊信号：只做聚合，不记录 IP、不暴露账号明细。
    # 24h 新用户暴增或积分集中发放时健康页转为“需关注”，
    # 便于人工复核；不是自动封禁。
    cutoff = datetime.now(UTC) - timedelta(hours=24)
    for key, sql in (
        (
            "new_users_24h",
            "SELECT count(*) FROM users WHERE created_at >= :cutoff",
        ),
        (
            "coin_issued_24h",
            "SELECT coalesce(sum(delta), 0) FROM point_events "
            "WHERE identity = 'coin' AND delta > 0 AND created_at >= :cutoff",
        ),
    ):
        try:
            counts[key] = int((await db.execute(text(sql), {"cutoff": cutoff})).scalar_one())
        except Exception:
            counts[key] = -1

    pending_reports = 0
    pending_comments = 0
    try:
        pending_reports = int(
            (
                await db.execute(text("SELECT count(*) FROM forum_reports WHERE status = 'open'"))
            ).scalar_one()
        )
    except Exception:
        pending_reports = -1
    try:
        pending_comments = int(
            (
                await db.execute(text("SELECT count(*) FROM comments WHERE status = 'pending'"))
            ).scalar_one()
        )
    except Exception:
        pending_comments = -1

    # Forum review backlog + SLA overrun + notification failure rate.
    # These are operational leading indicators: a queue that grows quietly
    # eventually becomes an author-visible delay.
    forum_manual_review_pending = 0
    forum_sla_overdue = 0
    try:
        forum_manual_review_pending = int(
            (
                await db.execute(
                    text(
                        "SELECT count(*) FROM forum_topics "
                        "WHERE moderation_status = 'manual_review' AND deleted_at IS NULL"
                    )
                )
            ).scalar_one()
        )
        forum_sla_overdue = int(
            (
                await db.execute(
                    text(
                        "SELECT count(*) FROM forum_topics "
                        "WHERE moderation_status = 'manual_review' AND deleted_at IS NULL "
                        "AND review_eta_at IS NOT NULL AND review_eta_at < CURRENT_TIMESTAMP"
                    )
                )
            ).scalar_one()
        )
    except Exception:
        forum_manual_review_pending = -1
        forum_sla_overdue = -1
    notification_failures_24h = 0
    notification_sent_24h = 0
    try:
        notification_failures_24h = int(
            (
                await db.execute(
                    text(
                        "SELECT count(*) FROM email_digest_records "
                        "WHERE status = 'failed' AND created_at >= :cutoff"
                    ),
                    {"cutoff": cutoff},
                )
            ).scalar_one()
        )
        notification_sent_24h = int(
            (
                await db.execute(
                    text(
                        "SELECT count(*) FROM email_digest_records "
                        "WHERE status = 'sent' AND created_at >= :cutoff"
                    ),
                    {"cutoff": cutoff},
                )
            ).scalar_one()
        )
    except Exception:
        notification_failures_24h = -1
        notification_sent_24h = -1

    try:
        disk = shutil.disk_usage("/")
        disk_free_gb = round(disk.free / (1024**3), 1)
        disk_used_pct = round(disk.used / disk.total * 100, 1)
    except Exception:
        disk_free_gb = None
        disk_used_pct = None

    head = _alembic_head()
    migration_ok = bool(head and db_revision and head == db_revision)
    smtp_ok = False
    try:
        from app.core.email import smtp_configured

        smtp_ok = smtp_configured()
    except Exception:
        smtp_ok = False

    backup_status = "warn"
    backup_detail = "未配置 RUBBISH_BACKUP_DIR"
    backup_dir = (settings.backup_dir or "").strip()
    if backup_dir:
        try:
            entries = [entry for entry in os.scandir(backup_dir) if entry.is_file()]
            db_files = sorted(
                (
                    entry
                    for entry in entries
                    if entry.name.startswith("db-")
                    and entry.name.endswith((".dump", ".sql", ".sql.gz"))
                ),
                key=lambda entry: entry.stat().st_mtime,
            )
            upload_files = sorted(
                (
                    entry
                    for entry in entries
                    if entry.name.startswith("uploads-") and entry.name.endswith(".tar.gz")
                ),
                key=lambda entry: entry.stat().st_mtime,
            )
            if not db_files or not upload_files:
                backup_detail = "备份目录缺少 DB dump 或 uploads 归档"
            else:
                now_ts = time.time()
                db_age = (now_ts - db_files[-1].stat().st_mtime) / 3600
                up_age = (now_ts - upload_files[-1].stat().st_mtime) / 3600
                max_age = max(db_age, up_age)
                backup_status = "ok" if max_age <= settings.backup_max_age_hours else "warn"
                backup_detail = (
                    f"DB {db_files[-1].name}（{db_age:.1f}h） · "
                    f"uploads {upload_files[-1].name}（{up_age:.1f}h）"
                )
        except PermissionError:
            backup_detail = "备份目录存在，但当前应用用户无读取权限"
        except Exception:
            backup_detail = "备份目录无法读取"

    from app.domain.release.scheduler import (
        TICK_SECONDS as RELEASE_TICK,
    )
    from app.domain.release.scheduler import release_scheduler_state
    from app.domain.workflow_scheduler import (
        TICK_SECONDS as WORKFLOW_TICK,
    )
    from app.domain.workflow_scheduler import workflow_scheduler_state

    def _scheduler_check(
        key: str, label: str, state: dict[str, Any], tick_seconds: int
    ) -> dict[str, Any]:
        if settings.is_test:
            return {
                "key": key,
                "label": label,
                "status": "ok",
                "detail": "测试环境不启动后台调度器",
            }
        if not settings.scheduler_enabled:
            return {
                "key": key,
                "label": label,
                "status": "warn",
                "detail": "调度器已被 RUBBISH_SCHEDULER_ENABLED 关闭",
            }
        if not state.get("task_alive"):
            return {
                "key": key,
                "label": label,
                "status": "fail",
                "detail": "后台任务未运行",
            }
        if not state.get("leader"):
            # The workflow scheduler intentionally waits a few minutes before
            # its first tick. Do not turn that startup grace into a red health
            # check on every deploy; only warn after the window has passed.
            started = state.get("started_at")
            if started is not None:
                startup_age = max((datetime.now(UTC) - started).total_seconds(), 0)
                if startup_age < settings.scheduler_startup_delay_seconds + 30:
                    return {
                        "key": key,
                        "label": label,
                        "status": "ok",
                        "detail": "已启动，等待首个调度窗口",
                    }
            return {
                "key": key,
                "label": label,
                "status": "warn",
                "detail": "等待选主：当前实例不是调度器主节点",
            }
        last_success = state.get("last_success_at")
        if last_success is None:
            return {
                "key": key,
                "label": label,
                "status": "ok",
                "detail": "已启动，等待首轮",
            }
        age_seconds = max((datetime.now(UTC) - last_success).total_seconds(), 0)
        stale_after = max(tick_seconds * 2, 10 * 60)
        if state.get("last_error"):
            return {
                "key": key,
                "label": label,
                "status": "warn",
                "detail": f"上轮有失败：{str(state['last_error'])[:120]}",
            }
        if age_seconds > stale_after:
            return {
                "key": key,
                "label": label,
                "status": "fail",
                "detail": f"已 {age_seconds / 60:.0f} 分钟未成功运行",
            }
        stats = state.get("last_stats") or {}
        return {
            "key": key,
            "label": label,
            "status": "ok",
            "detail": f"{age_seconds / 60:.1f} 分钟前成功 · {stats}",
        }

    from app.core.antivirus import antivirus_health
    from app.core.rate_limit_store import rate_limiter_health

    limiter = await rate_limiter_health()
    scanner = await antivirus_health()
    virus_check = {
        "key": "virus_scan",
        "label": "上传安全扫描",
        "status": scanner["status"],
        "detail": str(scanner["detail"]),
    }
    rate_limit_check = {
        "key": "rate_limit",
        "label": "全局限流",
        "status": "ok" if limiter["ok"] else "warn",
        "detail": str(limiter["detail"]),
    }
    soffice_path = shutil.which("soffice")
    document_export_check = {
        "key": "document_export",
        "label": "文档转换",
        "status": "ok" if soffice_path else "fail",
        "detail": "LibreOffice 可用" if soffice_path else "缺少 soffice，Word→PDF 下载会失败",
    }

    # External cron is the only layer that can catch a dead site while the
    # process is still up. Its heartbeat is the log mtime written every five
    # minutes; an old file means the job is installed but not actually running.
    automation_log = os.environ.get("RUBBISH_HEALTH_LOG", "/var/log/rubbish-health.log")
    if settings.is_test:
        automation_check = {
            "key": "automation",
            "label": "站点巡检",
            "status": "ok",
            "detail": "测试环境不检查外部 cron",
        }
    elif not os.path.exists(automation_log):  # noqa: ASYNC240 - one stat, not a blocking read
        automation_check = {
            "key": "automation",
            "label": "站点巡检",
            "status": "warn",
            "detail": "未发现 /var/log/rubbish-health.log，外部 cron 可能未安装",
        }
    else:
        age_minutes = max((time.time() - os.path.getmtime(automation_log)) / 60, 0)  # noqa: ASYNC240
        automation_check = {
            "key": "automation",
            "label": "站点巡检",
            "status": "ok" if age_minutes <= 15 else "warn",
            "detail": f"最近心跳 {age_minutes:.1f} 分钟前"
            if age_minutes <= 15
            else f"日志已 {age_minutes:.0f} 分钟未更新，检查 cron",
        }

    counts["forum_manual_review_pending"] = forum_manual_review_pending
    counts["forum_sla_overdue"] = forum_sla_overdue
    counts["notification_failures_24h"] = notification_failures_24h
    counts["notification_sent_24h"] = notification_sent_24h

    scheduler_checks = [
        _scheduler_check(
            "release_scheduler", "定时发布调度器", release_scheduler_state(), RELEASE_TICK
        ),
        _scheduler_check(
            "workflow_scheduler", "工作流调度器", workflow_scheduler_state(), WORKFLOW_TICK
        ),
    ]

    checks = [
        {
            "key": "backup",
            "label": "最近备份",
            "status": backup_status,
            "detail": backup_detail,
        },
        automation_check,
        {
            "key": "database",
            "label": "数据库",
            "status": "ok" if db_latency_ms is not None else "fail",
            "detail": f"{db_latency_ms} ms" if db_latency_ms is not None else "连接失败",
        },
        {
            "key": "migration",
            "label": "数据库迁移",
            "status": "ok" if migration_ok else "warn",
            "detail": f"库 {db_revision or '未知'} / 代码 {head or '未知'}",
        },
        {
            "key": "disk",
            "label": "磁盘",
            "status": "ok" if disk_used_pct is not None and disk_used_pct < 85 else "warn",
            "detail": f"已用 {disk_used_pct}% · 剩余 {disk_free_gb} GB"
            if disk_used_pct is not None
            else "无法读取",
        },
        {
            "key": "reports",
            "label": "待处置举报",
            "status": "ok" if pending_reports == 0 else "warn",
            "detail": f"{pending_reports} 条",
        },
        {
            "key": "comments",
            "label": "待审评论",
            "status": "ok" if pending_comments == 0 else "warn",
            "detail": f"{pending_comments} 条",
        },
        {
            "key": "forum_queue",
            "label": "审核队列",
            "status": "warn" if forum_manual_review_pending > 0 or forum_sla_overdue > 0 else "ok",
            "detail": f"待核验 {forum_manual_review_pending} 条 · SLA 超时 {forum_sla_overdue} 条",
        },
        {
            "key": "notification_email",
            "label": "通知邮件（24h）",
            "status": "warn"
            if notification_failures_24h < 0
            or notification_sent_24h < 0
            or notification_failures_24h > 0
            or (
                notification_sent_24h + notification_failures_24h > 0
                and notification_failures_24h / (notification_sent_24h + notification_failures_24h)
                > 0.05
            )
            else "ok",
            "detail": f"失败 {notification_failures_24h} · 成功 {notification_sent_24h}"
            if notification_failures_24h >= 0 and notification_sent_24h >= 0
            else "无法读取邮件审计表",
        },
        {
            "key": "email",
            "label": "邮件通道",
            "status": "ok" if smtp_ok and settings.email_outbound_enabled else "warn",
            "detail": "已配置并启用"
            if smtp_ok and settings.email_outbound_enabled
            else ("已配置但未启用" if smtp_ok else "未配置 SMTP，仅站内通知"),
        },
        virus_check,
        rate_limit_check,
        document_export_check,
        *scheduler_checks,
        {
            "key": "anomaly",
            "label": "异常频率（24h）",
            "status": "warn"
            if counts.get("new_users_24h", 0) >= 20 or counts.get("coin_issued_24h", 0) >= 5000
            else "ok",
            "detail": f"新用户 {counts.get('new_users_24h', -1)} · "
            f"发放积分 {counts.get('coin_issued_24h', -1)}",
        },
    ]
    overall = (
        "fail"
        if any(c["status"] == "fail" for c in checks)
        else ("warn" if any(c["status"] == "warn" for c in checks) else "ok")
    )
    return {
        "status": overall,
        "version": __version__,
        "db_revision": db_revision,
        "code_revision": head,
        "db_latency_ms": db_latency_ms,
        "counts": counts,
        "disk_free_gb": disk_free_gb,
        "disk_used_pct": disk_used_pct,
        "load_1m": round(os.getloadavg()[0], 2) if hasattr(os, "getloadavg") else None,
        "uptime_seconds": int(time.monotonic()),
        "checks": checks,
    }
