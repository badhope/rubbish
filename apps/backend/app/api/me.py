"""个人中心接口：社区权限档位 + 能力清单。

* 权限轴四层：member < moderator < editor < owner。
  内部仍沿用 ``user / reviewer / editor / editor_in_chief`` 字符串，
  但对外标签与能力清单全部使用社区口径。
* 不再返回学术身份等级轨（作者 / 审稿人 / 编辑），积分只作为社区激励，
  不绑定任何学术权限。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    PERMISSION_RANK,
    effective_permission_role,
    get_current_user,
)
from app.core.db import get_db
from app.models import User

router = APIRouter(prefix="/me", tags=["me"])

PERMISSION_LABELS = {
    "user": "社区成员",
    "reviewer": "版主",
    "editor": "内容管理员",
    "editor_in_chief": "站长",
}

# 每个权限档位对应的能力清单（与 require_role 一一对应）。
_PERMISSIONS = {
    "user": [
        "浏览档案与社区帖子",
        "发帖、回复、评论",
        "收藏档案、关注作者",
        "发布自己的研究记录",
    ],
    "reviewer": [
        "处理举报与违规内容",
        "管理所负责版块的置顶与标签",
        "参与社区规则讨论",
    ],
    "editor": [
        "策展首页与档案分类",
        "发布社区公告",
        "管理版块与内容标签",
        "查看社区运营数据",
    ],
    "editor_in_chief": [
        "站点设置与审计日志",
        "分配版主与内容管理员",
        "处理侵权与隐私申诉",
    ],
}


@router.get("/profile")
async def my_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """当前权限档位 + 社区能力清单。"""
    permission_role = await effective_permission_role(db, current_user)

    perms: list[str] = []
    for role in ("user", "reviewer", "editor", "editor_in_chief"):
        if PERMISSION_RANK[role] <= PERMISSION_RANK[permission_role]:
            perms.extend(_PERMISSIONS[role])

    return {
        "user_id": current_user.id,
        "username": current_user.username,
        "permission_role": permission_role,
        "permission_label": PERMISSION_LABELS[permission_role],
        "permissions": perms,
        "identities": [],
        "levels": {},
        "rules_accepted": current_user.rules_ack_version is not None,
    }
