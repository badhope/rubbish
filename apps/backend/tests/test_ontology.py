"""Discipline ontology endpoint tests + resource validation enforcement.

Covers:
  - GET /api/catalog/disciplines (public) returns empty list initially
  - POST /api/catalog/disciplines (admin) creates a discipline + subs
  - POST duplicates return 409
  - POST a resource with unknown discipline returns 422
  - POST a resource with subdiscipline not matching discipline returns 422
  - PATCH /api/catalog/disciplines/{slug} updates name/description
  - DELETE /api/catalog/disciplines/{slug} removes (subdisciplines cascade)
  - Subdiscipline add/remove endpoints
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

# --- Helpers ---------------------------------------------------------------


async def _create_discipline(
    client: AsyncClient, admin_user: dict, slug: str = "computer-science"
) -> dict:
    """Create a discipline + one subdiscipline via the admin API."""
    r = await client.post(
        "/api/catalog/disciplines",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={
            "slug": slug,
            "name": slug.replace("-", " ").title(),
            "description": f"Discipline {slug}",
            "subdisciplines": [{"slug": "machine-learning", "name": "Machine Learning"}],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


# --- Public read -----------------------------------------------------------


@pytest.mark.asyncio
async def test_list_disciplines_empty(client: AsyncClient) -> None:
    # Warm the tenant context so require_tenant_id() resolves.
    warmup = await client.get("/api/health")
    assert warmup.status_code == 200
    r = await client.get("/api/catalog/disciplines")
    assert r.status_code == 200, r.text
    assert r.json() == []


@pytest.mark.asyncio
async def test_list_disciplines_after_create(client: AsyncClient, admin_user: dict) -> None:
    await _create_discipline(client, admin_user, slug="computer-science")
    r = await client.get("/api/catalog/disciplines")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["slug"] == "computer-science"
    assert body[0]["name"] == "Computer Science"
    assert len(body[0]["subdisciplines"]) == 1
    assert body[0]["subdisciplines"][0]["slug"] == "machine-learning"


# --- Admin write -----------------------------------------------------------


@pytest.mark.asyncio
async def test_create_discipline_requires_admin(client: AsyncClient, test_user: dict) -> None:
    r = await client.post(
        "/api/catalog/disciplines",
        headers={"Authorization": f"Bearer {test_user['token']}"},
        json={"slug": "physics", "name": "Physics"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_create_duplicate_returns_409(client: AsyncClient, admin_user: dict) -> None:
    await _create_discipline(client, admin_user, slug="physics")
    r = await client.post(
        "/api/catalog/disciplines",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={"slug": "physics", "name": "Physics"},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_update_discipline(client: AsyncClient, admin_user: dict) -> None:
    await _create_discipline(client, admin_user, slug="physics")
    r = await client.patch(
        "/api/catalog/disciplines/physics",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={"name": "Physics & Astronomy"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Physics & Astronomy"


@pytest.mark.asyncio
async def test_delete_discipline(client: AsyncClient, admin_user: dict) -> None:
    await _create_discipline(client, admin_user, slug="physics")
    r = await client.delete(
        "/api/catalog/disciplines/physics",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert r.status_code == 204
    r = await client.get("/api/catalog/disciplines")
    assert r.json() == []


# --- Subdiscipline management ---------------------------------------------


@pytest.mark.asyncio
async def test_add_subdiscipline(client: AsyncClient, admin_user: dict) -> None:
    await _create_discipline(client, admin_user, slug="biology")
    r = await client.post(
        "/api/catalog/disciplines/biology/subdisciplines",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={"slug": "genetics", "name": "Genetics"},
    )
    assert r.status_code == 201
    assert r.json()["slug"] == "genetics"


@pytest.mark.asyncio
async def test_remove_subdiscipline(client: AsyncClient, admin_user: dict) -> None:
    await _create_discipline(client, admin_user, slug="biology")
    r = await client.delete(
        "/api/catalog/disciplines/biology/subdisciplines/machine-learning",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert r.status_code == 204


# --- Resource validation enforcement --------------------------------------


@pytest.mark.asyncio
async def test_create_resource_unknown_discipline_422(
    client: AsyncClient, admin_user: dict
) -> None:
    """Without a matching discipline, the resource POST must 422."""
    # Seed at least one discipline so the ontology enters strict mode
    # (empty ontology = unconfigured = any discipline allowed).
    await _create_discipline(client, admin_user, slug="computer-science")
    r = await client.post(
        "/api/catalog",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={
            "type": "paper",
            "title": "Orphan resource",
            "authors": ["Lonely Author"],
            "year": 2026,
            "discipline": "Unlisted Discipline",
            "tags": [],
            "abstract": "This resource has no matching discipline in the ontology.",
        },
    )
    assert r.status_code == 422
    assert "Unknown discipline" in r.text


@pytest.mark.asyncio
async def test_create_resource_subdiscipline_mismatch_422(
    client: AsyncClient, admin_user: dict
) -> None:
    """A subdiscipline that exists but belongs to a different discipline fails."""
    await _create_discipline(client, admin_user, slug="computer-science")
    r = await client.post(
        "/api/catalog",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={
            "type": "paper",
            "title": "Mismatched subdiscipline",
            "authors": ["Alice"],
            "year": 2026,
            "discipline": "Computer Science",
            "subdiscipline": "Genetics",  # doesn't exist anywhere
            "tags": [],
            "abstract": "Should fail because subdiscipline doesn't belong.",
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_resource_with_valid_discipline_succeeds(
    client: AsyncClient, admin_user: dict
) -> None:
    """Sanity: a discipline that exists lets the resource through."""
    await _create_discipline(client, admin_user, slug="computer-science")
    r = await client.post(
        "/api/catalog",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={
            "type": "paper",
            "title": "Valid resource",
            "authors": ["Alice"],
            "year": 2026,
            "discipline": "Computer Science",
            "subdiscipline": "Machine Learning",
            "tags": [],
            "abstract": "A clean resource with valid taxonomy.",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["discipline"] == "Computer Science"
    assert body["subdiscipline"] == "Machine Learning"


@pytest.mark.asyncio
async def test_update_resource_subdiscipline_mismatch_422(
    client: AsyncClient, admin_user: dict
) -> None:
    """Updating an existing resource to a wrong taxonomy must 422."""
    await _create_discipline(client, admin_user, slug="computer-science")
    # Create the resource.
    r = await client.post(
        "/api/catalog",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={
            "type": "paper",
            "title": "Taxonomy drift test",
            "authors": ["Alice"],
            "year": 2026,
            "discipline": "Computer Science",
            "subdiscipline": "Machine Learning",
            "tags": [],
            "abstract": "Will be patched with bad taxonomy.",
        },
    )
    assert r.status_code == 201
    rid = r.json()["id"]

    # Now patch to an invalid subdiscipline.
    r = await client.patch(
        f"/api/catalog/{rid}",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={"subdiscipline": "Genetics (not registered)"},
    )
    assert r.status_code == 422
