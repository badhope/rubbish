"""1.20.16 论坛新手任务与社区信用。"""

from __future__ import annotations

import pytest
from conftest import auth_headers, register_user
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_starter_tasks_patch_profile_and_claim_once(
    client: AsyncClient, test_user: dict
) -> None:
    headers = auth_headers(test_user)
    starter = await client.get("/api/forum/starter", headers=headers)
    assert starter.status_code == 200, starter.text
    body = starter.json()
    assert body["total"] == 4
    assert body["reward_xp"] == 25
    assert body["completed"] == 1  # test_user 已走完作者引导，规则已确认
    assert body["claimed"] is False
    assert [task["done"] for task in body["tasks"]] == [True, False, False, False]

    early = await client.post("/api/forum/starter/claim", headers=headers)
    assert early.status_code == 409
    assert "3 项" in early.json()["detail"]

    profile = await client.patch(
        "/api/users/me",
        json={"display_name": "桌边测试员", "bio": "在码头边记一点东西。"},
        headers=headers,
    )
    assert profile.status_code == 200, profile.text

    topic = await client.post(
        "/api/forum/topics",
        json={"title": "第一帖：怎么开始", "body": "先从一句真实的话开始。"},
        headers=headers,
    )
    assert topic.status_code == 201, topic.text
    reply = await client.post(
        f"/api/forum/topics/{topic.json()['id']}/replies",
        json={"body": "自己接一句，放在这里。"},
        headers=headers,
    )
    assert reply.status_code == 201, reply.text

    complete = (await client.get("/api/forum/starter", headers=headers)).json()
    assert complete["completed"] == 4
    assert complete["all_done"] is True

    before = (await client.get("/api/gamification/me", headers=headers)).json()["xp"]
    claimed = await client.post("/api/forum/starter/claim", headers=headers)
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["claimed"] is True
    assert claimed.json()["claimed_at"]
    after = (await client.get("/api/gamification/me", headers=headers)).json()["xp"]
    assert after - before == 25

    again = await client.post("/api/forum/starter/claim", headers=headers)
    assert again.status_code == 200
    assert again.json()["claimed"] is True
    final_xp = (await client.get("/api/gamification/me", headers=headers)).json()["xp"]
    assert final_xp == after


@pytest.mark.asyncio
async def test_credit_adds_public_work_and_records_removal(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    headers = auth_headers(test_user)
    topic = await client.post(
        "/api/forum/topics",
        json={"title": "海边的记录", "body": "潮水退下去以后，码头露出半截旧绳子。"},
        headers=headers,
    )
    assert topic.status_code == 201, topic.text
    topic_id = topic.json()["id"]
    reply = await client.post(
        f"/api/forum/topics/{topic_id}/replies",
        json={"body": "我也见过那截绳子，像是谁忘了收。"},
        headers=headers,
    )
    assert reply.status_code == 201, reply.text
    reply_id = reply.json()["id"]

    credit = (await client.get("/api/forum/credit/me", headers=headers)).json()
    assert credit["score"] == 103
    assert credit["tier_label"] == "正常"
    assert credit["counts"]["published_topics"] == 1
    assert credit["counts"]["published_replies"] == 1
    assert {row["kind"] for row in credit["records"]} >= {"topic_published", "reply_published"}
    assert credit["positive_points"] == 3

    reporter = await register_user(
        client, email="reporter12016@example.com", username="reporter12016"
    )
    report = await client.post(
        "/api/forum/reports",
        json={"reply_id": reply_id, "reason": "这条回复泄漏了别人的隐私"},
        headers=auth_headers(reporter),
    )
    assert report.status_code == 201, report.text
    report_id = report.json()["id"]
    handled = await client.patch(
        f"/api/forum/reports/{report_id}",
        json={"action": "remove_content", "note": "确认移除"},
        headers=auth_headers(admin_user),
    )
    assert handled.status_code == 200, handled.text

    after = (await client.get("/api/forum/credit/me", headers=headers)).json()
    assert after["score"] == 94
    assert after["counts"]["removed_contents"] == 1
    assert after["negative_points"] == 8
    assert any(row["kind"] == "content_removed" for row in after["records"])


@pytest.mark.asyncio
async def test_rules_task_marks_done_after_community_ack(client: AsyncClient) -> None:
    fresh = await register_user(client, email="fresh12016@example.com", username="fresh12016")
    headers = auth_headers(fresh)
    before = (await client.get("/api/forum/starter", headers=headers)).json()
    assert before["tasks"][0]["done"] is False
    assert before["completed"] == 0

    ack = await client.post("/api/gamification/onboarding/community", headers=headers)
    assert ack.status_code == 200, ack.text
    after = (await client.get("/api/forum/starter", headers=headers)).json()
    assert after["tasks"][0]["done"] is True
    assert after["completed"] == 1


@pytest.mark.asyncio
async def test_starter_and_credit_require_login(client: AsyncClient) -> None:
    assert (await client.get("/api/forum/starter")).status_code == 401
    assert (await client.get("/api/forum/credit/me")).status_code == 401
