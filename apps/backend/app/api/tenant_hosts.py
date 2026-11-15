"""Admin endpoints for managing tenant host mappings.

In multi-tenant mode, host-header → tenant resolution is the entry point
for every request. These endpoints allow an admin to manage the host
mappings for their own tenant.

All endpoints require ``is_admin=True``. The current tenant is read from
the ContextVar (set by ``TenantContextMiddleware``) — an admin in tenant A
cannot add a host mapping for tenant B.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin, require_tenant_id
from app.core.db import get_db
from app.core.logging import get_logger
from app.core.tenant import invalidate_host_cache
from app.models import AuditLog, TenantHost, User
from app.schemas import TenantHostCreate, TenantHostResponse

router = APIRouter(prefix="/admin/tenant-hosts", tags=["tenant-hosts"])

logger = get_logger("rubbish.tenant_hosts")


@router.get("", response_model=list[TenantHostResponse])
async def list_tenant_hosts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[TenantHostResponse]:
    """List all host mappings for the current tenant."""
    tenant_id = require_tenant_id()
    result = await db.execute(
        select(TenantHost).where(TenantHost.tenant_id == tenant_id).order_by(TenantHost.host)
    )
    hosts = result.scalars().all()
    return [TenantHostResponse.model_validate(h) for h in hosts]


@router.post("", response_model=TenantHostResponse, status_code=status.HTTP_201_CREATED)
async def create_tenant_host(
    body: TenantHostCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> TenantHostResponse:
    """Add a host mapping for the current tenant.

    The host must be globally unique — a given domain can only point to
    one tenant. Returns 409 Conflict if the host is already mapped.
    """
    tenant_id = require_tenant_id()
    host = body.host.strip().lower()

    # Check for duplicate hostname across all tenants.
    existing = (
        await db.execute(select(TenantHost).where(TenantHost.host == host))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Host '{host}' is already mapped to a tenant",
        )

    entry = TenantHost(tenant_id=tenant_id, host=host, is_active=True)
    db.add(entry)
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_admin.id,
            action="tenant_host.create",
            target_type="tenant_host",
            target_id=None,
            payload={"host": host, "tenant_id": str(tenant_id)},
        )
    )
    await db.commit()
    await db.refresh(entry)

    # Invalidate the cache so the new mapping takes effect immediately.
    invalidate_host_cache(host)

    logger.info("tenant_host_created", host=host, tenant_id=str(tenant_id))
    return TenantHostResponse.model_validate(entry)


@router.delete("/{host_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant_host(
    host_id: int,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> None:
    """Remove a host mapping. Returns 404 if not found."""
    tenant_id = require_tenant_id()
    result = await db.execute(
        select(TenantHost).where(
            TenantHost.id == host_id,
            TenantHost.tenant_id == tenant_id,
        )
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Host mapping not found in this tenant",
        )

    host = entry.host
    await db.delete(entry)
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_admin.id,
            action="tenant_host.delete",
            target_type="tenant_host",
            target_id=str(host_id),
            payload={"host": host, "tenant_id": str(tenant_id)},
        )
    )
    await db.commit()

    # Invalidate the cache so the removed mapping stops resolving.
    invalidate_host_cache(host)

    logger.info("tenant_host_deleted", host=host, tenant_id=str(tenant_id))
