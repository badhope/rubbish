"""Integration tests for the /api/export endpoint.

These need the catalog module (for Resource creation) plus the export
module's router. Admin creates resources via the catalog API, then we
hit /api/export?ids=...&format=... and assert the response shape.
"""

from __future__ import annotations

from httpx import AsyncClient

_SAMPLE = {
    "type": "paper",
    "title": "A Test Paper",
    "authors": ["Alice Author", "Bob Reviewer"],
    "year": 2024,
    "venue": "Journal of Testing",
    "discipline": "computer-science",
    "subdiscipline": "machine-learning",
    "tags": ["ml", "python"],
    "abstract": "This is a test abstract.",
    "preview": "Test preview.",
    "doi": "10.1234/test.1",
    "keywords": ["testing", "fixtures"],
}


async def test_export_requires_ids(client: AsyncClient) -> None:
    response = await client.get("/api/export")
    assert response.status_code == 400


async def test_export_rejects_too_many_ids(client: AsyncClient) -> None:
    ids = "&".join(f"ids={i}" for i in range(501))
    response = await client.get(f"/api/export?{ids}")
    assert response.status_code == 400
    assert "Too many" in response.json()["detail"]


async def test_export_returns_404_when_no_resources_match(
    client: AsyncClient,
) -> None:
    response = await client.get("/api/export?ids=99999&ids=99998")
    assert response.status_code == 404


