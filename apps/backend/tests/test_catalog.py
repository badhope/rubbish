"""Catalog module tests — CRUD + stats + facets + auth."""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.storage import get_storage
from app.models import Tenant
from app.modules.submission.models import Submission

_SAMPLE = {
    "type": "paper",
    "title": "A Test Paper",
    "authors": ["Alice Author", "Bob Reviewer"],
    "year": 2024,
    "venue": "Journal of Testing",
    "discipline": "computer-science",
    "subdiscipline": "machine-learning",
    "tags": ["test", "pytest"],
    "abstract": "This is a test abstract.",
    "preview": "Test preview text.",
    # DOI 现在有唯一约束（迁移 002），同一份夹具多次创建会撞号；
    # 需要唯一 DOI 的用例自行覆盖，这里留空。
    "doi": None,
    "volume": "10",
    "issue": "2",
    "pages": "1-20",
    "keywords": ["testing", "fixtures"],
    "language": "en",
    "publication_status": "published",
}


async def test_create_requires_admin(client: AsyncClient, test_user: dict) -> None:
    response = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {test_user['token']}"},
    )
    assert response.status_code == 403


async def test_create_returns_201(client: AsyncClient, admin_user: dict) -> None:
    response = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["id"] > 0
    assert body["title"] == "A Test Paper"
    assert body["authors"] == ["Alice Author", "Bob Reviewer"]
    assert body["discipline"] == "computer-science"
    assert body["doi"] is None
    assert "created_at" in body
    assert "updated_at" in body


