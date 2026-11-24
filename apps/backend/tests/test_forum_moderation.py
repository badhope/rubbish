"""论坛半自动化审核链路：规则分档、人工队列、批量/单条处置与规则设置。"""

from __future__ import annotations

import pytest
from conftest import auth_headers
from httpx import AsyncClient


async def _set_threshold(client: AsyncClient, admin: dict, threshold: int = 30) -> None:
    r = await client.put(
        "/api/forum/moderation/settings",
        json={
            "auto_publish_enabled": True,
            "manual_threshold": threshold,
            "sla_minutes": 30,
            "weights": {},
        },
        headers=auth_headers(admin),
    )
    assert r.status_code == 200, r.text


async def _manual_topic(client: AsyncClient, user: dict) -> dict:
    r = await client.post(
        "/api/forum/topics",
        json={
            "title": "合作联系与资料分享",
            "body": "这是一段足够长的主题帖正文，想先说明背景，再留下联系邮箱 hello@example.com，方便感兴趣的人后续交流。",
            "category": "collab",
        },
        headers=auth_headers(user),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["moderation_status"] == "manual_review"
    assert body["review_eta_at"] is not None
    return body


@pytest.mark.asyncio
async def test_auto_publish_normal_topic(client: AsyncClient, test_user: dict) -> None:
    r = await client.post(
        "/api/forum/topics",
        json={
            "title": "一个普通的主题帖",
            "body": "我想讨论一个具体问题：社区里的主题帖应该如何归档，大家有什么实际经验？",
            "category": "question",
        },
        headers=auth_headers(test_user),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["moderation_status"] == "published"
    assert body["risk_score"] >= 0
    listing = await client.get("/api/forum/topics")
    assert [row["id"] for row in listing.json()["data"]] == [body["id"]]


@pytest.mark.asyncio
async def test_manual_queue_approve_and_visibility(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    await _set_threshold(client, admin_user, 30)
    topic = await _manual_topic(client, test_user)

    # 公开列表不展示；作者能看自己的核验状态；匿名看不到。
    listing = await client.get("/api/forum/topics")
    assert topic["id"] not in [row["id"] for row in listing.json()["data"]]
    assert (
        await client.get(f"/api/forum/topics/{topic['id']}", headers=auth_headers(test_user))
    ).status_code == 200
    assert (await client.get(f"/api/forum/topics/{topic['id']}")).status_code == 404

    queue = await client.get(
        "/api/forum/moderation/queue",
        params={"status": "manual_review", "topic_id": topic["id"]},
        headers=auth_headers(admin_user),
    )
    assert queue.status_code == 200, queue.text
    assert queue.json()["data"][0]["id"] == topic["id"]
    assert queue.json()["data"][0]["risk_score"] >= 30

    decision = await client.post(
        f"/api/forum/moderation/topics/{topic['id']}/decision",
        json={"action": "approve", "note": "内容无风险，公开。"},
        headers=auth_headers(admin_user),
    )
    assert decision.status_code == 200, decision.text
    assert decision.json()["moderation_status"] == "published"
    listing = await client.get("/api/forum/topics")
    assert topic["id"] in [row["id"] for row in listing.json()["data"]]


@pytest.mark.asyncio
async def test_manual_reject_keeps_topic_hidden(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    await _set_threshold(client, admin_user, 30)
    topic = await _manual_topic(client, test_user)
    decision = await client.post(
        f"/api/forum/moderation/topics/{topic['id']}/decision",
        json={"action": "reject", "note": "公开联系方式不符合当前版规。"},
        headers=auth_headers(admin_user),
    )
    assert decision.status_code == 200, decision.text
    assert decision.json()["moderation_status"] == "rejected"
    assert (await client.get(f"/api/forum/topics/{topic['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_moderation_queue_requires_operator(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    await _set_threshold(client, admin_user, 30)
    await _manual_topic(client, test_user)
    r = await client.get("/api/forum/moderation/queue", headers=auth_headers(test_user))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_settings_and_auto_publish_off(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    await _set_threshold(client, admin_user, 30)
    r = await client.put(
        "/api/forum/moderation/settings",
        json={
            "auto_publish_enabled": False,
            "manual_threshold": 40,
            "sla_minutes": 45,
            "weights": {"contact": 0, "external_link": 0, "low_effort": 0, "shouting": 0},
        },
        headers=auth_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    topic = await client.post(
        "/api/forum/topics",
        json={
            "title": "全部人工核验",
            "body": "这是一段足够长的正文，用于验证关闭自动发布后全部进入人工队列。",
        },
        headers=auth_headers(test_user),
    )
    body = topic.json()
    assert body["moderation_status"] == "manual_review"
    settings = await client.get("/api/forum/moderation/settings", headers=auth_headers(admin_user))
    assert settings.json()["auto_publish_enabled"] is False
    assert settings.json()["sla_minutes"] == 45


@pytest.mark.asyncio
async def test_stats_events_batch_and_notifications(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    await _set_threshold(client, admin_user, 30)
    ids: list[int] = []
    for index in range(2):
        r = await client.post(
            "/api/forum/topics",
            json={
                "title": f"人工核验批量样本 {index}",
                "body": f"这是第 {index} 条足够长的主题帖正文，留下邮箱 batch{index}@example.com 方便联系。",
            },
            headers=auth_headers(test_user),
        )
        assert r.status_code == 201, r.text
        assert r.json()["moderation_status"] == "manual_review"
        ids.append(r.json()["id"])

    stats = await client.get("/api/forum/moderation/stats", headers=auth_headers(admin_user))
    assert stats.status_code == 200, stats.text
    assert stats.json()["manual_review"] >= 2

    events = await client.get(
        f"/api/forum/moderation/topics/{ids[0]}/events", headers=auth_headers(admin_user)
    )
    assert events.status_code == 200, events.text
    assert events.json()[0]["to_status"] == "manual_review"

    batch = await client.post(
        "/api/forum/moderation/batch",
        json={"topic_ids": ids, "action": "approve", "note": "批量核验通过。"},
        headers=auth_headers(admin_user),
    )
    assert batch.status_code == 200, batch.text
    assert batch.json()["count"] == 2

    after_events = await client.get(
        f"/api/forum/moderation/topics/{ids[0]}/events", headers=auth_headers(admin_user)
    )
    assert any(row["action"] == "approve" for row in after_events.json())

    # 处置结果必须真正落成作者通知，而不是在请求结束时被丢弃。
    notes = await client.get("/api/notifications", headers=auth_headers(test_user))
    assert notes.status_code == 200, notes.text
    assert any("已通过核验" in row["title"] for row in notes.json()["data"])


@pytest.mark.asyncio
async def test_settings_returns_effective_default_weights(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    r = await client.get("/api/forum/moderation/settings", headers=auth_headers(admin_user))
    assert r.status_code == 200, r.text
    weights = r.json()["weights"]
    assert weights["contact"] == 32
    assert weights["external_link"] == 14
    assert weights["low_effort"] == 22
    assert weights["shouting"] == 10


@pytest.mark.asyncio
async def test_editor_can_moderate_but_cannot_change_rules(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    grant = await client.post(
        f"/api/admin/users/{test_user['user_id']}/roles",
        json={"role": "editor"},
        headers=auth_headers(admin_user),
    )
    assert grant.status_code == 201, grant.text
    queue = await client.get("/api/forum/moderation/queue", headers=auth_headers(test_user))
    assert queue.status_code == 200, queue.text
    settings = await client.put(
        "/api/forum/moderation/settings",
        json={
            "auto_publish_enabled": True,
            "manual_threshold": 40,
            "sla_minutes": 30,
            "weights": {},
        },
        headers=auth_headers(test_user),
    )
    assert settings.status_code == 403, settings.text
