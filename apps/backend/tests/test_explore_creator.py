"""发现页、创作者中心与帖子收藏的集成测试。"""

from __future__ import annotations

import pytest
from conftest import auth_headers
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_explore_overview_is_public_and_has_shape(client: AsyncClient) -> None:
    r = await client.get("/api/explore/overview")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stats"]["resources"] == 0
    assert body["top_resources"] == []
    assert body["top_topics"] == []
    assert body["top_authors"] == []
    assert body["top_tags"] == []


@pytest.mark.asyncio
async def test_explore_following_requires_login(client: AsyncClient) -> None:
    assert (await client.get("/api/explore/following")).status_code == 401


@pytest.mark.asyncio
async def test_explore_following_returns_grouped_feeds(
    client: AsyncClient, test_user: dict
) -> None:
    r = await client.get("/api/explore/following", headers=auth_headers(test_user))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resources"] == []
    assert body["topics"] == []
    assert body["followed_authors"] == 0
    assert body["subscribed_disciplines"] == 0
    assert body["followed_topics"] == 0


@pytest.mark.asyncio
async def test_creator_overview_requires_login_and_returns_zeroes(
    client: AsyncClient, test_user: dict
) -> None:
    assert (await client.get("/api/me/creator")).status_code == 401
    r = await client.get("/api/me/creator", headers=auth_headers(test_user))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["published"] == 0
    assert body["totals"] == {"reads": 0, "downloads": 0, "saves": 0, "comments": 0}
    assert body["works"] == []
    assert body["recent_comments"] == []


@pytest.mark.asyncio
async def test_bookmarked_topics_list_round_trip(client: AsyncClient, test_user: dict) -> None:
    topic = (
        await client.post(
            "/api/forum/topics",
            json={"title": "值得回看的帖子", "body": "收藏后应该出现在列表里。"},
            headers=auth_headers(test_user),
        )
    ).json()

    empty = await client.get("/api/forum/topics/bookmarks", headers=auth_headers(test_user))
    assert empty.status_code == 200
    assert empty.json()["data"] == []

    toggle = await client.post(
        "/api/forum/reactions/toggle",
        json={"target_type": "topic", "target_id": topic["id"], "kind": "bookmark"},
        headers=auth_headers(test_user),
    )
    assert toggle.status_code == 200, toggle.text
    assert toggle.json()["active"] is True

    listed = await client.get("/api/forum/topics/bookmarks", headers=auth_headers(test_user))
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()["data"]] == [topic["id"]]
