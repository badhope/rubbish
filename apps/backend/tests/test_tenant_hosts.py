"""Admin tenant host-mapping CRUD (multi-tenant host resolution)."""

from __future__ import annotations

import pytest
from conftest import auth_headers
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Tenant, TenantHost


@pytest.mark.asyncio
async def test_tenant_hosts_require_admin(client: AsyncClient, test_user: dict) -> None:
    r = await client.get("/api/admin/tenant-hosts", headers=auth_headers(test_user))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_tenant_host_lifecycle(
    client: AsyncClient, admin_user: dict, db_session: AsyncSession
) -> None:
    headers = auth_headers(admin_user)

    empty = await client.get("/api/admin/tenant-hosts", headers=headers)
    assert empty.status_code == 200
    assert empty.json() == []

    # Host is normalised: lowercased by the endpoint.
    created = await client.post(
        "/api/admin/tenant-hosts", json={"host": "Journal.Example.COM"}, headers=headers
    )
    assert created.status_code == 201
    body = created.json()
    assert body["host"] == "journal.example.com"
    assert body["is_active"] is True

    duplicate = await client.post(
        "/api/admin/tenant-hosts", json={"host": "journal.example.com"}, headers=headers
    )
    assert duplicate.status_code == 409

    listed = await client.get("/api/admin/tenant-hosts", headers=headers)
    assert listed.status_code == 200
    assert [h["host"] for h in listed.json()] == ["journal.example.com"]

    audit = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "tenant_host.create")
    )
    assert audit.scalars().first() is not None

    removed = await client.delete(f"/api/admin/tenant-hosts/{body['id']}", headers=headers)
    assert removed.status_code == 204

    again = await client.delete(f"/api/admin/tenant-hosts/{body['id']}", headers=headers)
    assert again.status_code == 404

    final = await client.get("/api/admin/tenant-hosts", headers=headers)
    assert final.json() == []

    delete_audit = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "tenant_host.delete")
    )
    assert delete_audit.scalars().first() is not None


@pytest.mark.asyncio
async def test_tenant_host_rejects_malformed_host(client: AsyncClient, admin_user: dict) -> None:
    r = await client.post(
        "/api/admin/tenant-hosts", json={"host": "not a host!"}, headers=auth_headers(admin_user)
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_tenant_host_row_is_scoped_to_tenant(
    client: AsyncClient, admin_user: dict, db_session: AsyncSession
) -> None:
    """Created rows carry the current tenant id from the ContextVar."""
    headers = auth_headers(admin_user)
    created = await client.post(
        "/api/admin/tenant-hosts", json={"host": "scoped.example.org"}, headers=headers
    )
    assert created.status_code == 201

    row = (
        await db_session.execute(select(TenantHost).where(TenantHost.host == "scoped.example.org"))
    ).scalar_one()
    tenant = (await db_session.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()
    assert row.tenant_id == tenant.id
    assert row.is_active is True
