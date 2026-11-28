"""Personal API token + MCP gateway tests.

These cover the regression that removed the old `/api/ai` router: a token
must pass the login wall, the tool list must be filtered by scopes, and the
MCP submit path must create a real v1 snapshot with the manuscript body.
"""

from __future__ import annotations

import secrets
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.domain.submission.models import Submission, SubmissionVersion
from app.interfaces.http.ai.scopes import token_hash
from app.models import ApiToken, Tenant, User


async def _tenant(db: AsyncSession) -> Tenant:
    return (await db.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()


async def _token(
    db: AsyncSession,
    user_id: int,
    scopes: str,
    name: str = "test-mcp",
) -> str:
    tenant = await _tenant(db)
    raw = "rbk_" + secrets.token_urlsafe(36)
    db.add(
        ApiToken(
            tenant_id=tenant.id,
            user_id=user_id,
            name=name,
            token_hash=token_hash(raw),
            token_prefix=raw[:12],
            scopes=scopes,
            expires_at=utcnow() + timedelta(days=1),
        )
    )
    await db.commit()
    return raw


async def _user(db: AsyncSession, user_id: int) -> User:
    return await db.get(User, user_id)


@pytest.mark.asyncio
async def test_mcp_accepts_rbk_before_auth_wall(
    client: AsyncClient, db_session: AsyncSession, test_user: dict
) -> None:
    raw = await _token(
        db_session, test_user["user_id"], "profile:read submission:read submission:write"
    )
    init = await client.post(
        "/api/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "t", "version": "1"},
            },
        },
        headers={"Authorization": f"Bearer {raw}"},
    )
    assert init.status_code == 200, init.text
    body = init.json()
    assert body["result"]["serverInfo"]["name"] == "rubbish-mcp"
    assert body["result"]["protocolVersion"] == "2024-11-05"

    anonymous = await client.post("/api/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "ping"})
    assert anonymous.status_code == 401, anonymous.text


@pytest.mark.asyncio
async def test_auth_wall_allows_x_api_key_for_mcp(
    client: AsyncClient, db_session: AsyncSession, test_user: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "auth_wall_enabled", True)
    raw = await _token(db_session, test_user["user_id"], "profile:read")
    init = await client.post(
        "/api/mcp",
        json={"jsonrpc": "2.0", "id": 11, "method": "initialize", "params": {}},
        headers={"X-API-Key": raw},
    )
    assert init.status_code == 200, init.text
    missing = await client.post(
        "/api/mcp", json={"jsonrpc": "2.0", "id": 12, "method": "initialize", "params": {}}
    )
    assert missing.status_code == 401, missing.text


@pytest.mark.asyncio
async def test_tools_are_filtered_by_role_and_scope(
    client: AsyncClient, db_session: AsyncSession, test_user: dict
) -> None:
    raw = await _token(
        db_session, test_user["user_id"], "profile:read submission:read submission:write"
    )
    listed = await client.post(
        "/api/mcp",
        json={"jsonrpc": "2.0", "id": 3, "method": "tools/list"},
        headers={"Authorization": f"Bearer {raw}"},
    )
    assert listed.status_code == 200, listed.text
    names = {tool["name"] for tool in listed.json()["result"]["tools"]}
    assert "submit_paper" in names
    assert "submit_review_report" not in names
    assert "decide_submission" not in names

    denied = await client.post(
        "/api/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"name": "submit_review_report", "arguments": {"assignment_id": 1}},
        },
        headers={"Authorization": f"Bearer {raw}"},
    )
    assert denied.status_code == 200, denied.text
    result = denied.json()["result"]
    assert result["isError"] is True
    assert result["content"][0]["text"].startswith("{")


@pytest.mark.asyncio
async def test_token_cannot_exceed_role(
    client: AsyncClient, db_session: AsyncSession, test_user: dict
) -> None:
    response = await client.post(
        "/api/ai/tokens",
        json={"name": "越权", "scopes": ["profile:read", "editorial:decide"], "expires_days": 30},
        headers={"Authorization": f"Bearer {test_user['token']}"},
    )
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_submit_paper_writes_v1_body_and_is_idempotent(
    client: AsyncClient, db_session: AsyncSession, test_user: dict
) -> None:
    raw = await _token(
        db_session, test_user["user_id"], "profile:read submission:read submission:write"
    )
    # AI 不能凭默认替用户勾选规范；必须先显式确认。
    ack = await client.post(
        "/api/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "acknowledge_rules",
                "arguments": {"rules_version": "2.0", "confirm": True},
            },
        },
        headers={"Authorization": f"Bearer {raw}"},
    )
    assert ack.json()["result"]["isError"] is False, ack.text

    args = {
        "title": "一篇用来验证 MCP 投稿快照的短文",
        "type": "paper",
        "authors": ["测试作者"],
        "year": 2026,
        "discipline": "computer-science",
        "abstract": "这是一段足够长的摘要，用来验证 MCP 投稿不会丢失首版正文，也验证 idempotency_key 重复提交时不会产生第二篇。",
        "keywords": ["MCP", "投稿", "快照"],
        "body_markdown": "# 正文\n\n"
        + ("这是正文内容。" * 20)
        + "\n\n## 结论\n\n快照应该包含这一段。",
        "confirm": True,
        "idempotency_key": "test-mcp-idem-001",
    }
    first = await client.post(
        "/api/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": {"name": "submit_paper", "arguments": args},
        },
        headers={"Authorization": f"Bearer {raw}"},
    )
    first_result = first.json()["result"]
    assert first_result["isError"] is False, first.text
    submission_id = int(__import__("json").loads(first_result["content"][0]["text"])["id"])

    row = (
        await db_session.execute(select(Submission).where(Submission.id == submission_id))
    ).scalar_one()
    assert row.source == "ai"
    assert row.client_ref == "test-mcp-idem-001"
    assert row.markdown_path

    versions = (
        (
            await db_session.execute(
                select(SubmissionVersion)
                .where(SubmissionVersion.submission_id == submission_id)
                .order_by(SubmissionVersion.version)
            )
        )
        .scalars()
        .all()
    )
    assert versions[0].version == 1
    assert "快照应该包含这一段" in (versions[0].body or "")

    replay = await client.post(
        "/api/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/call",
            "params": {"name": "submit_paper", "arguments": args},
        },
        headers={"Authorization": f"Bearer {raw}"},
    )
    replay_result = replay.json()["result"]
    assert replay_result["isError"] is False, replay.text
    replay_id = int(__import__("json").loads(replay_result["content"][0]["text"])["id"])
    assert replay_id == submission_id


