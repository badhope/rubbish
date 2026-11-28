"""统一检索的集成测试：四类结果、计数、分页与空查询。"""

from __future__ import annotations

import pytest
from conftest import auth_headers
from httpx import AsyncClient

from tests.test_catalog import _SAMPLE


@pytest.mark.asyncio
async def test_search_returns_four_kinds_and_counts(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    resource = await client.post(
        "/api/catalog",
        json={**_SAMPLE, "title": "深空检索笔记", "tags": ["深空检索", "射电"]},
        headers=auth_headers(admin_user),
    )
    assert resource.status_code == 201, resource.text
    topic = await client.post(
        "/api/forum/topics",
        json={"title": "深空检索讨论", "body": "想找同好一起读这篇。"},
        headers=auth_headers(test_user),
    )
    assert topic.status_code == 201, topic.text

    r = await client.get("/api/search", params={"q": "深空检索"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["meta"]["totals"] == {"resources": 1, "topics": 1, "people": 0, "tags": 1}
    assert body["resources"][0]["id"] == resource.json()["id"]
    assert body["resources"][0]["excerpt"]
    assert body["topics"][0]["id"] == topic.json()["id"]
    assert body["tags"] == [{"name": "深空检索", "count": 1}]
    assert body["people"] == []


@pytest.mark.asyncio
async def test_search_type_filter_pages_one_surface(
    client: AsyncClient, admin_user: dict
) -> None:
    for index in range(3):
        created = await client.post(
            "/api/catalog",
            json={**_SAMPLE, "title": f"分页检索样例 {index}", "tags": ["分页检索"]},
            headers=auth_headers(admin_user),
        )
        assert created.status_code == 201, created.text

    first = await client.get(
        "/api/search", params={"q": "分页检索", "type": "resources", "page_size": 2, "page": 1}
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["meta"]["totals"]["resources"] == 3
    assert len(body["resources"]) == 2
    assert body["topics"] == []
    assert body["people"] == []
    assert body["tags"] == []

    second = await client.get(
        "/api/search", params={"q": "分页检索", "type": "resources", "page_size": 2, "page": 2}
    )
    assert len(second.json()["resources"]) == 1


@pytest.mark.asyncio
async def test_search_finds_people_by_username(client: AsyncClient, test_user: dict) -> None:
    r = await client.get(
        "/api/search",
        params={"q": test_user["username"], "type": "people"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["meta"]["totals"]["people"] >= 1
    assert any(row["username"] == test_user["username"] for row in body["people"])


@pytest.mark.asyncio
async def test_search_people_by_subject_discipline(
    client: AsyncClient, test_user: dict
) -> None:
    profile = await client.patch(
        "/api/users/me",
        json={"subject_disciplines": ["computer-science"]},
        headers=auth_headers(test_user),
    )
    assert profile.status_code == 200, profile.text

    r = await client.get(
        "/api/search",
        params={"type": "people", "discipline": "computer-science"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["meta"]["query"] == ""
    assert body["meta"]["totals"]["people"] >= 1
    hit = next(row for row in body["people"] if row["username"] == test_user["username"])
    assert hit["subject_disciplines"] == ["computer-science"]
    # 审稿领域不能借检索卡片泄露。
    assert "reviewer_disciplines" not in hit
    assert "reviewer_tags" not in hit


@pytest.mark.asyncio
async def test_search_people_respects_private_profile(
    client: AsyncClient, test_user: dict
) -> None:
    profile = await client.patch(
        "/api/users/me",
        json={"subject_disciplines": ["computer-science"], "profile_visibility": "private"},
        headers=auth_headers(test_user),
    )
    assert profile.status_code == 200, profile.text

    r = await client.get(
        "/api/search",
        params={"type": "people", "discipline": "computer-science"},
    )
    assert r.status_code == 200, r.text
    assert all(row["username"] != test_user["username"] for row in r.json()["people"])


@pytest.mark.asyncio
async def test_search_rejects_blank_query(client: AsyncClient) -> None:
    assert (await client.get("/api/search", params={"q": "   "})).status_code == 422