async def test_export_preflight_reports_missing_ids(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    response = await client.get("/api/export/preflight", params={"ids": [rid, 99999]})
    assert response.status_code == 200
    body = response.json()
    assert body["requested_count"] == 2
    assert body["resolved_count"] == 1
    assert body["missing_ids"] == [99999]
    assert body["warnings"] == []
    assert body["can_export"] is True


async def test_export_preflight_without_resources_is_not_404(client: AsyncClient) -> None:
    response = await client.get("/api/export/preflight", params={"ids": [99998]})
    assert response.status_code == 200
    body = response.json()
    assert body["resolved_count"] == 0
    assert body["can_export"] is False


async def test_export_bibtex_format(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    response = await client.get(f"/api/export?ids={rid}&format=bibtex")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/x-bibtex"
    assert 'filename="rubbish-export.bib"' in response.headers["content-disposition"]
    body = response.text
    assert "@article{" in body
    assert "Alice Author and Bob Reviewer" in body


async def test_export_ris_format(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    response = await client.get(f"/api/export?ids={rid}&format=ris")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/x-research-info-systems"
    body = response.text
    assert "TY  - JOUR" in body
    assert "AU  - Alice Author" in body
    assert body.rstrip().endswith("ER  -")


async def test_export_csv_format(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    response = await client.get(f"/api/export?ids={rid}&format=csv")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    lines = response.text.strip().split("\n")
    assert lines[0] == "title,type,authors,year,venue,discipline,tags,abstract,doi,url"


async def test_export_json_format(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    response = await client.get(f"/api/export?ids={rid}&format=json")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    import json

    records = json.loads(response.text)
    assert len(records) == 1
    assert records[0]["title"] == "A Test Paper"


async def test_export_jats_format(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    response = await client.get(f"/api/export?ids={rid}&format=jats")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/xml"
    assert 'filename="rubbish-export.xml"' in response.headers["content-disposition"]
    assert "<article" in response.text
    assert "A Test Paper" in response.text


async def test_export_preserves_request_order(client: AsyncClient, admin_user: dict) -> None:
    r1 = await client.post(
        "/api/catalog",
        json={**_SAMPLE, "title": "First Paper"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    r2 = await client.post(
        "/api/catalog",
        json={**_SAMPLE, "title": "Second Paper", "doi": "10.2/second"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    id1 = r1.json()["id"]
    id2 = r2.json()["id"]

    response = await client.get(f"/api/export?ids={id2}&ids={id1}&format=json")
    import json

    records = json.loads(response.text)
    # Order preserved: id2 first
    assert records[0]["title"] == "Second Paper"
    assert records[1]["title"] == "First Paper"


async def test_export_default_format_is_json(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    response = await client.get(f"/api/export?ids={rid}")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"


async def test_export_rejects_invalid_format(client: AsyncClient, admin_user: dict) -> None:
    create = await client.post(
        "/api/catalog",
        json=_SAMPLE,
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    rid = create.json()["id"]

    response = await client.get(f"/api/export?ids={rid}&format=yaml")
    # Pattern validation rejects before reaching handler.
    assert response.status_code == 422


async def _create_with_markdown(
    client: AsyncClient,
    db_session,
    admin_user: dict,
    title: str,
    md: str,
    *,
    volume: str | None = None,
    issue: str | None = None,
) -> int:
    from sqlalchemy import select as sa_select

    from app.core.storage import get_storage
    from app.domain.submission.models import Submission
    from app.models import Tenant

    create = await client.post(
        "/api/catalog",
        json={
            **_SAMPLE,
            "title": title,
            "doi": f"10.1234/batch.{abs(hash(title))}",
            **({"volume": volume} if volume else {}),
            **({"issue": issue} if issue else {}),
        },
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    create.raise_for_status()
    rid = create.json()["id"]
    tenant = (
        await db_session.execute(sa_select(Tenant).where(Tenant.slug == "default"))
    ).scalar_one()
    rel = f"{tenant.id}/{rid}/batch.md"
    await get_storage().save(rel, md.encode("utf-8"))
    db_session.add(
        Submission(
            tenant_id=tenant.id,
            resource_id=rid,
            submitted_by=admin_user["user_id"],
            title=title,
            type="paper",
            discipline="computer-science",
            authors=["Anon"],
            year=2026,
            abstract="abstract",
            preview="preview",
            tags=[],
            status="accepted",
            markdown_path=rel,
        )
    )
    await db_session.commit()
    return rid


async def test_export_documents_merged_pdf_and_zip(
    client: AsyncClient, db_session, admin_user: dict
) -> None:
    import zipfile
    from io import BytesIO

    import pymupdf

    rid1 = await _create_with_markdown(
        client, db_session, admin_user, "Batch One", "# 第一篇\n\n正文一。\n"
    )
    rid2 = await _create_with_markdown(
        client, db_session, admin_user, "Batch Two", "# 第二篇\n\n正文二。\n"
    )

    response = await client.get(
        "/api/export/documents", params={"ids": [rid1, rid2], "format": "pdf"}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    with pymupdf.open(stream=response.content, filetype="pdf") as doc:
        assert doc.page_count >= 2

    zipped = await client.get(
        "/api/export/documents", params={"ids": [rid1, rid2], "format": "zip"}
    )
    assert zipped.status_code == 200
    with zipfile.ZipFile(BytesIO(zipped.content)) as archive:
        names = archive.namelist()
        assert len([n for n in names if n.endswith(".pdf")]) == 2
        assert "manifest.json" in names


async def test_export_documents_merged_docx(
    client: AsyncClient, db_session, admin_user: dict
) -> None:
    from io import BytesIO

    from docx import Document

    rid1 = await _create_with_markdown(
        client, db_session, admin_user, "Word One", "# 第一篇\n\n正文一。\n"
    )
    rid2 = await _create_with_markdown(
        client, db_session, admin_user, "Word Two", "# 第二篇\n\n正文二。\n"
    )
    response = await client.get(
        "/api/export/documents", params={"ids": [rid1, rid2], "format": "docx"}
    )
    assert response.status_code == 200
    document = Document(BytesIO(response.content))
    text = "\n".join(p.text for p in document.paragraphs)
    assert "第一篇" in text
    assert "第二篇" in text


async def test_export_issue_full_text_zip(
    client: AsyncClient, db_session, admin_user: dict
) -> None:
    import zipfile
    from io import BytesIO

    for i in range(2):
        await _create_with_markdown(
            client,
            db_session,
            admin_user,
            f"Issue Paper {i}",
            f"# 第{i}篇\n\n正文。\n",
            volume="9",
            issue="07",
        )

    response = await client.get("/api/export/issue", params={"volume": "9", "issue": "07"})
    assert response.status_code == 200
    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert "00-front-matter.pdf" in names
        assert len([n for n in names if n.endswith(".pdf")]) >= 3
        assert "manifest.json" in names
