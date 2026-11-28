"""1.20.26: 内容后台保存前自检。

覆盖公告与论坛分区的只读预检：
- 合法草稿可以进入保存流程；
- 重复 slug、过期时间、空白文案、父子循环都是 fail；
- 预检不写库、不留下审计日志；
- 普通编辑不能借预检端点绕过主编权限。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from conftest import auth_headers, register_user
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.announcements.models import Announcement
from app.domain.forum.models import ForumBoard
from app.models import AuditLog


@pytest.mark.asyncio
async def test_announcement_preflight_blocks_conflicts_without_writing(
    client: AsyncClient, admin_user: dict, db_session: AsyncSession
) -> None:
    headers = auth_headers(admin_user)
    created = await client.post(
        "/api/announcements",
        json={
            "slug": "pf-existing",
            "title": "已经有公告",
            "body": "这条公告用来占用 slug。",
            "level": "info",
            "is_active": False,
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text

    count_before = (await db_session.execute(select(func.count(Announcement.id)))).scalar_one()
    audit_before = (await db_session.execute(select(func.count(AuditLog.id)))).scalar_one()

    duplicated = await client.post(
        "/api/announcements/preflight",
        json={
            "slug": "pf-existing",
            "title": "重复标识",
            "body": "会被唯一约束拦住。",
            "level": "info",
            "is_active": False,
        },
        headers=headers,
    )
    assert duplicated.status_code == 200, duplicated.text
    body = duplicated.json()
    assert body["status"] == "fail"
    assert any(item["key"] == "slug_unique" and item["status"] == "fail" for item in body["items"])

    expired = await client.post(
        "/api/announcements/preflight",
        json={
            "slug": "pf-expired",
            "title": "已过期",
            "body": "结束时间在昨天。",
            "level": "info",
            "is_active": True,
            "ends_at": (datetime.now(UTC) - timedelta(days=1)).isoformat(),
        },
        headers=headers,
    )
    assert expired.status_code == 200, expired.text
    assert expired.json()["status"] == "fail"
    assert any(
        item["key"] == "window" and item["status"] == "fail" for item in expired.json()["items"]
    )

    blank = await client.post(
        "/api/announcements/preflight",
        json={
            "slug": "pf-blank",
            "title": "   ",
            "body": " ",
            "level": "info",
            "is_active": False,
        },
        headers=headers,
    )
    assert blank.status_code == 200, blank.text
    assert blank.json()["status"] == "fail"
    assert any(item["key"] == "copy" and item["status"] == "fail" for item in blank.json()["items"])

    count_after = (await db_session.execute(select(func.count(Announcement.id)))).scalar_one()
    audit_after = (await db_session.execute(select(func.count(AuditLog.id)))).scalar_one()
    assert count_after == count_before
    assert audit_after == audit_before


@pytest.mark.asyncio
async def test_board_preflight_blocks_cycle_and_duplicate(
    client: AsyncClient, admin_user: dict, db_session: AsyncSession
) -> None:
    headers = auth_headers(admin_user)
    parent = await client.post(
        "/api/forum/admin/boards",
        json={"slug": "pf-parent", "name": "预检父分区", "sort_order": 10},
        headers=headers,
    )
    assert parent.status_code == 201, parent.text
    parent_id = parent.json()["id"]

    child = await client.post(
        "/api/forum/admin/boards",
        json={
            "parent_id": parent_id,
            "slug": "pf-child",
            "name": "预检子分区",
            "sort_order": 20,
        },
        headers=headers,
    )
    assert child.status_code == 201, child.text
    child_id = child.json()["id"]

    board_count_before = (await db_session.execute(select(func.count(ForumBoard.id)))).scalar_one()
    audit_before = (await db_session.execute(select(func.count(AuditLog.id)))).scalar_one()

    duplicate = await client.post(
        "/api/forum/admin/boards/preflight",
        json={"slug": "pf-parent", "name": "另一个父分区", "sort_order": 30},
        headers=headers,
    )
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["status"] == "fail"
    assert any(
        item["key"] == "slug_unique" and item["status"] == "fail"
        for item in duplicate.json()["items"]
    )

    invalid_draft = await client.post(
        "/api/forum/admin/boards/preflight",
        json={"slug": "x", "name": "自检演示分区", "sort_order": 10000},
        headers=headers,
    )
    assert invalid_draft.status_code == 200, invalid_draft.text
    assert invalid_draft.json()["status"] == "fail"
    assert any(
        item["key"] == "slug" and item["status"] == "fail" for item in invalid_draft.json()["items"]
    )
    assert any(
        item["key"] == "sort_order" and item["status"] == "fail"
        for item in invalid_draft.json()["items"]
    )

    cycle = await client.post(
        "/api/forum/admin/boards/preflight",
        json={
            "board_id": child_id,
            "parent_id": child_id,
            "slug": "pf-child",
            "name": "预检子分区",
            "sort_order": 20,
        },
        headers=headers,
    )
    assert cycle.status_code == 200, cycle.text
    assert cycle.json()["status"] == "fail"
    assert any(item["status"] == "fail" for item in cycle.json()["items"])

    board_count_after = (await db_session.execute(select(func.count(ForumBoard.id)))).scalar_one()
    audit_after = (await db_session.execute(select(func.count(AuditLog.id)))).scalar_one()
    assert board_count_after == board_count_before
    assert audit_after == audit_before


@pytest.mark.asyncio
async def test_preflight_requires_chief_not_plain_editor(
    client: AsyncClient, admin_user: dict
) -> None:
    editor = await register_user(client, email="pf-editor@example.com", username="pfeditor")
    editor_headers = auth_headers(editor)

    res = await client.post(
        "/api/announcements/preflight",
        json={"slug": "pf-editor-denied", "title": "越权", "body": "不应通过。", "level": "info"},
        headers=editor_headers,
    )
    assert res.status_code == 403
