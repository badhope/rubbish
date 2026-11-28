"""1.20.17 科目领域与审稿领域：公开边界、校验与站务代改。"""

from __future__ import annotations

import pytest
from conftest import auth_headers
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.catalog.models import Resource
from app.domain.submission.models import Submission
from app.models import AuditLog, Tenant


async def _create_discipline(client: AsyncClient, admin_user: dict, slug: str) -> None:
    r = await client.post(
        "/api/catalog/disciplines",
        headers=auth_headers(admin_user),
        json={
            "slug": slug,
            "name": slug.replace("-", " ").title(),
            "description": f"Discipline {slug}",
            "subdisciplines": [],
        },
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_subject_areas_public_reviewer_areas_private(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    await _create_discipline(client, admin_user, "mathematics")
    r = await client.patch(
        "/api/users/me",
        json={
            "subject_disciplines": ["mathematics"],
            "reviewer_disciplines": ["mathematics"],
            "reviewer_tags": ["统计分析"],
        },
        headers=auth_headers(test_user),
    )
    assert r.status_code == 200, r.text
    assert r.json()["subject_disciplines"] == ["mathematics"]
    assert r.json()["reviewer_disciplines"] == ["mathematics"]

    public = await client.get("/api/users/testuser/public")
    assert public.status_code == 200, public.text
    user = public.json()["user"]
    assert user["subject_disciplines"] == ["mathematics"]
    assert "reviewer_disciplines" not in user
    assert "reviewer_tags" not in user


@pytest.mark.asyncio
async def test_subject_areas_reject_unknown_slug(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    await _create_discipline(client, admin_user, "physics")
    r = await client.patch(
        "/api/users/me",
        json={"subject_disciplines": ["physics", "not-a-real-area"]},
        headers=auth_headers(test_user),
    )
    assert r.status_code == 422, r.text
    assert "未知科目领域" in r.json()["detail"]


@pytest.mark.asyncio
async def test_subject_areas_cap_at_six(client: AsyncClient, test_user: dict) -> None:
    r = await client.patch(
        "/api/users/me",
        json={"subject_disciplines": [f"area-{i}" for i in range(7)]},
        headers=auth_headers(test_user),
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_admin_updates_member_areas_and_audits(
    client: AsyncClient,
    test_user: dict,
    admin_user: dict,
    db_session: AsyncSession,
) -> None:
    await _create_discipline(client, admin_user, "computer-science")
    r = await client.patch(
        f"/api/admin/users/{test_user['user_id']}/areas",
        json={
            "subject_disciplines": ["computer-science"],
            "reviewer_disciplines": ["computer-science"],
            "reviewer_tags": ["代码复现", "系统设计"],
        },
        headers=auth_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["subject_disciplines"] == ["computer-science"]
    assert body["reviewer_tags"] == ["代码复现", "系统设计"]
    assert body["username"] == "testuser"

    audit = (
        (
            await db_session.execute(
                select(AuditLog)
                .where(AuditLog.action == "user.update_areas")
                .order_by(AuditLog.id.desc())
            )
        )
        .scalars()
        .first()
    )
    assert audit is not None
    assert audit.target_id == str(test_user["user_id"])
    assert audit.payload["subject_disciplines"] == ["computer-science"]


@pytest.mark.asyncio
async def test_admin_area_update_requires_a_field(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    r = await client.patch(
        f"/api/admin/users/{test_user['user_id']}/areas",
        json={},
        headers=auth_headers(admin_user),
    )
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_role_application_carries_applicant_areas(
    client: AsyncClient, test_user: dict, admin_user: dict, db_session: AsyncSession
) -> None:
    await _create_discipline(client, admin_user, "psychology")
    await client.patch(
        "/api/users/me",
        json={
            "subject_disciplines": ["psychology"],
            "reviewer_disciplines": ["psychology"],
        },
        headers=auth_headers(test_user),
    )
    tenant = (await db_session.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()
    resource = Resource(
        tenant_id=tenant.id,
        type="paper",
        title="申请互评资格的通过作品",
        authors=["Test User"],
        year=2026,
        discipline="psychology",
        tags=[],
        abstract="用于验证角色申请携带领域字段。",
        preview="用于验证角色申请携带领域字段。",
        quality_score=80,
    )
    db_session.add(resource)
    await db_session.flush()
    db_session.add(
        Submission(
            tenant_id=tenant.id,
            resource_id=resource.id,
            submitted_by=test_user["user_id"],
            title=resource.title,
            type="paper",
            authors=["Test User"],
            year=2026,
            discipline="psychology",
            tags=[],
            abstract=resource.abstract,
            preview=resource.preview,
            status="accepted",
        )
    )
    await db_session.commit()
    submit = await client.post(
        "/api/gamification/applications",
        json={"target_role": "reviewer", "statement": "我想参与互评，长期阅读心理学与教育稿件。"},
        headers=auth_headers(test_user),
    )
    assert submit.status_code == 201, submit.text
    admin_list = await client.get(
        "/api/gamification/admin/applications?status=pending", headers=auth_headers(admin_user)
    )
    assert admin_list.status_code == 200, admin_list.text
    rows = admin_list.json()["data"]
    assert rows
    assert rows[0]["subject_disciplines"] == ["psychology"]
    assert rows[0]["reviewer_disciplines"] == ["psychology"]
    assert rows[0]["username"] == "testuser"
