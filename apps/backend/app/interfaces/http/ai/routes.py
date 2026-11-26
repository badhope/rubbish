"""Personal API tokens, the MCP tool gateway and a remote MCP endpoint.

Auth model:
- `/api/ai/tokens/*`, `/api/ai/capabilities` use the normal browser session.
- Tool calls use a personal `rbk_...` token and never accept a password.
- `/api/mcp` speaks JSON-RPC 2.0 so a remote MCP client can use one URL.

The token is not a second permission system: every tool handler calls the
same domain route as the UI, so role gates, rules acknowledgement, moderation,
similarity checks, quality thresholds, snapshots and audit all still run.
"""

from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import effective_permission_role, get_current_user, require_tenant_id
from app.core.db import get_db
from app.core.time import utcnow
from app.interfaces.http.ai.scopes import (
    ALL_SCOPES,
    SCOPE_LABELS,
    TOKEN_PREFIX,
    TokenIdentity,
    allowed_scopes_for_user,
    effective_scopes,
    get_api_token_identity,
    normalize_requested_scopes,
    require_scope,
    scopes_for_role,
    token_hash,
)
from app.interfaces.http.ai.tools import ToolContext, execute_tool, tools_for_scopes
from app.models import ApiToken, AuditLog, User

router = APIRouter(prefix="/ai", tags=["ai"])
mcp_router = APIRouter(prefix="/mcp", tags=["mcp"])

PROTOCOL_VERSION = "2024-11-05"
SERVER_VERSION = "1.20.0"


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    scopes: list[str] | None = None
    expires_days: int = Field(default=90, ge=7, le=365)


class TokenUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    scopes: list[str] | None = None


