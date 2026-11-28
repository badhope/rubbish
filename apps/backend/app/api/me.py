"""个人中心接口：身份（权限）+ 活跃等级（经验）。

两条轴严格分开：
* 身份决定“能做什么” —— 成员 / 评审 / 管理，向上继承，权限逐层累加。
* 活跃等级决定“参与了多少” —— 全站统一 Level 1–10，只由 XP 推进，
  不参与任何权限判定；主编和管理员也从 Level 1 开始。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import cast
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    PERMISSION_RANK,
    effective_permission_role,
    get_current_user,
    require_tenant_id,
)
from app.core.db import get_db
from app.domain.catalog.models import PageView, Resource
from app.domain.gamification.activity import activity_snapshot
from app.domain.submission.models import Submission, SubmissionDraft
from app.models import User

router = APIRouter(prefix="/me", tags=["me"])

PERMISSION_LABELS = {
    "user": "成员组",
    "reviewer": "内容工作组",
    "editor": "内容工作组",
    "editor_in_chief": "站点管理组",
}

PERMISSION_ROLE_LABELS = {
    "user": "成员",
    "reviewer": "互评成员",
    "editor": "内容整理",
    "editor_in_chief": "站点管理",
}

# 三个展示层：成员组 < 评审组 < 管理组；技术角色仍保留细分，但对外只讲三层。
_PERMISSION_GROUPS = {
    "user": {"key": "member", "label": "成员组", "rank": 1},
    "reviewer": {"key": "review", "label": "内容工作组", "rank": 2},
    "editor": {"key": "review", "label": "内容工作组", "rank": 2},
    "editor_in_chief": {"key": "admin", "label": "站点管理组", "rank": 3},
}

# 能力清单逐层累加；高身份自动拥有低身份的全部能力。
_PERMISSIONS = {
    "user": [
        "阅读与下载全部公开内容",
        "发帖、回复与评论",
        "收藏内容、关注作者",
        "发布作品并查看进度",
    ],
    "reviewer": [
        "接收互评邀请，提交互评意见与评分",
        "查看自己的互评历史",
        "参与内容举报初核",
    ],
    "editor": [
        "初审作品、分配与撤销互评成员",
        "作出通过、修改或不通过决定",
        "编排合集与内容目录",
        "发布社区公告与内容治理",
    ],
    "editor_in_chief": [
        "站点设置、审计日志与系统级操作",
        "分配内容整理、互评等身份",
        "处理侵权、隐私申诉与重大争议",
        "管理全站运营数据",
    ],
}


@router.get("/profile")
async def my_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """当前身份组、逐层权限清单、全站活跃等级、本人作品状态。

    ``work_stats`` 只统计当前用户自己的投稿；编辑看到的全站总览仍走
    ``/submissions/overview``，两者不能混用。
    """
    permission_role = await effective_permission_role(db, current_user)
    group = _PERMISSION_GROUPS[permission_role]

    perms: list[str] = []
    for role in ("user", "reviewer", "editor", "editor_in_chief"):
        if PERMISSION_RANK[role] <= PERMISSION_RANK[permission_role]:
            perms.extend(_PERMISSIONS[role])

    rows = (
        await db.execute(
            select(Submission.status, func.count(Submission.id))
            .where(
                Submission.tenant_id == require_tenant_id(),
                Submission.submitted_by == current_user.id,
            )
            .group_by(Submission.status)
        )
    ).all()
    status_counts = {str(status): int(count) for status, count in rows}
    under_review = sum(
        status_counts.get(status, 0) for status in ("pending", "under_review", "resubmitted")
    )
    revision = sum(
        status_counts.get(status, 0)
        for status in ("major_revision", "minor_revision", "rework_requested")
    )
    published = int(
        (
            await db.execute(
                select(func.count(func.distinct(Submission.resource_id))).where(
                    Submission.tenant_id == require_tenant_id(),
                    Submission.submitted_by == current_user.id,
                    Submission.resource_id.is_not(None),
                    Submission.status.in_(("accepted", "approved")),
                )
            )
        ).scalar_one()
        or 0
    )
    # 发文向导的草稿在 ``submission_drafts`` 里，是独立表，不是
    # Submission.status='draft'；只查 submissions 会永远显示 0。
    draft = int(
        (
            await db.execute(
                select(func.count(SubmissionDraft.id)).where(
                    SubmissionDraft.tenant_id == require_tenant_id(),
                    SubmissionDraft.user_id == current_user.id,
                )
            )
        ).scalar_one()
        or 0
    )

    return {
        "user_id": current_user.id,
        "username": current_user.username,
        "permission_role": permission_role,
        "permission_label": group["label"],
        "permission_group": group,
        "permission_role_label": PERMISSION_ROLE_LABELS[permission_role],
        "permissions": perms,
        "activity": activity_snapshot(current_user.xp or 0),
        "rules_accepted": current_user.rules_ack_version is not None,
        "work_stats": {
            "total": sum(status_counts.values()) + draft,
            "draft": draft,
            "under_review": under_review,
            "revision": revision,
            "published": published,
        },
    }


async def _pageview_series(
    db: AsyncSession,
    tenant_id: object,
    paths: list[str],
    days: int,
) -> tuple[datetime, int, list[dict[str, object]]]:
    """One natural-day series for one path set, in Asia/Shanghai.

    Both the single-work analytics page and the creator overview need the
    same buckets. Keeping this in one place means the numbers on the two
    screens cannot drift apart.
    """
    local_now = datetime.now(ZoneInfo("Asia/Shanghai"))
    start_local = (local_now - timedelta(days=days - 1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    since = start_local.astimezone(UTC)
    if not paths:
        daily_empty = [
            {"date": (start_local.date() + timedelta(days=offset)).isoformat(), "views": 0}
            for offset in range(days)
        ]
        return since, 0, daily_empty
    # PostgreSQL has IANA timezone support; SQLite (tests/local) does not.
    # Both expressions must land on the same Asia/Shanghai natural day, or the
    # chart silently shifts by eight hours depending on the backend.
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        local_day = func.date(func.timezone("Asia/Shanghai", PageView.created_at)).label("day")
    else:
        local_day = func.date(func.datetime(PageView.created_at, "+8 hours")).label("day")
    rows = (
        await db.execute(
            select(local_day, func.count(PageView.id).label("views"))
            .where(
                PageView.tenant_id == tenant_id,
                PageView.created_at >= since,
                PageView.path.in_(paths),
            )
            .group_by(local_day)
            .order_by(local_day)
        )
    ).all()
    daily_map = {str(day): int(cast("int", views)) for day, views in rows}
    total = sum(daily_map.values())
    daily = [
        {
            "date": (start_local.date() + timedelta(days=offset)).isoformat(),
            "views": daily_map.get((start_local.date() + timedelta(days=offset)).isoformat(), 0),
        }
        for offset in range(days)
    ]
    return since, int(total), daily


@router.get("/resources/{resource_id}/analytics")
async def resource_author_analytics(
    resource_id: int,
    days: int = Query(default=30, ge=7, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Author-facing readership trend for one published work.

    Only the submitting author or an admin can read it. The page-view table
    deliberately stores no IP/User-Agent, so this is aggregate interest, not
    identity tracking.
    """
    tenant_id = require_tenant_id()
    resource = (
        await db.execute(
            select(Resource).where(Resource.id == resource_id, Resource.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=404, detail="作品不存在")
    submission = (
        await db.execute(
            select(Submission)
            .where(
                Submission.tenant_id == tenant_id,
                Submission.resource_id == resource_id,
            )
            .order_by(Submission.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if submission is None or (
        submission.submitted_by != current_user.id and not current_user.is_admin
    ):
        raise HTTPException(status_code=403, detail="只有作者本人可以查看作品数据")

    paths = [f"/catalog/{resource.id}"]
    if resource.slug:
        paths.append(f"/catalog/{resource.slug}")
    since, total, daily = await _pageview_series(db, tenant_id, paths, days)
    refs = (
        await db.execute(
            select(func.coalesce(PageView.referrer, ""), func.count(PageView.id))
            .where(
                PageView.tenant_id == tenant_id,
                PageView.created_at >= since,
                PageView.path.in_(paths),
            )
            .group_by(PageView.referrer)
            .order_by(func.count(PageView.id).desc())
            .limit(8)
        )
    ).all()
    return {
        "resource_id": resource.id,
        "title": resource.title,
        "days": days,
        "total_views": int(total),
        "downloads": int(resource.download_count or 0),
        "daily": daily,
        "referrers": [{"referrer": r or "direct", "views": int(c)} for r, c in refs],
    }


@router.get("/creator")
async def creator_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Aggregate creator numbers across all published works.

    Per-work analytics already lives at ``/me/resources/{id}/analytics``.
    This endpoint answers the question a creator asks before opening any one
    work: "is anyone reading me, and what are they saying?" It only exposes
    aggregate attention, never reader identity.
    """
    from app.domain.catalog.engagement import load_raw_engagement
    from app.domain.comments.models import Comment
    from app.domain.follows.models import AuthorFollow
    from app.domain.forum.models import ForumReply, ForumTopic

    tenant_id = require_tenant_id()
    now = datetime.now(UTC)
    rows = (
        await db.execute(
            select(Submission, Resource)
            .join(Resource, Submission.resource_id == Resource.id)
            .where(
                Submission.tenant_id == tenant_id,
                Submission.submitted_by == current_user.id,
                Submission.status.in_(("accepted", "approved")),
                Resource.tenant_id == tenant_id,
                Resource.publication_status == "published",
                (Resource.publish_at.is_(None)) | (Resource.publish_at <= now),
            )
            .order_by(Resource.publish_at.desc(), Resource.id.desc())
        )
    ).all()
    resources = [resource for _submission, resource in rows]
    raw = await load_raw_engagement(db, [resource.id for resource in resources], tenant_id)

    paths: list[str] = []
    for resource in resources:
        paths.append(f"/catalog/{resource.id}")
        if resource.slug:
            paths.append(f"/catalog/{resource.slug}")
    _since, page_views_30d, daily_views = await _pageview_series(db, tenant_id, paths, 30)
    comment_rows: list[tuple[int, int]] = []
    if resources:
        comment_rows = [
            (int(row[0] or 0), int(row[1] or 0))
            for row in (
                await db.execute(
                    select(Comment.resource_id, func.count(Comment.id))
                    .where(
                        Comment.tenant_id == tenant_id,
                        Comment.resource_id.in_([resource.id for resource in resources]),
                        Comment.status != "rejected",
                    )
                    .group_by(Comment.resource_id)
                )
            ).all()
        ]
    comments_by_resource = {int(rid): int(count) for rid, count in comment_rows}

    author_names = [
        name
        for name in (current_user.display_name, current_user.real_name, current_user.username)
        if name
    ]
    followers = 0
    if author_names:
        followers = int(
            (
                await db.execute(
                    select(func.count(AuthorFollow.id)).where(
                        AuthorFollow.tenant_id == tenant_id,
                        AuthorFollow.author_name.in_(author_names),
                    )
                )
            ).scalar_one()
            or 0
        )
    forum_topics = int(
        (
            await db.execute(
                select(func.count(ForumTopic.id)).where(
                    ForumTopic.tenant_id == tenant_id,
                    ForumTopic.author_id == current_user.id,
                    ForumTopic.deleted_at.is_(None),
                )
            )
        ).scalar_one()
        or 0
    )
    forum_replies = int(
        (
            await db.execute(
                select(func.count(ForumReply.id)).where(
                    ForumReply.tenant_id == tenant_id,
                    ForumReply.author_id == current_user.id,
                    ForumReply.deleted_at.is_(None),
                )
            )
        ).scalar_one()
        or 0
    )

    works = []
    for resource in resources:
        reads, downloads, saves = raw.get(resource.id, (0, 0, 0))
        works.append(
            {
                "id": resource.id,
                "title": resource.short_title or resource.title,
                "full_title": resource.title,
                "cover_image": resource.cover_image,
                "discipline": resource.discipline,
                "published_at": (resource.publish_at or resource.created_at).isoformat(),
                "reads": reads,
                "downloads": downloads,
                "saves": saves,
                "comments": comments_by_resource.get(resource.id, 0),
            }
        )

    recent_comments = []
    if resources:
        recent_comments = [
            {
                "id": comment.id,
                "resource_id": resource.id,
                "resource_title": resource.short_title or resource.title,
                "body": comment.body[:160],
                "created_at": comment.created_at.isoformat(),
                "author_username": author.username,
                "author_display_name": author.display_name,
            }
            for comment, resource, author in (
                await db.execute(
                    select(Comment, Resource, User)
                    .join(Resource, Comment.resource_id == Resource.id)
                    .join(User, Comment.user_id == User.id)
                    .where(
                        Comment.tenant_id == tenant_id,
                        Comment.resource_id.in_([r.id for r in resources]),
                        Comment.status != "rejected",
                    )
                    .order_by(Comment.created_at.desc())
                    .limit(6)
                )
            ).all()
        ]

    totals = {
        "reads": sum(cast("int", item["reads"]) for item in works),
        "downloads": sum(cast("int", item["downloads"]) for item in works),
        "saves": sum(cast("int", item["saves"]) for item in works),
        "comments": sum(cast("int", item["comments"]) for item in works),
    }
    return {
        "published": len(resources),
        "followers": followers,
        "forum_topics": forum_topics,
        "forum_replies": forum_replies,
        "totals": totals,
        "page_views": {
            "days": 30,
            "total": int(page_views_30d),
            "daily": daily_views,
        },
        "works": works[:10],
        "recent_comments": recent_comments,
    }
