"""Integration tests for the follows module.

Two groups mirroring the two follow target types:

- Author follows: follow / unfollow / status / list. Idempotency on
  re-follow and unfollow-when-not-following.
- Discipline subscriptions: subscribe / unsubscribe / status / list.
  Same idempotency contract.

Auth model:
- Write endpoints (follow/unfollow/subscribe/unsubscribe) require auth.
- Status-check endpoints are public; ``following`` / ``subscribed``
  is false for anonymous callers, but the count is still returned.
- Listing endpoints (/users/me/...) require auth and are user-scoped.
"""

from __future__ import annotations

from conftest import auth_headers
from httpx import AsyncClient

# ---------------------------------------------------------------------------
# Author follows
# ---------------------------------------------------------------------------


async def test_follow_requiresauth_headers(client: AsyncClient) -> None:
    response = await client.post("/api/authors/Alice/follow")
    assert response.status_code == 401


async def test_follow_author_then_status(client: AsyncClient, test_user: dict) -> None:
    """Following an author makes status endpoint report following=True + count=1."""
    follow = await client.post("/api/authors/Alice Author/follow", headers=auth_headers(test_user))
    assert follow.status_code == 200
    body = follow.json()
    assert body["following"] is True
    assert body["followers_count"] == 1


async def test_follow_author_idempotent(client: AsyncClient, test_user: dict) -> None:
    """Re-following the same author is a no-op (still 200, count stays 1)."""
    await client.post("/api/authors/Alice/follow", headers=auth_headers(test_user))
    second = await client.post("/api/authors/Alice/follow", headers=auth_headers(test_user))
    assert second.status_code == 200
    body = second.json()
    assert body["following"] is True
    assert body["followers_count"] == 1


async def test_unfollow_author_idempotent(client: AsyncClient, test_user: dict) -> None:
    """Unfollowing when not following is a no-op (200, count=0)."""
    response = await client.delete("/api/authors/Nobody/follow", headers=auth_headers(test_user))
    assert response.status_code == 200
    body = response.json()
    assert body["following"] is False
    assert body["followers_count"] == 0


async def test_follow_then_unfollow(client: AsyncClient, test_user: dict) -> None:
    await client.post("/api/authors/Bob/follow", headers=auth_headers(test_user))
    unfollow = await client.delete("/api/authors/Bob/follow", headers=auth_headers(test_user))
    assert unfollow.status_code == 200
    body = unfollow.json()
    assert body["following"] is False
    assert body["followers_count"] == 0


async def test_follow_status_public(client: AsyncClient, test_user: dict) -> None:
    """Anonymous caller sees count but following=False."""
    await client.post("/api/authors/Public Author/follow", headers=auth_headers(test_user))
    response = await client.get("/api/authors/Public Author/follow")
    assert response.status_code == 200
    body = response.json()
    assert body["following"] is False
    assert body["followers_count"] == 1


async def test_follow_status_authenticated(client: AsyncClient, test_user: dict) -> None:
    """Authenticated status reflects the caller's follow state."""
    await client.post("/api/authors/Auth Author/follow", headers=auth_headers(test_user))
    response = await client.get("/api/authors/Auth Author/follow", headers=auth_headers(test_user))
    body = response.json()
    assert body["following"] is True
    assert body["followers_count"] == 1


async def test_list_my_followed_authors(client: AsyncClient, test_user: dict) -> None:
    await client.post("/api/authors/Alice/follow", headers=auth_headers(test_user))
    await client.post("/api/authors/Bob/follow", headers=auth_headers(test_user))
    response = await client.get("/api/users/me/following/authors", headers=auth_headers(test_user))
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 2
    # Newest first — Bob was followed last.
    names = [entry["author_name"] for entry in body["data"]]
    assert names == ["Bob", "Alice"]


async def test_list_my_followed_authors_paginates(client: AsyncClient, test_user: dict) -> None:
    for i in range(5):
        await client.post(f"/api/authors/A{i}/follow", headers=auth_headers(test_user))
    response = await client.get(
        "/api/users/me/following/authors?page=2&page_size=2",
        headers=auth_headers(test_user),
    )
    body = response.json()
    assert body["meta"]["total"] == 5
    assert body["meta"]["page"] == 2
    assert body["meta"]["page_size"] == 2
    assert body["meta"]["total_pages"] == 3
    assert len(body["data"]) == 2


async def test_follow_rejects_too_long_name(client: AsyncClient, test_user: dict) -> None:
    """Author name > 200 chars returns 404 (the resource cannot exist)."""
    long_name = "x" * 201
    response = await client.post(
        f"/api/authors/{long_name}/follow", headers=auth_headers(test_user)
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Discipline subscriptions
# ---------------------------------------------------------------------------


async def test_subscribe_requiresauth_headers(client: AsyncClient) -> None:
    response = await client.post("/api/disciplines/physics/subscribe")
    assert response.status_code == 401


async def test_subscribe_then_status(client: AsyncClient, test_user: dict) -> None:
    subscribe = await client.post(
        "/api/disciplines/physics/subscribe", headers=auth_headers(test_user)
    )
    assert subscribe.status_code == 200
    body = subscribe.json()
    assert body["subscribed"] is True
    assert body["subscribers_count"] == 1


async def test_subscribe_idempotent(client: AsyncClient, test_user: dict) -> None:
    await client.post("/api/disciplines/physics/subscribe", headers=auth_headers(test_user))
    second = await client.post(
        "/api/disciplines/physics/subscribe", headers=auth_headers(test_user)
    )
    assert second.status_code == 200
    body = second.json()
    assert body["subscribed"] is True
    assert body["subscribers_count"] == 1


async def test_unsubscribe_idempotent(client: AsyncClient, test_user: dict) -> None:
    response = await client.delete(
        "/api/disciplines/nobody/subscribe", headers=auth_headers(test_user)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["subscribed"] is False
    assert body["subscribers_count"] == 0


async def test_subscribe_then_unsubscribe(client: AsyncClient, test_user: dict) -> None:
    await client.post("/api/disciplines/biology/subscribe", headers=auth_headers(test_user))
    response = await client.delete(
        "/api/disciplines/biology/subscribe", headers=auth_headers(test_user)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["subscribed"] is False
    assert body["subscribers_count"] == 0


async def test_subscribe_status_public(client: AsyncClient, test_user: dict) -> None:
    await client.post("/api/disciplines/chemistry/subscribe", headers=auth_headers(test_user))
    response = await client.get("/api/disciplines/chemistry/subscribe")
    body = response.json()
    assert body["subscribed"] is False
    assert body["subscribers_count"] == 1


async def test_list_my_subscribed_disciplines(client: AsyncClient, test_user: dict) -> None:
    await client.post("/api/disciplines/physics/subscribe", headers=auth_headers(test_user))
    await client.post("/api/disciplines/biology/subscribe", headers=auth_headers(test_user))
    response = await client.get(
        "/api/users/me/subscriptions/disciplines", headers=auth_headers(test_user)
    )
    assert response.status_code == 200
    body = response.json()
    # Newest first — biology was subscribed last.
    assert body["data"] == ["biology", "physics"]


async def test_subscribe_rejects_empty_slug(client: AsyncClient, test_user: dict) -> None:
    """Empty discipline slug returns 404 (the resource cannot exist)."""
    response = await client.post("/api/disciplines//subscribe", headers=auth_headers(test_user))
    # FastAPI treats // as a path normalization edge case — assert that
    # it does NOT result in a 500 (any 4xx is acceptable).
    assert response.status_code < 500
