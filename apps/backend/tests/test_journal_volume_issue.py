"""Volume / Issue first-class objects: create, edit, assign, sync."""

from __future__ import annotations

from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.domain.catalog.models import Issue, Resource

_SAMPLE = {
    "type": "paper",
    "title": "Volume Sync Paper",
    "authors": ["Alice Author"],
    "year": 2026,
    "venue": "Journal of Testing",
    "discipline": "computer-science",
    "abstract": "Abstract for volume sync.",
    "preview": "Preview for volume sync.",
    "publication_status": "published",
    "volume": "10",
    "issue": "2",
    "language": "en",
}


async def test_resource_create_syncs_issue_and_lists_empty_issue(
    client: AsyncClient, admin_user: dict, db_session: AsyncSession
) -> None:
    response = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 201
    resource_id = response.json()["id"]

    resource = (
        await db_session.execute(select(Resource).where(Resource.id == resource_id))
    ).scalar_one()
    assert resource.issue_id is not None

    issue = (
        await db_session.execute(select(Issue).where(Issue.id == resource.issue_id))
    ).scalar_one()
    assert issue.number == "2"
    assert issue.status == "live"

    public_issues = await client.get("/api/catalog/issues")
    assert public_issues.status_code == 200
    public_rows = public_issues.json()["data"]
    assert len(public_rows) == 1
    assert public_rows[0]["id"] == issue.id
    assert public_rows[0]["article_count"] == 1

    filtered = await client.get(f"/api/catalog?issue_id={issue.id}")
    assert filtered.status_code == 200
    assert [row["id"] for row in filtered.json()["data"]] == [resource_id]

    # Admin registry includes the auto-created volume and issue.
    listing = await client.get(
        "/api/admin/journal/volumes",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert listing.status_code == 200
    volumes = listing.json()["items"]
    assert len(volumes) == 1
    assert volumes[0]["number"] == "10"
    assert volumes[0]["issues"][0]["number"] == "2"
    assert volumes[0]["issues"][0]["article_count"] == 1

    # Creating another empty issue under the same volume is allowed and
    # does not require any article to exist yet.
    create_issue = await client.post(
        "/api/admin/journal/volumes/10/issues",
        json={"number": "3", "title": "Empty Issue", "status": "draft"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    # Volume lookup uses the numeric id, not the number.
    assert create_issue.status_code == 404
    create_issue = await client.post(
        f"/api/admin/journal/volumes/{volumes[0]['id']}/issues",
        json={"number": "3", "title": "Empty Issue", "status": "draft"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert create_issue.status_code == 201
    empty_issue_id = create_issue.json()["id"]

    # Edit title/intro and schedule it.
    patch = await client.patch(
        f"/api/admin/journal/issues/{empty_issue_id}",
        json={
            "title": "Issue Three",
            "intro": "An issue with no articles yet.",
            "status": "scheduled",
            "publish_at": (utcnow() + timedelta(days=7)).isoformat(),
        },
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert patch.status_code == 200
    assert patch.json()["title"] == "Issue Three"
    assert patch.json()["status"] == "scheduled"

    # Move the paper to the empty issue; legacy strings must follow.
    assign = await client.post(
        f"/api/admin/journal/issues/{empty_issue_id}/resources",
        json={"resource_ids": [resource_id]},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert assign.status_code == 200
    assert assign.json()["assigned"] == 1

    await db_session.refresh(resource)
    assert resource.issue_id == empty_issue_id
    assert resource.volume == "10"
    assert resource.issue == "3"

    # Remove it again; issue_id and legacy strings clear together.
    remove = await client.delete(
        f"/api/admin/journal/issues/{empty_issue_id}/resources/{resource_id}",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert remove.status_code == 204
    await db_session.refresh(resource)
    assert resource.issue_id is None
    assert resource.volume is None
    assert resource.issue is None

    # Empty issue can be deleted; an issue with articles refuses.
    delete_empty = await client.delete(
        f"/api/admin/journal/issues/{empty_issue_id}",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert delete_empty.status_code == 204


async def test_create_volume_and_duplicate_number(client: AsyncClient, admin_user: dict) -> None:
    first = await client.post(
        "/api/admin/journal/volumes",
        json={"number": "11", "title": "Volume Eleven", "year": 2026},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert first.status_code == 201
    assert first.json()["issue_count"] == 0

    duplicate = await client.post(
        "/api/admin/journal/volumes",
        json={"number": "11"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert duplicate.status_code == 409
