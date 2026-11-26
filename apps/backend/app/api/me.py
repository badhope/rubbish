"""个人中心接口：身份（权限）+ 活跃等级（经验）。

两条轴严格分开：
* 身份决定“能做什么” —— 成员 / 评审 / 管理，向上继承，权限逐层累加。
* 活跃等级决定“参与了多少” —— 全站统一 Level 1–10，只由 XP 推进，
  不参与任何权限判定；主编和管理员也从 Level 1 开始。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
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
from app.domain.submission.models import Submission
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
    """当前身份组、逐层权限清单、全站活跃等级。"""
    permission_role = await effective_permission_role(db, current_user)
    group = _PERMISSION_GROUPS[permission_role]

    perms: list[str] = []
    for role in ("user", "reviewer", "editor", "editor_in_chief"):
        if PERMISSION_RANK[role] <= PERMISSION_RANK[permission_role]:
            perms.extend(_PERMISSIONS[role])

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
    }


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
    if submission is None or (submission.submitted_by != current_user.id and not current_user.is_admin):
        raise HTTPException(status_code=403, detail="只有作者本人可以查看作品数据")

    local_now = datetime.now(ZoneInfo("Asia/Shanghai"))
    start_local = (local_now - timedelta(days=days - 1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    since = start_local.astimezone(UTC)
    paths = [f"/catalog/{resource.id}"]
    if resource.slug:
        paths.append(f"/catalog/{resource.slug}")
    base = select(PageView).where(
        PageView.tenant_id == tenant_id,
        PageView.created_at >= since,
        PageView.path.in_(paths),
    )
    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()
    local_day = func.date(func.timezone("Asia/Shanghai", PageView.created_at)).label("day")
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
    daily_map = {str(day): int(views) for day, views in rows}
    daily = [
        {
            "date": (start_local.date() + timedelta(days=offset)).isoformat(),
            "views": daily_map.get((start_local.date() + timedelta(days=offset)).isoformat(), 0),
        }
        for offset in range(days)
    ]
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
