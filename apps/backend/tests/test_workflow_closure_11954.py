"""1.19.54 workflow closure: rework checklist, withdraw, diff, batch undo, quota."""

from __future__ import annotations

import pytest
from conftest import auth_headers
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.submission.models import Submission, SubmissionVersion
from app.models import Tenant


async def _tenant(db: AsyncSession) -> Tenant:
    return (await db.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()


async def _submission(db: AsyncSession, user_id: int, **overrides) -> Submission:
    tenant = await _tenant(db)
    data = {
        "tenant_id": tenant.id,
        "submitted_by": user_id,
        "status": "under_review",
        "title": "工作流闭环测试稿",
        "type": "paper",
        "authors": ["Test Author"],
        "year": 2026,
        "discipline": "computer-science",
        "tags": [],
        "keywords": [],
        "jel_codes": [],
        "abstract": "这是一篇用于验证工作流闭环的测试稿。",
        "preview": "这是一篇用于验证工作流闭环的测试稿。",
    }
    data.update(overrides)
    row = Submission(**data)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@pytest.mark.asyncio
async def test_rework_checklist_deadline_response_and_withdraw(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict, test_user: dict
) -> None:
    submission = await _submission(db_session, test_user["user_id"])
    rework = await client.post(
        f"/api/submissions/{submission.id}/rework",
        json={
            "requirements": ["补样本量", "补坐标单位", "写明局限"],
            "note": "请按这三条修改",
            "due_days": 7,
        },
        headers=auth_headers(admin_user),
    )
    assert rework.status_code == 200, rework.text
    body = rework.json()
    assert body["status"] == "rework_requested"
    assert len(body["rework_requirements"]) == 3
    assert body["rework_due_at"] is not None
    first_id = body["rework_requirements"][0]["id"]

    saved = await client.put(
        f"/api/submissions/{submission.id}/rework-response",
        json={
            "items": [
                {"requirement_id": first_id, "status": "addressed", "note": "已在第 3 节补上"}
            ]
        },
        headers=auth_headers(test_user),
    )
    assert saved.status_code == 200, saved.text
    saved_body = saved.json()
    assert saved_body["rework_requirements"][0]["status"] == "addressed"
    assert saved_body["rework_requirements"][0]["response"] == "已在第 3 节补上"

    withdrawn = await client.post(
        f"/api/submissions/{submission.id}/withdraw",
        json={"reason": "选题方向调整，准备重写"},
        headers=auth_headers(test_user),
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["status"] == "withdrawn"
    assert withdrawn.json()["rework_due_at"] is None
    again = await client.post(
        f"/api/submissions/{submission.id}/withdraw",
        json={"reason": "重复操作"},
        headers=auth_headers(test_user),
    )
    assert again.status_code == 400


@pytest.mark.asyncio
async def test_version_diff_reports_body_and_fields(
    client: AsyncClient, db_session: AsyncSession, test_user: dict
) -> None:
    submission = await _submission(db_session, test_user["user_id"], title="旧标题")
    tenant = await _tenant(db_session)
    db_session.add_all(
        [
            SubmissionVersion(
                tenant_id=tenant.id,
                submission_id=submission.id,
                version=1,
                payload={"title": "旧标题", "abstract": "旧摘要"},
                body="第一版正文\n旧结论",
            ),
            SubmissionVersion(
                tenant_id=tenant.id,
                submission_id=submission.id,
                version=2,
                payload={"title": "新标题", "abstract": "新摘要"},
                body="第二版正文\n新结论",
            ),
        ]
    )
    await db_session.commit()
    response = await client.get(
        f"/api/submissions/{submission.id}/versions/2/diff",
        headers=auth_headers(test_user),
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["from_version"] == 1
    assert data["to_version"] == 2
    assert data["has_body_diff"] is True
    assert any(line.startswith("+新结论") for line in data["body_diff"])
    fields = {item["field"] for item in data["field_changes"]}
    assert {"title", "abstract"}.issubset(fields)


@pytest.mark.asyncio
async def test_batch_preflight_and_undo(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    settings = await client.put(
        "/api/forum/moderation/settings",
        json={
            "auto_publish_enabled": True,
            "manual_threshold": 30,
            "sla_minutes": 30,
            "weights": {},
        },
        headers=auth_headers(admin_user),
    )
    assert settings.status_code == 200, settings.text
    ids: list[int] = []
    for index in range(2):
        response = await client.post(
            "/api/forum/topics",
            json={
                "title": f"批量预检样本 {index}",
                "body": "这是一段足够长的主题帖正文，留下邮箱 batch@example.com 方便联系。",
            },
            headers=auth_headers(test_user),
        )
        assert response.status_code == 201, response.text
        ids.append(response.json()["id"])

    preflight = await client.post(
        "/api/forum/moderation/batch/preflight",
        json={"topic_ids": ids, "action": "approve", "note": ""},
        headers=auth_headers(admin_user),
    )
    assert preflight.status_code == 200, preflight.text
    assert preflight.json()["will_change_count"] == 2
    assert preflight.json()["unchanged_count"] == 0

    batch = await client.post(
        "/api/forum/moderation/batch",
        json={"topic_ids": ids, "action": "approve", "note": ""},
        headers=auth_headers(admin_user),
    )
    assert batch.status_code == 200, batch.text
    batch_id = batch.json()["batch_id"]
    assert isinstance(batch_id, str) and batch_id

    undo = await client.post(
        f"/api/forum/moderation/batch/{batch_id}/undo",
        headers=auth_headers(admin_user),
    )
    assert undo.status_code == 200, undo.text
    assert undo.json()["restored"] == 2


@pytest.mark.asyncio
async def test_daily_upload_quota_blocks_second_file(
    client: AsyncClient,
    db_session: AsyncSession,
    test_user: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.interfaces.http.submission import routes_files

    monkeypatch.setattr(routes_files, "_UPLOAD_DAILY_FILE_LIMIT", 1)
    submission = await _submission(db_session, test_user["user_id"], status="pending")
    files = {"file": ("note.md", b"# tiny note\n", "text/markdown")}
    first = await client.post(
        f"/api/submissions/{submission.id}/files",
        files=files,
        headers=auth_headers(test_user),
    )
    assert first.status_code == 200, first.text
    second = await client.post(
        f"/api/submissions/{submission.id}/files",
        files={"file": ("again.md", b"# again\n", "text/markdown")},
        headers=auth_headers(test_user),
    )
    assert second.status_code == 429, second.text
