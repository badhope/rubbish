"""API Token scopes and the MCP request identity.

A token never carries more authority than its owner.  Scope sets are derived
from the five-level permission axis (user < reviewer < editor <
editor_in_chief); callers may request a subset, never a superset.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import effective_permission_role, require_tenant_id
from app.core.db import get_db
from app.core.time import utcnow
from app.models import ApiToken, User

TOKEN_PREFIX = "rbk_"

SCOPE_PROFILE_READ = "profile:read"
SCOPE_SUBMISSION_READ = "submission:read"
SCOPE_SUBMISSION_WRITE = "submission:write"
SCOPE_REVIEW_READ = "review:read"
SCOPE_REVIEW_WRITE = "review:write"
SCOPE_EDITORIAL_READ = "editorial:read"
SCOPE_EDITORIAL_TRIAGE = "editorial:triage"
SCOPE_EDITORIAL_DECIDE = "editorial:decide"

ALL_SCOPES: tuple[str, ...] = (
    SCOPE_PROFILE_READ,
    SCOPE_SUBMISSION_READ,
    SCOPE_SUBMISSION_WRITE,
    SCOPE_REVIEW_READ,
    SCOPE_REVIEW_WRITE,
    SCOPE_EDITORIAL_READ,
    SCOPE_EDITORIAL_TRIAGE,
    SCOPE_EDITORIAL_DECIDE,
)

AUTHOR_SCOPES: tuple[str, ...] = (
    SCOPE_PROFILE_READ,
    SCOPE_SUBMISSION_READ,
    SCOPE_SUBMISSION_WRITE,
)
REVIEWER_SCOPES: tuple[str, ...] = (
    *AUTHOR_SCOPES,
    SCOPE_REVIEW_READ,
    SCOPE_REVIEW_WRITE,
)
EDITOR_SCOPES: tuple[str, ...] = (
    *REVIEWER_SCOPES,
    SCOPE_EDITORIAL_READ,
    SCOPE_EDITORIAL_TRIAGE,
)
CHIEF_SCOPES: tuple[str, ...] = (
    *EDITOR_SCOPES,
    SCOPE_EDITORIAL_DECIDE,
)

ROLE_SCOPES: dict[str, tuple[str, ...]] = {
    "user": AUTHOR_SCOPES,
    "reviewer": REVIEWER_SCOPES,
    "editor": EDITOR_SCOPES,
    "editor_in_chief": CHIEF_SCOPES,
}

SCOPE_LABELS: dict[str, str] = {
    SCOPE_PROFILE_READ: "读取账号与规则状态",
    SCOPE_SUBMISSION_READ: "读取自己的投稿",
    SCOPE_SUBMISSION_WRITE: "投稿、改稿、重投、撤稿",
    SCOPE_REVIEW_READ: "读取分配到的互评任务",
    SCOPE_REVIEW_WRITE: "接受/拒绝邀请、提交互评",
    SCOPE_EDITORIAL_READ: "读取内容台队列与工作台",
    SCOPE_EDITORIAL_TRIAGE: "基础检查、分派互评",
    SCOPE_EDITORIAL_DECIDE: "终审决定与发表",
}

# 旧 Token 只写了 submission:write / profile:read。读是写的自然前提，
# 老 Token 不应因为新增“读取自己的投稿”作用域而被静默锁死。
_IMPLIED_BY_WRITE: dict[str, str] = {
    SCOPE_SUBMISSION_WRITE: SCOPE_SUBMISSION_READ,
    SCOPE_REVIEW_WRITE: SCOPE_REVIEW_READ,
    SCOPE_EDITORIAL_TRIAGE: SCOPE_EDITORIAL_READ,
    SCOPE_EDITORIAL_DECIDE: SCOPE_EDITORIAL_READ,
}


def split_scopes(raw: str | None) -> list[str]:
    return [part for part in (raw or "").split() if part in ALL_SCOPES]


def effective_scopes(raw: str | None) -> list[str]:
    scopes = set(split_scopes(raw))
    for write_scope, read_scope in _IMPLIED_BY_WRITE.items():
        if write_scope in scopes:
            scopes.add(read_scope)
    return [scope for scope in ALL_SCOPES if scope in scopes]


def scopes_for_role(role: str) -> list[str]:
    return list(ROLE_SCOPES.get(role, AUTHOR_SCOPES))


def normalize_requested_scopes(requested: list[str] | None, allowed: list[str]) -> list[str]:
    """Keep only allowed scopes; empty request means the role maximum."""
    if requested is None:
        return list(allowed)
    unknown = [scope for scope in requested if scope not in ALL_SCOPES]
    if unknown:
        raise ValueError(f"未知作用域：{', '.join(unknown)}")
    forbidden = [scope for scope in requested if scope not in allowed]
    if forbidden:
        raise ValueError(f"当前身份不能授权这些作用域：{', '.join(forbidden)}")
    # Deduplicate but keep the canonical order.
    chosen = set(requested)
    return [scope for scope in ALL_SCOPES if scope in chosen]


def token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def normalize_dt(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def extract_raw_token(request: Request, x_api_key: str | None) -> str:
    if x_api_key and x_api_key.strip():
        return x_api_key.strip()
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


@dataclass
class TokenIdentity:
    user: User
    token: ApiToken
    scopes: list[str]

    def has(self, *required: str) -> bool:
        return all(scope in self.scopes for scope in required)


async def get_api_token_identity(
    request: Request,
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
    db: AsyncSession = Depends(get_db),
) -> TokenIdentity:
    """Resolve a personal API token; never accepts account passwords."""
    raw = extract_raw_token(request, x_api_key)
    if not raw.startswith(TOKEN_PREFIX):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "api_token_required",
                "message": "需要个人 API Token（设置 → AI 接入 创建），不接受账号密码。",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )
    tenant_id = require_tenant_id()
    now = utcnow()
    token = (
        await db.execute(
            select(ApiToken).where(
                ApiToken.tenant_id == tenant_id,
                ApiToken.token_hash == token_hash(raw),
                ApiToken.revoked_at.is_(None),
                or_(ApiToken.expires_at.is_(None), ApiToken.expires_at > now),
            )
        )
    ).scalar_one_or_none()
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "api_token_invalid", "message": "Token 无效、已撤销或已过期。"},
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = (
        await db.execute(
            select(User).where(
                User.id == token.user_id,
                User.tenant_id == tenant_id,
                User.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "account_disabled", "message": "Token 所属账号已停用。"},
        )
    scopes = effective_scopes(token.scopes)
    token.last_used_at = now
    token.request_count = (token.request_count or 0) + 1
    await db.commit()
    return TokenIdentity(user=user, token=token, scopes=scopes)


def require_scope(*required: str) -> Callable[..., Any]:
    async def _guard(identity: TokenIdentity = Depends(get_api_token_identity)) -> TokenIdentity:
        missing = [scope for scope in required if scope not in identity.scopes]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "missing_scope",
                    "required": list(required),
                    "missing": missing,
                    "message": f"Token 缺少作用域：{', '.join(missing)}。请到设置 → AI 接入重新授权。",
                },
            )
        return identity

    return _guard


async def allowed_scopes_for_user(db: AsyncSession, user: User) -> list[str]:
    role = await effective_permission_role(db, user)
    return scopes_for_role(role)
