"""1.20.19: moderation policy cache, gray release and operational metrics."""

from __future__ import annotations

from uuid import uuid4

import pytest
from conftest import auth_headers
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.forum import moderation_service as moderation
from app.domain.forum.models import ForumModerationSetting
from app.domain.notifications import services as notification_services
from app.models import Tenant


def _base_policy(**overrides):
    values = dict(
        auto_publish_enabled=True,
        manual_threshold=40,
        sla_minutes=30,
        weights={},
        priority_risk_weight=10,
        priority_age_weight=1,
        gray_rules={},
    )
    values.update(overrides)
    return moderation.ModerationPolicy(**values)


def test_gray_release_precedence_and_sanitize() -> None:
    policy = _base_policy(
        gray_rules={
            "roles": {"user": {"manual_threshold": 30, "weights": {"low_effort": 8}}},
            "boards": {"site": 15},
        }
    )
    user_policy = moderation.effective_policy(policy, board_slug="discussion", role="user")
    assert user_policy.manual_threshold == 30
    assert user_policy.weights["low_effort"] == 8
    # A board segment is more specific than a role segment and wins.
    site_policy = moderation.effective_policy(policy, board_slug="site", role="user")
    assert site_policy.manual_threshold == 15

    cleaned = moderation.sanitize_gray_rules(
        {
            "boards": {
                "site": {"manual_threshold": 200, "auto_publish_enabled": False},
                "ok": 55,
                "bad": "nope",
            },
            "roles": {"user": {"manual_threshold": 0, "weights": {"unknown": 90, "contact": 300}}},
            "junk": {"x": 1},
        }
    )
    assert cleaned["boards"]["site"] == {
        "manual_threshold": 99,
        "auto_publish_enabled": False,
    }
    assert cleaned["boards"]["ok"] == 55
    assert cleaned["roles"]["user"] == {"manual_threshold": 1, "weights": {"contact": 100}}
    assert "junk" not in cleaned


def test_priority_score_uses_both_weights() -> None:
    policy = _base_policy(priority_risk_weight=10, priority_age_weight=1)
    assert moderation.priority_score(20, 0, policy) == 200
    assert moderation.priority_score(20, 60, policy) == 201


@pytest.mark.asyncio
async def test_policy_cache_is_tenant_scoped_and_invalidates(
    db_session: AsyncSession,
) -> None:
    tenant_a = uuid4()
    tenant_b = uuid4()
    for tenant_id, slug in (
        (tenant_a, f"cache-a-{tenant_a.hex[:8]}"),
        (tenant_b, f"cache-b-{tenant_b.hex[:8]}"),
    ):
        db_session.add(Tenant(id=tenant_id, slug=slug, name=slug))
    await db_session.commit()
    moderation.invalidate_policy(tenant_a)
    moderation.invalidate_policy(tenant_b)

    first_a = await moderation.get_policy(db_session, tenant_a)
    assert first_a.manual_threshold == 40

    row_b = ForumModerationSetting(
        tenant_id=tenant_b,
        auto_publish_enabled=True,
        manual_threshold=20,
        sla_minutes=30,
        weights={},
        priority_risk_weight=10,
        priority_age_weight=1,
        gray_rules={},
    )
    db_session.add(row_b)
    await db_session.commit()
    moderation.invalidate_policy(tenant_b)

    policy_b = await moderation.get_policy(db_session, tenant_b)
    assert policy_b.manual_threshold == 20
    # Tenant A stays on its own cached row; B's config must not leak into A.
    assert (await moderation.get_policy(db_session, tenant_a)).manual_threshold == 40

    row_a = (
        await db_session.execute(
            select(ForumModerationSetting).where(ForumModerationSetting.tenant_id == tenant_a)
        )
    ).scalar_one()
    row_a.manual_threshold = 70
    await db_session.commit()
    moderation.invalidate_policy(tenant_a)
    assert (await moderation.get_policy(db_session, tenant_a)).manual_threshold == 70
    assert (await moderation.get_policy(db_session, tenant_b)).manual_threshold == 20


@pytest.mark.asyncio
async def test_settings_api_accepts_queue_weights_and_gray_rules(
    client: AsyncClient, admin_user: dict
) -> None:
    r = await client.put(
        "/api/forum/moderation/settings",
        json={
            "auto_publish_enabled": True,
            "manual_threshold": 40,
            "sla_minutes": 30,
            "weights": {},
            "priority_risk_weight": 4,
            "priority_age_weight": 7,
            "gray_rules": {
                "boards": {"site": {"manual_threshold": 12}},
                "roles": {"user": 25},
            },
        },
        headers=auth_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["priority_risk_weight"] == 4
    assert body["priority_age_weight"] == 7
    assert body["gray_rules"]["boards"]["site"]["manual_threshold"] == 12
    assert body["gray_rules"]["roles"]["user"] == 25


@pytest.mark.asyncio
async def test_health_includes_forum_queue_and_notification_metrics(
    client: AsyncClient, admin_user: dict
) -> None:
    r = await client.get("/api/admin/system/health", headers=auth_headers(admin_user))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "forum_manual_review_pending" in body["counts"]
    assert "forum_sla_overdue" in body["counts"]
    assert "notification_failures_24h" in body["counts"]
    assert "notification_sent_24h" in body["counts"]
    keys = {row["key"] for row in body["checks"]}
    assert {"forum_queue", "notification_email"} <= keys


@pytest.mark.asyncio
async def test_decision_survives_notification_failure(
    client: AsyncClient, test_user: dict, admin_user: dict, monkeypatch
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
    topic = await client.post(
        "/api/forum/topics",
        json={
            "title": "通知失败时的审核恢复",
            "body": "这是一段足够长的正文，留下联系邮箱 notify-fail@example.com 用来进入人工核验。",
        },
        headers=auth_headers(test_user),
    )
    assert topic.status_code == 201, topic.text
    assert topic.json()["moderation_status"] == "manual_review"

    async def boom(*_args, **_kwargs):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(notification_services, "create", boom)
    decision = await client.post(
        f"/api/forum/moderation/topics/{topic.json()['id']}/decision",
        json={"action": "approve", "note": "通知通道故障，审核结果仍要落库。"},
        headers=auth_headers(admin_user),
    )
    assert decision.status_code == 200, decision.text
    assert decision.json()["moderation_status"] == "published"
