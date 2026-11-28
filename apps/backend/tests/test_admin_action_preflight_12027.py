"""1.20.27: 全后台动作预检只读、可解释，且不写库。"""

from __future__ import annotations

import pytest
from conftest import auth_headers, register_user
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, ContentReport, User


async def _grant(client: AsyncClient, admin_user: dict, target: dict, role: str) -> dict[str, str]:
    res = await client.post(
        f"/api/admin/users/{target['user_id']}/roles",
        json={"role": role},
        headers=auth_headers(admin_user),
    )
    assert res.status_code == 201, res.text
    return auth_headers(target)


async def _preflight(client: AsyncClient, headers: dict[str, str], kind: str, payload: dict):
    return await client.post(
        "/api/admin/actions/preflight",
        json={"kind": kind, "payload": payload},
        headers=headers,
    )


@pytest.mark.asyncio
async def test_preflight_rejects_editor_and_unknown_kind(
    client: AsyncClient, admin_user: dict
) -> None:
    editor = await register_user(client, email="pf-editor@example.com", username="pfeditor")
    editor_headers = await _grant(client, admin_user, editor, "editor")

    denied = await _preflight(
        client, editor_headers, "member_xp", {"user_id": editor["user_id"], "amount": 1}
    )
    assert denied.status_code == 403

    unknown = await _preflight(client, auth_headers(admin_user), "no_such_kind", {})
    assert unknown.status_code == 404
    assert "未知" in unknown.json()["detail"]


@pytest.mark.asyncio
async def test_member_create_duplicate_accounts_fail(client: AsyncClient, admin_user: dict) -> None:
    res = await _preflight(
        client,
        auth_headers(admin_user),
        "member_create",
        {"email": "admin@example.com", "username": "adminuser", "role": "editor"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "fail"
    by_key = {item["key"]: item for item in body["items"]}
    assert by_key["email"]["status"] == "ok"
    assert by_key["username"]["status"] == "ok"
    assert by_key["identity_unique"]["status"] == "fail"


@pytest.mark.asyncio
async def test_member_create_split_conflicts_do_not_crash(
    client: AsyncClient, admin_user: dict
) -> None:
    first = await register_user(client, email="pf-first@example.com", username="pffirst")
    second = await register_user(client, email="pf-second@example.com", username="pfsecond")
    assert first["user_id"] != second["user_id"]
    res = await _preflight(
        client,
        auth_headers(admin_user),
        "member_create",
        {"email": "pf-first@example.com", "username": "pfsecond", "role": "editor"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "fail"
    item = next(i for i in body["items"] if i["key"] == "identity_unique")
    assert "邮箱" in item["detail"] and "用户名" in item["detail"]


@pytest.mark.asyncio
async def test_member_admin_last_admin_and_self_demotion_fail(
    client: AsyncClient, admin_user: dict
) -> None:
    res = await _preflight(
        client,
        auth_headers(admin_user),
        "member_admin",
        {"user_id": admin_user["user_id"], "is_admin": False},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "fail"
    keys = {item["key"] for item in body["items"] if item["status"] == "fail"}
    assert {"self", "last_admin"} <= keys


@pytest.mark.asyncio
async def test_member_areas_over_limit_fails(client: AsyncClient, admin_user: dict) -> None:
    target = await register_user(client, email="pf-areas@example.com", username="pfareas")
    res = await _preflight(
        client,
        auth_headers(admin_user),
        "member_areas",
        {"user_id": target["user_id"], "subject_disciplines": [f"d{i}" for i in range(7)]},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "fail"
    assert any(
        item["key"] == "subject_disciplines" and "超过上限" in item["detail"]
        for item in body["items"]
    )


@pytest.mark.asyncio
async def test_missing_comment_and_shop_item_are_explained(
    client: AsyncClient, admin_user: dict
) -> None:
    comment = await _preflight(
        client,
        auth_headers(admin_user),
        "comment_moderation",
        {"comment_id": 999999, "action": "approve"},
    )
    assert comment.status_code == 200
    assert comment.json()["status"] == "fail"

    topic = await _preflight(
        client,
        auth_headers(admin_user),
        "forum_topic",
        {"topic_id": 999999, "is_pinned": True},
    )
    assert topic.status_code == 200
    assert topic.json()["status"] == "fail"

    shop = await _preflight(
        client,
        auth_headers(admin_user),
        "shop_item",
        {"name": "", "price_coin": 0, "sort_order": 2000, "effect": "magic"},
    )
    assert shop.status_code == 200
    body = shop.json()
    assert body["status"] == "fail"
    assert {item["key"] for item in body["items"] if item["status"] == "fail"} >= {
        "name",
        "price",
        "sort",
        "effect",
    }


@pytest.mark.asyncio
async def test_canonical_chief_can_read_economy_config(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from app.models import User

    user = await register_user(client, email="pf-canonical-chief@example.com", username="pfchief")
    row = (await db_session.execute(select(User).where(User.id == user["user_id"]))).scalar_one()
    row.role = "editor_in_chief"
    row.is_admin = False
    await db_session.commit()

    res = await client.get("/api/gamification/admin/coin/config", headers=auth_headers(user))
    assert res.status_code == 200, res.text


@pytest.mark.asyncio
async def test_preflight_never_writes_audit(
    client: AsyncClient, admin_user: dict, db_session: AsyncSession
) -> None:
    before = (await db_session.execute(select(func.count()).select_from(AuditLog))).scalar_one()
    res = await _preflight(
        client,
        auth_headers(admin_user),
        "coin_policy",
        {"daily_earn_cap": 5, "monthly_issue_cap": 5000},
    )
    assert res.status_code == 200
    # 等一个事务边界，确认端点没有写审计。
    await db_session.rollback()
    after = (await db_session.execute(select(func.count()).select_from(AuditLog))).scalar_one()
    assert after == before


@pytest.mark.asyncio
async def test_content_report_missing_target_is_explained(
    client: AsyncClient, admin_user: dict, db_session: AsyncSession
) -> None:
    """评论/作品举报的目标若已被删除，预检要在提交前说清楚。"""
    user = (
        await db_session.execute(select(User).where(User.id == admin_user["user_id"]))
    ).scalar_one()
    report = ContentReport(
        tenant_id=user.tenant_id,
        reporter_id=user.id,
        target_type="comment",
        target_id=999999,
        reason="预检目标缺失测试",
    )
    db_session.add(report)
    await db_session.commit()
    report_id = report.id

    res = await _preflight(
        client,
        auth_headers(admin_user),
        "report_disposition",
        {"id": report_id, "source": "content", "action": "remove_content", "note": ""},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "fail"
    by_key = {item["key"]: item for item in body["items"]}
    assert by_key["target"]["status"] == "ok"
    assert by_key["status"]["status"] == "ok"
    assert by_key["content"]["status"] == "fail"
    assert "评论" in by_key["content"]["detail"]
