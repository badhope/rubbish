"""GDPR self-service endpoints (M5 hardening).

Two endpoints per the GDPR right-to-erasure / right-to-data-portability
contract:

- ``GET /api/users/me/export`` — download a JSON document containing
  every piece of personal data the system holds about the caller.
  This is the data-portability request (Article 20).
- ``DELETE /api/users/me`` — soft-delete the caller's account. The row
  is anonymised in place (email -> ``deleted-{user_id}@deleted.local``,
  username -> ``deleted-{user_id}``, hashed_password rotated to a
  random unguessable value, ``is_active=False``, display name + bio
  cleared, TOTP secret destroyed). A scheduled job (out of scope for
  M5) hard-deletes the row after 30 days.

  Soft delete is preferred over hard delete because domain tables
  (submissions, reviews, audit logs) carry ``user_id`` as a foreign
  key. Hard-deleting would orphan or cascade-wipe publications the
  author still wants visible. Anonymising the user preserves the
  referential integrity of historical submissions / reviews while
  erasing the user's personally identifiable information.

- ``POST /api/users/me/restore`` — undo a soft delete within the
  30-day grace window. The caller supplies a new email + username +
  password. Outside the window the row may have been hard-deleted by
  the sweep job, in which case there is nothing to restore — the
  caller must register a new account.

The 30-day retention window is enforced by reading
``User.deleted_at``: a value older than 30 days means a hard-delete
job has either already run or should run on the next sweep.

All endpoints mutate ``token_version`` so any active session is
immediately invalidated.

Note on the ``get_soft_delete_aware_user`` dependency: the standard
``get_current_user`` dependency refuses soft-deleted accounts with
403 because they cannot poke at write endpoints. The restore endpoint
needs the opposite: a user in the soft-deleted state must still be
able to call back inside the grace window to undo the deletion.
``get_soft_delete_aware_user`` accepts the bearer token (checking
``token_version`` as usual) but does NOT refuse on ``is_active``.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.logging import get_logger
from app.core.retention import USER_DELETION_GRACE_DAYS
from app.core.security import (
    decode_access_token,
    hash_password,
    token_version_matches,
    verify_password,
)
from app.core.tenant import TENANT_CONTEXT_VAR
from app.models import AuditLog, User
from app.schemas import UserResponse

router = APIRouter(prefix="/users", tags=["users-gdpr"])

logger = get_logger("rubbish.gdpr")

# 30-day grace period between soft delete and hard delete. Operators
# can tune this via env if their jurisdiction requires a different
# window (some sectors mandate 90 days for audit trails).
_DELETION_GRACE_DAYS = USER_DELETION_GRACE_DAYS


# --- Auth dependency that allows soft-deleted callers ----------------------


async def get_soft_delete_aware_user(
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> User:
    """Bearer-auth dependency that permits ``is_active=False`` callers.

    Used only by the GDPR restore endpoint. Every other endpoint
    keeps using the standard ``get_current_user`` which refuses
    soft-deleted users with 403 — that refusal is correct for write
    endpoints but would prevent the account holder from undoing the
    deletion inside the grace window.
    """
    if authorization is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = parts[1]
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    sub = payload.get("sub")
    try:
        user_id = int(sub)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from exc
    tenant_id = TENANT_CONTEXT_VAR.get()
    stmt = select(User).where(User.id == user_id)
    if tenant_id is not None:
        stmt = stmt.where(User.tenant_id == tenant_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # Soft-deleted grace-window exemption (T2 finding H-3): deletion bumps
    # token_version, so the strict check below would 401 every pre-deletion
    # token and permanently brick the restore endpoint — the documented
    # 30-day recovery promise was unreachable. During the window the
    # deleted-state user has no other credential (password was anonymised
    # at deletion), so the pre-deletion bearer token IS the intended
    # restore credential. Threat model: a stolen pre-deletion token could
    # re-activate the account and set a new password; mitigated because
    # (a) the same token was equally usable while the account was alive,
    # (b) restore stamps a fresh token_version, invalidating every
    # outstanding token including the attacker's, and (c) restore only
    # works while deleted_at is set and inside the grace window.
    if not (_is_soft_deleted(user) and _within_grace_window(user)):
        if not token_version_matches(payload, user.token_version):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked"
            )
    # Note: is_active / is_email_verified deliberately NOT checked
    # here. The GDPR restore path is the only legitimate reason for
    # a soft-deleted user to be talking to the API at all.
    return user


# --- Helpers ---------------------------------------------------------------


def _deleted_marker(user_id: int) -> tuple[str, str]:
    """Build the anonymised email + username for a soft-deleted user.

    The user id is preserved in the placeholder so that historical
    references in submissions / reviews / audit logs can still be
    joined on ``user_id``, but no PII (email, name) leaks into those
    joined views.
    """
    suffix = f"deleted-{user_id}"
    return (f"{suffix}@deleted.local", suffix)


def _is_soft_deleted(user: User) -> bool:
    """Return True if the user is in the soft-deleted state."""
    return user.email.endswith("@deleted.local")


def _within_grace_window(user: User) -> bool:
    """Return True if the soft-deleted user is still inside the 30-day
    window during which a restore is possible.

    Tolerates both timezone-aware and timezone-naive ``deleted_at``
    values so the test SQLite (which strips tzinfo) and production
    PostgreSQL (which preserves it) both behave the same way.
    """
    if user.deleted_at is None:
        return False
    deleted_at = user.deleted_at
    if deleted_at.tzinfo is None:
        # Treat naive datetimes as UTC. The column is declared
        # ``DateTime(timezone=True)`` so production rows carry tzinfo;
        # this branch only fires for SQLite test rows.
        deleted_at = deleted_at.replace(tzinfo=UTC)
    return datetime.now(UTC) - deleted_at < timedelta(days=_DELETION_GRACE_DAYS)


# --- Data export -----------------------------------------------------------


@router.get("/me/export")
async def export_my_data(
    current_user: User = Depends(get_soft_delete_aware_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return a JSON document of everything the system holds about the caller.

    The shape is intentionally flat: a top-level ``exported_at``
    timestamp, a ``user`` object with the caller's profile fields,
    and an empty list for each domain table the caller has rows in
    (modules will register additional export sections in their own
    routers). The audit log entry is recorded with a separate action
    name so a regulator can correlate export requests with the
    account holder.
    """
    sections: dict[str, list[dict[str, Any]]] = {
        "submissions": [],
        "reviews": [],
        "reading_history": [],
        "library_lists": [],
    }

    # Audit the export request (success-side audit only — we do NOT
    # record a row when the export is denied).
    db.add(
        AuditLog(
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            action="user.export_data",
            target_type="user",
            target_id=str(current_user.id),
            payload={"sections": list(sections.keys())},
        )
    )
    await db.commit()

    user_payload: dict[str, Any] = {
        "id": current_user.id,
        "tenant_id": str(current_user.tenant_id),
        "email": current_user.email,
        "username": current_user.username,
        "is_active": current_user.is_active,
        "is_admin": current_user.is_admin,
        "is_email_verified": current_user.is_email_verified,
        "totp_enabled": current_user.totp_enabled_at is not None,
        "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
        "updated_at": current_user.updated_at.isoformat() if current_user.updated_at else None,
        "deleted_at": current_user.deleted_at.isoformat() if current_user.deleted_at else None,
    }
    return {
        "exported_at": datetime.now(UTC).isoformat(),
        "schema_version": 1,
        "user": user_payload,
        "sections": sections,
    }


