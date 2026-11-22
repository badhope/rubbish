"""Gamification tests — ladder, onboarding, XP awarding, achievements, announcements."""

from __future__ import annotations

from conftest import auth_headers, register_user
from httpx import AsyncClient
from sqlalchemy import select

from app.models import AuditLog


def _level(body: dict) -> int:
    return int(body["level"]["level"])


async def test_ladder_is_public_and_lists_four_identities(client: AsyncClient) -> None:
    """身份体系 3.0：四种身份（读者/作者/审稿人/编辑），不再是九级 XP 阶梯。"""
    r = await client.get("/api/gamification/ladder")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "3.0"
    identities = body["identities"]
    assert [item["slug"] for item in identities] == ["reader", "author", "reviewer", "editor"]
    by_slug = {item["slug"]: item for item in identities}
    # 审稿人身份必须能对上后端角色，否则"授予"与"门禁"会脱节
    assert "reviewer" in by_slug["reviewer"]["roles"]
    assert "editor" in by_slug["editor"]["roles"]
    # 读者与作者都不需要角色（注册/确认规范即得）
    assert by_slug["reader"]["roles"] == []
    assert by_slug["author"]["roles"] == []


async def test_new_user_starts_at_level_one(client: AsyncClient) -> None:
    user = await register_user(client, email="fresh@example.com", username="fresh")
    me = await client.get("/api/users/me", headers={"Authorization": f"Bearer {user['token']}"})
    assert me.status_code == 200
    body = me.json()
    assert body["level"] == 1
    assert body["xp"] == 10
    assert body["rules_accepted"] is False


async def test_level_one_can_comment(client: AsyncClient, admin_user: dict) -> None:
    sample = {
        "type": "paper",
        "title": "Comment Gate Target",
        "authors": ["A"],
        "year": 2026,
        "discipline": "计算机科学",
        "abstract": "用于验证 L1 评论门禁的占位摘要。",
    }
    rid = (await client.post("/api/catalog", json=sample, headers=auth_headers(admin_user))).json()[
        "id"
    ]
    r = await register_user(client, email="l1c@example.com", username="l1comment")
    posted = await client.post(
        "/api/comments",
        json={"resource_id": rid, "body": "L1 可以发言"},
        headers={"Authorization": f"Bearer {r['token']}"},
    )
    assert posted.status_code == 201


async def test_author_onboarding_requires_accept_flag(client: AsyncClient) -> None:
    user = await register_user(client, email="noaccept@example.com", username="noaccept")
    headers = {"Authorization": f"Bearer {user['token']}"}
    resp = await client.post(
        "/api/gamification/onboarding/author", json={"accept_rules": False}, headers=headers
    )
    assert resp.status_code == 400


async def test_profile_returns_badges_and_progressive_reveal(client: AsyncClient) -> None:
    user = await register_user(client, email="profile@example.com", username="profileuser")
    headers = {"Authorization": f"Bearer {user['token']}"}
    profile = await client.get("/api/gamification/me", headers=headers)
    assert profile.status_code == 200
    body = profile.json()
    assert body["level"]["level"] == 1
    assert body["level"]["slug"] == "reader"
    # 下一步是"成为作者"，靠确认规范而不是攒积分
    assert body["level"]["next_identity"]["slug"] == "author"
    # 低等级只展示已解锁 + 最多 3 个待解锁，避免一次铺满整面墙
    assert len([b for b in body["badges"] if not b["unlocked"]]) <= 3
    assert all(not b["secret"] for b in body["badges"] if not b["unlocked"])


async def test_admin_sees_secret_badges(client: AsyncClient, admin_user: dict) -> None:
    profile = await client.get("/api/gamification/me", headers=auth_headers(admin_user))
    assert profile.status_code == 200
    body = profile.json()
    # 身份仍是编辑（第 4 层），但活跃等级人人从 1 开始。
    assert body["level"]["identity_slug"] == "editor"
    assert body["level"]["identity_level"] == 4
    assert body["level"]["level"] == 1
    assert body["level"]["activity"]["level"] == 1
    assert any(b["secret"] for b in body["badges"])