@pytest.mark.asyncio
async def test_legacy_ai_submissions_route_still_lists(
    client: AsyncClient, db_session: AsyncSession, test_user: dict
) -> None:
    raw = await _token(db_session, test_user["user_id"], "profile:read submission:write")
    response = await client.get("/api/ai/submissions", headers={"X-API-Key": raw})
    assert response.status_code == 200, response.text
    assert "submissions" in response.json()


@pytest.mark.asyncio
async def test_forged_editor_scope_cannot_replace_real_role(
    client: AsyncClient, db_session: AsyncSession, test_user: dict
) -> None:
    # 直接写库模拟“Token 建好后账号被降级/历史脏数据”，调度器必须再验角色。
    raw = await _token(db_session, test_user["user_id"], "profile:read editorial:read")
    response = await client.post(
        "/api/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 8,
            "method": "tools/call",
            "params": {"name": "get_editor_workbench", "arguments": {}},
        },
        headers={"Authorization": f"Bearer {raw}"},
    )
    result = response.json()["result"]
    assert result["isError"] is True
    text = result["content"][0]["text"]
    assert "role_required" in text
    assert "actual_role" in text


@pytest.mark.asyncio
async def test_admin_gets_editor_workbench_and_stale_decision_is_rejected(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    raw = await _token(
        db_session, admin_user["user_id"], "profile:read editorial:read editorial:decide"
    )
    workbench = await client.post(
        "/api/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 9,
            "method": "tools/call",
            "params": {"name": "get_editor_workbench", "arguments": {}},
        },
        headers={"Authorization": f"Bearer {raw}"},
    )
    assert workbench.status_code == 200, workbench.text
    assert workbench.json()["result"]["isError"] is False, workbench.text

    tenant = await _tenant(db_session)
    row = Submission(
        tenant_id=tenant.id,
        submitted_by=test_user["user_id"],
        status="pending",
        title="用来验证陈旧决策的稿子",
        type="paper",
        authors=["测试作者"],
        year=2026,
        discipline="computer-science",
        tags=[],
        keywords=[],
        jel_codes=[],
        abstract="这是一段足够长的摘要，用来验证编辑决定必须防陈旧。",
        preview="这是一段足够长的摘要，用来验证编辑决定必须防陈旧。",
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)

    stale = await client.post(
        "/api/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 10,
            "method": "tools/call",
            "params": {
                "name": "decide_submission",
                "arguments": {
                    "submission_id": row.id,
                    "decision": "accept",
                    "expected_status": "under_review",
                    "expected_latest_version": 1,
                    "confirm": True,
                },
            },
        },
        headers={"Authorization": f"Bearer {raw}"},
    )
    result = stale.json()["result"]
    assert result["isError"] is True
    assert "stale_decision" in result["content"][0]["text"]


@pytest.mark.asyncio
async def test_admin_triage_requires_and_matches_expected_state(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    raw = await _token(
        db_session, admin_user["user_id"], "profile:read editorial:read editorial:triage"
    )
    tenant = await _tenant(db_session)
    row = Submission(
        tenant_id=tenant.id,
        submitted_by=test_user["user_id"],
        status="pending",
        title="用来验证基础检查防陈旧的稿子",
        type="paper",
        authors=["测试作者"],
        year=2026,
        discipline="computer-science",
        tags=[],
        keywords=[],
        jel_codes=[],
        abstract="这是一段足够长的摘要，用来验证基础检查必须防陈旧。",
        preview="这是一段足够长的摘要，用来验证基础检查必须防陈旧。",
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)

    ok = await client.post(
        "/api/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 13,
            "method": "tools/call",
            "params": {
                "name": "triage_submission",
                "arguments": {
                    "submission_id": row.id,
                    "decision": "send_to_review",
                    "expected_status": "pending",
                    "expected_latest_version": 1,
                    "confirm": True,
                },
            },
        },
        headers={"Authorization": f"Bearer {raw}"},
    )
    assert ok.json()["result"]["isError"] is False, ok.text
    await db_session.refresh(row)
    assert row.triage_status == "passed"
