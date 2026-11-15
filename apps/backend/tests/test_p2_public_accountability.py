"""P2 public accountability: desk subscription + quarterly finance ledger."""

from __future__ import annotations

import re

from conftest import auth_headers
from httpx import AsyncClient

TOKEN_RE = re.compile(r"token=([A-Za-z0-9_-]+)&action=confirm")


async def test_desk_subscribe_double_opt_in_and_unsubscribe(
    client: AsyncClient, fake_email_sender
) -> None:
    r = await client.post("/api/support/subscribe", json={"email": "reader@example.com"})
    assert r.status_code == 202, r.text
    assert "确认邮件已发送" in r.json()["message"]
    assert len(fake_email_sender.outbox) == 1
    mail = fake_email_sender.last()
    assert mail["to"] == "reader@example.com"
    token = TOKEN_RE.search(mail["body"])
    assert token, mail["body"]

    status = await client.get("/api/support/subscription")
    assert status.status_code == 200
    assert status.json()["pending_count"] == 1
    assert status.json()["confirmed_count"] == 0

    # Public form must not become an email bomb: a second submit inside the
    # cooldown window is accepted but does not send another message.
    second = await client.post("/api/support/subscribe", json={"email": "reader@example.com"})
    assert second.status_code == 202
    assert len(fake_email_sender.outbox) == 1

    confirmed = await client.post("/api/support/confirm", json={"token": token.group(1)})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    assert confirmed.json()["email_masked"] == "re***@example.com"
    status = await client.get("/api/support/subscription")
    assert status.json()["confirmed_count"] == 1
    assert status.json()["pending_count"] == 0

    # Confirmed addresses do not receive another confirmation when resubmitted.
    again = await client.post("/api/support/subscribe", json={"email": "reader@example.com"})
    assert again.status_code == 202
    assert len(fake_email_sender.outbox) == 1

    unsub = await client.post("/api/support/unsubscribe", json={"token": token.group(1)})
    assert unsub.status_code == 200
    assert unsub.json()["status"] == "unsubscribed"
    status = await client.get("/api/support/subscription")
    assert status.json()["confirmed_count"] == 0


async def test_desk_subscribe_invalid_email(client: AsyncClient) -> None:
    r = await client.post("/api/support/subscribe", json={"email": "not-an-email"})
    assert r.status_code == 422

    r = await client.post("/api/support/confirm", json={"token": "x" * 32})
    assert r.status_code == 200
    assert r.json()["status"] == "invalid"


async def test_finance_report_draft_then_publish(client: AsyncClient, admin_user: dict) -> None:
    payload = {
        "year": 2026,
        "quarter": 4,
        "title": "2026 Q4 账本：先把账记清楚",
        "summary_md": "本季只登记实际支出。",
        "income_items": [{"label": "读者赞助", "amount_cents": 12000, "note": ""}],
        "expense_items": [
            {"label": "VPS", "amount_cents": 9000, "note": "季度合计"},
            {"label": "域名", "amount_cents": 1500, "note": ""},
        ],
        "currency": "CNY",
        "published": False,
    }
    created = await client.post(
        "/api/admin/finance/reports", json=payload, headers=auth_headers(admin_user)
    )
    assert created.status_code == 201, created.text
    report = created.json()
    assert report["published"] is False
    assert report["income_items"][0]["amount_cents"] == 12000

    public = await client.get("/api/support/reports")
    assert public.status_code == 200
    assert public.json()["total"] == 0

    payload["published"] = True
    updated = await client.patch(
        f"/api/admin/finance/reports/{report['id']}",
        json=payload,
        headers=auth_headers(admin_user),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["published"] is True
    assert updated.json()["published_at"]

    public = await client.get("/api/support/reports")
    assert public.json()["total"] == 1
    latest = await client.get("/api/support/reports/latest")
    assert latest.status_code == 200
    assert latest.json()["title"] == payload["title"]
    assert latest.json()["summary_md"] == payload["summary_md"]

    # A published report cannot be silently deleted.
    deleted = await client.delete(
        f"/api/admin/finance/reports/{report['id']}", headers=auth_headers(admin_user)
    )
    assert deleted.status_code == 409


async def test_finance_requires_admin(client: AsyncClient, test_user: dict) -> None:
    r = await client.get("/api/admin/finance/reports", headers=auth_headers(test_user))
    assert r.status_code == 403
    r = await client.get("/api/admin/desk/subscribers", headers=auth_headers(test_user))
    assert r.status_code == 403


async def test_editor_today_aggregates_backup_and_email(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    r = await client.get("/api/admin/editor/today", headers=auth_headers(admin_user))
    assert r.status_code == 200, r.text
    keys = {check["key"] for check in r.json()["checks"]}
    assert {"backup", "database", "migration", "disk", "email"} <= keys

    r = await client.get("/api/admin/editor/today", headers=auth_headers(test_user))
    assert r.status_code == 403
