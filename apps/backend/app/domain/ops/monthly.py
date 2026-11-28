"""Monthly operations report aggregation.

The report is deliberately read-only and tenant-scoped. It exists to close
the "monthly report" half of the admin operations backlog: counts come from
the same source tables the rest of the site uses, not from a hand-written
spreadsheet.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.catalog.models import Resource
from app.domain.comments.models import Comment
from app.domain.forum.models import (
    ForumModerationEvent,
    ForumReply,
    ForumReport,
    ForumTopic,
)
from app.domain.submission.models import Submission
from app.models import AuditLog, User

LOCAL_TZ = ZoneInfo("Asia/Shanghai")

MODERATION_DECISIONS = ("approve", "reject", "changes")
BACKLOG_SUBMISSION_STATUSES = ("pending", "under_review", "resubmitted")


def month_bounds(month: str) -> tuple[datetime, datetime, datetime, datetime]:
    """Return local start/end and UTC start/end for a ``YYYY-MM`` month."""
    try:
        start_local = datetime.strptime(f"{month}-01", "%Y-%m-%d").replace(tzinfo=LOCAL_TZ)
    except (TypeError, ValueError) as exc:
        raise ValueError("month must be YYYY-MM") from exc
    if start_local.year < 2000 or start_local.year > 2100:
        raise ValueError("month must be between 2000-01 and 2100-12")
    if start_local.month == 12:
        end_local = start_local.replace(year=start_local.year + 1, month=1)
    else:
        end_local = start_local.replace(month=start_local.month + 1)
    return start_local, end_local, start_local.astimezone(UTC), end_local.astimezone(UTC)


def _day_expr(db: AsyncSession, column: Any) -> Any:
    """Bucket a UTC timestamp by Asia/Shanghai natural day.

    SQLite has no ``timezone()``; both SQLite and PostgreSQL produce a text
    or date value that ``str()`` can normalise below.
    """
    if db.get_bind().dialect.name == "sqlite":
        return func.date(column, "+8 hours")
    return func.date(func.timezone("Asia/Shanghai", column))


async def _count(db: AsyncSession, stmt: Any) -> int:
    return int((await db.execute(stmt)).scalar_one())


async def _daily_counts(
    db: AsyncSession,
    column: Any,
    tenant_id: UUID,
    start_utc: datetime,
    end_utc: datetime,
    extra: list[Any] | None = None,
) -> dict[str, int]:
    day = _day_expr(db, column).label("day")
    conditions = [column >= start_utc, column < end_utc]
    if extra:
        conditions.extend(extra)
    rows = (
        await db.execute(select(day, func.count().label("n")).where(*conditions).group_by(day))
    ).all()
    return {str(key): int(cast("int", count)) for key, count in rows}


async def build_monthly_report(
    db: AsyncSession,
    tenant_id: UUID,
    month: str,
) -> dict[str, Any]:
    start_local, end_local, start_utc, end_utc = month_bounds(month)
    days = (end_local.date() - start_local.date()).days
    dates = [(start_local.date() + timedelta(days=offset)).isoformat() for offset in range(days)]

    release_extra = [Resource.tenant_id == tenant_id]
    topic_extra = [ForumTopic.tenant_id == tenant_id, ForumTopic.deleted_at.is_(None)]
    reply_extra = [ForumReply.tenant_id == tenant_id, ForumReply.deleted_at.is_(None)]
    comment_extra = [Comment.tenant_id == tenant_id]
    submission_extra = [Submission.tenant_id == tenant_id]

    daily_new_users = await _daily_counts(
        db, User.created_at, tenant_id, start_utc, end_utc, [User.tenant_id == tenant_id]
    )
    daily_submissions = await _daily_counts(
        db, Submission.submitted_at, tenant_id, start_utc, end_utc, submission_extra
    )
    daily_products = await _daily_counts(
        db, Resource.created_at, tenant_id, start_utc, end_utc, release_extra
    )
    daily_topics = await _daily_counts(
        db, ForumTopic.created_at, tenant_id, start_utc, end_utc, topic_extra
    )
    daily_replies = await _daily_counts(
        db, ForumReply.created_at, tenant_id, start_utc, end_utc, reply_extra
    )
    daily_comments = await _daily_counts(
        db, Comment.created_at, tenant_id, start_utc, end_utc, comment_extra
    )
    daily_actions = await _daily_counts(
        db, AuditLog.created_at, tenant_id, start_utc, end_utc, [AuditLog.tenant_id == tenant_id]
    )

    daily = [
        {
            "date": date,
            "new_users": daily_new_users.get(date, 0),
            "submissions": daily_submissions.get(date, 0),
            "resources": daily_products.get(date, 0),
            "forum_topics": daily_topics.get(date, 0),
            "forum_replies": daily_replies.get(date, 0),
            "comments": daily_comments.get(date, 0),
            "admin_actions": daily_actions.get(date, 0),
        }
        for date in dates
    ]

    totals = {
        "new_users": sum(daily_new_users.values()),
        "submissions": sum(daily_submissions.values()),
        "resources": sum(daily_products.values()),
        "forum_topics": sum(daily_topics.values()),
        "forum_replies": sum(daily_replies.values()),
        "comments": sum(daily_comments.values()),
        "reports": await _count(
            db,
            select(func.count(ForumReport.id)).where(
                ForumReport.tenant_id == tenant_id,
                ForumReport.created_at >= start_utc,
                ForumReport.created_at < end_utc,
            ),
        ),
    }

    action_rows = (
        await db.execute(
            select(AuditLog.action, func.count(AuditLog.id).label("n"))
            .where(
                AuditLog.tenant_id == tenant_id,
                AuditLog.created_at >= start_utc,
                AuditLog.created_at < end_utc,
            )
            .group_by(AuditLog.action)
            .order_by(func.count(AuditLog.id).desc(), AuditLog.action)
            .limit(10)
        )
    ).all()
    active_admins = await _count(
        db,
        select(func.count(func.distinct(AuditLog.actor_user_id))).where(
            AuditLog.tenant_id == tenant_id,
            AuditLog.created_at >= start_utc,
            AuditLog.created_at < end_utc,
            AuditLog.actor_user_id.is_not(None),
        ),
    )
    admin_actions = await _count(
        db,
        select(func.count(AuditLog.id)).where(
            AuditLog.tenant_id == tenant_id,
            AuditLog.created_at >= start_utc,
            AuditLog.created_at < end_utc,
        ),
    )

    moderation_rows = (
        await db.execute(
            select(ForumModerationEvent.action, func.count(ForumModerationEvent.id).label("n"))
            .where(
                ForumModerationEvent.tenant_id == tenant_id,
                ForumModerationEvent.created_at >= start_utc,
                ForumModerationEvent.created_at < end_utc,
            )
            .group_by(ForumModerationEvent.action)
        )
    ).all()
    moderation_map = {str(action): int(count) for action, count in moderation_rows}
    moderation_events = sum(moderation_map.values())
    breakdown = {key: moderation_map.get(key, 0) for key in MODERATION_DECISIONS}
    breakdown["feedback"] = moderation_map.get("feedback", 0)

    moderator_rows = (
        await db.execute(
            select(ForumModerationEvent.actor_id, func.count(ForumModerationEvent.id).label("n"))
            .where(
                ForumModerationEvent.tenant_id == tenant_id,
                ForumModerationEvent.created_at >= start_utc,
                ForumModerationEvent.created_at < end_utc,
                ForumModerationEvent.actor_id.is_not(None),
            )
            .group_by(ForumModerationEvent.actor_id)
            .order_by(func.count(ForumModerationEvent.id).desc())
            .limit(5)
        )
    ).all()
    moderator_ids = {row[0] for row in moderator_rows}
    moderator_names: dict[int, str] = {}
    if moderator_ids:
        users = (
            await db.execute(
                select(User.id, User.username, User.display_name).where(User.id.in_(moderator_ids))
            )
        ).all()
        moderator_names = {row.id: (row.display_name or row.username) for row in users}
    top_moderators = [
        {
            "user_id": int(uid or 0),
            "name": moderator_names.get(int(uid or 0), f"成员 #{uid}"),
            "count": int(n or 0),
        }
        for uid, n in moderator_rows
    ]

    active_moderators = await _count(
        db,
        select(func.count(func.distinct(ForumModerationEvent.actor_id))).where(
            ForumModerationEvent.tenant_id == tenant_id,
            ForumModerationEvent.created_at >= start_utc,
            ForumModerationEvent.created_at < end_utc,
            ForumModerationEvent.actor_id.is_not(None),
        ),
    )

    backlog = {
        "open_reports": await _count(
            db,
            select(func.count(ForumReport.id)).where(
                ForumReport.tenant_id == tenant_id, ForumReport.status == "open"
            ),
        ),
        "manual_review_topics": await _count(
            db,
            select(func.count(ForumTopic.id)).where(
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
                ForumTopic.moderation_status == "manual_review",
            ),
        ),
        "pending_comments": await _count(
            db,
            select(func.count(Comment.id)).where(
                Comment.tenant_id == tenant_id, Comment.status == "pending"
            ),
        ),
        "pending_submissions": await _count(
            db,
            select(func.count(Submission.id)).where(
                Submission.tenant_id == tenant_id,
                Submission.status.in_(BACKLOG_SUBMISSION_STATUSES),
                Submission.withdrawn_at.is_(None),
            ),
        ),
    }

    return {
        "month": month,
        "period": {
            "start": start_local.isoformat(),
            "end": end_local.isoformat(),
        },
        "totals": {
            **totals,
            "moderation_events": moderation_events,
            "admin_actions": admin_actions,
            "active_admins": active_admins,
            "active_moderators": active_moderators,
        },
        "moderation_breakdown": breakdown,
        "top_actions": [
            {"action": str(action), "count": int(count)} for action, count in action_rows
        ],
        "top_moderators": top_moderators,
        "backlog": backlog,
        "daily": daily,
    }


__all__ = ["LOCAL_TZ", "build_monthly_report", "month_bounds"]