async def test_create_without_preview_autofills_from_abstract(
    client: AsyncClient, admin_user: dict
) -> None:
    """preview 留空时自动从 abstract 截取（与 SubmissionCreate 一致）。"""
    payload = dict(_SAMPLE)
    payload.pop("preview")
    response = await client.post(
        "/api/catalog",
        json=payload,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["preview"]
    assert body["preview"] == payload["abstract"][:500]


async def test_create_with_slug(client: AsyncClient, admin_user: dict) -> None:
    payload = {**_SAMPLE, "slug": "test-paper-2024"}
    response = await client.post(
        "/api/catalog",
        json=payload,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 201
    assert response.json()["slug"] == "test-paper-2024"


async def test_create_rejects_duplicate_slug(client: AsyncClient, admin_user: dict) -> None:
    payload = {**_SAMPLE, "slug": "dup-slug"}
    r1 = await client.post(
        "/api/catalog",
        json=payload,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert r1.status_code == 201

    r2 = await client.post(
        "/api/catalog",
        json=payload,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert r2.status_code == 409


async def test_create_rejects_bad_url(client: AsyncClient, admin_user: dict) -> None:
    payload = {**_SAMPLE, "download_url": "ftp://bad-scheme"}
    response = await client.post(
        "/api/catalog",
        json=payload,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 422


async def test_list_returns_empty_when_no_records(client: AsyncClient) -> None:
    response = await client.get("/api/catalog")
    assert response.status_code == 200
    body = response.json()
    assert body["data"] == []
    assert body["meta"]["total"] == 0
    assert body["meta"]["page"] == 1
    assert body["meta"]["total_pages"] == 0


async def test_list_returns_created_record(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    response = await client.get("/api/catalog")
    body = response.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["id"] == rid


async def test_list_filters_by_type(client: AsyncClient, admin_user: dict) -> None:
    await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    await client.post(
        "/api/catalog",
        json={**_SAMPLE, "type": "book", "title": "A Test Book"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )

    r_all = await client.get("/api/catalog")
    assert r_all.json()["meta"]["total"] == 2

    r_paper = await client.get("/api/catalog?type=paper")
    assert r_paper.json()["meta"]["total"] == 1
    assert r_paper.json()["data"][0]["title"] == "A Test Paper"

    r_book = await client.get("/api/catalog?type=book")
    assert r_book.json()["meta"]["total"] == 1
    assert r_book.json()["data"][0]["title"] == "A Test Book"


async def test_list_search_by_query(client: AsyncClient, admin_user: dict) -> None:
    await client.post(
        "/api/catalog",
        json={**_SAMPLE, "title": "Machine Learning Fundamentals"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    await client.post(
        "/api/catalog",
        json={**_SAMPLE, "title": "Another Paper", "abstract": "Quantum physics abstract"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )

    r = await client.get("/api/catalog?q=machine")
    assert r.json()["meta"]["total"] == 1
    assert r.json()["data"][0]["title"] == "Machine Learning Fundamentals"

    r2 = await client.get("/api/catalog?q=quantum")
    assert r2.json()["meta"]["total"] == 1
    assert r2.json()["data"][0]["title"] == "Another Paper"


async def test_get_by_id(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    response = await client.get(f"/api/catalog/{rid}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == rid
    assert body["title"] == "A Test Paper"


async def test_get_returns_404_for_missing(client: AsyncClient) -> None:
    response = await client.get("/api/catalog/9999")
    assert response.status_code == 404


async def test_update_requires_admin(client: AsyncClient, test_user: dict) -> None:
    response = await client.patch(
        "/api/catalog/1",
        json={"title": "Updated"},
        headers={"Authorization": f"Bearer {test_user['token']}"},
    )
    assert response.status_code == 403


async def test_update_partial(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    response = await client.patch(
        f"/api/catalog/{rid}",
        json={"title": "Updated Title", "year": 2025},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Updated Title"
    assert body["year"] == 2025
    # Untouched fields preserved.
    assert body["authors"] == ["Alice Author", "Bob Reviewer"]


async def test_update_returns_404_for_missing(client: AsyncClient, admin_user: dict) -> None:
    response = await client.patch(
        "/api/catalog/9999",
        json={"title": "X"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 404


async def test_delete_requires_admin(client: AsyncClient, test_user: dict) -> None:
    response = await client.delete(
        "/api/catalog/1",
        headers={"Authorization": f"Bearer {test_user['token']}"},
    )
    assert response.status_code == 403


async def test_delete_returns_204(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    delete = await client.delete(
        f"/api/catalog/{rid}",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert delete.status_code == 204

    # Confirm gone.
    get = await client.get(f"/api/catalog/{rid}")
    assert get.status_code == 404


async def test_stats_returns_breakdowns(client: AsyncClient, admin_user: dict) -> None:
    await client.post(
        "/api/catalog",
        json={**_SAMPLE, "type": "paper", "discipline": "computer-science"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    await client.post(
        "/api/catalog",
        json={**_SAMPLE, "type": "book", "discipline": "mathematics", "title": "Math Book"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )

    response = await client.get("/api/catalog/stats")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["by_type"]["paper"] == 1
    assert body["by_type"]["book"] == 1
    assert body["by_discipline"]["computer-science"] == 1
    assert body["by_discipline"]["mathematics"] == 1


async def test_facets_returns_years_and_tags(client: AsyncClient, admin_user: dict) -> None:
    await client.post(
        "/api/catalog",
        json={**_SAMPLE, "year": 2024, "tags": ["ml", "python"]},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    await client.post(
        "/api/catalog",
        json={**_SAMPLE, "year": 2023, "tags": ["ml", "rust"], "title": "Older Paper"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )

    response = await client.get("/api/catalog/facets")
    assert response.status_code == 200
    body = response.json()
    # Years: 2024 (1) + 2023 (1), newest first.
    assert len(body["years"]) == 2
    assert body["years"][0]["value"] == "2024"
    assert body["years"][1]["value"] == "2023"
    # Tags: ml (2) should rank first.
    ml_bucket = next(b for b in body["tags"] if b["value"] == "ml")
    assert ml_bucket["count"] == 2


async def _create_draft_resource_with_submission(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, *, status: str
) -> int:
    """Helper: published/draft 资源 + 关联带本地文件的 submission，返回 resource id。"""
    payload = {**_SAMPLE, "title": f"Sealed {status}", "publication_status": status}
    response = await client.post(
        "/api/catalog", json=payload, headers={"Authorization": f"Bearer {admin_user['token']}"}
    )
    response.raise_for_status()
    resource_id = response.json()["id"]

    # tenant 上下文走中间件预热后的 bootstrap 租户（与 admin_user fixture 同源）
    tenant = (
        await db_session.execute(sa_select(Tenant).where(Tenant.slug == "default"))
    ).scalar_one()

    # 存储 key 与真实上传一致：{tenant_id}/{submission_id}/{uuid}{ext} 相对路径，
    # 通过 storage 后端落盘（本地 root 为测试环境的 tmp uploads 目录）。
    rel_path = f"{tenant.id}/0/sealed_manuscript_{status}.pdf"
    await get_storage().save(rel_path, b"%PDF-1.4 test sealed payload")

    db_session.add(
        Submission(
            tenant_id=tenant.id,
            resource_id=resource_id,
            submitted_by=admin_user["user_id"],
            title="Sealed manuscript",
            type="paper",
            discipline="computer-science",
            authors=["Anon Author"],
            year=2024,
            abstract="sealed",
            preview="sealed preview",
            tags=[],
            status="accepted",
            file_path=rel_path,
        )
    )
    await db_session.commit()
    return resource_id


async def test_file_endpoint_serves_published_resource(
    client: AsyncClient, db_session, admin_user
) -> None:
    resource_id = await _create_draft_resource_with_submission(
        client, db_session, admin_user, status="published"
    )
    response = await client.get(f"/api/catalog/{resource_id}/file")
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF")


async def test_file_endpoint_blocks_draft_resource(
    client: AsyncClient, db_session, admin_user
) -> None:
    """P1 回归：draft/in_review 资源的稿件不得经公开端点流出。"""
    resource_id = await _create_draft_resource_with_submission(
        client, db_session, admin_user, status="draft"
    )
    response = await client.get(f"/api/catalog/{resource_id}/file")
    assert response.status_code == 404


async def test_file_endpoint_blocks_in_review_resource(
    client: AsyncClient, db_session, admin_user
) -> None:
    resource_id = await _create_draft_resource_with_submission(
        client, db_session, admin_user, status="in_review"
    )
    response = await client.get(f"/api/catalog/{resource_id}/file")
    assert response.status_code == 404


async def test_file_endpoint_404_when_no_submission_file(client: AsyncClient, admin_user) -> None:
    """没有关联 submission 文件时 404（不暴露内部差异）。"""
    response = await client.post(
        "/api/catalog",
        json={**_SAMPLE, "title": "No File Resource"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    resource_id = response.json()["id"]
    response = await client.get(f"/api/catalog/{resource_id}/file")
    assert response.status_code == 404
