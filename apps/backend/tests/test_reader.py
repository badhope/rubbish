"""Integration tests for the reader module.

Three groups:

- History endpoints (auth required, every user sees their own history):
  list / record view / remove.
- Progress endpoints (auth required): get / upsert with duration_sec
  accumulation and IntegrityError retry semantics.
- FileAsset endpoints (admin only): list / get / create / delete with
  per-tenant sha256 dedup.

History tests need a catalog Resource to exist first, so they use the
admin_user fixture to create one, then the test_user fixture to interact
with the reader endpoints (a normal user's reading history is the
canonical flow).
"""

from __future__ import annotations

from conftest import auth_headers
from httpx import AsyncClient

_RESOURCE = {
    "type": "paper",
    "title": "Reader Test Paper",
    "authors": ["Alice Author"],
    "year": 2024,
    "venue": "Journal of Testing",
    "discipline": "computer-science",
    "subdiscipline": "machine-learning",
    "tags": ["test"],
    "abstract": "Test abstract for reader module.",
    "preview": "Test preview.",
    "doi": "10.1234/reader.1",
}


async def _create_resource(client: AsyncClient, admin_user: dict) -> int:
    """Helper: create a catalog resource as admin and return its id."""
    response = await client.post(
        "/api/catalog",
        json=_RESOURCE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    response.raise_for_status()
    return response.json()["id"]


# ---------------------------------------------------------------------------
# History endpoints
# ---------------------------------------------------------------------------


async def test_history_requiresauth_headers(client: AsyncClient) -> None:
    response = await client.get("/api/reader/history")
    assert response.status_code == 401


async def test_history_empty(client: AsyncClient, test_user: dict) -> None:
    response = await client.get("/api/reader/history", headers=auth_headers(test_user))
    assert response.status_code == 200
    body = response.json()
    assert body["data"] == []
    assert body["meta"]["total"] == 0


async def test_record_view_creates_entry(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    rid = await _create_resource(client, admin_user)
    response = await client.post(f"/api/reader/history/{rid}", headers=auth_headers(test_user))
    assert response.status_code == 201
    assert response.json()["message"] == "Added to history"

    # The entry shows up in the user's history.
    history = await client.get("/api/reader/history", headers=auth_headers(test_user))
    body = history.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["resource_id"] == rid
    assert body["data"][0]["visit_count"] == 1


async def test_record_view_bumps_visit_count(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    rid = await _create_resource(client, admin_user)
    await client.post(f"/api/reader/history/{rid}", headers=auth_headers(test_user))
    await client.post(f"/api/reader/history/{rid}", headers=auth_headers(test_user))
    await client.post(f"/api/reader/history/{rid}", headers=auth_headers(test_user))

    history = await client.get("/api/reader/history", headers=auth_headers(test_user))
    entry = history.json()["data"][0]
    assert entry["visit_count"] == 3


async def test_record_view_404_on_missing_resource(client: AsyncClient, test_user: dict) -> None:
    response = await client.post("/api/reader/history/99999", headers=auth_headers(test_user))
    assert response.status_code == 404


async def test_remove_from_history(client: AsyncClient, admin_user: dict, test_user: dict) -> None:
    rid = await _create_resource(client, admin_user)
    await client.post(f"/api/reader/history/{rid}", headers=auth_headers(test_user))
    assert (await client.get("/api/reader/history", headers=auth_headers(test_user))).json()[
        "meta"
    ]["total"] == 1

    delete = await client.delete(f"/api/reader/history/{rid}", headers=auth_headers(test_user))
    assert delete.status_code == 200
    assert (await client.get("/api/reader/history", headers=auth_headers(test_user))).json()[
        "meta"
    ]["total"] == 0


async def test_remove_from_history_404_when_absent(client: AsyncClient, test_user: dict) -> None:
    response = await client.delete("/api/reader/history/99999", headers=auth_headers(test_user))
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Progress endpoints
# ---------------------------------------------------------------------------


async def test_get_progress_404_when_no_history(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    rid = await _create_resource(client, admin_user)
    response = await client.get(
        f"/api/reader/history/{rid}/progress", headers=auth_headers(test_user)
    )
    assert response.status_code == 404


async def test_put_progress_creates_entry(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    rid = await _create_resource(client, admin_user)
    response = await client.put(
        f"/api/reader/history/{rid}/progress",
        json={
            "page": 5,
            "progress_percent": 25.0,
            "duration_sec": 120,
            "completed": False,
        },
        headers=auth_headers(test_user),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["resource_id"] == rid
    assert data["page"] == 5
    assert data["progress_percent"] == 25.0
    assert data["duration_sec"] == 120
    assert data["visit_count"] == 1
    assert data["completed"] is False
    assert data["last_read_at"] is not None
    assert data["viewed_at"] is not None


async def test_put_progress_accumulates_duration(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    """duration_sec accumulates across PUTs — never overwrites."""
    rid = await _create_resource(client, admin_user)
    first = await client.put(
        f"/api/reader/history/{rid}/progress",
        json={"duration_sec": 120},
        headers=auth_headers(test_user),
    )
    assert first.status_code == 200
    assert first.json()["duration_sec"] == 120

    second = await client.put(
        f"/api/reader/history/{rid}/progress",
        json={"duration_sec": 60, "page": 10, "progress_percent": 50.0},
        headers=auth_headers(test_user),
    )
    assert second.status_code == 200
    data = second.json()
    assert data["duration_sec"] == 180  # 120 + 60
    assert data["page"] == 10
    assert data["progress_percent"] == 50.0
    # visit_count stays at 1 — PUT progress does not bump it (POST view does).
    assert data["visit_count"] == 1


async def test_put_progress_marks_completed(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    rid = await _create_resource(client, admin_user)
    response = await client.put(
        f"/api/reader/history/{rid}/progress",
        json={"progress_percent": 100.0, "completed": True},
        headers=auth_headers(test_user),
    )
    assert response.status_code == 200
    assert response.json()["completed"] is True


async def test_put_progress_404_on_missing_resource(client: AsyncClient, test_user: dict) -> None:
    response = await client.put(
        "/api/reader/history/99999/progress",
        json={"page": 1},
        headers=auth_headers(test_user),
    )
    assert response.status_code == 404


async def test_put_progress_rejects_invalid_percent(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    rid = await _create_resource(client, admin_user)
    response = await client.put(
        f"/api/reader/history/{rid}/progress",
        json={"progress_percent": 150.0},
        headers=auth_headers(test_user),
    )
    assert response.status_code == 422


async def test_put_then_get_progress_round_trip(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    rid = await _create_resource(client, admin_user)
    await client.put(
        f"/api/reader/history/{rid}/progress",
        json={"page": 7, "progress_percent": 33.5, "duration_sec": 45},
        headers=auth_headers(test_user),
    )
    response = await client.get(
        f"/api/reader/history/{rid}/progress", headers=auth_headers(test_user)
    )
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 7
    assert data["progress_percent"] == 33.5
    assert data["duration_sec"] == 45


# ---------------------------------------------------------------------------
# FileAsset endpoints (admin only)
# ---------------------------------------------------------------------------


_FILE_ASSET = {
    "filename": "abc123.pdf",
    "original_filename": "Manuscript v3.pdf",
    "mime_type": "application/pdf",
    "file_size": 1048576,
    # storage_path must be relative; absolute paths and .. are rejected by the validator.
    "storage_path": "data/files/abc123.pdf",
    "storage_backend": "local",
    "sha256": "a" * 64,
}


async def test_file_assets_require_admin(client: AsyncClient, test_user: dict) -> None:
    response = await client.get("/api/reader/file-assets", headers=auth_headers(test_user))
    assert response.status_code == 403


async def test_file_assets_requireauth_headers(client: AsyncClient) -> None:
    response = await client.get("/api/reader/file-assets")
    assert response.status_code == 401


async def test_create_file_asset(client: AsyncClient, admin_user: dict) -> None:
    response = await client.post(
        "/api/reader/file-assets",
        json=_FILE_ASSET,
        headers=auth_headers(admin_user),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["id"] > 0
    assert body["filename"] == "abc123.pdf"
    assert body["mime_type"] == "application/pdf"
    assert body["file_size"] == 1048576
    assert body["sha256"] == "a" * 64
    assert body["uploaded_by"] == admin_user["user_id"]


async def test_list_file_assets(client: AsyncClient, admin_user: dict) -> None:
    # Start empty.
    empty = await client.get("/api/reader/file-assets", headers=auth_headers(admin_user))
    assert empty.status_code == 200
    assert empty.json() == []

    # Create one and list again.
    await client.post(
        "/api/reader/file-assets",
        json=_FILE_ASSET,
        headers=auth_headers(admin_user),
    )
    listed = await client.get("/api/reader/file-assets", headers=auth_headers(admin_user))
    assert listed.status_code == 200
    body = listed.json()
    assert len(body) == 1
    assert body[0]["filename"] == "abc123.pdf"


async def test_get_file_asset(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/reader/file-assets",
        json=_FILE_ASSET,
        headers=auth_headers(admin_user),
    )
    asset_id = create.json()["id"]

    response = await client.get(
        f"/api/reader/file-assets/{asset_id}", headers=auth_headers(admin_user)
    )
    assert response.status_code == 200
    assert response.json()["id"] == asset_id


async def test_get_file_asset_404(client: AsyncClient, admin_user: dict) -> None:
    response = await client.get("/api/reader/file-assets/99999", headers=auth_headers(admin_user))
    assert response.status_code == 404


async def test_create_file_asset_rejects_duplicate_sha256(
    client: AsyncClient, admin_user: dict
) -> None:
    first = await client.post(
        "/api/reader/file-assets",
        json=_FILE_ASSET,
        headers=auth_headers(admin_user),
    )
    assert first.status_code == 201

    # Same sha256, different filename — should 409.
    second = await client.post(
        "/api/reader/file-assets",
        json={**_FILE_ASSET, "filename": "different.pdf"},
        headers=auth_headers(admin_user),
    )
    assert second.status_code == 409


async def test_create_file_asset_allows_null_sha256(client: AsyncClient, admin_user: dict) -> None:
    """Multiple FileAssets with NULL sha256 are allowed (no dedup when hash unknown)."""
    no_hash = {**_FILE_ASSET, "sha256": None}
    first = await client.post(
        "/api/reader/file-assets",
        json={**no_hash, "filename": "first.pdf"},
        headers=auth_headers(admin_user),
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/reader/file-assets",
        json={**no_hash, "filename": "second.pdf"},
        headers=auth_headers(admin_user),
    )
    assert second.status_code == 201


async def test_delete_file_asset(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/reader/file-assets",
        json=_FILE_ASSET,
        headers=auth_headers(admin_user),
    )
    asset_id = create.json()["id"]

    delete = await client.delete(
        f"/api/reader/file-assets/{asset_id}", headers=auth_headers(admin_user)
    )
    assert delete.status_code == 200

    # Subsequent GET returns 404.
    response = await client.get(
        f"/api/reader/file-assets/{asset_id}", headers=auth_headers(admin_user)
    )
    assert response.status_code == 404


async def test_delete_file_asset_404(client: AsyncClient, admin_user: dict) -> None:
    response = await client.delete(
        "/api/reader/file-assets/99999", headers=auth_headers(admin_user)
    )
    assert response.status_code == 404
