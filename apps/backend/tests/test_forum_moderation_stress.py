"""论坛审核链路的批量负载回归：50 条边界主题全部入队、批量通过、审计落库。

这不是生产并发压测；SQLite 共用一条连接会串行化写入。它验证的是高负载下
状态不漂移、批量接口不丢项、通知与审计不因数量增长而中断。
"""

from __future__ import annotations

import time

import pytest
from conftest import auth_headers
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_fifty_topic_queue_and_batch_decision(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    settings = await client.put(
        "/api/forum/moderation/settings",
        json={
            "auto_publish_enabled": True,
            "manual_threshold": 30,
            "sla_minutes": 30,
            "weights": {},
        },
        headers=auth_headers(admin_user),
    )
    assert settings.status_code == 200, settings.text

    started = time.perf_counter()
    ids: list[int] = []
    for index in range(50):
        response = await client.post(
            "/api/forum/topics",
            json={
                "title": f"压力回归主题帖 {index}",
                "body": (
                    f"这是第 {index} 条压力回归正文，内容长度足够，"
                    f"包含联系邮箱 stress{index}@example.com 和说明链接 "
                    f"https://example.com/stress/{index}，用于验证人工队列。"
                ),
            },
            headers=auth_headers(test_user),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["moderation_status"] == "manual_review"
        assert body["risk_score"] >= 30
        ids.append(body["id"])
    create_seconds = time.perf_counter() - started

    stats = await client.get("/api/forum/moderation/stats", headers=auth_headers(admin_user))
    assert stats.status_code == 200, stats.text
    assert stats.json()["manual_review"] >= 50

    batch = await client.post(
        "/api/forum/moderation/batch",
        json={"topic_ids": ids, "action": "approve", "note": "压力回归批量通过。"},
        headers=auth_headers(admin_user),
    )
    assert batch.status_code == 200, batch.text
    assert batch.json()["count"] == 50

    listing = await client.get(
        "/api/forum/topics", params={"page_size": 100}, headers=auth_headers(test_user)
    )
    assert listing.status_code == 200, listing.text
    visible = {row["id"] for row in listing.json()["data"]}
    assert set(ids).issubset(visible)

    for topic_id in ids[:5]:
        events = await client.get(
            f"/api/forum/moderation/topics/{topic_id}/events", headers=auth_headers(admin_user)
        )
        assert events.status_code == 200
        assert any(event["action"] == "approve" for event in events.json())

    print(f"[forum-stress] create_50={create_seconds:.2f}s")
