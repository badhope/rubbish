"""返修稿直接录用与返修队列回归。"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.submission.models import Submission, SubmissionVersion
from app.models import AuditLog, Tenant


async def _default_tenant(db: AsyncSession) -> Tenant:
    return (await db.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()


async def _make_submission(
    db: AsyncSession,
    tenant: Tenant,
    author_id: int,
    *,
    title: str,
    status: str = "under_review",
    versions: int = 1,
) -> Submission:
    submission = Submission(
        tenant_id=tenant.id,
        submitted_by=author_id,
        status=status,
        title=title,
        type="paper",
        authors=["Test Author"],
        year=2026,
        discipline="computer-science",
        tags=[],
        keywords=[],
        jel_codes=[],
        abstract="这是一篇用于验证返修稿直接录用的测试稿。",
        preview="这是一篇用于验证返修稿直接录用的测试稿。",
    )
    db.add(submission)
    await db.flush()
    for version in range(1, versions + 1):
        db.add(
            SubmissionVersion(
                tenant_id=tenant.id,
                submission_id=submission.id,
                version=version,
                payload={"title": f"{title} v{version}"},
                created_by=author_id,
            )
        )
    await db.commit()
    await db.refresh(submission)
    return submission


@pytest.mark.asyncio
async def test_chief_can_direct_accept_after_revision(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    tenant = await _default_tenant(db_session)
    submission = await _make_submission(
        db_session,
        tenant,
        test_user["user_id"],
        title="返修后直接录用的稿子",
        versions=2,
    )

    # 不加直接录用开关时，闸门仍然生效：没有本轮通过意见不能通过。
    blocked = await client.patch(
        f"/api/submissions/{submission.id}/decision",
        json={"decision": "accept"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"]["code"] == "no_completed_reviews"

    direct = await client.patch(
        f"/api/submissions/{submission.id}/decision",
        json={"decision": "accept", "accept_after_revision": True},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert direct.status_code == 200, direct.text
    body = direct.json()
    assert body["status"] == "accepted"
    assert body["resource_id"]
    assert body["latest_version"] == 2
    assert "返修后直接录用" in (body["editor_note"] or "")

    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "submission.decision",
                AuditLog.target_id == str(submission.id),
            )
        )
    ).scalar_one()
    assert audit.payload["accept_after_revision"] is True
    assert audit.payload["latest_version"] == 2


@pytest.mark.asyncio
async def test_direct_accept_rejects_first_submission(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    tenant = await _default_tenant(db_session)
    submission = await _make_submission(
        db_session,
        tenant,
        test_user["user_id"],
        title="尚未返修的首次投稿",
        versions=1,
    )

    response = await client.patch(
        f"/api/submissions/{submission.id}/decision",
        json={"decision": "accept", "accept_after_revision": True},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 400, response.text
    assert "返修" in response.json()["detail"]


@pytest.mark.asyncio
async def test_revision_queue_uses_version_not_only_status(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    tenant = await _default_tenant(db_session)
    first = await _make_submission(
        db_session,
        tenant,
        test_user["user_id"],
        title="首次投稿仍在互评",
        versions=1,
    )
    revised = await _make_submission(
        db_session,
        tenant,
        test_user["user_id"],
        title="作者已经返修",
        versions=2,
    )

    response = await client.get(
        "/api/submissions",
        params={"status": "revision", "page_size": 50},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    ids = {item["id"] for item in data}
    assert revised.id in ids
    assert first.id not in ids
    revised_row = next(item for item in data if item["id"] == revised.id)
    assert revised_row["latest_version"] == 2


@pytest.mark.asyncio
async def test_overview_revision_count_matches_revision_queue(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    """内容台概览的返修稿计数必须与 revision 队列完全一致。"""
    tenant = await _default_tenant(db_session)
    before = await client.get(
        "/api/submissions/overview",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert before.status_code == 200, before.text
    baseline = before.json()["revision_count"]

    revised = await _make_submission(
        db_session,
        tenant,
        test_user["user_id"],
        title="概览计数的返修稿",
        versions=2,
    )
    first = await _make_submission(
        db_session,
        tenant,
        test_user["user_id"],
        title="概览计数的首次投稿",
        versions=1,
    )
    assert revised.id != first.id

    after = await client.get(
        "/api/submissions/overview",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert after.status_code == 200, after.text
    assert after.json()["revision_count"] == baseline + 1

    queue = await client.get(
        "/api/submissions",
        params={"status": "revision", "page_size": 100},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert queue.status_code == 200, queue.text
    assert queue.json()["meta"]["total"] == after.json()["revision_count"]
    assert revised.id in {item["id"] for item in queue.json()["data"]}
    assert first.id not in {item["id"] for item in queue.json()["data"]}


@pytest.mark.asyncio
async def test_workbench_rows_expose_latest_version(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    """进度看板卡片必须能看到 v2+，否则主编无法识别返修稿。"""
    tenant = await _default_tenant(db_session)
    revised = await _make_submission(
        db_session,
        tenant,
        test_user["user_id"],
        title="看板里的返修稿",
        status="major_revision",
        versions=2,
    )

    response = await client.get(
        "/api/editor/workbench",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 200, response.text
    rows = response.json()["columns"]["rework"]["items"]
    row = next(item for item in rows if item["submission_id"] == revised.id)
    assert row["latest_version"] == 2
