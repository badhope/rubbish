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

from app.api.deps import get_current_user
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
    # Export is for a live account; the soft-delete-aware dependency is only
    # needed by restore below. Using the standard dependency also keeps the
    # staging QA identity override working, instead of making export the one
    # page the QA machine account cannot open.
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return a JSON document of the caller's real account data.

    This endpoint previously returned four empty placeholder lists while the
    privacy page promised "export all personal data". That is exactly the kind
    of half-feature this project refuses to ship. The export now reads the
    actual domain tables, caps each section to keep the response bounded, and
    reports any truncation instead of silently pretending the list was complete.

    Secrets are deliberately excluded: password hashes, TOTP secret material,
    backup-code hashes and passkey public keys are credentials, not personal
    data a data-subject needs copied into an email attachment.
    """
    from app.domain.catalog.models import Appeal, AuthorClaim, Resource
    from app.domain.comments.models import Comment
    from app.domain.follows.models import AuthorFollow, DisciplineSubscription
    from app.domain.forum.models import ForumReply, ForumTopic
    from app.domain.gamification.models import (
        RoleApplication,
        UserAchievement,
        UserXpEvent,
    )
    from app.domain.library.models import ReadingList, ReadingListItem
    from app.domain.notifications.models import Notification
    from app.domain.reader.models import ReadingHistory
    from app.domain.review.models import ReviewAssignment, ReviewReport
    from app.domain.submission.models import Submission

    section_limit = 2000
    truncated: dict[str, int] = {}
    tenant_id = current_user.tenant_id
    user_id = current_user.id

    def iso(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    async def scalar_rows(stmt) -> list[Any]:
        rows = (await db.execute(stmt.limit(section_limit + 1))).scalars().all()
        if len(rows) > section_limit:
            truncated[stmt_key] = len(rows) - 1
        return rows[:section_limit]

    async def tuple_rows(stmt) -> list[Any]:
        rows = (await db.execute(stmt.limit(section_limit + 1))).all()
        if len(rows) > section_limit:
            truncated[stmt_key] = len(rows) - 1
        return rows[:section_limit]

    # The helper reads this mutable local only for its truncation label; each
    # caller sets it immediately before invoking, which keeps the boilerplate
    # out of every section without relying on inspect() or query introspection.
    stmt_key = ""

    stmt_key = "submissions"
    submissions = await scalar_rows(
        select(Submission)
        .where(Submission.tenant_id == tenant_id, Submission.submitted_by == user_id)
        .order_by(Submission.submitted_at.desc(), Submission.id.desc())
    )
    submissions_payload = [
        {
            "id": row.id,
            "title": row.title,
            "type": row.type,
            "content_track": row.content_track,
            "status": row.status,
            "triage_status": row.triage_status,
            "abstract": row.abstract,
            "preview": row.preview,
            "tags": row.tags,
            "editor_note": row.editor_note,
            "author_response": row.author_response,
            "resource_id": row.resource_id,
            "submitted_at": iso(row.submitted_at),
            "updated_at": iso(row.updated_at),
        }
        for row in submissions
    ]

    stmt_key = "reviews"
    review_rows = await tuple_rows(
        select(ReviewAssignment, Submission.title)
        .join(Submission, Submission.id == ReviewAssignment.submission_id)
        .where(
            ReviewAssignment.tenant_id == tenant_id,
            ReviewAssignment.reviewer_id == user_id,
        )
        .order_by(ReviewAssignment.invited_at.desc(), ReviewAssignment.id.desc())
    )
    reviews_payload = [
        {
            "assignment_id": assignment.id,
            "submission_id": assignment.submission_id,
            "submission_title": title,
            "status": assignment.status,
            "round": assignment.round,
            "due_date": iso(assignment.due_date),
            "invited_at": iso(assignment.invited_at),
            "responded_at": iso(assignment.responded_at),
            "completed_at": iso(assignment.completed_at),
        }
        for assignment, title in review_rows
    ]

    stmt_key = "review_reports"
    report_rows = await tuple_rows(
        select(ReviewReport, ReviewAssignment.submission_id)
        .join(ReviewAssignment, ReviewAssignment.id == ReviewReport.assignment_id)
        .where(
            ReviewReport.tenant_id == tenant_id,
            ReviewAssignment.reviewer_id == user_id,
        )
        .order_by(ReviewReport.submitted_at.desc(), ReviewReport.id.desc())
    )
    review_reports_payload = [
        {
            "report_id": report.id,
            "assignment_id": report.assignment_id,
            "submission_id": submission_id,
            "recommendation": report.recommendation,
            "scores": report.scores,
            "comments_to_editor": report.comments_to_editor,
            "comments_to_author": report.comments_to_author,
            "attachments": report.attachments,
            "submitted_at": iso(report.submitted_at),
        }
        for report, submission_id in report_rows
    ]

    stmt_key = "reading_history"
    history_rows = await tuple_rows(
        select(ReadingHistory, Resource.title)
        .join(Resource, Resource.id == ReadingHistory.resource_id)
        .where(ReadingHistory.tenant_id == tenant_id, ReadingHistory.user_id == user_id)
        .order_by(ReadingHistory.viewed_at.desc(), ReadingHistory.id.desc())
    )
    reading_history_payload = [
        {
            "resource_id": history.resource_id,
            "resource_title": title,
            "viewed_at": iso(history.viewed_at),
            "visit_count": history.visit_count,
            "page": history.page,
            "progress_percent": history.progress_percent,
            "duration_sec": history.duration_sec,
            "last_read_at": iso(history.last_read_at),
            "completed": history.completed,
        }
        for history, title in history_rows
    ]

    stmt_key = "library_lists"
    list_rows = await scalar_rows(
        select(ReadingList)
        .where(ReadingList.tenant_id == tenant_id, ReadingList.user_id == user_id)
        .order_by(ReadingList.updated_at.desc(), ReadingList.id.desc())
    )
    list_ids = [row.id for row in list_rows]
    stmt_key = "library_list_items"
    item_rows = (
        await tuple_rows(
            select(ReadingListItem, Resource.title)
            .join(Resource, Resource.id == ReadingListItem.resource_id)
            .where(
                ReadingListItem.tenant_id == tenant_id,
                ReadingListItem.reading_list_id.in_(list_ids),
            )
            .order_by(ReadingListItem.id)
        )
        if list_ids
        else []
    )
    items_by_list: dict[int, list[dict[str, Any]]] = {}
    for item, title in item_rows:
        items_by_list.setdefault(item.reading_list_id, []).append(
            {
                "resource_id": item.resource_id,
                "resource_title": title,
                "added_at": iso(item.added_at),
            }
        )
    library_lists_payload = [
        {
            "id": row.id,
            "name": row.name,
            "description": row.description,
            "created_at": iso(row.created_at),
            "updated_at": iso(row.updated_at),
            "items": items_by_list.get(row.id, []),
        }
        for row in list_rows
    ]

    stmt_key = "comments"
    comment_rows = await tuple_rows(
        select(Comment, Resource.title)
        .join(Resource, Resource.id == Comment.resource_id)
        .where(Comment.tenant_id == tenant_id, Comment.user_id == user_id)
        .order_by(Comment.created_at.desc(), Comment.id.desc())
    )
    comments_payload = [
        {
            "id": comment.id,
            "resource_id": comment.resource_id,
            "resource_title": title,
            "body": comment.body,
            "status": comment.status,
            "moderation_note": comment.moderation_note,
            "created_at": iso(comment.created_at),
        }
        for comment, title in comment_rows
    ]

    stmt_key = "forum_topics"
    topic_rows = await scalar_rows(
        select(ForumTopic)
        .where(ForumTopic.tenant_id == tenant_id, ForumTopic.author_id == user_id)
        .order_by(ForumTopic.created_at.desc(), ForumTopic.id.desc())
    )
    forum_topics_payload = [
        {
            "id": row.id,
            "title": row.title,
            "body": row.body,
            "category": row.category,
            "is_fictional": row.is_fictional,
            "reply_count": row.reply_count,
            "created_at": iso(row.created_at),
            "deleted_at": iso(row.deleted_at),
        }
        for row in topic_rows
    ]

    stmt_key = "forum_replies"
    reply_rows = await scalar_rows(
        select(ForumReply)
        .where(ForumReply.tenant_id == tenant_id, ForumReply.author_id == user_id)
        .order_by(ForumReply.created_at.desc(), ForumReply.id.desc())
    )
    forum_replies_payload = [
        {
            "id": row.id,
            "topic_id": row.topic_id,
            "parent_id": row.parent_id,
            "body": row.body,
            "created_at": iso(row.created_at),
            "deleted_at": iso(row.deleted_at),
        }
        for row in reply_rows
    ]

    stmt_key = "appeals"
    appeal_rows = await tuple_rows(
        select(Appeal, Resource.title)
        .join(Resource, Resource.id == Appeal.resource_id)
        .where(Appeal.tenant_id == tenant_id, Appeal.user_id == user_id)
        .order_by(Appeal.created_at.desc(), Appeal.id.desc())
    )
    appeals_payload = [
        {
            "id": appeal.id,
            "resource_id": appeal.resource_id,
            "resource_title": title,
            "kind": appeal.kind,
            "reason": appeal.reason,
            "status": appeal.status,
            "editor_note": appeal.editor_note,
            "created_at": iso(appeal.created_at),
            "decided_at": iso(appeal.decided_at),
        }
        for appeal, title in appeal_rows
    ]

    stmt_key = "author_claims"
    claim_rows = await tuple_rows(
        select(AuthorClaim, Resource.title)
        .join(Resource, Resource.id == AuthorClaim.resource_id)
        .where(AuthorClaim.tenant_id == tenant_id, AuthorClaim.user_id == user_id)
        .order_by(AuthorClaim.created_at.desc(), AuthorClaim.id.desc())
    )
    author_claims_payload = [
        {
            "id": claim.id,
            "resource_id": claim.resource_id,
            "resource_title": title,
            "note": claim.note,
            "status": claim.status,
            "author_position": claim.author_position,
            "evidence_type": claim.evidence_type,
            "evidence_value": claim.evidence_value,
            "decision_note": claim.decision_note,
            "created_at": iso(claim.created_at),
            "decided_at": iso(claim.decided_at),
        }
        for claim, title in claim_rows
    ]

    stmt_key = "author_follows"
    follow_rows = await scalar_rows(
        select(AuthorFollow)
        .where(AuthorFollow.tenant_id == tenant_id, AuthorFollow.user_id == user_id)
        .order_by(AuthorFollow.created_at.desc(), AuthorFollow.id.desc())
    )
    author_follows_payload = [
        {"author_name": row.author_name, "created_at": iso(row.created_at)} for row in follow_rows
    ]

    stmt_key = "discipline_subscriptions"
    subscription_rows = await scalar_rows(
        select(DisciplineSubscription)
        .where(
            DisciplineSubscription.tenant_id == tenant_id,
            DisciplineSubscription.user_id == user_id,
        )
        .order_by(DisciplineSubscription.created_at.desc(), DisciplineSubscription.id.desc())
    )
    discipline_subscriptions_payload = [
        {"discipline": row.discipline, "created_at": iso(row.created_at)}
        for row in subscription_rows
    ]

    stmt_key = "xp_events"
    xp_rows = await scalar_rows(
        select(UserXpEvent)
        .where(UserXpEvent.tenant_id == tenant_id, UserXpEvent.user_id == user_id)
        .order_by(UserXpEvent.created_at.desc(), UserXpEvent.id.desc())
    )
    xp_events_payload = [
        {
            "action": row.action,
            "points": row.points,
            "ref_type": row.ref_type,
            "ref_id": row.ref_id,
            "note": row.note,
            "created_at": iso(row.created_at),
        }
        for row in xp_rows
    ]

    stmt_key = "achievements"
    achievement_rows = await scalar_rows(
        select(UserAchievement)
        .where(UserAchievement.tenant_id == tenant_id, UserAchievement.user_id == user_id)
        .order_by(UserAchievement.unlocked_at.desc(), UserAchievement.id.desc())
    )
    achievements_payload = [
        {"badge_key": row.badge_key, "unlocked_at": iso(row.unlocked_at)}
        for row in achievement_rows
    ]

    stmt_key = "role_applications"
    application_rows = await scalar_rows(
        select(RoleApplication)
        .where(RoleApplication.tenant_id == tenant_id, RoleApplication.user_id == user_id)
        .order_by(RoleApplication.created_at.desc(), RoleApplication.id.desc())
    )
    role_applications_payload = [
        {
            "id": row.id,
            "target_role": row.target_role,
            "statement": row.statement,
            "status": row.status,
            "decision_note": row.decision_note,
            "created_at": iso(row.created_at),
            "decided_at": iso(row.decided_at),
        }
        for row in application_rows
    ]

    stmt_key = "notifications"
    notification_rows = await scalar_rows(
        select(Notification)
        .where(Notification.tenant_id == tenant_id, Notification.user_id == user_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
    )
    notifications_payload = [
        {
            "id": row.id,
            "type": row.type,
            "title": row.title,
            "body": row.body,
            "related_type": row.related_type,
            "related_id": row.related_id,
            "is_read": row.is_read,
            "created_at": iso(row.created_at),
        }
        for row in notification_rows
    ]

    sections: dict[str, list[dict[str, Any]]] = {
        "submissions": submissions_payload,
        "reviews": reviews_payload,
        "review_reports": review_reports_payload,
        "reading_history": reading_history_payload,
        "library_lists": library_lists_payload,
        "comments": comments_payload,
        "forum_topics": forum_topics_payload,
        "forum_replies": forum_replies_payload,
        "appeals": appeals_payload,
        "author_claims": author_claims_payload,
        "author_follows": author_follows_payload,
        "discipline_subscriptions": discipline_subscriptions_payload,
        "xp_events": xp_events_payload,
        "achievements": achievements_payload,
        "role_applications": role_applications_payload,
        "notifications": notifications_payload,
    }

    # Audit the export request (success-side audit only — we do NOT
    # record a row when the export is denied).
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=user_id,
            action="user.export_data",
            target_type="user",
            target_id=str(user_id),
            payload={
                "sections": {name: len(items) for name, items in sections.items()},
                "truncated": truncated,
            },
        )
    )
    await db.commit()

    from app.domain.notifications import services as notifications

    user_payload: dict[str, Any] = {
        "id": current_user.id,
        "tenant_id": str(current_user.tenant_id),
        "email": current_user.email,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "real_name": current_user.real_name,
        "bio": current_user.bio,
        "affiliation": current_user.affiliation,
        "department": current_user.department,
        "academic_title": current_user.academic_title,
        "research_interests": current_user.research_interests,
        "reviewer_tags": current_user.reviewer_tags,
        "reviewer_disciplines": current_user.reviewer_disciplines,
        "website": current_user.website,
        "google_scholar": current_user.google_scholar,
        "location": current_user.location,
        "avatar_url": current_user.avatar_url,
        "banner_url": current_user.banner_url,
        "accent_color": current_user.accent_color,
        "contact_email": current_user.contact_email,
        "profile_visibility": current_user.profile_visibility,
        "orcid": current_user.orcid,
        "role": current_user.role,
        "is_active": current_user.is_active,
        "is_admin": current_user.is_admin,
        "is_email_verified": current_user.is_email_verified,
        "xp": current_user.xp,
        "coin_balance": current_user.coin_balance,
        "totp_enabled": current_user.totp_enabled_at is not None,
        "passkey_count": len(current_user.webauthn_credentials or []),
        "created_at": iso(current_user.created_at),
        "updated_at": iso(current_user.updated_at),
        "deleted_at": iso(current_user.deleted_at),
    }
    return {
        "exported_at": datetime.now(UTC).isoformat(),
        "schema_version": 2,
        "user": user_payload,
        "notification_preferences": {
            "explicit": current_user.notification_prefs or {},
            "effective": notifications.merged_prefs(current_user),
        },
        "sections": sections,
        "truncated": truncated,
    }


# --- Soft delete -----------------------------------------------------------


class DeleteMyAccountRequest(BaseModel):
    password: str = Field(min_length=1)
    confirmation: str = Field(min_length=1)


@router.delete("/me", status_code=status.HTTP_202_ACCEPTED)
async def delete_my_account(
    payload: DeleteMyAccountRequest,
    # Deletion is a live-account action. The soft-delete-aware dependency is
    # reserved for restore; using it here also made the action unreachable from
    # the staging QA identity, which only overrides the standard dependency.
    current_user: User = Depends(get_current_user),
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
