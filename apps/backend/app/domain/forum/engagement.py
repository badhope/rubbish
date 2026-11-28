"""主题论坛的新手任务与社区信用。

这两个视图都不新建表，只把已有的行为记录换成用户能看懂的东西：

* 新手任务：规则确认、资料、首帖、首回；四项齐了可一次性领 25 经验。
  领取本身仍写 ``UserXpEvent``，靠 (action, ref_type, ref_id) 唯一约束
  保证不会重复发奖。
* 社区信用：以 100 为起点，按公开主题/回复加分，按被驳回主题、被移除
  内容扣分。分数和明细都是当时聚合出来的，不复制一份容易和处置结果
  脱节的“信用余额”。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.forum.models import ForumReply, ForumReport, ForumTopic
from app.domain.gamification.levels_axis import CURRENT_RULES_VERSION
from app.domain.gamification.models import UserXpEvent
from app.domain.gamification.xp import XP_RULES
from app.models import User

TOPIC_VISIBLE_STATUSES = ("published", "auto_approved", "approved")
NEWBIE_REWARD_ACTION = "forum.newbie_complete"
NEWBIE_REF_TYPE = "forum_starter"
NEWBIE_REF_ID = "v1"


async def _scalar_count(db: AsyncSession, stmt: Any) -> int:
    value: Any = (await db.execute(stmt)).scalar_one()
    return int(value or 0)


async def starter_summary(db: AsyncSession, user: User) -> dict[str, Any]:
    """Return the four starter tasks and whether the reward was claimed."""
    tenant_id = user.tenant_id
    published_topics = await _scalar_count(
        db,
        select(func.count(ForumTopic.id)).where(
            ForumTopic.tenant_id == tenant_id,
            ForumTopic.author_id == user.id,
            ForumTopic.deleted_at.is_(None),
            (ForumTopic.moderation_status.in_(TOPIC_VISIBLE_STATUSES))
            | (ForumTopic.moderation_status.is_(None)),
        ),
    )
    replies = await _scalar_count(
        db,
        select(func.count(ForumReply.id)).where(
            ForumReply.tenant_id == tenant_id,
            ForumReply.author_id == user.id,
            ForumReply.deleted_at.is_(None),
        ),
    )
    profile_done = bool((user.display_name or "").strip()) and bool((user.bio or "").strip())
    rules_done = user.rules_ack_version == CURRENT_RULES_VERSION

    claim = (
        await db.execute(
            select(UserXpEvent)
            .where(
                UserXpEvent.tenant_id == tenant_id,
                UserXpEvent.user_id == user.id,
                UserXpEvent.action == NEWBIE_REWARD_ACTION,
                UserXpEvent.ref_type == NEWBIE_REF_TYPE,
                UserXpEvent.ref_id == NEWBIE_REF_ID,
            )
            .order_by(UserXpEvent.created_at.desc(), UserXpEvent.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    tasks = [
        {
            "key": "rules",
            "label": "确认社区规范",
            "hint": "读完边界与处理，点一下确认。",
            "done": rules_done,
            "action": None if rules_done else "ack_rules",
            "to": "/guide?tab=policies",
        },
        {
            "key": "profile",
            "label": "补一句自我介绍",
            "hint": "昵称和一句话简介，让别人知道在跟谁说话。",
            "done": profile_done,
            "action": None,
            "to": "/me?tab=settings",
        },
        {
            "key": "topic",
            "label": "发第一个主题帖",
            "hint": "问题、复盘、组队都行，不必写成完整文章。",
            "done": published_topics > 0,
            "action": None,
            "to": "/forum?compose=1",
        },
        {
            "key": "reply",
            "label": "回第一条讨论",
            "hint": "接住别人的问题，或者补一个自己的经验。",
            "done": replies > 0,
            "action": None,
            "to": "/forum",
        },
    ]
    completed = sum(1 for task in tasks if task["done"])
    return {
        "tasks": tasks,
        "completed": completed,
        "total": len(tasks),
        "all_done": completed == len(tasks),
        "claimed": claim is not None,
        "claimed_at": claim.created_at.isoformat() if claim is not None else None,
        "reward_xp": XP_RULES[NEWBIE_REWARD_ACTION],
        "counts": {
            "published_topics": published_topics,
            "replies": replies,
        },
    }


def _credit_tier(score: int) -> tuple[str, str]:
    if score >= 105:
        return "stable", "稳定"
    if score >= 90:
        return "normal", "正常"
    if score >= 70:
        return "watch", "观察"
    return "restricted", "受限"


async def credit_summary(db: AsyncSession, user: User, *, record_limit: int = 10) -> dict[str, Any]:
    """Aggregate a member's public behaviour into a 0–120 credit score.

    The record list is intentionally short and traceable: every row points
    back to a topic, a reply, or a resolved report, so an operator can check
    the source instead of trusting a opaque number.
    """
    tenant_id = user.tenant_id
    published_topics = await _scalar_count(
        db,
        select(func.count(ForumTopic.id)).where(
            ForumTopic.tenant_id == tenant_id,
            ForumTopic.author_id == user.id,
            ForumTopic.deleted_at.is_(None),
            (ForumTopic.moderation_status.in_(TOPIC_VISIBLE_STATUSES))
            | (ForumTopic.moderation_status.is_(None)),
        ),
    )
    published_replies = await _scalar_count(
        db,
        select(func.count(ForumReply.id)).where(
            ForumReply.tenant_id == tenant_id,
            ForumReply.author_id == user.id,
            ForumReply.deleted_at.is_(None),
        ),
    )
    rejected_topics = await _scalar_count(
        db,
        select(func.count(ForumTopic.id)).where(
            ForumTopic.tenant_id == tenant_id,
            ForumTopic.author_id == user.id,
            ForumTopic.deleted_at.is_(None),
            ForumTopic.moderation_status == "rejected",
        ),
    )
    removed_topic_reports = await _scalar_count(
        db,
        select(func.count(ForumReport.id))
        .select_from(ForumReport)
        .join(ForumTopic, ForumReport.topic_id == ForumTopic.id)
        .where(
            ForumReport.tenant_id == tenant_id,
            ForumReport.status == "resolved",
            ForumTopic.author_id == user.id,
        ),
    )
    removed_reply_reports = await _scalar_count(
        db,
        select(func.count(ForumReport.id))
        .select_from(ForumReport)
        .join(ForumReply, ForumReport.reply_id == ForumReply.id)
        .where(
            ForumReport.tenant_id == tenant_id,
            ForumReport.status == "resolved",
            ForumReply.author_id == user.id,
        ),
    )
    removed_reports = removed_topic_reports + removed_reply_reports

    positive = min(published_topics, 10) * 2 + min(published_replies, 20)
    negative = rejected_topics * 10 + removed_reports * 8
    score = max(0, min(120, 100 + positive - negative))
    tier_key, tier_label = _credit_tier(score)

    topics = (
        (
            await db.execute(
                select(ForumTopic)
                .where(
                    ForumTopic.tenant_id == tenant_id,
                    ForumTopic.author_id == user.id,
                    ForumTopic.deleted_at.is_(None),
                )
                .order_by(ForumTopic.created_at.desc(), ForumTopic.id.desc())
                .limit(record_limit)
            )
        )
        .scalars()
        .all()
    )
    replies = (
        (
            await db.execute(
                select(ForumReply)
                .where(
                    ForumReply.tenant_id == tenant_id,
                    ForumReply.author_id == user.id,
                    ForumReply.deleted_at.is_(None),
                )
                .order_by(ForumReply.created_at.desc(), ForumReply.id.desc())
                .limit(record_limit)
            )
        )
        .scalars()
        .all()
    )
    recent_removed = (
        (
            await db.execute(
                select(ForumReport)
                .where(
                    ForumReport.tenant_id == tenant_id,
                    ForumReport.status == "resolved",
                    (
                        ForumReport.topic_id.in_(
                            select(ForumTopic.id).where(
                                ForumTopic.tenant_id == tenant_id,
                                ForumTopic.author_id == user.id,
                            )
                        )
                    )
                    | (
                        ForumReport.reply_id.in_(
                            select(ForumReply.id).where(
                                ForumReply.tenant_id == tenant_id,
                                ForumReply.author_id == user.id,
                            )
                        )
                    ),
                )
                .order_by(ForumReport.resolved_at.desc(), ForumReport.id.desc())
                .limit(record_limit)
            )
        )
        .scalars()
        .all()
    )

    records: list[dict[str, Any]] = []
    for topic in topics:
        if topic.moderation_status == "rejected":
            records.append(
                {
                    "kind": "topic_rejected",
                    "label": "主题未通过审核",
                    "detail": topic.title,
                    "delta": -10,
                    "at": topic.created_at.isoformat(),
                    "ref_type": "topic",
                    "ref_id": topic.id,
                }
            )
        elif topic.moderation_status in TOPIC_VISIBLE_STATUSES or topic.moderation_status is None:
            records.append(
                {
                    "kind": "topic_published",
                    "label": "发布主题",
                    "detail": topic.title,
                    "delta": 2,
                    "at": topic.created_at.isoformat(),
                    "ref_type": "topic",
                    "ref_id": topic.id,
                }
            )
    for reply in replies:
        records.append(
            {
                "kind": "reply_published",
                "label": "回复讨论",
                "detail": reply.body[:80],
                "delta": 1,
                "at": reply.created_at.isoformat(),
                "ref_type": "reply",
                "ref_id": reply.id,
            }
        )
    for report in recent_removed:
        records.append(
            {
                "kind": "content_removed",
                "label": "举报成立，内容被移除",
                "detail": report.reason or "处置记录",
                "delta": -8,
                "at": (report.resolved_at or report.created_at).isoformat(),
                "ref_type": "report",
                "ref_id": report.id,
            }
        )

    records.sort(key=lambda row: row["at"], reverse=True)
    return {
        "score": score,
        "max_score": 120,
        "tier": tier_key,
        "tier_label": tier_label,
        "positive_points": positive,
        "negative_points": negative,
        "counts": {
            "published_topics": published_topics,
            "published_replies": published_replies,
            "rejected_topics": rejected_topics,
            "removed_contents": removed_reports,
        },
        "records": records[:record_limit],
        "scoring": "起始 100；公开主题 +2（最多 10 篇），公开回复 +1（最多 20 条）；被驳回主题 -10，举报成立被移除内容 -8。",
    }
