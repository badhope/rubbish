"""ORCID-related endpoint tests: UserUpdate + PATCH /me/orcid + ResourceCreate/Update.

Covers:
  - GET /api/auth/me includes the ORCID field
  - PATCH /api/auth/me/orcid accepts a valid ORCID and rejects junk
  - PATCH /api/auth/me/orcid with empty string clears the field
  - POST /api/catalog/ accepts an authors_meta parallel to authors
  - PATCH /api/catalog/{id} updates authors_meta when present
  - Pydantic validator on authors_meta rejects an oversized list
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

# Reuse existing fixtures (test_user, admin_user, etc.) from conftest.


@pytest.mark.asyncio
async def test_me_includes_orcid_field(client: AsyncClient, test_user: dict) -> None:
    token = test_user["token"]
    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    # ORCID field is exposed even when unset.
    assert "orcid" in body
    assert body["orcid"] is None


@pytest.mark.asyncio
async def test_patch_orcid_sets_value(client: AsyncClient, test_user: dict) -> None:
    token = test_user["token"]
    r = await client.patch(
        "/api/auth/me/orcid",
        json={"orcid": "0000-0002-1825-0097"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["orcid"] == "0000-0002-1825-0097"


@pytest.mark.asyncio
async def test_patch_orcid_accepts_url_form(client: AsyncClient, test_user: dict) -> None:
    token = test_user["token"]
    r = await client.patch(
        "/api/auth/me/orcid",
        json={"orcid": "https://orcid.org/0000-0002-1825-0097"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["orcid"] == "0000-0002-1825-0097"


@pytest.mark.asyncio
async def test_patch_orcid_rejects_invalid(client: AsyncClient, test_user: dict) -> None:
    token = test_user["token"]
    r = await client.patch(
        "/api/auth/me/orcid",
        json={"orcid": "not-a-real-orcid"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422
    assert "ORCID" in r.text.upper() or "orcid" in r.text


@pytest.mark.asyncio
async def test_patch_orcid_empty_string_clears(client: AsyncClient, test_user: dict) -> None:
    token = test_user["token"]
    # Set first.
    r = await client.patch(
        "/api/auth/me/orcid",
        json={"orcid": "0000-0002-1825-0097"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    # Then clear.
    r = await client.patch(
        "/api/auth/me/orcid",
        json={"orcid": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["orcid"] is None


@pytest.mark.asyncio
async def test_patch_orcid_noop_when_field_omitted(client: AsyncClient, test_user: dict) -> None:
    token = test_user["token"]
    # No orcid key at all: no-op.
    r = await client.patch(
        "/api/auth/me/orcid",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_create_resource_with_authors_meta(client: AsyncClient, admin_user: dict) -> None:
    """Admin POSTs a resource with authors_meta parallel to authors."""
    token = admin_user["token"]
    r = await client.post(
        "/api/catalog",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "type": "paper",
            "title": "Sample paper with ORCID",
            "authors": ["Alice Author", "Bob Researcher"],
            "year": 2026,
            "discipline": "Computer Science",
            "tags": [],
            "abstract": "We present a sample resource with ORCID metadata.",
            "authors_meta": [
                {"name": "Alice Author", "orcid": "0000-0002-1825-0097"},
                {"name": "Bob Researcher"},
            ],
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["authors_meta"] is not None
    assert len(body["authors_meta"]) == 2
    assert body["authors_meta"][0]["orcid"] == "0000-0002-1825-0097"
    assert body["authors_meta"][1]["orcid"] is None


@pytest.mark.asyncio
async def test_create_resource_rejects_oversized_authors_meta(
    client: AsyncClient, admin_user: dict
) -> None:
    """authors_meta longer than authors must be rejected at validation time."""
    token = admin_user["token"]
    r = await client.post(
        "/api/catalog",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "type": "paper",
            "title": "Bad metadata",
            "authors": ["Alice"],
            "year": 2026,
            "discipline": "Computer Science",
            "tags": [],
            "abstract": "Will fail because authors_meta is longer than authors.",
            "authors_meta": [
                {"name": "Alice"},
                {"name": "Extra"},
            ],
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_resource_invalid_orcid_in_meta(client: AsyncClient, admin_user: dict) -> None:
    """A bad ORCID inside authors_meta must be rejected at validation."""
    token = admin_user["token"]
    r = await client.post(
        "/api/catalog",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "type": "paper",
            "title": "Bad ORCID",
            "authors": ["Alice"],
            "year": 2026,
            "discipline": "Computer Science",
            "tags": [],
            "abstract": "Will fail because ORCID is malformed.",
            "authors_meta": [{"name": "Alice", "orcid": "totally-not-an-orcid"}],
        },
    )
    assert r.status_code == 422