class ToolCallBody(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


def _token_row(token: ApiToken) -> dict[str, Any]:
    now = utcnow()
    revoked = token.revoked_at is not None
    expired = token.expires_at is not None and token.expires_at <= now
    return {
        "id": token.id,
        "name": token.name,
        "prefix": token.token_prefix,
        "scopes": effective_scopes(token.scopes),
        "created_at": token.created_at,
        "last_used_at": token.last_used_at,
        "expires_at": token.expires_at,
        "revoked_at": token.revoked_at,
        "status": "revoked" if revoked else ("expired" if expired else "active"),
        "request_count": token.request_count,
    }


def _audit(db: AsyncSession, user: User, action: str, token_id: int, payload: dict[str, Any]) -> None:
    db.add(
        AuditLog(
            tenant_id=user.tenant_id,
            actor_user_id=user.id,
            action=action,
            target_type="api_token",
            target_id=str(token_id),
            payload=payload,
        )
    )


@router.get("/capabilities")
async def capabilities(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    role = await effective_permission_role(db, current_user)
    allowed = scopes_for_role(role)
    base = str(request.base_url).rstrip("/")
    return {
        "permission_role": role,
        "allowed_scopes": [{"scope": scope, "label": SCOPE_LABELS[scope]} for scope in allowed],
        "all_scopes": [{"scope": scope, "label": SCOPE_LABELS[scope]} for scope in ALL_SCOPES],
        "remote_mcp_url": f"{base}/api/mcp",
        "transport": "streamable-http-json",
        "protocol_version": PROTOCOL_VERSION,
        "auth": "Authorization: Bearer rbk_... 或 X-API-Key: rbk_...",
        "tools_count": len(tools_for_scopes(allowed)),
    }


@router.get("/tokens")
async def list_tokens(
    include_revoked: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id = require_tenant_id()
    stmt = select(ApiToken).where(
        ApiToken.tenant_id == tenant_id,
        ApiToken.user_id == current_user.id,
    )
    if not include_revoked:
        stmt = stmt.where(ApiToken.revoked_at.is_(None))
    rows = (await db.execute(stmt.order_by(ApiToken.id.desc()))).scalars().all()
    return {"data": [_token_row(row) for row in rows], "count": len(rows)}


@router.post("/tokens", status_code=status.HTTP_201_CREATED)
async def create_token(
    body: TokenCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id = require_tenant_id()
    role = await effective_permission_role(db, current_user)
    allowed = await allowed_scopes_for_user(db, current_user)
    try:
        scopes = normalize_requested_scopes(body.scopes, allowed)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not scopes:
        raise HTTPException(status_code=422, detail="至少选择一个作用域")
    raw = TOKEN_PREFIX + secrets.token_urlsafe(36)
    row = ApiToken(
        tenant_id=tenant_id,
        user_id=current_user.id,
        name=body.name.strip(),
        token_hash=token_hash(raw),
        token_prefix=raw[:12],
        scopes=" ".join(scopes),
        expires_at=utcnow() + timedelta(days=body.expires_days),
    )
    db.add(row)
    await db.flush()
    _audit(db, current_user, "ai.token.create", row.id, {"scopes": scopes, "role": role})
    await db.commit()
    await db.refresh(row)
    return {
        "token": raw,
        "warning": "明文只显示这一次；服务端只保存 SHA-256。",
        **(await _token_detail(row, current_user, db)),
    }


async def _token_detail(row: ApiToken, user: User, db: AsyncSession) -> dict[str, Any]:
    require_tenant_id()
    allowed = await allowed_scopes_for_user(db, user)
    return {
        "id": row.id,
        "name": row.name,
        "prefix": row.token_prefix,
        "scopes": effective_scopes(row.scopes),
        "allowed_scopes": allowed,
        "expires_at": row.expires_at,
    }


@router.patch("/tokens/{token_id}")
async def update_token(
    token_id: int,
    body: TokenUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id = require_tenant_id()
    row = (
        await db.execute(
            select(ApiToken).where(
                ApiToken.id == token_id,
                ApiToken.tenant_id == tenant_id,
                ApiToken.user_id == current_user.id,
                ApiToken.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Token 不存在或已撤销")
    allowed = await allowed_scopes_for_user(db, current_user)
    if body.name is not None:
        row.name = body.name.strip()
    if body.scopes is not None:
        try:
            scopes = normalize_requested_scopes(body.scopes, allowed)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not scopes:
            raise HTTPException(status_code=422, detail="至少保留一个作用域")
        row.scopes = " ".join(scopes)
    _audit(db, current_user, "ai.token.update", row.id, {"scopes": effective_scopes(row.scopes)})
    await db.commit()
    await db.refresh(row)
    return await _token_detail(row, current_user, db)


@router.delete("/tokens/{token_id}")
async def revoke_token(
    token_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id = require_tenant_id()
    row = (
        await db.execute(
            select(ApiToken).where(
                ApiToken.id == token_id,
                ApiToken.tenant_id == tenant_id,
                ApiToken.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Token 不存在")
    if row.revoked_at is None:
        row.revoked_at = utcnow()
        _audit(db, current_user, "ai.token.revoke", row.id, {"prefix": row.token_prefix})
        await db.commit()
    return {"id": row.id, "revoked": True}


@router.get("/me")
async def me(identity: TokenIdentity = Depends(get_api_token_identity)) -> dict[str, Any]:
    return {
        "user": {
            "id": identity.user.id,
            "username": identity.user.username,
            "display_name": identity.user.display_name,
        },
        "token": {
            "id": identity.token.id,
            "name": identity.token.name,
            "prefix": identity.token.token_prefix,
            "scopes": identity.scopes,
        },
        "rules": {
            "current_version": identity.user.rules_ack_version,
        },
    }


@router.get("/tools")
async def list_tools(
    identity: TokenIdentity = Depends(get_api_token_identity),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    role = await effective_permission_role(db, identity.user)
    return {"tools": tools_for_scopes(identity.scopes, role)}


@router.post("/tools/call")
async def call_tool(
    body: ToolCallBody,
    identity: TokenIdentity = Depends(get_api_token_identity),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ctx = ToolContext(identity=identity, db=db)
    return await execute_tool(ctx, body.name, body.arguments)


# ---------------------------------------------------------------------------
# Compatibility with the first MCP bridge.  The stdio client used these two
# paths; keeping them means old local configs do not silently break.
# -------------------------------------------------------------------------


@router.post("/submissions", status_code=status.HTTP_201_CREATED)
async def legacy_submit(
    request: Request,
    identity: TokenIdentity = Depends(require_scope("submission:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="请求体必须是 JSON 对象")
    arguments = dict(payload)
    # 不替调用方补 confirm / idempotency_key：这两个字段是投稿的两个
    # 硬闸门，兼容层也不能代替用户或模型做真实写操作决定。
    result = await execute_tool(ToolContext(identity=identity, db=db), "submit_paper", arguments)
    if result.get("isError"):
        raise HTTPException(status_code=400, detail=result)
    return {"submission": result["content"][0]["text"]}


@router.get("/submissions")
async def legacy_list(
    identity: TokenIdentity = Depends(require_scope("submission:read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await execute_tool(ToolContext(identity=identity, db=db), "list_my_submissions", {})
    return {"submissions": result["content"][0]["text"]}


# ---------------------------------------------------------------------------
# Remote MCP (JSON-RPC 2.0, streamable HTTP JSON responses)
# ---------------------------------------------------------------------------


def _rpc_error(request_id: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": error}


def _rpc_result(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


@mcp_router.post("")
async def mcp_endpoint(
    request: Request,
    identity: TokenIdentity = Depends(get_api_token_identity),
    db: AsyncSession = Depends(get_db),
) -> Response:
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(_rpc_error(None, -32700, "Parse error"), status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse(_rpc_error(None, -32600, "Invalid Request"), status_code=400)
    method = payload.get("method")
    request_id = payload.get("id")
    params = payload.get("params") or {}
    if not isinstance(method, str):
        return JSONResponse(_rpc_error(request_id, -32600, "Invalid Request"), status_code=400)
    if request_id is None and method.startswith("notifications/"):
        return Response(status_code=202)

    if method == "initialize":
        return JSONResponse(
            _rpc_result(
                request_id,
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "rubbish-mcp", "version": SERVER_VERSION},
                    "instructions": (
                        "Rubbish 学术社区 MCP。先 get_context / get_editorial_rules；"
                        "投稿前 preflight_submission；审稿用 get_review_task 与 submit_review_report；"
                        "编辑决定必须带 expected_status 与 expected_latest_version。"
                    ),
                },
            )
        )
    if method == "ping":
        return JSONResponse(_rpc_result(request_id, {}))
    if method == "tools/list":
        role = await effective_permission_role(db, identity.user)
        return JSONResponse(_rpc_result(request_id, {"tools": tools_for_scopes(identity.scopes, role)}))
    if method == "tools/call":
        name = params.get("name") if isinstance(params, dict) else None
        arguments = params.get("arguments") if isinstance(params, dict) else None
        if not isinstance(name, str):
            return JSONResponse(_rpc_error(request_id, -32602, "tools/call 缺少 name"), status_code=400)
        result = await execute_tool(ToolContext(identity=identity, db=db), name, arguments or {})
        return JSONResponse(_rpc_result(request_id, result))
    if method in ("resources/list", "prompts/list"):
        key = "resources" if method.startswith("resources") else "prompts"
        return JSONResponse(_rpc_result(request_id, {key: []}))
    return JSONResponse(_rpc_error(request_id, -32601, f"Method not found: {method}"), status_code=200)


@mcp_router.get("")
async def mcp_get() -> Response:
    return JSONResponse(
        {"detail": "This MCP endpoint accepts JSON-RPC POST; SSE is not enabled."},
        status_code=405,
        headers={"Allow": "POST"},
    )
