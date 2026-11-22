from __future__ import annotations

from conftest import auth_headers, register_user
from sqlalchemy import select

from app.domain.catalog.models import Resource
from app.domain.submission.models import Submission
from app.models import AuditLog, Tenant


async def _notifications(client, user) -> list[dict]:
    response = await client.get(
        "/api/notifications", params={"page_size": 50}, headers=auth_headers(user)
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def test_feedback_resolution_notifies_the_submitter(client, db_session, admin_user) -> None:
    user = await register_user(client, email="feedbacker@example.com", username="feedbacker")
    created = await client.post(
        "/api/catalog/feedback",
        json={
            "kind": "bug",
            "title": "反馈通知测试",
            "body": "这是一条用来验证解决后通知提交人的反馈。",
            "page_url": "/me",
        },
        headers=auth_headers(user),
    )
    assert created.status_code == 200, created.text
    feedback_id = created.json()["id"]

    resolved = await client.post(
        f"/api/catalog/feedback/{feedback_id}/resolve",
        json={"note": "已经修好了。"},
        headers=auth_headers(admin_user),
    )
    assert resolved.status_code == 200, resolved.text

    rows = await _notifications(client, user)
    hit = next(
        row
        for row in rows
        if row["type"] == "site.feedback"
        and row["related_type"] == "feedback"
        and int(row["related_id"]) == feedback_id
    )
    assert "反馈已处理" in hit["title"]

    # 重复提交同一反馈的处理请求：不重复通知，也不追加第二条处理审计。
    again = await client.post(
        f"/api/catalog/feedback/{feedback_id}/resolve",
        json={"note": "重复点击不应再发一次。"},
        headers=auth_headers(admin_user),
    )
    assert again.status_code == 200, again.text
    repeated_hits = [
        row
        for row in await _notifications(client, user)
        if row["type"] == "site.feedback"
        and row["related_type"] == "feedback"
        and int(row["related_id"]) == feedback_id
    ]
    assert len(repeated_hits) == 1
    resolve_rows = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "feedback.resolve",
                AuditLog.target_id == str(feedback_id),
            )
        )
    ).scalars().all()
    assert len(resolve_rows) == 1
    assert repeated_hits[0]["body"] == "已经修好了。"


async def test_role_application_notifies_admin_and_result_reaches_applicant(
    client, db_session, admin_user
) -> None:
    user = await register_user(client, email="reviewapply@example.com", username="reviewapply")
    tenant = (await db_session.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()
    resource = Resource(
        tenant_id=tenant.id,
        type="paper",
        title="申请互评资格的通过作品",
        authors=["Review Applicant"],
        year=2026,
        discipline="computer-science",
        tags=[],
        abstract="用于验证角色申请通知链路。",
        preview="用于验证角色申请通知链路。",
        quality_score=80,
    )
    db_session.add(resource)
    await db_session.flush()
    db_session.add(
        Submission(
            tenant_id=tenant.id,
            resource_id=resource.id,
            submitted_by=user["user_id"],
            title=resource.title,
            type="paper",
            authors=["Review Applicant"],
            year=2026,
            discipline="computer-science",
            tags=[],
            abstract=resource.abstract,
            preview=resource.preview,
            status="accepted",
        )
    )
    await db_session.commit()

    applied = await client.post(
        "/api/gamification/applications",
        json={
            "target_role": "reviewer",
            "statement": "我有一篇通过的作品，愿意每周看一到两篇并给出具体修改建议。",
        },
        headers=auth_headers(user),
    )
    assert applied.status_code == 201, applied.text
    application_id = applied.json()["id"]

    scoped = await client.get(
        "/api/gamification/admin/applications",
        params={"application_id": application_id, "page_size": 1},
        headers=auth_headers(admin_user),
    )
    assert scoped.status_code == 200, scoped.text
    assert [row["id"] for row in scoped.json()["data"]] == [application_id]

    admin_rows = await _notifications(client, admin_user)
    admin_hit = next(
        row
        for row in admin_rows
        if row["related_type"] == "role_application_admin"
        and int(row["related_id"]) == application_id
    )
    assert "新的角色申请" in admin_hit["title"]

    decided = await client.post(
        f"/api/gamification/admin/applications/{application_id}/decision",
        json={"decision": "approve", "note": "欢迎加入互评。"},
        headers=auth_headers(admin_user),
    )
    assert decided.status_code == 200, decided.text

    user_rows = await _notifications(client, user)
    user_hit = next(
        row
        for row in user_rows
        if row["related_type"] == "role_application"
        and int(row["related_id"]) == application_id
    )
    assert "申请已通过" in user_hit["title"]
