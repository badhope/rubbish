"""Server-side submission wizard draft.

The draft is per (tenant, user), overwritten in place, and must never
leak into another author's wizard or look like a submitted manuscript.
"""

from __future__ import annotations

from conftest import auth_headers, register_user
from httpx import AsyncClient


async def test_draft_roundtrip_and_overwrite(client: AsyncClient, test_user: dict) -> None:
    headers = auth_headers(test_user)
    empty = await client.get("/api/submissions/draft", headers=headers)
    assert empty.status_code == 200
    assert empty.json()["draft"] is None

    first = await client.put(
        "/api/submissions/draft",
        json={
            "payload": {"title": "草稿一", "discipline": "economics"},
            "body": "# 引言\n\n第一版正文",
        },
        headers=headers,
    )
    assert first.status_code == 200
    draft = first.json()["draft"]
    assert draft["payload"]["title"] == "草稿一"
    assert draft["body"].startswith("# 引言")
    assert draft["updated_at"]

    second = await client.put(
        "/api/submissions/draft",
        json={"payload": {"title": "草稿二"}, "body": "第二版"},
        headers=headers,
    )
    assert second.status_code == 200
    loaded = (await client.get("/api/submissions/draft", headers=headers)).json()
    assert loaded["draft"]["payload"]["title"] == "草稿二"
    assert loaded["draft"]["body"] == "第二版"
    # 覆盖保存，不堆版本
    rows = await client.get("/api/submissions/me", headers=headers)
    assert rows.status_code == 200
    assert rows.json()["data"] == []


async def test_draft_is_per_user(client: AsyncClient, test_user: dict) -> None:
    headers = auth_headers(test_user)
    await client.put(
        "/api/submissions/draft",
        json={"payload": {"title": "只属于作者一"}, "body": "正文"},
        headers=headers,
    )
    other = await register_user(client, email="draft-other@example.com", username="draft_other")
    other_headers = auth_headers(other)
    assert (await client.get("/api/submissions/draft", headers=other_headers)).json()[
        "draft"
    ] is None


async def test_delete_draft_is_idempotent(client: AsyncClient, test_user: dict) -> None:
    headers = auth_headers(test_user)
    await client.put(
        "/api/submissions/draft",
        json={"payload": {"title": "待删除"}, "body": "正文"},
        headers=headers,
    )
    first = await client.delete("/api/submissions/draft", headers=headers)
    assert first.status_code == 200
    second = await client.delete("/api/submissions/draft", headers=headers)
    assert second.status_code == 200
    loaded = (await client.get("/api/submissions/draft", headers=headers)).json()
    assert loaded["draft"] is None
