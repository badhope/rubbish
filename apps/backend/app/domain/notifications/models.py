"""SQLAlchemy models for the notifications module.

Two tables, tenant-scoped with RLS:

- ``notifications`` — one row per (tenant, user, notification). The
  ``user_id`` is the recipient; notifications are strictly per-user
  (no shared "team" stream). ``related_type`` / ``related_id`` are
  optional opaque pointers (e.g. "submission"/"123") so the recipient
  can deep-link to the source object without a hard FK.

- ``email_digest_records`` — one row per outbound email *attempt* tied
  to a review-workflow event (assignment / reminder / decision / claim
  result). When SMTP is not configured or the outbound switch is off,
  the row is still written so the operator can see exactly what would
  have been sent and to whom. ``status`` records the real outcome:
  ``sent`` / ``skipped_disabled`` / ``skipped_no_smtp`` / ``failed``.
  This is the source of truth for "did we actually send it?" — the
  in-app notification is the user-facing channel, this table is the
  audit trail for the email side channel.

The recipient FK points at ``users.id`` in the core schema. The model
inherits from the core ``Base`` so cross-module FKs resolve without
metadata gymnastics (ARCHITECTURE.md "All modules share the tenant's
PostgreSQL database").
"""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.models import Base, TenantScopedMixin

if TYPE_CHECKING:
    pass


class Notification(Base, TenantScopedMixin):
    """An in-app notification addressed to one user.

    ``type`` is a short stable slug (e.g. ``submission_approved``,
    ``submission_rejected``, ``system``) the frontend uses to pick an
    icon / route. ``related_type`` / ``related_id`` are opaque
    pointers — no FK — so a notification survives the source object
    being deleted (the recipient still sees "your submission was
    approved" even after the catalog Resource is later removed).
    """

    __tablename__ = "notifications"
    # Composite index for the per-user inbox listing (newest first);
    # created by the notifications migration but previously missing
    # here, which made `alembic check` report a spurious drift.
    __table_args__ = (Index("ix_notifications_user_id_created_at", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Recipient. CASCADE so deleting a user removes their notifications
    # (consistent with how the rest of the schema handles ownership).
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Opaque pointers — no FK. Lets the source object (e.g. a catalog
    # Resource) be deleted without invalidating the historical
    # notification record.
    related_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    related_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class EmailDigestRecord(Base, TenantScopedMixin):
    """One outbound email *attempt* for a review-workflow event.

    Written for every event that *would* email a user — assignment,
    reminder, decision, claim result — regardless of whether SMTP is
    configured. ``status`` is the honest outcome:

    - ``sent``                  — handed to the SMTP relay without error;
    - ``skipped_disabled``      — operator switch ``email_review_digest_enabled`` off;
    - ``skipped_no_smtp``       — no SMTP configured (console/dev/test);
    - ``skipped_user_pref``     — recipient turned this email category off;
    - ``failed``                — SMTP threw; message body kept for ops.

    No FK to the source object (``related_type`` / ``related_id`` are
    opaque), same rationale as ``Notification``.
    """

    __tablename__ = "email_digest_records"
    __table_args__ = (
        Index(
            "ix_email_digest_records_user_created",
            "user_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 指派 / 催审 / 裁决 / 认领结果
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    recipient_email: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    html: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 投递通道：default=普通发信池；congrat=通过专用通道。
    channel: Mapped[str] = mapped_column(
        String(20), nullable=False, default="default", server_default="default"
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    related_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    related_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    # 发件箱字段：每次投递尝试都更新；失败后由工作流调度器按退避重试。
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class PublicationDigestItem(Base, TenantScopedMixin):
    """A reader-eligible new work waiting for the next daily digest.

    This is intentionally separate from ``Notification``: a reader can turn
    off in-app publication cards and still keep the daily email digest.  If
    the digest were rebuilt from notifications, that preference combination
    would silently produce no email at all.
    """

    __tablename__ = "publication_digest_items"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "user_id",
            "resource_id",
            name="uq_publication_digest_item_user_resource",
        ),
        Index("ix_publication_digest_items_user_pending", "user_id", "delivered_at"),
        Index("ix_publication_digest_items_tenant_created", "tenant_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    resource_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("resources.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PublicationDigestDelivery(Base, TenantScopedMixin):
    """One user's daily publication-digest decision.

    The digest is built from the independent publication-digest queue and
    sent once per local calendar day.  The unique key is the idempotency
    boundary: a scheduler retry, a redeploy, or a second worker must not send
    the same reader a second copy of the same day's digest.
    """

    __tablename__ = "publication_digest_deliveries"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "user_id",
            "digest_date",
            name="uq_publication_digest_user_date",
        ),
        Index("ix_publication_digest_user_id", "user_id"),
        Index("ix_publication_digest_tenant_date", "tenant_id", "digest_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    digest_date: Mapped[date] = mapped_column(Date, nullable=False)
    # queued (outbox owns delivery) / sent / skipped / error
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    email_record_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("email_digest_records.id", ondelete="SET NULL"), nullable=True
    )
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


__all__ = [
    "EmailDigestRecord",
    "Notification",
    "PublicationDigestDelivery",
    "PublicationDigestItem",
]
