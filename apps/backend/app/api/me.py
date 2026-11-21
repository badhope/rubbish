"""个人中心接口：身份（权限）+ 活跃等级（经验）。

两条轴严格分开：
* 身份决定“能做什么” —— 成员 / 评审 / 管理，向上继承，权限逐层累加。
* 活跃等级决定“参与了多少” —— 全站统一 Level 1–10，只由 XP 推进，
  不参与任何权限判定；主编和管理员也从 Level 1 开始。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import PERMISSION_RANK, effective_permission_role, get_current_user
from app.core.db import get_db
from app.domain.gamification.activity import activity_snapshot
from app.models import User

router = APIRouter(prefix="/me", tags=["me"])

PERMISSION_LABELS = {
    "user": "成员组",
    "reviewer": "评审组",
    "editor": "评审组",
    "editor_in_chief": "管理组",
}

PERMISSION_ROLE_LABELS = {
    "user": "成员",
    "reviewer": "审稿人",
    "editor": "编辑",
    "editor_in_chief": "主编 / 管理员",
}

# 三个展示层：成员组 < 评审组 < 管理组；技术角色仍保留细分，但对外只讲三层。
_PERMISSION_GROUPS = {
    "user": {"key": "member", "label": "成员组", "rank": 1},
    "reviewer": {"key": "review", "label": "评审组", "rank": 2},
    "editor": {"key": "review", "label": "评审组", "rank": 2},
    "editor_in_chief": {"key": "admin", "label": "管理组", "rank": 3},
}

# 能力清单逐层累加；高身份自动拥有低身份的全部能力。
_PERMISSIONS = {
    "user": [
        "阅读与下载全部公开文章",
        "社区发帖、回复与评论",
        "收藏文章、关注作者",
        "提交作品并查看审核进度",
    ],
    "reviewer": [
        "接收审稿邀请，提交评审意见与评分",
        "查看自己的评审历史",
        "参与内容举报初核",
    ],
    "editor": [
        "初审作品、分配与撤销审稿人",
        "作出录用、修回或拒稿决定",
        "编排卷期与文章目录",
        "发布社区公告与内容治理",
    ],
    "editor_in_chief": [
        "站点设置、审计日志与系统级操作",
        "分配编辑、评审等身份",
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
