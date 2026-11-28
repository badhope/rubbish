"""Tenant-scoped, admin-editable site switches.

These are runtime policy flags that must survive a restart and differ from
the process environment defaults. They live in ``tenants.settings`` next to
the existing ``review_mode`` key so a single deployment does not need a
second settings table.

Only known keys are accepted; unknown keys are rejected at the API boundary
instead of silently growing a settings blob.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Tenant

_INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_INVITE_GROUPS = 3
_INVITE_GROUP_LEN = 4


def generate_registration_invite_code(prefix: str = "RUBBISH") -> str:
    """Return a readable, high-entropy invite code.

    Avoid ``0/O`` and ``1/I`` so an operator can read it over the phone or
    paste it into a group without correcting characters by hand.
    """
    groups = [
        "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(_INVITE_GROUP_LEN))
        for _ in range(_INVITE_GROUPS)
    ]
    return f"{prefix}-" + "-".join(groups)


def _default_for(key: str) -> bool:
    """Process default, read live so tests / env reloads are reflected."""
    if key == "captcha_required_for_registration":
        return bool(settings.captcha_required_for_registration)
    if key == "doi_author_entry_enabled":
        return True
    if key == "auth_wall_enabled":
        return bool(settings.auth_wall_enabled)
    if key == "mainland_gate_enabled":
        return bool(settings.mainland_gate_enabled)
    if key == "region_access_enabled":
        return bool(settings.region_access_enabled)
    if key == "registration_invite_required":
        return bool(settings.registration_invite_code.strip())
    if key == "registration_email_code_required":
        return bool(settings.registration_email_code_required)
    raise KeyError(key)


SITE_FLAGS: tuple[str, ...] = (
    "captcha_required_for_registration",
    "doi_author_entry_enabled",
    "auth_wall_enabled",
    "mainland_gate_enabled",
    "region_access_enabled",
    "registration_invite_required",
    "registration_email_code_required",
)

SITE_TEXTS: tuple[str, ...] = ("registration_invite_code",)


def _default_text(key: str) -> str:
    if key == "registration_invite_code":
        return settings.registration_invite_code.strip().upper()
    raise KeyError(key)


@dataclass(frozen=True)
class AccessPolicy:
    """The subset of site settings used at the request edge.

    The region / auth-wall / mainland-gate middleware run before the tenant
    dependency, so they cannot query the database per request. This immutable
    snapshot is loaded at startup and refreshed after every admin write.
    """

    auth_wall_enabled: bool
    mainland_gate_enabled: bool
    region_access_enabled: bool
    registration_invite_required: bool
    registration_email_code_required: bool
    registration_invite_code: str


_ACCESS_POLICY: AccessPolicy | None = None


def default_access_policy() -> AccessPolicy:
    return AccessPolicy(
        auth_wall_enabled=_default_for("auth_wall_enabled"),
        mainland_gate_enabled=_default_for("mainland_gate_enabled"),
        region_access_enabled=_default_for("region_access_enabled"),
        registration_invite_required=_default_for("registration_invite_required"),
        registration_email_code_required=_default_for("registration_email_code_required"),
        registration_invite_code=_default_text("registration_invite_code"),
    )


def get_access_policy() -> AccessPolicy:
    """Return the process snapshot, falling back to live env defaults."""
    return _ACCESS_POLICY or default_access_policy()


def reset_access_policy() -> None:
    """Drop the snapshot so the next read uses live env defaults.

    Test-only helper: pytest monkeypatches ``settings`` per case, while the
    snapshot is deliberately process-wide for request-edge performance.
    """
    global _ACCESS_POLICY
    _ACCESS_POLICY = None


def _policy_from_blob(blob: dict[str, Any] | None) -> AccessPolicy:
    base = default_access_policy()
    if not isinstance(blob, dict):
        return base
    return AccessPolicy(
        auth_wall_enabled=blob.get("auth_wall_enabled")
        if isinstance(blob.get("auth_wall_enabled"), bool)
        else base.auth_wall_enabled,
        mainland_gate_enabled=blob.get("mainland_gate_enabled")
        if isinstance(blob.get("mainland_gate_enabled"), bool)
        else base.mainland_gate_enabled,
        region_access_enabled=blob.get("region_access_enabled")
        if isinstance(blob.get("region_access_enabled"), bool)
        else base.region_access_enabled,
        registration_invite_required=blob.get("registration_invite_required")
        if isinstance(blob.get("registration_invite_required"), bool)
        else base.registration_invite_required,
        registration_email_code_required=blob.get("registration_email_code_required")
        if isinstance(blob.get("registration_email_code_required"), bool)
        else base.registration_email_code_required,
        registration_invite_code=(
            str(blob.get("registration_invite_code")).strip().upper()
            if isinstance(blob.get("registration_invite_code"), str)
            else base.registration_invite_code
        ),
    )


async def refresh_access_policy(
    db: AsyncSession | None = None,
    tenant_id: UUID | None = None,
) -> AccessPolicy:
    """Reload the process snapshot from ``tenants.settings``.

    Called during startup (after the bootstrap tenant exists) and after each
    admin write. A database failure keeps the previous snapshot instead of
    silently opening the site.
    """
    global _ACCESS_POLICY
    owns_session = db is None
    if db is None:
        from app.core.db import async_session_factory

        db = async_session_factory()
    try:
        if tenant_id is not None:
            stmt = select(Tenant.settings).where(Tenant.id == tenant_id)
        else:
            stmt = select(Tenant.settings).where(Tenant.slug == settings.bootstrap_tenant_slug)
        blob = (await db.execute(stmt)).scalar_one_or_none()
        _ACCESS_POLICY = _policy_from_blob(blob if isinstance(blob, dict) else None)
        return _ACCESS_POLICY
    finally:
        if owns_session:
            await db.close()


async def _tenant_blob(db: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    blob = (
        await db.execute(select(Tenant.settings).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    return dict(blob) if isinstance(blob, dict) else {}


async def get_site_flag(
    db: AsyncSession,
    tenant_id: UUID,
    key: str,
) -> bool:
    """Read a flag, falling back to the process default when unset."""
    default = _default_for(key)
    blob = await _tenant_blob(db, tenant_id)
    if isinstance(blob.get(key), bool):
        return bool(blob[key])
    return default


async def get_all_site_flags(db: AsyncSession, tenant_id: UUID) -> dict[str, bool]:
    blob = await _tenant_blob(db, tenant_id)
    return {
        key: bool(blob[key]) if isinstance(blob.get(key), bool) else _default_for(key)
        for key in SITE_FLAGS
    }


async def get_site_text(
    db: AsyncSession,
    tenant_id: UUID,
    key: str,
) -> str:
    if key not in SITE_TEXTS:
        raise KeyError(key)
    blob = await _tenant_blob(db, tenant_id)
    value = blob.get(key)
    if isinstance(value, str):
        return value.strip().upper()
    return _default_text(key)


async def get_site_texts(db: AsyncSession, tenant_id: UUID) -> dict[str, str]:
    return {key: await get_site_text(db, tenant_id, key) for key in SITE_TEXTS}


async def set_site_flag(
    db: AsyncSession,
    tenant_id: UUID,
    key: str,
    value: bool,
) -> None:
    """Persist one boolean flag without clobbering other tenant settings."""
    if key not in SITE_FLAGS:
        raise KeyError(key)
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if tenant is None:
        raise LookupError("Tenant not found")
    merged: dict[str, Any] = dict(tenant.settings or {})
    merged[key] = bool(value)
    tenant.settings = merged


async def set_site_text(
    db: AsyncSession,
    tenant_id: UUID,
    key: str,
    value: str,
) -> None:
    if key not in SITE_TEXTS:
        raise KeyError(key)
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if tenant is None:
        raise LookupError("Tenant not found")
    merged: dict[str, Any] = dict(tenant.settings or {})
    merged[key] = value.strip().upper()
    tenant.settings = merged


__all__ = [
    "SITE_FLAGS",
    "SITE_TEXTS",
    "AccessPolicy",
    "default_access_policy",
    "generate_registration_invite_code",
    "get_access_policy",
    "get_all_site_flags",
    "get_site_flag",
    "get_site_text",
    "get_site_texts",
    "refresh_access_policy",
    "reset_access_policy",
    "set_site_flag",
    "set_site_text",
]
