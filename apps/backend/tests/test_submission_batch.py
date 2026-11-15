"""Batch submission endpoint: one request, per-row outcomes.

The import page can select multiple parsed records.  The batch route must
create every valid row through the same moderation/similarity path as
``POST /submissions``, and a single rejected row must not hide or roll back
the rows around it.
"""

from __future__ import annotations

from conftest import auth_headers, register_user
from httpx import AsyncClient

_PAYLOAD = {
    "title": "Batch Imported Specimen",
    "type": "paper",
    "authors": ["Alice Author", "Bob Coauthor"],
    "year": 2024,
    "venue": "Journal of Testing",
    "discipline": "physics",
    "subdiscipline": "quantum",
    "tags": ["batch", "ingest"],
    "abstract": "A batch-submitted record used to test the import endpoint.",
    "preview": "Short batch preview.",
    "doi": "10.1234/batch.001",
}


def _payload(index: int) -> dict:
    item = dict(_PAYLOAD)
    item["title"] = f"{_PAYLOAD['title']} {index}"
    item["doi"] = f"10.1234/batch.{index}"
    return item


async def test_batch_requires_auth(client: AsyncClient) -> None:
    response = await client.post("/api/submissions/batch", json={"items": [_PAYLOAD]})
    assert response.status_code == 401


async def test_batch_creates_each_item(client: AsyncClient, test_user: dict) -> None:
    response = await client.post(
        "/api/submissions/batch",
        json={"items": [_payload(1), _payload(2)]},
        headers=auth_headers(test_user),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 2
    assert body["failed_count"] == 0
    assert [r["status"] for r in body["results"]] == ["created", "created"]
    assert all(r["submission_id"] > 0 for r in body["results"])

    listed = await client.get("/api/submissions/me", headers=auth_headers(test_user))
    assert listed.status_code == 200
    assert listed.json()["meta"]["total"] == 2


async def test_batch_keeps_good_rows_when_one_is_blocked(
    client: AsyncClient, test_user: dict
) -> None:
    blocked = _payload(2)
    blocked["title"] = "兼职日赚500"
    blocked["abstract"] = "加微信 xxx 拉你进群，刷单返利"
    response = await client.post(
        "/api/submissions/batch",
        json={"items": [_payload(1), blocked]},
        headers=auth_headers(test_user),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    assert body["failed_count"] == 1
    assert body["results"][0]["status"] == "created"
    assert body["results"][1]["status"] == "failed"
    assert body["results"][1]["code"] == "content_blocked"

    listed = await client.get("/api/submissions/me", headers=auth_headers(test_user))
    assert listed.status_code == 200
    assert listed.json()["meta"]["total"] == 1
    assert listed.json()["data"][0]["title"].startswith("Batch Imported Specimen")


async def test_batch_rejects_more_than_fifty_items(client: AsyncClient, test_user: dict) -> None:
    response = await client.post(
        "/api/submissions/batch",
        json={"items": [_payload(i) for i in range(51)]},
        headers=auth_headers(test_user),
    )
    assert response.status_code == 422


async def test_batch_requires_current_rules_ack(client: AsyncClient, test_user: dict) -> None:
    # ``test_user`` already accepted the current rules.  A fresh registration
    # has not, so it must be rejected before any row is created.
    unacked = await register_user(
        client,
        email="batch-unacked@example.com",
        username="batch-unacked",
    )
    response = await client.post(
        "/api/submissions/batch",
        json={"items": [_payload(1)]},
        headers=auth_headers(unacked),
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "rules_ack_required"