async def test_reading_awards_xp_once(client: AsyncClient, admin_user: dict) -> None:
    sample = {
        "type": "paper",
        "title": "XP Reading Target",
        "authors": ["A"],
        "year": 2026,
        "discipline": "计算机科学",
        "abstract": "用于验证阅读积分幂等。",
    }
    rid = (await client.post("/api/catalog", json=sample, headers=auth_headers(admin_user))).json()[
        "id"
    ]
    r = await register_user(client, email="reader@example.com", username="xpreader")
    headers = {"Authorization": f"Bearer {r['token']}"}
    first = await client.post(f"/api/reader/history/{rid}", headers=headers)
    assert first.status_code == 201
    second = await client.post(f"/api/reader/history/{rid}", headers=headers)
    assert second.status_code == 201
    me = await client.get("/api/users/me", headers=headers)
    assert me.json()["xp"] == 12  # 10 注册 + 2 阅读（第二次不重复计分）


async def test_announcement_lifecycle(client: AsyncClient, admin_user: dict) -> None:
    active = await client.get("/api/announcements/active")
    assert active.status_code == 200
    payload = {
        "slug": "launch-2026",
        "title": "站点迁移公告",
        "body": "Rubbish 已迁移至新域名。",
        "level": "info",
        "is_active": True,
    }
    created = await client.post(
        "/api/announcements", json=payload, headers=auth_headers(admin_user)
    )
    assert created.status_code == 201
    published = await client.get("/api/announcements/active")
    assert published.json()["slug"] == "launch-2026"
    hidden = await client.post(
        "/api/announcements",
        json={**payload, "slug": "hidden", "is_active": False},
        headers=auth_headers(admin_user),
    )
    assert hidden.status_code == 201
    still = await client.get("/api/announcements/active")
    assert still.json()["slug"] == "launch-2026"


async def test_announcement_requires_admin(client: AsyncClient, test_user: dict) -> None:
    r = await client.post(
        "/api/announcements",
        json={"slug": "x", "title": "x", "body": "x"},
        headers=auth_headers(test_user),
    )
    assert r.status_code == 403


async def test_wallet_checkin_idempotent_and_streak(client: AsyncClient, test_user: dict) -> None:
    """每日签到统一走钱包接口：首次发 XP + 积分，重复签到幂等。"""
    headers = auth_headers(test_user)
    before = (await client.get("/api/gamification/wallet", headers=headers)).json()
    assert before["checked_in_today"] is False
    assert before["streak"] == 0
    assert before["total_checkins"] == 0
    assert before["balance"] == 0

    first = await client.post("/api/gamification/wallet/checkin", headers=headers)
    assert first.status_code == 200
    body = first.json()
    assert body["checked_in_today"] is True
    assert body["streak"] == 1
    assert body["total_checkins"] == 1
    assert body["balance"] == 1

    me1 = (await client.get("/api/gamification/me", headers=headers)).json()
    again = await client.post("/api/gamification/wallet/checkin", headers=headers)
    assert again.status_code == 200
    assert again.json()["checked_in_today"] is True
    assert again.json()["streak"] == 1
    assert again.json()["balance"] == body["balance"]
    me2 = (await client.get("/api/gamification/me", headers=headers)).json()
    assert me2["xp"] == me1["xp"]


async def test_checkin_requires_auth(client: AsyncClient) -> None:
    r = await client.post("/api/gamification/wallet/checkin")
    assert r.status_code in (401, 403)


async def test_admin_can_grant_activity_xp(
    client: AsyncClient, admin_user: dict, db_session
) -> None:
    """管理员手动发放活跃值是可达能力：非管理员不能调用，发放会写经验与审计。"""
    target = await register_user(client, email="granted@example.com", username="granted")
    target_headers = {"Authorization": f"Bearer {target['token']}"}
    before = (await client.get("/api/users/me", headers=target_headers)).json()["xp"]

    denied = await client.post(
        f"/api/gamification/admin/users/{target['user_id']}/grant",
        json={"points": 250, "note": "普通成员不能自助发放"},
        headers=target_headers,
    )
    assert denied.status_code == 403

    missing_note = await client.post(
        f"/api/gamification/admin/users/{target['user_id']}/grant",
        json={"points": 250, "note": ""},
        headers=auth_headers(admin_user),
    )
    assert missing_note.status_code == 422

    granted = await client.post(
        f"/api/gamification/admin/users/{target['user_id']}/grant",
        json={"points": 250, "note": "测试活动奖励"},
        headers=auth_headers(admin_user),
    )
    assert granted.status_code == 200, granted.text
    assert granted.json() == {"points": 250, "note": "测试活动奖励"}
    after = (await client.get("/api/users/me", headers=target_headers)).json()["xp"]
    assert after == before + 250

    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "gamification.grant",
                AuditLog.target_id == str(target["user_id"]),
            )
        )
    ).scalar_one()
    assert audit.payload == {"points": 250, "note": "测试活动奖励"}
