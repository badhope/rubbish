"""作者申诉闭环：提交、后台队列、决定、通知与撤回下架。"""

from __future__ import annotations

from conftest import auth_headers, register_user
from httpx import AsyncClient
from sqlalchemy import select

from app.domain.catalog.models import Resource


async def _owned_resource(
    client: AsyncClient,
    admin: dict,
    db_session,
    *,
    owner_id: int,
    title: str,
) -> int:
    payload = {
        "type": "paper",
        "title": title,
        "authors": ["作者"],
        "year": 2026,
        "discipline": "计算机科学",
        "abstract": "用于验证作者申诉闭环的占位摘要。",
    }
    created = await client.post("/api/catalog", json=payload, headers=auth_headers(admin))
    assert created.status_code == 201, created.text
    resource_id = created.json()["id"]
    resource = (
        await db_session.execute(select(Resource).where(Resource.id == resource_id))
    ).scalar_one()
    resource.owner_id = owner_id
    await db_session.commit()
    return resource_id


async def _notifications(client: AsyncClient, user: dict, type_: str) -> list[dict]:
    response = await client.get(
        "/api/notifications",
        params={"page_size": 50},
        headers=auth_headers(user),
    )
    assert response.status_code == 200, response.text
    return [item for item in response.json()["data"] if item["type"] == type_]


async def test_author_submits_appeal_once_and_admin_is_notified(
    client: AsyncClient, admin_user: dict, test_user: dict, db_session
) -> None:
    resource_id = await _owned_resource(
        client, admin_user, db_session, owner_id=int(test_user["user_id"]), title="申诉目标作品"
    )
    reason = "这是一段完整申诉理由：" + "本文的评分与实际内容不符，" * 8
    first = await client.post(
        f"/api/catalog/{resource_id}/appeal",
        json={"kind": "rescore", "reason": reason},
        headers=auth_headers(test_user),
    )
    assert first.status_code == 201, first.text
    body = first.json()
    assert body["status"] == "pending"
    assert body["kind"] == "rescore"
    assert body["resource_title"] == "申诉目标作品"

    second = await client.post(
        f"/api/catalog/{resource_id}/appeal",
        json={"kind": "rescore", "reason": reason},
        headers=auth_headers(test_user),
    )
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "appeal_exists"

    mine = await client.get("/api/catalog/appeals/mine", headers=auth_headers(test_user))
    assert mine.status_code == 200
    assert [item["id"] for item in mine.json()["items"]] == [body["id"]]

    notifications = await _notifications(client, admin_user, "appeal.created")
    assert any(
        item["related_type"] == "appeal" and item["related_id"] == str(body["id"])
        for item in notifications
    )

    outsider = await register_user(client, email="outsider@example.com", username="outsider")
    denied = await client.post(
        f"/api/catalog/{resource_id}/appeal",
        json={"kind": "withdraw", "reason": reason},
        headers=auth_headers(outsider),
    )
    assert denied.status_code == 403


async def test_admin_accepting_withdrawal_unpublishes_and_notifies_author(
    client: AsyncClient, admin_user: dict, test_user: dict, db_session
) -> None:
    resource_id = await _owned_resource(
        client, admin_user, db_session, owner_id=int(test_user["user_id"]), title="撤回目标作品"
    )
    reason = "这是一段完整申诉理由：" + "作品已经另有安排，请从公开目录撤回。" * 8
    created = await client.post(
        f"/api/catalog/{resource_id}/appeal",
        json={"kind": "withdraw", "reason": reason},
        headers=auth_headers(test_user),
    )
    assert created.status_code == 201, created.text
    appeal_id = created.json()["id"]

    non_admin = await client.patch(
        f"/api/catalog/admin/appeals/{appeal_id}",
        json={
            "status": "accepted",
            "editor_note": "这条决定不应该由普通成员发出，普通账号没有申诉处置权限。",
        },
        headers=auth_headers(test_user),
    )
    assert non_admin.status_code == 403

    decided = await client.patch(
        f"/api/catalog/admin/appeals/{appeal_id}",
        json={
            "status": "accepted",
            "editor_note": "确认撤回申请，作品已从公开目录下架并停止对外展示。",
        },
        headers=auth_headers(admin_user),
    )
    assert decided.status_code == 200, decided.text
    assert decided.json()["status"] == "accepted"

    db_session.expire_all()
    resource = (
        await db_session.execute(select(Resource).where(Resource.id == resource_id))
    ).scalar_one()
    assert resource.publication_status == "draft"

    notifications = await _notifications(client, test_user, "appeal.decision")
    assert any(item["related_id"] == str(appeal_id) for item in notifications)

    again = await client.patch(
        f"/api/catalog/admin/appeals/{appeal_id}",
        json={"status": "rejected", "editor_note": "重复处理应该被拒绝，这条申诉已经有最终结论。"},
        headers=auth_headers(admin_user),
    )
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "appeal_already_decided"


async def test_rejecting_rescore_keeps_resource_public_and_audits(
    client: AsyncClient, admin_user: dict, test_user: dict, db_session
) -> None:
    resource_id = await _owned_resource(
        client, admin_user, db_session, owner_id=int(test_user["user_id"]), title="重审被驳回作品"
    )
    reason = "这是一段完整申诉理由：" + "评分维度存在明显偏差，请重新核对五项评分。" * 8
    created = await client.post(
        f"/api/catalog/{resource_id}/appeal",
        json={"kind": "rescore", "reason": reason},
        headers=auth_headers(test_user),
    )
    appeal_id = created.json()["id"]

    decided = await client.patch(
        f"/api/catalog/admin/appeals/{appeal_id}",
        json={"status": "rejected", "editor_note": "复核后维持原评分，现有理由不足以支持改判。"},
        headers=auth_headers(admin_user),
    )
    assert decided.status_code == 200, decided.text
    assert decided.json()["status"] == "rejected"

    db_session.expire_all()
    resource = (
        await db_session.execute(select(Resource).where(Resource.id == resource_id))
    ).scalar_one()
    assert resource.publication_status == "published"

    queue = await client.get(
        "/api/catalog/admin/appeals",
        params={"status": "rejected"},
        headers=auth_headers(admin_user),
    )
    assert queue.status_code == 200
    assert any(item["id"] == appeal_id for item in queue.json()["items"])
    assert queue.json()["meta"]["total"] >= 1


async def test_appeal_validation_and_short_reason(
    client: AsyncClient, admin_user: dict, test_user: dict, db_session
) -> None:
    resource_id = await _owned_resource(
        client, admin_user, db_session, owner_id=int(test_user["user_id"]), title="申诉校验作品"
    )
    short = await client.post(
        f"/api/catalog/{resource_id}/appeal",
        json={"kind": "rescore", "reason": "太短"},
        headers=auth_headers(test_user),
    )
    assert short.status_code == 422

    bad_kind = await client.post(
        f"/api/catalog/{resource_id}/appeal",
        json={"kind": "refund", "reason": "这是一段完整申诉理由：" + "理由" * 70},
        headers=auth_headers(test_user),
    )
    assert bad_kind.status_code == 422
