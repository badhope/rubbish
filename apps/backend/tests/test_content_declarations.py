"""P3-1：内容声明与许可是逐篇字段，不是硬编码文案。"""

from __future__ import annotations

import pytest
from conftest import auth_headers, register_user
from httpx import AsyncClient

_DECLARATIONS = {
    "license": "CC BY 4.0",
    "author_contributions": "概念化、方法学、写作：Alice；数据管理：Bob。",
    "funding": "国家自然科学基金 12345678",
    "coi_statement": "作者声明无利益冲突。",
    "data_availability": "原始数据存于作者处，可向通讯作者索取。",
}


@pytest.mark.asyncio
async def test_resource_declarations_round_trip(client: AsyncClient, admin_user: dict) -> None:
    payload = {
        "type": "paper",
        "title": "声明字段往返",
        "authors": ["Alice Author"],
        "year": 2026,
        "discipline": "computer-science",
        "tags": ["test"],
        "abstract": "摘要。",
        "preview": "预览。",
        "publication_status": "published",
        **_DECLARATIONS,
    }
    created = await client.post("/api/catalog", json=payload, headers=auth_headers(admin_user))
    assert created.status_code == 201, created.text
    body = created.json()
    for key, value in _DECLARATIONS.items():
        assert body[key] == value

    # PATCH 只改一个字段，其他声明不能被清空。
    patched = await client.patch(
        f"/api/catalog/{body['id']}",
        json={"coi_statement": "作者受雇于测试机构，已声明。"},
        headers=auth_headers(admin_user),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["coi_statement"] == "作者受雇于测试机构，已声明。"
    assert patched.json()["data_availability"] == _DECLARATIONS["data_availability"]

    detail = await client.get(f"/api/catalog/{body['id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["license"] == "CC BY 4.0"


@pytest.mark.asyncio
async def test_submission_declarations_are_persisted(client: AsyncClient, admin_user: dict) -> None:
    author = await register_user(
        client, email="declarations@example.com", username="declarations_author"
    )
    ack = await client.post("/api/gamification/rules/ack", headers=auth_headers(author))
    assert ack.status_code == 200, ack.text
    created = await client.post(
        "/api/submissions",
        json={
            "title": "投稿声明字段",
            "type": "paper",
            "authors": ["Alice Author"],
            "year": 2026,
            "discipline": "computer-science",
            "tags": ["test"],
            "abstract": "摘要。",
            "preview": "预览。",
            **_DECLARATIONS,
        },
        headers=auth_headers(author),
    )
    assert created.status_code == 201, created.text
    body = created.json()
    for key, value in _DECLARATIONS.items():
        assert body[key] == value

    detail = await client.get(f"/api/submissions/{body['id']}", headers=auth_headers(author))
    assert detail.status_code == 200, detail.text
    assert detail.json()["author_contributions"] == _DECLARATIONS["author_contributions"]

    # 录用物化：声明必须跟到目录条目，而不是只留在投稿记录里。
    # 零审稿不能直接录用（P1 #4 闸门）：先 waive-review 记录免审理由，再 accept。
    waived = await client.post(
        f"/api/submissions/{body['id']}/waive-review",
        json={"reason": "测试免审录用：验证声明字段物化到目录条目。"},
        headers=auth_headers(admin_user),
    )
    assert waived.status_code == 200, waived.text
    approved = await client.patch(
        f"/api/submissions/{body['id']}/decision",
        json={"decision": "accept"},
        headers=auth_headers(admin_user),
    )
    assert approved.status_code == 200, approved.text
    resource_id = approved.json()["resource_id"]
    resource = await client.get(f"/api/catalog/{resource_id}")
    assert resource.status_code == 200, resource.text
    for key, value in _DECLARATIONS.items():
        assert resource.json()[key] == value


async def _create_public_resource(client: AsyncClient, admin_user: dict, title: str) -> dict:
    created = await client.post(
        "/api/catalog",
        json={
            "type": "paper",
            "title": title,
            "authors": ["Alice Author"],
            "year": 2026,
            "discipline": "computer-science",
            "tags": ["test"],
            "abstract": "摘要。",
            "preview": "预览。",
            "publication_status": "published",
        },
        headers=auth_headers(admin_user),
    )
    assert created.status_code == 201, created.text
    return created.json()


@pytest.mark.asyncio
async def test_public_correction_log_and_retraction(client: AsyncClient, admin_user: dict) -> None:
    resource = await _create_public_resource(client, admin_user, "公开变更记录")
    rid = resource["id"]

    before = await client.get(f"/api/catalog/{rid}/history")
    assert before.status_code == 200, before.text
    assert before.json()["events"] == []
    assert before.json()["retracted"] is False

    correction = await client.post(
        f"/api/catalog/{rid}/events",
        json={
            "event_type": "correction",
            "title": "更正图 2 样本量",
            "body": "图 2 标注由 n=40 更正为 n=42，结论不变。",
        },
        headers=auth_headers(admin_user),
    )
    assert correction.status_code == 201, correction.text
    assert correction.json()["event_type"] == "correction"

    retraction = await client.post(
        f"/api/catalog/{rid}/events",
        json={
            "event_type": "retraction",
            "title": "撤稿声明",
            "body": "作者发现原始数据不可复现，主动撤稿。",
        },
        headers=auth_headers(admin_user),
    )
    assert retraction.status_code == 201, retraction.text

    history = await client.get(f"/api/catalog/{rid}/history")
    assert history.status_code == 200, history.text
    body = history.json()
    assert body["retracted"] is True
    assert [row["event_type"] for row in body["events"]].count("correction") == 1
    assert [row["event_type"] for row in body["events"]].count("retraction") == 1

    updates = await client.get("/api/catalog/updates")
    assert updates.status_code == 200, updates.text
    assert any(row["resource_id"] == rid for row in updates.json())


@pytest.mark.asyncio
async def test_public_event_requires_admin_and_valid_type(
    client: AsyncClient, admin_user: dict
) -> None:
    resource = await _create_public_resource(client, admin_user, "事件权限")
    author = await register_user(
        client, email="events-author@example.com", username="events_author"
    )
    denied = await client.post(
        f"/api/catalog/{resource['id']}/events",
        json={"event_type": "correction", "title": "越权", "body": "不应成功"},
        headers=auth_headers(author),
    )
    assert denied.status_code == 403

    invalid = await client.post(
        f"/api/catalog/{resource['id']}/events",
        json={"event_type": "not_a_type", "title": "错误类型", "body": "不应成功"},
        headers=auth_headers(admin_user),
    )
    assert invalid.status_code == 422
