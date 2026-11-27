"""相关阅读接口：只返回公开作品，并说明为什么相关。"""

from __future__ import annotations

import pytest
from conftest import auth_headers
from httpx import AsyncClient

from tests.test_catalog import _SAMPLE


@pytest.mark.asyncio
async def test_related_resources_rank_shared_tag_first(
    client: AsyncClient, admin_user: dict
) -> None:
    target = await client.post(
        "/api/catalog",
        json={
            **_SAMPLE,
            "title": "目标作品",
            "authors": ["Target Author"],
            "tags": ["共享标签"],
        },
        headers=auth_headers(admin_user),
    )
    assert target.status_code == 201, target.text
    target_id = target.json()["id"]

    candidate = await client.post(
        "/api/catalog",
        json={
            **_SAMPLE,
            "title": "同标签作品",
            "authors": ["Tag Author"],
            "tags": ["共享标签"],
        },
        headers=auth_headers(admin_user),
    )
    assert candidate.status_code == 201, candidate.text
    candidate_id = candidate.json()["id"]

    unrelated = await client.post(
        "/api/catalog",
        json={
            **_SAMPLE,
            "title": "无关作品",
            "authors": ["Other Author"],
            "tags": ["别的"],
        },
        headers=auth_headers(admin_user),
    )
    assert unrelated.status_code == 201, unrelated.text

    r = await client.get(f"/api/catalog/{target_id}/related?limit=4")
    assert r.status_code == 200, r.text
    rows = r.json()["data"]
    assert rows
    assert rows[0]["id"] == candidate_id
    assert rows[0]["reason"] == "同标签 · 共享标签"
    assert target_id not in {row["id"] for row in rows}


@pytest.mark.asyncio
async def test_related_resources_404_for_unknown_work(client: AsyncClient) -> None:
    assert (await client.get("/api/catalog/999999/related")).status_code == 404