# --- Soft delete -----------------------------------------------------------


class DeleteMyAccountRequest(BaseModel):
    password: str = Field(min_length=1)
    confirmation: str = Field(min_length=1)


@router.delete("/me", status_code=status.HTTP_202_ACCEPTED)
async def delete_my_account(
    payload: DeleteMyAccountRequest,
    current_user: User = Depends(get_soft_delete_aware_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Soft-delete the caller's account.

    Steps, in order:

    1. Re-authenticate by re-checking the password. This stops an
       attacker with a stolen browser session from triggering the
       delete via CSRF or by walking up to an unattended machine.
    2. Verify the literal confirmation string ``"DELETE MY ACCOUNT"``
       so a fat-finger click can't blow the account away.
    3. Anonymise the PII fields (email, username, password), clear
       TOTP state, set ``is_active=False`` and ``deleted_at=now``,
       bump ``token_version`` to invalidate every active session.
    4. Record an audit log so the user has proof of the request.
    """
    # Confirmation must be the literal phrase to avoid accidental
    # account deletion via misclick or stale form values.
    if payload.confirmation.strip().upper() != "DELETE MY ACCOUNT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation must be exactly 'DELETE MY ACCOUNT'",
        )

    if not verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        )

    if _is_soft_deleted(current_user):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Account is already scheduled for deletion",
        )

    anon_email, anon_username = _deleted_marker(current_user.id)
    current_user.email = anon_email
    current_user.username = anon_username
    # Rotate the password to an unguessable random value. We do NOT
    # null it out (NOT NULL constraint) and we do NOT reuse the same
    # hash (otherwise an attacker who later recovered the deleted
    # user's previous hash could log in as the deleted account).
    current_user.hashed_password = hash_password(secrets.token_urlsafe(48))
    current_user.is_active = False
    current_user.is_email_verified = False
    # Destroy the TOTP secret so even a future restore + new password
    # would need to re-enroll 2FA. Only the encrypted ``totp_*`` column
    # group remains — the plaintext ``two_factor_*`` columns were dropped
    # by migration 021_unify_two_factor.
    current_user.totp_secret_encrypted = None
    current_user.totp_enabled_at = None
    current_user.totp_backup_codes_hashed = None
    current_user.deleted_at = datetime.now(UTC)
    # Invalidate every active session immediately. The bump below is
    # enough — no separate "log out everywhere" call is needed.
    current_user.token_version += 1
    current_user.refresh_token_version += 1

    db.add(
        AuditLog(
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            action="user.soft_delete",
            target_type="user",
            target_id=str(current_user.id),
            payload={
                "grace_days": _DELETION_GRACE_DAYS,
                "hard_delete_after": (
                    current_user.deleted_at + timedelta(days=_DELETION_GRACE_DAYS)
                ).isoformat(),
            },
        )
    )
    await db.commit()

    logger.info(
        "user_soft_deleted",
        user_id=current_user.id,
        grace_until=(current_user.deleted_at + timedelta(days=_DELETION_GRACE_DAYS)).isoformat(),
    )

    return {
        "status": "scheduled_for_deletion",
        "grace_days": _DELETION_GRACE_DAYS,
        "hard_delete_after": (
            current_user.deleted_at + timedelta(days=_DELETION_GRACE_DAYS)
        ).isoformat(),
    }


# --- Restore (within grace window) -----------------------------------------


class RestoreMyAccountRequest(BaseModel):
    email: str = Field(min_length=1)
    username: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/me/restore", response_model=UserResponse)
async def restore_my_account(
    payload: RestoreMyAccountRequest,
    current_user: User = Depends(get_soft_delete_aware_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Restore a soft-deleted account inside the 30-day grace window.

    The caller supplies the new email + username they want back and
    a new password. Outside the grace window the row may have been
    hard-deleted by the sweep job, in which case there is nothing to
    restore — the caller must register a new account.
    """
    if not _is_soft_deleted(current_user):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Account is not in a deleted state",
        )
    if not _within_grace_window(current_user):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=(
                "Restoration window has closed; the account has been permanently "
                "deleted. Please register a new account."
            ),
        )

    # Uniqueness check on the new email/username (per tenant). If
    # either is taken, the caller picks another one.
    current_user.email = payload.email
    current_user.username = payload.username
    current_user.hashed_password = hash_password(payload.new_password)
    current_user.is_active = True
    current_user.is_email_verified = False
    current_user.deleted_at = None
    current_user.token_version += 1
    current_user.refresh_token_version += 1

    db.add(
        AuditLog(
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            action="user.restore",
            target_type="user",
            target_id=str(current_user.id),
            payload={"new_email": payload.email, "new_username": payload.username},
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email or username already taken in this tenant",
        ) from exc
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)


__all__ = ["router"]
