"""Focused regression tests for the 1.20.14 completion pass.

Two half-built flows are covered here:

- public reading lists: backend already had the table and the endpoint, but
  the UI and owner-aware serialization were missing. The important safety
  property is that a public list never exposes a draft or scheduled work.
- forum ↔ work linkage: `ForumTopic.paper_id` existed and article pages could
  set it, but the detail API never surfaced the work and authors could not
  repair the link. These tests pin the public read path and the author edit path.
"""

from __future__ import annotations

from conftest import auth_headers
from httpx import AsyncClient

_RESOURCE_PAYLOAD = {
    "type": "paper",
    "title": "A public test paper",
    "authors": ["Alice Author"],
    "year": 2026,
    "discipline": "computer-science",
    "tags": ["agents"],
    "keywords": ["retrieval"],
    "abstract": "A public abstract for relation tests.",
    "preview": "A public preview for relation tests.",
}


async def _create_resource(
    client: AsyncClient,
    admin: dict,
    *,
    title: str,
    publication_status: str = "published",
    discipline: str = "computer-science",
    tags: list[str] | None = None,
) -> int:
    payload = {
        **_RESOURCE_PAYLOAD,
        "title": title,
        "publication_status": publication_status,
        "discipline": discipline,
        "tags": tags or ["agents"],
    }
    response = await client.post("/api/catalog", json=payload, headers=auth_headers(admin))
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


async def _create_list(client: AsyncClient, user: dict, *, name: str, visibility: str) -> dict:
    response = await client.post(
        "/api/reading-lists",
        json={"name": name, "description": "A test list", "visibility": visibility},
        headers=auth_headers(user),
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_public_list_hides_unpublished_items_and_exposes_owner(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    public_id = await _create_resource(client, admin_user, title="Published reading list work")
    listing = await _create_list(client, test_user, name="Public picks", visibility="public")
    response = await client.post(
        f"/api/reading-lists/{listing['id']}/items",
        json={"resource_id": public_id},
        headers=auth_headers(test_user),
    )
    assert response.status_code == 201, response.text

    # A work can be collected while public and unpublished later (withdrawal,
    # scheduled issue, editorial correction). The list must stop exposing it.
    status_update = await client.patch(
        f"/api/catalog/{public_id}",
        json={"publication_status": "draft"},
        headers=auth_headers(admin_user),
    )
    assert status_update.status_code == 200, status_update.text

    public_index = await client.get("/api/reading-lists/public")
    assert public_index.status_code == 200
    list_row = next(row for row in public_index.json()["data"] if row["id"] == listing["id"])
    assert list_row["owner_username"] == test_user["username"]
    assert list_row["item_count"] == 0
    assert list_row["preview_items"] == []

    detail = await client.get(f"/api/reading-lists/{listing['id']}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["is_owner"] is False
    assert body["owner_username"] == test_user["username"]
    assert body["items"] == []

    # The owner still sees their own collection, including the now-draft work.
    owner_detail = await client.get(
        f"/api/reading-lists/{listing['id']}", headers=auth_headers(test_user)
    )
    assert owner_detail.status_code == 200
    owner_body = owner_detail.json()
    assert owner_body["is_owner"] is True
    assert [item["resource_id"] for item in owner_body["items"]] == [public_id]


async def test_private_list_is_not_in_public_index(client: AsyncClient, test_user: dict) -> None:
    private = await _create_list(client, test_user, name="Just for me", visibility="private")
    response = await client.get("/api/reading-lists/public")
    assert response.status_code == 200
    assert all(row["id"] != private["id"] for row in response.json()["data"])


async def test_topic_detail_related_work_and_author_link_repair(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    paper_id = await _create_resource(client, admin_user, title="Linked work for forum")
    draft_id = await _create_resource(
        client, admin_user, title="Draft work must stay hidden", publication_status="draft"
    )
    topic_response = await client.post(
        "/api/forum/topics",
        json={
            "title": "读完这篇之后的一个方法问题",
            "body": "这篇作品里的方法，放到小样本上还成立吗？",
            "category": "discussion",
            "paper_id": paper_id,
        },
        headers=auth_headers(test_user),
    )
    assert topic_response.status_code == 201, topic_response.text
    topic = topic_response.json()
    assert topic["paper_id"] == paper_id

    sibling_response = await client.post(
        "/api/forum/topics",
        json={
            "title": "同一篇作品的复现记录",
            "body": "我也按这篇作品的方法跑了一遍，记录一下差异。",
            "category": "discussion",
            "paper_id": paper_id,
        },
        headers=auth_headers(test_user),
    )
    assert sibling_response.status_code == 201, sibling_response.text

    related = await client.get(f"/api/forum/topics/{topic['id']}/related")
    assert related.status_code == 200, related.text
    body = related.json()
    assert body["paper"]["id"] == paper_id
    assert body["paper"]["title"] == "Linked work for forum"
    assert sibling_response.json()["id"] in {row["id"] for row in body["topics"]}
    assert body["topics"][0]["reason"] == "同一作品"

    cleared = await client.patch(
        f"/api/forum/topics/{topic['id']}/edit",
        json={"clear_paper": True},
        headers=auth_headers(test_user),
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["paper_id"] is None
    after_clear = (await client.get(f"/api/forum/topics/{topic['id']}/related")).json()
    assert after_clear["paper"] is None

    rejected = await client.patch(
        f"/api/forum/topics/{topic['id']}/edit",
        json={"paper_id": draft_id},
        headers=auth_headers(test_user),
    )
    assert rejected.status_code == 404
    assert "尚未公开" in rejected.json()["detail"]
    detail = (await client.get(f"/api/forum/topics/{topic['id']}")).json()
    assert detail["paper_id"] is None
