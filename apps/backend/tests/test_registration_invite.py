"""Invite-only registration: invite code + registration email code."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.email_code import hash_code
from app.models import EmailLoginCode, Tenant

INVITE = "RUBBISH-READER-TEST-4827"


async def _tenant_id(db: AsyncSession) -> object:
    return (await db.execute(select(Tenant.id).limit(1))).scalar_one()


async def test_registration_requires_invite_and_email_code(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "registration_invite_code", INVITE)
    monkeypatch.setattr(settings, "registration_email_code_required", True)
    # Ensure the tenant exists before querying its id directly.
    await client.get("/api/capabilities")

    wrong = await client.post(
        "/api/auth/register",
        json={
            "email": "invitee@example.com",
            "username": "invitee",
            "password": "password123",
            "invite_code": "WRONG-CODE",
        },
    )
    assert wrong.status_code == 403
    assert "邀请码" in wrong.json()["detail"]

    missing_code = await client.post(
        "/api/auth/register",
        json={
            "email": "invitee@example.com",
            "username": "invitee",
            "password": "password123",
            "invite_code": INVITE,
        },
    )
    assert missing_code.status_code == 400
    assert "邮箱验证码" in missing_code.json()["detail"]

    tenant_id = await _tenant_id(db_session)
    db_session.add(
        EmailLoginCode(
            tenant_id=tenant_id,
            email="invitee@example.com",
            purpose="register",
            code_hash=hash_code("invitee@example.com", "123456"),
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
    )
    await db_session.commit()

    created = await client.post(
        "/api/auth/register",
        json={
            "email": "invitee@example.com",
            "username": "invitee",
            "password": "password123",
            "invite_code": INVITE.lower(),
            "email_code": "123456",
        },
    )
    assert created.status_code == 201
    assert set(created.json()) == {"message"}

    login = await client.post(
        "/api/auth/login",
        json={"username": "invitee", "password": "password123"},
    )
    assert login.status_code == 200
    me = await client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["is_email_verified"] is True
