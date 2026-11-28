"""退回修改 → 作者编辑 → 显式重交 的完整状态流转。"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.submission.models import Submission
from app.models import Tenant


async def _default_tenant(db: AsyncSession) -> Tenant:
    return (await db.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()


@pytest.mark.asyncio
async def test_rework_request_returns_to_author_then_resubmit(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    tenant = await _default_tenant(db_session)
    submission = Submission(
        tenant_id=tenant.id,
        submitted_by=test_user["user_id"],
        status="under_review",
        title="待退回的一篇",
        type="paper",
        authors=["Test Author"],
        year=2026,
        discipline="computer-science",
        tags=[],
        keywords=[],
        jel_codes=[],
        abstract="这是一篇用于验证退回修改链路的测试稿。",
        preview="这是一篇用于验证退回修改链路的测试稿。",
    )
    db_session.add(submission)
    await db_session.commit()
    await db_session.refresh(submission)

    rework = await client.post(
        f"/api/submissions/{submission.id}/rework",
        json={
            "requirements": [
                "补充样本量说明",
                "把图 2 的坐标单位补齐",
                "在结论里写明局限",
            ],
            "note": "按 D 级处置退回修改",
        },
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert rework.status_code == 200, rework.text
    assert rework.json()["status"] == "rework_requested"
    # 修改要求必须同时落到作者详情，不能只存在于站内通知。
    note = rework.json()["editor_note"]
    assert "修改要求" in note
    for requirement in ("补充样本量说明", "把图 2 的坐标单位补齐", "在结论里写明局限"):
        assert requirement in note
    assert "按 D 级处置退回修改" in note

    # 作者能在这个状态下改标题；under_review 时同一个请求必须被挡住。
    edit = await client.patch(
        f"/api/submissions/{submission.id}",
        json={"title": "按意见改过的一篇"},
        headers={"Authorization": f"Bearer {test_user['token']}"},
    )
    assert edit.status_code == 200, edit.text
    assert edit.json()["title"] == "按意见改过的一篇"
    assert edit.json()["status"] == "rework_requested"

    resubmit = await client.post(
        f"/api/submissions/{submission.id}/resubmit",
        json={"note": "已逐条修改，补了样本量、坐标单位和局限。"},
        headers={"Authorization": f"Bearer {test_user['token']}"},
    )
    assert resubmit.status_code == 200, resubmit.text
    assert resubmit.json()["status"] == "under_review"

    # 重交后不能再走作者编辑，避免编辑端拿到一份仍在变化的稿子。
    edit_again = await client.patch(
        f"/api/submissions/{submission.id}",
        json={"title": "重交后再改"},
        headers={"Authorization": f"Bearer {test_user['token']}"},
    )
    assert edit_again.status_code == 400, edit_again.text


@pytest.mark.asyncio
async def test_request_rework_requires_three_requirements(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    tenant = await _default_tenant(db_session)
    submission = Submission(
        tenant_id=tenant.id,
        submitted_by=test_user["user_id"],
        status="under_review",
        title="退回要求不足的一篇",
        type="paper",
        authors=["Test Author"],
        year=2026,
        discipline="computer-science",
        tags=[],
        keywords=[],
        jel_codes=[],
        abstract="测试退回必须说清问题。",
        preview="测试退回必须说清问题。",
    )
    db_session.add(submission)
    await db_session.commit()
    await db_session.refresh(submission)

    response = await client.post(
        f"/api/submissions/{submission.id}/rework",
        json={"requirements": ["补说明", "补单位"]},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code in (400, 422), response.text


@pytest.mark.asyncio
async def test_triage_return_keeps_note_and_decision_notification(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    """初筛退回也要让作者在详情页看到原话，并进“决定”通知分类。"""
    tenant = await _default_tenant(db_session)
    submission = Submission(
        tenant_id=tenant.id,
        submitted_by=test_user["user_id"],
        status="pending",
        title="初筛退回的一篇",
        type="paper",
        authors=["Test Author"],
        year=2026,
        discipline="computer-science",
        tags=[],
        keywords=[],
        jel_codes=[],
        abstract="这是一篇用于验证初筛退回通知的测试稿。",
        preview="这是一篇用于验证初筛退回通知的测试稿。",
    )
    db_session.add(submission)
    await db_session.commit()
    await db_session.refresh(submission)

    note = "选题范围与社区定位不符，请收窄问题后再提交。"
    response = await client.post(
        f"/api/submissions/{submission.id}/triage",
        json={"decision": "return_for_revision", "note": note},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "major_revision"
    assert response.json()["editor_note"] == note

    notes = await client.get(
        "/api/notifications",
        params={"category": "decision", "page_size": 50},
        headers={"Authorization": f"Bearer {test_user['token']}"},
    )
    assert notes.status_code == 200, notes.text
    types = {item["type"] for item in notes.json()["data"]}
    assert "submission.triage_rework" in types
