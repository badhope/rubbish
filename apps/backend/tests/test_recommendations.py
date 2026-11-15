"""Integration tests for the recommendations module.

Covers the content-based engine: fallback when no history, tag-overlap
scoring, discipline boost, exclusion of already-read resources, limit
enforcement, and auth.

Test data is set up through the catalog + reader APIs (the same path
real users take) so the recommendations endpoint sees realistic rows.
"""

from __future__ import annotations

from conftest import auth_headers
from httpx import AsyncClient

_BASE_RESOURCE = {
    "type": "paper",
    "title": "Base Paper",
    "authors": ["Author A"],
    "year": 2024,
    "discipline": "computer-science",
    "subdiscipline": "machine-learning",
    "tags": ["test"],
    "abstract": "Abstract text.",
    "preview": "Preview text.",
}


async def _create_resource(client: AsyncClient, admin_user: dict, **overrides: object) -> int:
    """Create a catalog resource as admin and return its id."""
    payload: dict[str, object] = {**_BASE_RESOURCE, **overrides}
    response = await client.post(
        "/api/catalog",
        json=payload,
        headers=auth_headers(admin_user),
    )
    response.raise_for_status()
    return response.json()["id"]


async def _read_resource(client: AsyncClient, user: dict, resource_id: int) -> None:
    """Record a reading-history entry for the user via the reader API."""
    response = await client.post(
        f"/api/reader/history/{resource_id}",
        headers=auth_headers(user),
    )
    response.raise_for_status()


# ---------------------------------------------------------------------------
# Fallback (no reading history)
# ---------------------------------------------------------------------------


async def test_no_history_returns_latest(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    r1 = await _create_resource(client, admin_user, title="R1")
    await _create_resource(client, admin_user, title="R2")
    r3 = await _create_resource(client, admin_user, title="R3")

    response = await client.get("/api/recommendations/me", headers=auth_headers(test_user))
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 3
    for item in body["data"]:
        assert item["score"] == 0.0
    # Newest first (highest id created last).
    ids = [item["id"] for item in body["data"]]
    assert ids[0] == r3
    assert ids[-1] == r1


# ---------------------------------------------------------------------------
# With reading history
# ---------------------------------------------------------------------------


async def test_with_history_returns_recommendations(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    read_id = await _create_resource(client, admin_user, title="Read", tags=["python", "web"])
    cand_id = await _create_resource(
        client, admin_user, title="Cand", tags=["python", "web", "api"]
    )
    await _read_resource(client, test_user, read_id)

    response = await client.get("/api/recommendations/me", headers=auth_headers(test_user))
    body = response.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["id"] == cand_id
    assert body["data"][0]["score"] > 0.0


# ---------------------------------------------------------------------------
# Tag overlap ordering
# ---------------------------------------------------------------------------


async def test_more_tag_matches_scores_higher(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    read_id = await _create_resource(
        client,
        admin_user,
        title="Read",
        tags=["a", "b", "c"],
        discipline="physics",
        subdiscipline="quantum",
    )
    # Both candidates share discipline/subdiscipline that do NOT match the
    # profile, so only tag overlap differentiates them.
    c1 = await _create_resource(
        client,
        admin_user,
        title="C1",
        tags=["a", "b", "c"],
        discipline="biology",
        subdiscipline="genetics",
    )
    c2 = await _create_resource(
        client,
        admin_user,
        title="C2",
        tags=["a", "x", "y"],
        discipline="biology",
        subdiscipline="genetics",
    )
    await _read_resource(client, test_user, read_id)

    response = await client.get("/api/recommendations/me", headers=auth_headers(test_user))
    items = response.json()["data"]
    c1_item = next(i for i in items if i["id"] == c1)
    c2_item = next(i for i in items if i["id"] == c2)
    assert c1_item["score"] > c2_item["score"]
    assert items[0]["id"] == c1
    assert "matches 3 tags" in c1_item["reason"]


# ---------------------------------------------------------------------------
# Discipline match boost
# ---------------------------------------------------------------------------


async def test_discipline_match_boosts_score(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    read_id = await _create_resource(
        client,
        admin_user,
        title="Read",
        tags=["unique-tag-xyz"],
        discipline="cs",
        subdiscipline="ml",
    )
    # Both candidates have zero tag overlap; only discipline differs.
    c_a = await _create_resource(
        client,
        admin_user,
        title="A",
        tags=["different"],
        discipline="cs",
        subdiscipline="other",
    )
    c_b = await _create_resource(
        client,
        admin_user,
        title="B",
        tags=["different"],
        discipline="physics",
        subdiscipline="other",
    )
    await _read_resource(client, test_user, read_id)

    response = await client.get("/api/recommendations/me", headers=auth_headers(test_user))
    items = response.json()["data"]
    c_a_item = next(i for i in items if i["id"] == c_a)
    c_b_item = next(i for i in items if i["id"] == c_b)
    assert c_a_item["score"] > c_b_item["score"]
    assert c_b_item["score"] == 0.0
    assert "discipline" in c_a_item["reason"]


# ---------------------------------------------------------------------------
# Excludes already-read resources
# ---------------------------------------------------------------------------


async def test_excludes_read_resources(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    read_id = await _create_resource(client, admin_user, title="Read", tags=["shared"])
    other_id = await _create_resource(client, admin_user, title="Other", tags=["shared"])
    await _read_resource(client, test_user, read_id)

    response = await client.get("/api/recommendations/me", headers=auth_headers(test_user))
    ids = [i["id"] for i in response.json()["data"]]
    assert read_id not in ids
    assert other_id in ids


# ---------------------------------------------------------------------------
# Everything already read → fall back instead of an empty page
# ---------------------------------------------------------------------------


async def test_all_read_falls_back_to_latest(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    ids = [await _create_resource(client, admin_user, title=f"R{i}") for i in range(3)]
    for rid in ids:
        await _read_resource(client, test_user, rid)

    response = await client.get("/api/recommendations/me", headers=auth_headers(test_user))
    body = response.json()
    assert body["meta"]["total"] == 3
    # 已读完全部资源时不再返回空列表，而是回退到最新收录。
    for item in body["data"]:
        assert item["score"] == 0.0
        assert "showing latest" in item["reason"]


# ---------------------------------------------------------------------------
# Limit enforcement
# ---------------------------------------------------------------------------


async def test_respects_limit(client: AsyncClient, admin_user: dict, test_user: dict) -> None:
    read_id = await _create_resource(client, admin_user, title="Read", tags=["shared"])
    for i in range(5):
        await _create_resource(client, admin_user, title=f"C{i}", tags=["shared"])
    await _read_resource(client, test_user, read_id)

    response = await client.get("/api/recommendations/me?limit=3", headers=auth_headers(test_user))
    body = response.json()
    assert len(body["data"]) <= 3
    assert body["meta"]["page_size"] == 3


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


async def test_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/api/recommendations/me")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Limit upper bound
# ---------------------------------------------------------------------------


async def test_limit_exceeds_max_returns_422(client: AsyncClient, test_user: dict) -> None:
    response = await client.get("/api/recommendations/me?limit=51", headers=auth_headers(test_user))
    assert response.status_code == 422
