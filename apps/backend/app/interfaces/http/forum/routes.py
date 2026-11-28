# mypy: ignore-errors
"""Forum API — 主题论坛（发帖 / 回帖 / 版主操作）。

权限模型
--------
- 读：公开（未登录也能浏览，论坛是社区的橱窗）
- 发帖/回帖：登录即可（不设积分门槛——参考前面身份体系 3.0 的原则）
- 置顶/锁定/删除他人帖子：编辑或管理员（版主权限）

版块设计：树形社区版块（文章 / 选题与计划 / 过程记录 / 现场观察 / 失败复盘 / 写作讨论 / 创作生存 / 组队招募 / 站务），
不做树状子版。本刊是内容库社区，不是大型论坛；五个版块足够让帖子有归属，
又不会在冷启动阶段把每个子版都做成空壳。
"""

from __future__ import annotations

import re
from dataclasses import asdict
from datetime import datetime, timedelta
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    PERMISSION_RANK,
    ROLE_EDITOR,
    effective_permission_role,
    get_current_user,
    get_current_user_optional,
    require_admin,
    require_tenant_id,
    user_has_role,
)
from app.core.config import settings
from app.core.db import get_db, paginate
from app.core.images import (
    IMAGE_CACHE_HEADERS,
    IMAGE_MAX_BYTES,
    IMAGE_MIME_EXT,
    IMAGE_NAME_RE,
    image_magic_ok,
    image_mime_for_name,
)
from app.core.moderation import SOFT_PATTERNS, assess_text, rejection_detail
from app.core.storage import get_storage
from app.core.time import utcnow
from app.domain.catalog.models import Resource
from app.domain.catalog.visibility import public_conditions
from app.domain.forum import engagement, passages
from app.domain.forum import moderation_service as moderation
from app.domain.forum.models import (
    ForumBoard,
    ForumModerationEvent,
    ForumReaction,
    ForumReply,
    ForumReport,
    ForumTopic,
    ForumTopicFollow,
)
from app.domain.forum.related import find_related
from app.models import AuditLog, User

router = APIRouter(prefix="/forum", tags=["forum"])


@router.post("/images", status_code=status.HTTP_201_CREATED)
async def upload_forum_image(
    file: UploadFile = File(...),
    _user: User = Depends(get_current_user),
) -> dict[str, str]:
    """上传一张论坛图片，返回可公开访问的短链。

    正文仍只存 Markdown；图片单独落对象存储，不把二进制塞进帖子表。
    """
    mime = (file.content_type or "").lower()
    ext = IMAGE_MIME_EXT.get(mime)
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="只支持 PNG / JPEG / GIF / WebP 图片",
        )
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图片为空")
    if len(contents) > IMAGE_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="图片不能超过 5MB",
        )
    if not image_magic_ok(contents, mime):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="图片内容与格式不符",
        )
    name = f"{uuid4().hex}{ext}"
    await get_storage().save(f"forum/{name}", contents, content_type=mime)
    return {"url": f"/api/forum/images/{name}"}


@router.get("/images/{filename}")
async def get_forum_image(filename: str) -> Response:
    """公开读取论坛图片；文件名是 128 位随机串，不可枚举。"""
    if not IMAGE_NAME_RE.match(filename):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="图片不存在")
    try:
        contents = await get_storage().load(f"forum/{filename}")
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="图片不存在") from None
    mime = image_mime_for_name(filename)
    return Response(content=contents, media_type=mime, headers=IMAGE_CACHE_HEADERS)


# 五个平铺版块：写作讨论 / 记录与复盘 / 组队招募 / 创作生活 / 站务与反馈。
# 旧分类保留为兼容别名（历史帖子和既有客户端仍可直接写入）。
ForumCategory = Literal[
    "discussion",
    "records",
    "collab",
    "admissions",
    "admissions-recruit",
    "admissions-seek",
    "life",
    "site",
    # 兼容旧客户端/旧帖
    "planning",
    "lab-notes",
    "field-notes",
    "failures",
    "survival",
    "announcements",
    "feedback",
    "paper",
    "method",
    "meta",
    "notice",
    "question",
    "suggestion",
]

CATEGORY_LABELS: dict[str, str] = {
    "discussion": "写作讨论",
    "records": "记录与复盘",
    "collab": "组队招募",
    "admissions": "招生与导师",
    "admissions-recruit": "导师招生",
    "admissions-seek": "学生找导师",
    "life": "创作生活",
    "site": "站务与反馈",
    # 旧分类仍可读，但不再作为新帖入口
    "planning": "记录与复盘",
    "lab-notes": "记录与复盘",
    "field-notes": "记录与复盘",
    "failures": "记录与复盘",
    "survival": "创作生活",
    "announcements": "站务与反馈",
    "feedback": "站务与反馈",
    "paper": "写作讨论",
    "method": "写作讨论",
    "meta": "站务与反馈",
    "notice": "站务与反馈",
    "question": "写作讨论",
    "suggestion": "站务与反馈",
}

# 版块 -> 实际落库的分类集合。旧帖不用搬家也能出现在新版块下。
CATEGORY_BOARD: dict[str, tuple[str, ...]] = {
    "discussion": ("discussion",),
    "records": ("records",),
    "collab": ("collab",),
    "admissions": ("admissions",),
    "admissions-recruit": ("admissions-recruit",),
    "admissions-seek": ("admissions-seek",),
    "life": ("life",),
    "site": ("site",),
    # 旧客户端按旧分类发帖时，回退到新版块
    "planning": ("records",),
    "lab-notes": ("records",),
    "field-notes": ("records",),
    "failures": ("records",),
    "survival": ("life",),
    "announcements": ("site",),
    "feedback": ("site",),
    "paper": ("discussion",),
    "method": ("discussion",),
    "question": ("discussion",),
    "meta": ("site",),
    "notice": ("site",),
    "suggestion": ("site",),
}


class PassageIn(BaseModel):
    """A sentence or two selected in the linked work, in the author's words."""

    quote: str = Field(min_length=2, max_length=passages.QUOTE_MAX)
    prefix: str = Field(default="", max_length=passages.CONTEXT_MAX * 4)
    suffix: str = Field(default="", max_length=passages.CONTEXT_MAX * 4)


class PassageOut(BaseModel):
    quote: str
    prefix: str = ""
    suffix: str = ""


class TopicCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    # 页边讨论可以只有一个问题：引文本身就是上下文，所以带 passage 时正文可空。
    body: str = Field(default="", max_length=20000)
    category: ForumCategory = "discussion"
    is_fictional: bool = False
    # 树形版块：新客户端传 board_id；旧客户端只传 category 仍然兼容。
    board_id: int | None = Field(default=None, ge=1)
    board_slug: str | None = Field(default=None, max_length=40)
    paper_id: int | None = Field(default=None, ge=1)
    passage: PassageIn | None = None

    @model_validator(mode="after")
    def _body_or_passage(self) -> TopicCreate:
        if self.passage is None and len(self.body.strip()) < 2:
            raise ValueError("正文至少 2 个字")
        if self.passage is not None and self.paper_id is None:
            raise ValueError("页边讨论需要关联作品")
        return self


REACTION_KINDS = ("agree", "helpful", "bookmark")


class ReplyCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)
    parent_id: int | None = Field(default=None, ge=1)


class AuthorBrief(BaseModel):
    id: int
    username: str
    display_name: str | None = None
    avatar_url: str | None = None


class TopicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body: str
    category: str
    board_id: int | None = None
    is_fictional: bool = False
    board_slug: str | None = None
    board_name: str | None = None
    board_path: str | None = None
    is_pinned: bool
    is_locked: bool
    reply_count: int
    created_at: datetime
    last_reply_at: datetime | None
    paper_id: int | None = None
    # The quoted passage follows the work's own body visibility: viewers who
    # cannot open the manuscript get ``has_passage`` without the words.
    passage: PassageOut | None = None
    has_passage: bool = False
    moderation_status: str = "published"
    risk_score: int = 0
    manual_review_reason: str | None = None
    review_eta_at: datetime | None = None
    published_at: datetime | None = None
    reviewed_at: datetime | None = None
    author: AuthorBrief | None = None
    reactions: dict[str, int] = Field(default_factory=dict)
    viewer_reactions: list[str] = Field(default_factory=list)
    viewer_following: bool = False


class TopicListOut(BaseModel):
    data: list[TopicOut]
    meta: dict[str, object]


class LinkedWorkOut(BaseModel):
    """A public catalog record attached to a topic or recommended beside it."""

    id: int
    title: str
    short_title: str | None = None
    preview: str
    type: str
    discipline: str
    year: int
    authors: list[str] = Field(default_factory=list)
    reason: str | None = None
    # essay / paper：前端据此写“自由创作”还是“研究长文”，不再一律按 type 叫研究长文。
    content_track: str | None = None
    content_genre: str | None = None


class RelatedTopicOut(BaseModel):
    id: int
    title: str
    board_name: str | None = None
    board_path: str | None = None
    reply_count: int
    last_reply_at: datetime | None = None
    reason: str


class TopicRelatedOut(BaseModel):
    """Linked work plus two independent discovery lists."""

    paper: LinkedWorkOut | None = None
    topics: list[RelatedTopicOut] = Field(default_factory=list)
    works: list[LinkedWorkOut] = Field(default_factory=list)


class ModerationSignalOut(BaseModel):
    code: str
    label: str
    detail: str
    weight: int


class ModerationQueueItem(BaseModel):
    id: int
    title: str
    body: str
    board_name: str | None = None
    board_path: str | None = None
    author: AuthorBrief | None = None
    moderation_status: str
    risk_score: int
    moderation_signals: list[ModerationSignalOut] = Field(default_factory=list)
    manual_review_reason: str | None = None
    review_eta_at: datetime | None = None
    created_at: datetime
    reviewed_at: datetime | None = None
    reviewed_by: AuthorBrief | None = None


class ModerationQueueOut(BaseModel):
    data: list[ModerationQueueItem]
    meta: dict[str, object]


class ModerationDecisionIn(BaseModel):
    action: Literal["approve", "reject", "changes"]
    note: str = Field(default="", max_length=1000)


class ModerationBatchIn(BaseModel):
    topic_ids: list[int] = Field(min_length=1, max_length=50)
    action: Literal["approve", "reject", "changes"]
    note: str = Field(default="", max_length=1000)
    # 前端生成的批次号；为空时后端补一个，用于撤销时定位同一批事件。
    batch_id: str | None = Field(default=None, max_length=32)


class ModerationFeedbackIn(BaseModel):
    verdict: Literal["false_positive", "correct"] = "false_positive"
    signal_code: str | None = Field(default=None, max_length=40)
    note: str = Field(default="", max_length=1000)


class ModerationSettingsIn(BaseModel):
    auto_publish_enabled: bool = True
    manual_threshold: int = Field(default=40, ge=1, le=99)
    sla_minutes: int = Field(default=30, ge=1, le=1440)
    weights: dict[str, int] | None = None
    # 队列排序：风险分 × risk + 等待小时 × age。0 表示该维度不参与。
    priority_risk_weight: int = Field(default=10, ge=0, le=100)
    priority_age_weight: int = Field(default=1, ge=0, le=100)
    # 灰度：{"boards": {...}, "roles": {...}}；服务端只保留受支持的形状。
    gray_rules: dict[str, object] | None = None


class ModerationSettingsOut(ModerationSettingsIn):
    updated_at: datetime | None = None


class ReplyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    topic_id: int
    parent_id: int | None = None
    body: str
    created_at: datetime
    author: AuthorBrief | None = None
    reactions: dict[str, int] = Field(default_factory=dict)
    viewer_reactions: list[str] = Field(default_factory=list)


async def _author_map(db: AsyncSession, user_ids: set[int]) -> dict[int, AuthorBrief]:
    """批量查作者，避免列表页 N+1。"""
    if not user_ids:
        return {}
    rows = (
        await db.execute(
            select(User.id, User.username, User.display_name, User.avatar_url).where(
                User.id.in_(user_ids)
            )
        )
    ).all()
    return {
        r[0]: AuthorBrief(
            id=r[0],
            username=r[1],
            display_name=r[2],
            avatar_url=r[3],
        )
        for r in rows
    }


async def _reaction_summary(
    db: AsyncSession,
    *,
    target_type: str,
    target_ids: list[int],
    viewer_id: int | None,
) -> tuple[dict[int, dict[str, int]], dict[int, list[str]]]:
    """批量取反馈计数和当前用户已选状态，避免详情页 N+1。"""
    counts: dict[int, dict[str, int]] = {i: {k: 0 for k in REACTION_KINDS} for i in target_ids}
    viewers: dict[int, list[str]] = {i: [] for i in target_ids}
    if not target_ids:
        return counts, viewers
    rows = (
        await db.execute(
            select(ForumReaction.target_id, ForumReaction.kind, func.count())
            .where(
                ForumReaction.tenant_id == require_tenant_id(),
                ForumReaction.target_type == target_type,
                ForumReaction.target_id.in_(target_ids),
            )
            .group_by(ForumReaction.target_id, ForumReaction.kind)
        )
    ).all()
    for tid, kind, count in rows:
        if tid in counts and kind in counts[tid]:
            counts[tid][kind] = int(count)
    if viewer_id is not None:
        viewer_rows = (
            await db.execute(
                select(ForumReaction.target_id, ForumReaction.kind).where(
                    ForumReaction.tenant_id == require_tenant_id(),
                    ForumReaction.user_id == viewer_id,
                    ForumReaction.target_type == target_type,
                    ForumReaction.target_id.in_(target_ids),
                )
            )
        ).all()
        for tid, kind in viewer_rows:
            if tid in viewers:
                viewers[tid].append(kind)
    return counts, viewers


async def _board_index(db: AsyncSession, tenant_id) -> dict[int, ForumBoard]:
    """当前租户全部版块，供列表页一次解析名称/路径，避免 N+1。"""
    rows = (
        (
            await db.execute(
                select(ForumBoard)
                .where(ForumBoard.tenant_id == tenant_id)
                .order_by(ForumBoard.sort_order, ForumBoard.id)
            )
        )
        .scalars()
        .all()
    )
    return {b.id: b for b in rows}


def _board_path(board: ForumBoard | None, index: dict[int, ForumBoard]) -> str | None:
    if board is None:
        return None
    names: list[str] = []
    seen: set[int] = set()
    cursor: ForumBoard | None = board
    while cursor is not None and cursor.id not in seen:
        seen.add(cursor.id)
        names.append(cursor.name)
        cursor = index.get(cursor.parent_id) if cursor.parent_id else None
    return " / ".join(reversed(names))


def _can_read_bodies(viewer: User | None) -> bool:
    """Whether this viewer may read full manuscripts.

    Mirrors the manuscript route: with the auth wall on (production), only a
    signed-in reader opens a body; overseas guests get metadata and threads.
    A quoted passage is part of the body, so it follows the same rule.
    """
    return viewer is not None or not settings.auth_wall_enabled


def _passage_out(t: ForumTopic, show: bool) -> PassageOut | None:
    quote = getattr(t, "passage_quote", None)
    if not show or not quote:
        return None
    return PassageOut(
        quote=quote,
        prefix=getattr(t, "passage_prefix", None) or "",
        suffix=getattr(t, "passage_suffix", None) or "",
    )


def _topic_out(
    t: ForumTopic,
    authors: dict[int, AuthorBrief],
    reactions: dict[str, int] | None = None,
    viewer_reactions: list[str] | None = None,
    boards: dict[int, ForumBoard] | None = None,
    viewer_following: bool = False,
    show_passage: bool = False,
) -> TopicOut:
    board = boards.get(t.board_id) if boards and t.board_id else None
    return TopicOut(
        id=t.id,
        title=t.title,
        body=t.body,
        category=t.category,
        is_fictional=t.is_fictional,
        board_id=t.board_id,
        board_slug=board.slug if board else None,
        board_name=board.name if board else None,
        board_path=_board_path(board, boards or {}),
        is_pinned=t.is_pinned,
        is_locked=t.is_locked,
        reply_count=t.reply_count,
        created_at=t.created_at,
        last_reply_at=t.last_reply_at,
        paper_id=t.paper_id,
        passage=_passage_out(t, show_passage),
        has_passage=bool(getattr(t, "passage_quote", None)),
        moderation_status=getattr(t, "moderation_status", "published") or "published",
        risk_score=getattr(t, "risk_score", 0) or 0,
        manual_review_reason=getattr(t, "manual_review_reason", None),
        review_eta_at=getattr(t, "review_eta_at", None),
        published_at=getattr(t, "published_at", None),
        reviewed_at=getattr(t, "reviewed_at", None),
        author=authors.get(t.author_id),
        reactions=reactions or {k: 0 for k in REACTION_KINDS},
        viewer_reactions=viewer_reactions or [],
        viewer_following=viewer_following,
    )


def _reply_out(
    r: ForumReply,
    authors: dict[int, AuthorBrief],
    reactions: dict[str, int] | None = None,
    viewer_reactions: list[str] | None = None,
) -> ReplyOut:
    return ReplyOut(
        id=r.id,
        topic_id=r.topic_id,
        parent_id=r.parent_id,
        body=r.body,
        created_at=r.created_at,
        author=authors.get(r.author_id),
        reactions=reactions or {k: 0 for k in REACTION_KINDS},
        viewer_reactions=viewer_reactions or [],
    )


def _subtree_ids(boards: list[ForumBoard], root: ForumBoard) -> set[int]:
    """父板块筛选时把全部子板块一起带上；3 层也只需一次内存遍历。"""
    children: dict[int, list[ForumBoard]] = {}
    for b in boards:
        if b.parent_id is not None:
            children.setdefault(b.parent_id, []).append(b)
    ids: set[int] = set()
    stack = [root]
    while stack:
        cur = stack.pop()
        if cur.id in ids:
            continue
        ids.add(cur.id)
        stack.extend(children.get(cur.id, []))
    return ids


def _ancestor_ids(boards: list[ForumBoard], board: ForumBoard) -> set[int]:
    index = {b.id: b for b in boards}
    ids: set[int] = set()
    cur: ForumBoard | None = board
    while cur is not None and cur.id not in ids:
        ids.add(cur.id)
        cur = index.get(cur.parent_id) if cur.parent_id else None
    return ids


async def _resolve_board(
    db: AsyncSession,
    tenant_id,
    *,
    board_id: int | None = None,
    board_slug: str | None = None,
) -> ForumBoard | None:
    stmt = select(ForumBoard).where(ForumBoard.tenant_id == tenant_id)
    if board_id is not None:
        stmt = stmt.where(ForumBoard.id == board_id)
    elif board_slug is not None:
        stmt = stmt.where(ForumBoard.slug == board_slug)
    else:
        return None
    return (await db.execute(stmt)).scalar_one_or_none()


VISIBLE_STATUS = ("published", "auto_approved", "approved")


def _visible_clause():
    """公开列表/详情可见的主题。未回填的历史行按 published 处理。"""
    return or_(
        ForumTopic.moderation_status.in_(VISIBLE_STATUS),
        ForumTopic.moderation_status.is_(None),
    )


async def _is_moderator(db: AsyncSession, user: User | None) -> bool:
    if user is None:
        return False
    if user.is_admin:
        return True
    actual = await effective_permission_role(db, user)
    if PERMISSION_RANK.get(actual, 0) >= PERMISSION_RANK[ROLE_EDITOR]:
        return True
    return await user_has_role(db, user, ROLE_EDITOR)


async def _require_moderator(db: AsyncSession, user: User) -> None:
    if await _is_moderator(db, user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="需要编辑或管理员权限才能处理内容审核",
    )


async def _require_rule_admin(db: AsyncSession, user: User) -> None:
    if user.is_admin:
        return
    actual = await effective_permission_role(db, user)
    if PERMISSION_RANK.get(actual, 0) >= PERMISSION_RANK["editor_in_chief"]:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="只有主编或管理员可以调整自动核验规则",
    )


def _auto_board_slug(title: str, body: str) -> str:
    """无版块选择时按内容做保守的确定性归类。

    只是把主题放进最接近的既有版块，不是内容理解模型；用户可以在发布前
    修改，运营也可以在人工核验时调整。
    """
    text = f"{title}\n{body}".lower()
    # 招生/找导师优先于“招募”，避免把导师名额误归到组队版。
    if any(term in text for term in ("找导师", "求导师", "寻导师", "套磁", "自荐信")):
        return "admissions-seek"
    if any(
        term in text
        for term in ("招生", "招硕士", "招博士", "招收", "博士后", "研究助理", "推免", "保研")
    ):
        return "admissions-recruit"
    if any(term in text for term in ("组队", "招募", "找队友", "合作", "一起做", "缺人")):
        return "collab"
    if any(term in text for term in ("bug", "报错", "建议", "反馈", "打不开", "无法", "站务")):
        return "site"
    if any(term in text for term in ("复盘", "记录", "日志", "实验", "过程", "踩坑")):
        return "records"
    if any(term in text for term in ("生活", "日常", "焦虑", "失眠", "写作", "创作", "心情")):
        return "life"
    return "discussion"


@router.get("/topics", response_model=TopicListOut)
async def list_topics(
    # 兼容旧客户端：既接受旧分类别名，也接受新版树形版块的 slug
    # （academic / site / paper-reading …）。父板块会聚合全部后代。
    category: str | None = Query(default=None, pattern=r"^[a-z0-9-]{2,40}$"),
    board: str | None = Query(
        default=None,
        pattern=r"^[a-z0-9-]{2,40}$",
        description="树形版块 slug；父板块会聚合全部子板块",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    paper_id: int | None = Query(default=None, ge=1),
    q: str | None = Query(
        default=None, min_length=1, max_length=80, description="标题或正文关键词"
    ),
    sort: Literal["latest", "hot", "unanswered", "following"] = Query(default="latest"),
    include_pending: bool = Query(default=False, description="运营端包含待人工核验主题"),
    current_user: User | None = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> TopicListOut:
    """主题帖列表：置顶优先。latest 按最近活跃，hot 按回复数，unanswered 只看零回应，following 只看当前用户关注的主题帖。"""
    tenant_id = require_tenant_id()
    all_boards = (
        (
            await db.execute(
                select(ForumBoard)
                .where(ForumBoard.tenant_id == tenant_id)
                .order_by(ForumBoard.sort_order, ForumBoard.id)
            )
        )
        .scalars()
        .all()
    )
    stmt = select(ForumTopic).where(
        ForumTopic.tenant_id == tenant_id,
        ForumTopic.deleted_at.is_(None),
    )
    if include_pending:
        if current_user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="登录后可查看待核验主题"
            )
        await _require_moderator(db, current_user)
    elif paper_id is not None and current_user is not None:
        # 作品页的页边：作者刚写下、还在人工核验的那条也要能看到自己的
        # （详情页本就对作者开放），其他人仍只看已公开的主题。
        stmt = stmt.where(
            or_(
                _visible_clause(),
                and_(
                    ForumTopic.author_id == current_user.id,
                    ForumTopic.moderation_status == "manual_review",
                ),
            )
        )
    else:
        stmt = stmt.where(_visible_clause())
    # board 优先；旧 category 仍可用。父板块筛选包含全部后代。
    selected_slugs: set[str] = set()
    selected_ids: set[int] = set()
    if board:
        root = next((b for b in all_boards if b.slug == board), None)
        if root is None:
            return TopicListOut(
                data=[], meta={"total": 0, "page": page, "page_size": page_size, "total_pages": 0}
            )
        subtree = _subtree_ids(list(all_boards), root)
        selected_ids = subtree
        selected_slugs = {b.slug for b in all_boards if b.id in subtree}
    elif category:
        # 旧分类别名映射到新版块，再带上子板块
        slug = next((b for b in all_boards if b.slug == category), None)
        if slug is None:
            slug = next(
                (
                    b
                    for b in all_boards
                    if b.slug
                    == next((k for k, v in CATEGORY_BOARD.items() if category in v), category)
                ),
                None,
            )
        if slug is not None:
            subtree = _subtree_ids(list(all_boards), slug)
            selected_ids = subtree
            selected_slugs = {b.slug for b in all_boards if b.id in subtree}
        else:
            selected_slugs = {category}

    if selected_ids or selected_slugs:
        clauses = []
        if selected_ids:
            clauses.append(ForumTopic.board_id.in_(selected_ids))
        if selected_slugs:
            clauses.append(ForumTopic.category.in_(selected_slugs))
        stmt = stmt.where(or_(*clauses))
    if sort == "unanswered":
        stmt = stmt.where(ForumTopic.reply_count == 0)
    elif sort == "following":
        if current_user is None:
            return TopicListOut(
                data=[],
                meta={
                    "total": 0,
                    "page": page,
                    "page_size": page_size,
                    "total_pages": 0,
                },
            )
        followed_ids = (
            (
                await db.execute(
                    select(ForumTopicFollow.topic_id).where(
                        ForumTopicFollow.tenant_id == tenant_id,
                        ForumTopicFollow.user_id == current_user.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        stmt = stmt.where(ForumTopic.id.in_(followed_ids))
    if paper_id is not None:
        stmt = stmt.where(ForumTopic.paper_id == paper_id)
    if q and q.strip():
        keyword = q.strip()
        stmt = stmt.where(
            or_(
                ForumTopic.title.ilike(f"%{keyword}%"),
                ForumTopic.body.ilike(f"%{keyword}%"),
            )
        )
    rows, meta = await paginate(
        db,
        stmt,
        page=page,
        page_size=page_size,
        order_by=(
            (
                desc(ForumTopic.is_pinned),
                desc(ForumTopic.reply_count),
                desc(ForumTopic.last_reply_at),
            )
            if sort == "hot"
            else (
                desc(ForumTopic.is_pinned),
                desc(func.coalesce(ForumTopic.last_reply_at, ForumTopic.created_at)),
                ForumTopic.id.desc(),
            )
            if sort in ("latest", "following")
            else (
                desc(ForumTopic.is_pinned),
                ForumTopic.created_at.desc(),
                ForumTopic.id.desc(),
            )
        ),
    )
    authors = await _author_map(db, {r.author_id for r in rows})
    boards = {b.id: b for b in all_boards}
    reaction_counts, viewer_reactions = await _reaction_summary(
        db,
        target_type="topic",
        target_ids=[r.id for r in rows],
        viewer_id=current_user.id if current_user else None,
    )
    followed_topic_ids: set[int] = set()
    if current_user is not None and rows:
        followed_topic_ids = set(
            (
                await db.execute(
                    select(ForumTopicFollow.topic_id).where(
                        ForumTopicFollow.tenant_id == tenant_id,
                        ForumTopicFollow.user_id == current_user.id,
                        ForumTopicFollow.topic_id.in_([r.id for r in rows]),
                    )
                )
            )
            .scalars()
            .all()
        )
    return TopicListOut(
        data=[
            _topic_out(
                r,
                authors,
                reactions=reaction_counts.get(r.id),
                viewer_reactions=viewer_reactions.get(r.id),
                boards=boards,
                viewer_following=r.id in followed_topic_ids,
                show_passage=_can_read_bodies(current_user),
            )
            for r in rows
        ],
        meta={
            "total": meta.total,
            "page": meta.page,
            "page_size": meta.page_size,
            "total_pages": meta.total_pages,
        },
    )


@router.get("/boards")
async def board_stats(db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    """树形版块及帖子数。

    ``data`` 保留旧的扁平结构（category = slug，兼容旧前端/测试），
    ``tree`` 给新前台按「父板块 → 子板块 → 子子板块」渲染。
    父板块的 ``total_topics`` 是整棵子树的合计。
    """
    tenant_id = require_tenant_id()
    boards = (
        (
            await db.execute(
                select(ForumBoard)
                .where(ForumBoard.tenant_id == tenant_id)
                .order_by(ForumBoard.sort_order, ForumBoard.id)
            )
        )
        .scalars()
        .all()
    )
    raw_counts = (
        await db.execute(
            select(
                ForumTopic.board_id,
                ForumTopic.category,
                func.count(ForumTopic.id),
                func.max(func.coalesce(ForumTopic.last_reply_at, ForumTopic.created_at)),
            )
            .where(
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
                _visible_clause(),
            )
            .group_by(ForumTopic.board_id, ForumTopic.category)
        )
    ).all()
    direct: dict[int, dict[str, object]] = {
        b.id: {"topics": 0, "last_active": None} for b in boards
    }
    legacy_slugs = {b.slug for b in boards}
    for board_id, category, count, last in raw_counts:
        target = board_id if board_id in direct else None
        if target is None and category in legacy_slugs:
            target = next((b.id for b in boards if b.slug == category), None)
        if target is None:
            continue
        direct[target]["topics"] = int(str(direct[target]["topics"])) + int(str(count))
        current = direct[target]["last_active"]
        if last is not None and (current is None or last > current):
            direct[target]["last_active"] = last

    flat: list[dict[str, object]] = []
    for b in boards:
        row = {
            "id": b.id,
            "parent_id": b.parent_id,
            "slug": b.slug,
            "category": b.slug,
            "name": b.name,
            "description": b.description,
            "sort_order": b.sort_order,
            "is_active": b.is_active,
            "topics": direct[b.id]["topics"],
            "last_active": direct[b.id]["last_active"],
        }
        if row["last_active"] is not None:
            row["last_active"] = row["last_active"].isoformat()  # type: ignore[union-attr]
        flat.append(row)

    by_parent: dict[int | None, list[dict[str, object]]] = {}
    for row in flat:
        by_parent.setdefault(row["parent_id"], []).append(row)

    def build(parent_id: int | None) -> list[dict[str, object]]:
        nodes: list[dict[str, object]] = []
        for row in by_parent.get(parent_id, []):
            children = build(row["id"])  # type: ignore[arg-type]
            own = int(str(row["topics"]))
            total = own + sum(int(str(c["total_topics"])) for c in children)
            node = dict(row)
            node["total_topics"] = total
            node["children"] = children
            last_values = [row["last_active"]] + [c["last_active"] for c in children]
            node["last_active"] = max([v for v in last_values if v], default=None)
            nodes.append(node)
        return nodes

    return {"data": flat, "tree": build(None), "total": len(flat)}


@router.get("/topics/bookmarks", response_model=TopicListOut)
async def list_bookmarked_topics(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TopicListOut:
    """当前用户收藏的主题帖，按收藏时间倒序。

    The bookmark action lives in the same reaction table as agree/helpful;
    this is its read side. It deliberately does not return replies, only the
    topic card a reader needs to decide whether to reopen it.
    """
    tenant_id = require_tenant_id()
    stmt = (
        select(ForumTopic)
        .join(
            ForumReaction,
            and_(
                ForumReaction.tenant_id == tenant_id,
                ForumReaction.target_id == ForumTopic.id,
                ForumReaction.target_type == "topic",
                ForumReaction.kind == "bookmark",
                ForumReaction.user_id == current_user.id,
            ),
        )
        .where(
            ForumTopic.tenant_id == tenant_id,
            ForumTopic.deleted_at.is_(None),
            _visible_clause(),
        )
    )
    rows, meta = await paginate(
        db,
        stmt,
        page=page,
        page_size=page_size,
        order_by=[ForumReaction.created_at.desc(), ForumTopic.id.desc()],
    )
    authors = await _author_map(db, {row.author_id for row in rows})
    boards = await _board_index(db, tenant_id)
    reaction_counts, viewer_reactions = await _reaction_summary(
        db,
        target_type="topic",
        target_ids=[row.id for row in rows],
        viewer_id=current_user.id,
    )
    followed_ids: set[int] = set()
    if rows:
        followed_ids = set(
            (
                await db.execute(
                    select(ForumTopicFollow.topic_id).where(
                        ForumTopicFollow.tenant_id == tenant_id,
                        ForumTopicFollow.user_id == current_user.id,
                        ForumTopicFollow.topic_id.in_([row.id for row in rows]),
                    )
                )
            )
            .scalars()
            .all()
        )
    return TopicListOut(
        data=[
            _topic_out(
                row,
                authors,
                reactions=reaction_counts.get(row.id),
                viewer_reactions=viewer_reactions.get(row.id),
                boards=boards,
                viewer_following=row.id in followed_ids,
                show_passage=_can_read_bodies(current_user),
            )
            for row in rows
        ],
        meta={
            "total": meta.total,
            "page": meta.page,
            "page_size": meta.page_size,
            "total_pages": meta.total_pages,
        },
    )


@router.get("/topics/{topic_id}", response_model=TopicOut)
async def get_topic(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> TopicOut:
    tenant_id = require_tenant_id()
    topic = (
        await db.execute(
            select(ForumTopic).where(
                ForumTopic.id == topic_id,
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")
    visible = topic.moderation_status in VISIBLE_STATUS or topic.moderation_status is None
    if not visible and not (
        current_user is not None
        and (current_user.id == topic.author_id or await _is_moderator(db, current_user))
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")
    authors = await _author_map(db, {topic.author_id})
    counts, viewers = await _reaction_summary(
        db,
        target_type="topic",
        target_ids=[topic.id],
        viewer_id=current_user.id if current_user else None,
    )
    boards = await _board_index(db, tenant_id)
    return _topic_out(
        topic,
        authors,
        counts.get(topic.id),
        viewers.get(topic.id),
        boards,
        show_passage=_can_read_bodies(current_user),
    )


@router.get("/topics/{topic_id}/related", response_model=TopicRelatedOut)
async def get_topic_related(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> TopicRelatedOut:
    """关联作品、同一作品的其它讨论，以及相近主题与延伸阅读。

    公开可读；待核验主题只对作者/版主开放，规则与详情页一致，避免关联
    接口成为未过审帖子的侧门。
    """
    tenant_id = require_tenant_id()
    topic = (
        await db.execute(
            select(ForumTopic).where(
                ForumTopic.id == topic_id,
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")
    visible = topic.moderation_status in VISIBLE_STATUS or topic.moderation_status is None
    if not visible and not (
        current_user is not None
        and (current_user.id == topic.author_id or await _is_moderator(db, current_user))
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")

    paper, related_topics, related_works = await find_related(db, tenant_id=tenant_id, topic=topic)
    boards = await _board_index(db, tenant_id)
    return TopicRelatedOut(
        paper=(
            LinkedWorkOut(
                id=paper.id,
                title=paper.title,
                short_title=paper.short_title,
                preview=paper.preview,
                type=paper.type,
                discipline=paper.discipline,
                year=paper.year,
                authors=paper.authors or [],
                content_track=paper.content_track,
                content_genre=paper.content_genre,
            )
            if paper is not None
            else None
        ),
        topics=[
            RelatedTopicOut(
                id=row.id,
                title=row.title,
                board_name=(
                    boards[row.board_id].name if row.board_id and row.board_id in boards else None
                ),
                board_path=_board_path(boards.get(row.board_id) if row.board_id else None, boards),
                reply_count=row.reply_count,
                last_reply_at=row.last_reply_at,
                reason=reason,
            )
            for row, reason in related_topics
        ],
        works=[
            LinkedWorkOut(
                id=work.id,
                title=work.title,
                short_title=work.short_title,
                preview=work.preview,
                type=work.type,
                discipline=work.discipline,
                year=work.year,
                authors=work.authors or [],
                reason=reason,
                content_track=work.content_track,
                content_genre=work.content_genre,
            )
            for work, reason in related_works
        ],
    )


@router.get("/topics/{topic_id}/replies", response_model=list[ReplyOut])
async def list_replies(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> list[ReplyOut]:
    """楼层互动回复按时间正序（讨论要按上下文读，倒序会读不懂）。"""
    tenant_id = require_tenant_id()
    topic = (
        await db.execute(
            select(ForumTopic).where(
                ForumTopic.id == topic_id,
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")
    visible = topic.moderation_status in VISIBLE_STATUS or topic.moderation_status is None
    if not visible and not (
        current_user is not None
        and (current_user.id == topic.author_id or await _is_moderator(db, current_user))
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")
    rows = (
        (
            await db.execute(
                select(ForumReply)
                .where(
                    ForumReply.topic_id == topic_id,
                    ForumReply.tenant_id == tenant_id,
                    ForumReply.deleted_at.is_(None),
                )
                .order_by(ForumReply.created_at.asc(), ForumReply.id.asc())
                .limit(500)
            )
        )
        .scalars()
        .all()
    )
    authors = await _author_map(db, {r.author_id for r in rows})
    counts, viewers = await _reaction_summary(
        db,
        target_type="reply",
        target_ids=[r.id for r in rows],
        viewer_id=current_user.id if current_user else None,
    )
    return [_reply_out(r, authors, counts.get(r.id), viewers.get(r.id)) for r in rows]


@router.post("/topics", response_model=TopicOut, status_code=status.HTTP_201_CREATED)
async def create_topic(
    payload: TopicCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TopicOut:
    """发帖。登录即可，不设积分门槛。"""
    blocked = rejection_detail(f"{payload.title}\n{payload.body}")
    if blocked is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=blocked)
    tenant_id = require_tenant_id()
    board = await _resolve_board(
        db, tenant_id, board_id=payload.board_id, board_slug=payload.board_slug
    )
    if (payload.board_id is not None or payload.board_slug is not None) and board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="版块不存在")
    # 三步发布：用户不选分区时，系统按标题/正文自动落到最接近的既有版块。
    explicit_board = payload.board_id is not None or payload.board_slug is not None
    if board is None:
        inferred_slug = _auto_board_slug(payload.title, payload.body)
        board = await _resolve_board(db, tenant_id, board_slug=inferred_slug)
        if board is None:
            board = await _resolve_board(db, tenant_id, board_slug="discussion")
    if board is not None and not board.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="版块已关闭")
    # 旧客户端只传 category 时保留旧分类语义，避免历史筛选/公告权限被改写；
    # 显式选版块时才用 slug 对齐新树形结构。
    category = board.slug if explicit_board and board is not None else payload.category
    # 公告类帖子只允许编辑/管理员发——否则任何人都能伪装成官方公告
    if category == "notice" or (board is not None and board.slug == "meta"):
        allowed = current_user.is_admin or await user_has_role(db, current_user, ROLE_EDITOR)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="「公告」分类仅限编辑与管理员发布",
            )
    base_policy = await moderation.get_policy(db, tenant_id)
    policy = moderation.effective_policy(
        base_policy,
        board_slug=board.slug if board is not None else None,
        role="admin" if current_user.is_admin else current_user.role,
    )
    assessment = assess_text(
        payload.title,
        payload.body,
        manual_threshold=policy.manual_threshold,
        auto_publish_enabled=policy.auto_publish_enabled,
        sla_minutes=policy.sla_minutes,
        weights=policy.weights,
    )
    if assessment.action == "blocked":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "content_blocked", "message": assessment.reason},
        )
    linked_paper_id = payload.paper_id
    if linked_paper_id is not None:
        linked = (
            await db.execute(
                select(Resource.id).where(
                    Resource.id == linked_paper_id,
                    Resource.tenant_id == tenant_id,
                    *public_conditions(),
                )
            )
        ).scalar_one_or_none()
        if linked is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="关联作品不存在或尚未公开",
            )
    passage_quote: str | None = None
    passage_prefix: str | None = None
    passage_suffix: str | None = None
    if payload.passage is not None and linked_paper_id is not None:
        # 引文署的是作者的名字：必须是正文里真有的话，不能借页边替作者“说”一句。
        passage_quote = passages.collapse(payload.passage.quote)
        manuscript = await passages.load_manuscript_markdown(
            db, tenant_id=tenant_id, resource_id=linked_paper_id
        )
        if manuscript is None or not passages.quote_in_text(passage_quote, manuscript):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "passage_not_found",
                    "message": "这段文字和作品正文对不上，请回到正文重新选择。",
                },
            )
        passage_prefix = passages.clean_context(payload.passage.prefix, keep="tail")
        passage_suffix = passages.clean_context(payload.passage.suffix, keep="head")
    review_status = "manual_review" if assessment.action == "manual_review" else "published"
    now = utcnow()
    topic = ForumTopic(
        tenant_id=tenant_id,
        author_id=current_user.id,
        title=payload.title.strip(),
        body=payload.body.strip(),
        category=category,
        is_fictional=payload.is_fictional,
        board_id=board.id if board is not None else None,
        paper_id=linked_paper_id,
        passage_quote=passage_quote,
        passage_prefix=passage_prefix,
        passage_suffix=passage_suffix,
        moderation_status=review_status,
        risk_score=assessment.risk_score,
        moderation_signals=[asdict(signal) for signal in assessment.signals],
        manual_review_reason=assessment.reason if review_status == "manual_review" else None,
        review_eta_at=(
            now + timedelta(minutes=policy.sla_minutes)
            if review_status == "manual_review"
            else None
        ),
        published_at=now if review_status == "published" else None,
    )
    db.add(topic)
    await db.flush()
    await moderation.record_event(
        db,
        tenant_id=tenant_id,
        topic=topic,
        action=review_status,
        from_status="new",
        to_status=review_status,
        actor_id=None,
        note=assessment.reason,
        meta={
            "risk_score": assessment.risk_score,
            "signals": [asdict(s) for s in assessment.signals],
        },
    )
    author = AuthorBrief(
        id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
    )
    await db.commit()
    await db.refresh(topic)
    # 只有已公开的主题才计入活跃经验/积分；待核验主题在人工通过后补记。
    if review_status == "published":
        try:
            from app.domain.gamification import service as gamification

            await gamification.award(
                db,
                current_user,
                "forum.topic",
                ref_type="forum_topic",
                ref_id=str(topic.id),
                commit=True,
            )
        except Exception:
            await db.rollback()
        try:
            from app.domain.gamification import currency

            await currency.award(
                db,
                current_user,
                "forum.topic",
                ref_type="forum_topic",
                ref_id=str(topic.id),
                commit=True,
            )
        except Exception:
            await db.rollback()
    boards = await _board_index(db, tenant_id)
    return _topic_out(topic, {author.id: author}, boards=boards, show_passage=True)


@router.post(
    "/topics/{topic_id}/replies",
    response_model=ReplyOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_reply(
    topic_id: int,
    payload: ReplyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReplyOut:
    tenant_id = require_tenant_id()
    topic = (
        await db.execute(
            select(ForumTopic).where(
                ForumTopic.id == topic_id,
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")
    if topic.moderation_status not in VISIBLE_STATUS and topic.moderation_status is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="主题帖还在核验，暂时不能参与楼层互动"
        )
    if topic.is_locked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="该主题帖已锁定，无法回复"
        )
    blocked = rejection_detail(payload.body)
    if blocked is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=blocked)

    parent_id = payload.parent_id
    parent_author_id: int | None = None
    if parent_id is not None:
        parent = (
            await db.execute(
                select(ForumReply).where(
                    ForumReply.id == parent_id,
                    ForumReply.topic_id == topic_id,
                    ForumReply.tenant_id == tenant_id,
                    ForumReply.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if parent is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="被回复的楼层不存在")
        # 只保留两级：回复子楼时归到根楼，既保留上下文，又不会出现无限缩进。
        parent_id = parent.parent_id or parent.id
        parent_author_id = parent.author_id

    reply = ForumReply(
        tenant_id=tenant_id,
        topic_id=topic_id,
        author_id=current_user.id,
        body=payload.body.strip(),
        parent_id=parent_id,
    )
    author = AuthorBrief(
        id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
    )
    db.add(reply)
    # 反冗余计数与最近活跃时间在同一事务里更新
    topic.reply_count += 1
    topic.last_reply_at = utcnow()
    await db.flush()
    # 回帖通知主题作者、被回复楼层作者和所有关注本帖的人；自己回自己不通知。
    from app.domain.notifications import services as notifications

    recipient_ids = {topic.author_id}
    if parent_author_id is not None:
        recipient_ids.add(parent_author_id)
    follower_ids = (
        (
            await db.execute(
                select(ForumTopicFollow.user_id).where(
                    ForumTopicFollow.tenant_id == tenant_id,
                    ForumTopicFollow.topic_id == topic_id,
                )
            )
        )
        .scalars()
        .all()
    )
    recipient_ids.update(follower_ids)
    recipient_ids.discard(current_user.id)
    if recipient_ids:
        recipients = (
            (await db.execute(select(User).where(User.id.in_(recipient_ids)))).scalars().all()
        )
        for recipient in recipients:
            prefs = notifications.merged_prefs(recipient)
            if prefs.get("in_app_forum"):
                await notifications.create(
                    db,
                    tenant_id=tenant_id,
                    user_id=recipient.id,
                    type_="forum.reply",
                    title=f"主题帖「{topic.title[:80]}」有新的楼层互动",
                    body=f"{current_user.display_name or current_user.username}：{payload.body.strip()[:120]}",
                    related_type="forum_topic",
                    related_id=str(topic.id),
                )
            if prefs.get("email_forum") and recipient.email:
                await notifications.record_email_digest(
                    db,
                    tenant_id=tenant_id,
                    user_id=recipient.id,
                    event_type="forum.reply",
                    recipient_email=recipient.email,
                    subject=f"Rubbish：{topic.title[:80]} 有新的楼层互动",
                    text=f"{current_user.display_name or current_user.username} 回复了主题帖「{topic.title[:80]}」：\n\n{payload.body.strip()[:500]}",
                    related_type="forum_topic",
                    related_id=str(topic.id),
                )
    await db.commit()
    await db.refresh(reply)
    # 回帖计入全站活跃经验；失败不影响回帖本身。
    try:
        from app.domain.gamification import service as gamification

        await gamification.award(
            db,
            current_user,
            "forum.reply",
            ref_type="forum_reply",
            ref_id=str(reply.id),
            commit=True,
        )
    except Exception:
        await db.rollback()
    # 积分（与活跃经验是两套账）；失败不影响回帖本身。
    try:
        from app.domain.gamification import currency

        await currency.award(
            db,
            current_user,
            "forum.reply",
            ref_type="forum_reply",
            ref_id=str(reply.id),
            commit=True,
        )
    except Exception:
        await db.rollback()
    return _reply_out(
        reply,
        {author.id: author},
        {k: 0 for k in REACTION_KINDS},
        [],
    )


class TopicEditRequest(BaseModel):
    """Author-side edit. Moderator pin/lock has its own endpoint."""

    title: str | None = Field(default=None, min_length=2, max_length=200)
    # 页边讨论的正文可以为空（引文就是上下文）；普通主题仍至少 2 个字，见 edit_topic。
    body: str | None = Field(default=None, max_length=20000)
    board_id: int | None = Field(default=None, ge=1)
    is_fictional: bool | None = None
    # 作者可以在不改正文的情况下补挂/更换关联作品；clear_paper 与 paper_id 互斥。
    paper_id: int | None = Field(default=None, ge=1)
    clear_paper: bool = False


class ModerateRequest(BaseModel):
    is_pinned: bool | None = None
    is_locked: bool | None = None


@router.get("/moderation/queue", response_model=ModerationQueueOut)
async def moderation_queue(
    status_filter: Literal["manual_review", "changes_requested", "rejected", "all"] = Query(
        default="manual_review", alias="status"
    ),
    sort: Literal["priority", "oldest", "newest"] = Query(default="priority"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    topic_id: int | None = Query(default=None, ge=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ModerationQueueOut:
    tenant_id = require_tenant_id()
    await _require_moderator(db, current_user)
    if status_filter == "all":
        statuses = ["manual_review", "changes_requested", "rejected"]
    else:
        statuses = [status_filter]
    stmt = select(ForumTopic).where(
        ForumTopic.tenant_id == tenant_id,
        ForumTopic.deleted_at.is_(None),
        ForumTopic.moderation_status.in_(statuses),
    )
    if topic_id is not None:
        stmt = stmt.where(ForumTopic.id == topic_id)
    if sort == "priority":
        policy = await moderation.get_policy(db, tenant_id)
        order_by = (
            desc(moderation.priority_order_expression(policy)),
            ForumTopic.created_at.asc(),
        )
    elif sort == "oldest":
        order_by = (ForumTopic.created_at.asc(),)
    else:
        order_by = (ForumTopic.created_at.desc(),)
    rows, meta = await paginate(
        db,
        stmt,
        page=page,
        page_size=page_size,
        order_by=order_by,
    )
    authors = await _author_map(
        db, {r.author_id for r in rows} | {r.reviewed_by for r in rows if r.reviewed_by}
    )
    boards = await _board_index(db, tenant_id)
    items: list[ModerationQueueItem] = []
    for row in rows:
        board = boards.get(row.board_id) if row.board_id else None
        signals = row.moderation_signals or []
        items.append(
            ModerationQueueItem(
                id=row.id,
                title=row.title,
                body=row.body,
                board_name=board.name if board else None,
                board_path=_board_path(board, boards) if board else None,
                author=authors.get(row.author_id),
                moderation_status=row.moderation_status,
                risk_score=row.risk_score,
                moderation_signals=[
                    ModerationSignalOut(**s) for s in signals if isinstance(s, dict)
                ],
                manual_review_reason=row.manual_review_reason,
                review_eta_at=row.review_eta_at,
                created_at=row.created_at,
                reviewed_at=row.reviewed_at,
                reviewed_by=authors.get(row.reviewed_by) if row.reviewed_by else None,
            )
        )
    return ModerationQueueOut(
        data=items,
        meta={
            "total": meta.total,
            "page": meta.page,
            "page_size": meta.page_size,
            "total_pages": meta.total_pages,
        },
    )


@router.get("/moderation/stats")
async def moderation_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    tenant_id = require_tenant_id()
    await _require_moderator(db, current_user)
    counts = (
        await db.execute(
            select(ForumTopic.moderation_status, func.count(ForumTopic.id))
            .where(
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
            )
            .group_by(ForumTopic.moderation_status)
        )
    ).all()
    result = {str(status): int(count) for status, count in counts}
    return {
        "manual_review": result.get("manual_review", 0),
        "changes_requested": result.get("changes_requested", 0),
        "published": result.get("published", 0)
        + result.get("auto_approved", 0)
        + result.get("approved", 0),
        "rejected": result.get("rejected", 0),
    }


@router.get("/moderation/topics/{topic_id}/events")
async def moderation_events(
    topic_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    tenant_id = require_tenant_id()
    await _require_moderator(db, current_user)
    topic = (
        await db.execute(
            select(ForumTopic).where(
                ForumTopic.id == topic_id,
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")
    events = (
        (
            await db.execute(
                select(ForumModerationEvent)
                .where(
                    ForumModerationEvent.tenant_id == tenant_id,
                    ForumModerationEvent.topic_id == topic_id,
                )
                .order_by(ForumModerationEvent.created_at.asc(), ForumModerationEvent.id.asc())
            )
        )
        .scalars()
        .all()
    )
    authors = await _author_map(db, {e.actor_id for e in events if e.actor_id})
    return [
        {
            "id": e.id,
            "action": e.action,
            "from_status": e.from_status,
            "to_status": e.to_status,
            "note": e.note,
            "created_at": e.created_at.isoformat(),
            "actor": authors.get(e.actor_id).model_dump()
            if e.actor_id and authors.get(e.actor_id)
            else None,
        }
        for e in events
    ]


@router.post("/moderation/topics/{topic_id}/feedback")
async def moderation_feedback(
    topic_id: int,
    payload: ModerationFeedbackIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Record a human false-positive/correct verdict for rule tuning."""
    tenant_id = require_tenant_id()
    await _require_moderator(db, current_user)
    topic = (
        await db.execute(
            select(ForumTopic).where(
                ForumTopic.id == topic_id,
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=404, detail="主题帖不存在")
    signal_code = payload.signal_code
    if signal_code is None:
        signals = topic.moderation_signals or []
        signal_code = (
            str(signals[0].get("code")) if signals and isinstance(signals[0], dict) else None
        )
    db.add(
        ForumModerationEvent(
            tenant_id=tenant_id,
            topic_id=topic.id,
            actor_id=current_user.id,
            action="feedback",
            from_status=topic.moderation_status,
            to_status=topic.moderation_status,
            note=payload.note.strip() or None,
            meta={
                "verdict": payload.verdict,
                "signal_code": signal_code,
                "risk_score": topic.risk_score,
            },
            created_at=utcnow(),
        )
    )
    await db.commit()
    return {"topic_id": topic.id, "verdict": payload.verdict, "signal_code": signal_code}


@router.get("/moderation/insights")
async def moderation_insights(
    days: int = Query(default=30, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Rule hit / override trend for operators; read-only aggregation."""
    tenant_id = require_tenant_id()
    await _require_moderator(db, current_user)
    since = utcnow() - timedelta(days=days)
    events = (
        (
            await db.execute(
                select(ForumModerationEvent)
                .where(
                    ForumModerationEvent.tenant_id == tenant_id,
                    ForumModerationEvent.created_at >= since,
                )
                .order_by(ForumModerationEvent.created_at)
                .limit(5000)
            )
        )
        .scalars()
        .all()
    )
    topic_ids = {e.topic_id for e in events}
    signals_by_topic: dict[int, list[dict]] = {}
    if topic_ids:
        rows = (
            await db.execute(
                select(ForumTopic.id, ForumTopic.moderation_signals).where(
                    ForumTopic.tenant_id == tenant_id,
                    ForumTopic.id.in_(topic_ids),
                )
            )
        ).all()
        signals_by_topic = {int(tid): (sig or []) for tid, sig in rows}
    decisions = {"approve": 0, "reject": 0, "changes": 0}
    feedback = {"false_positive": 0, "correct": 0}
    by_signal: dict[str, dict[str, int]] = {}
    daily: dict[str, dict[str, int]] = {}
    for event in events:
        day = event.created_at.date().isoformat()
        bucket = daily.setdefault(day, {"decisions": 0, "false_positive": 0})
        if event.action in decisions:
            decisions[event.action] += 1
            bucket["decisions"] += 1
        if event.action == "feedback":
            verdict = str((event.meta or {}).get("verdict") or "false_positive")
            feedback[verdict] = feedback.get(verdict, 0) + 1
            if verdict == "false_positive":
                bucket["false_positive"] += 1
            code = (event.meta or {}).get("signal_code")
            if not code:
                signals = signals_by_topic.get(event.topic_id, [])
                code = (
                    signals[0].get("code")
                    if signals and isinstance(signals[0], dict)
                    else "unknown"
                )
            code = str(code or "unknown")
            row = by_signal.setdefault(code, {"hits": 0, "false_positive": 0})
            if event.action == "feedback":
                row["false_positive"] += 1 if verdict == "false_positive" else 0
    for event in events:
        if event.action in decisions:
            signals = signals_by_topic.get(event.topic_id, [])
            for signal in signals:
                if isinstance(signal, dict):
                    code = str(signal.get("code") or "unknown")
                    by_signal.setdefault(code, {"hits": 0, "false_positive": 0})["hits"] += 1
    total_decisions = sum(decisions.values())
    return {
        "days": days,
        "decisions": decisions,
        "feedback": feedback,
        "false_positive_rate": round(feedback.get("false_positive", 0) / total_decisions * 100, 1)
        if total_decisions
        else 0.0,
        "signals": [
            {
                "code": code,
                **row,
                "false_positive_rate": round(row["false_positive"] / row["hits"] * 100, 1)
                if row["hits"]
                else 0.0,
            }
            for code, row in sorted(
                by_signal.items(), key=lambda item: item[1]["hits"], reverse=True
            )
        ],
        "daily": [{"date": day, **row} for day, row in sorted(daily.items())],
    }


@router.get("/moderation/settings", response_model=ModerationSettingsOut)
async def get_moderation_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ModerationSettingsOut:
    tenant_id = require_tenant_id()
    await _require_moderator(db, current_user)
    row = await moderation.load_settings_row(db, tenant_id)
    await db.commit()
    return ModerationSettingsOut(
        auto_publish_enabled=row.auto_publish_enabled,
        manual_threshold=row.manual_threshold,
        sla_minutes=row.sla_minutes,
        weights=moderation.effective_weights(row.weights),
        priority_risk_weight=row.priority_risk_weight,
        priority_age_weight=row.priority_age_weight,
        gray_rules=row.gray_rules or {},
        updated_at=row.updated_at,
    )


@router.put("/moderation/settings", response_model=ModerationSettingsOut)
async def update_moderation_settings(
    payload: ModerationSettingsIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ModerationSettingsOut:
    tenant_id = require_tenant_id()
    await _require_rule_admin(db, current_user)
    row = await moderation.load_settings_row(db, tenant_id)
    allowed = {code for code, *_ in SOFT_PATTERNS}
    weights = {
        k: max(0, min(100, int(v))) for k, v in (payload.weights or {}).items() if k in allowed
    }
    row.auto_publish_enabled = payload.auto_publish_enabled
    row.manual_threshold = payload.manual_threshold
    row.sla_minutes = payload.sla_minutes
    row.weights = weights
    row.priority_risk_weight = payload.priority_risk_weight
    row.priority_age_weight = payload.priority_age_weight
    row.gray_rules = moderation.sanitize_gray_rules(payload.gray_rules)
    row.updated_at = utcnow()
    await db.commit()
    await db.refresh(row)
    moderation.invalidate_policy(tenant_id)
    return ModerationSettingsOut(
        auto_publish_enabled=row.auto_publish_enabled,
        manual_threshold=row.manual_threshold,
        sla_minutes=row.sla_minutes,
        weights=moderation.effective_weights(row.weights),
        priority_risk_weight=row.priority_risk_weight,
        priority_age_weight=row.priority_age_weight,
        gray_rules=row.gray_rules or {},
        updated_at=row.updated_at,
    )


@router.get("/moderation/rules")
async def moderation_rules(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    tenant_id = require_tenant_id()
    await _require_moderator(db, current_user)
    row = await moderation.load_settings_row(db, tenant_id)
    return {
        "threshold": row.manual_threshold,
        "sla_minutes": row.sla_minutes,
        "auto_publish_enabled": row.auto_publish_enabled,
        "weights": moderation.effective_weights(row.weights),
        "priority_risk_weight": row.priority_risk_weight,
        "priority_age_weight": row.priority_age_weight,
        "gray_rules": row.gray_rules or {},
        "soft_rules": [
            {"code": code, "label": label, "detail": detail, "default_weight": weight}
            for code, label, detail, weight in SOFT_PATTERNS
        ],
        "hard_rules": ["广告引流", "辱骂攻击", "站规词"],
    }


@router.post("/moderation/topics/{topic_id}/decision", response_model=TopicOut)
async def decide_topic(
    topic_id: int,
    payload: ModerationDecisionIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TopicOut:
    tenant_id = require_tenant_id()
    await _require_moderator(db, current_user)
    topic = (
        await db.execute(
            select(ForumTopic).where(
                ForumTopic.id == topic_id,
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")
    if payload.action in ("reject", "changes") and len(payload.note.strip()) < 4:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="请写至少 4 个字的处理说明"
        )
    await moderation.apply_decision(
        db,
        tenant_id=tenant_id,
        topic=topic,
        action=payload.action,
        note=payload.note.strip(),
        actor_id=current_user.id,
    )
    await db.commit()
    await moderation.notify_author(
        db, tenant_id=tenant_id, topic=topic, action=payload.action, note=payload.note.strip()
    )
    authors = await _author_map(db, {topic.author_id})
    boards = await _board_index(db, tenant_id)
    return _topic_out(topic, authors, boards=boards)


@router.post("/moderation/batch/preflight")
async def preflight_batch_decision(
    payload: ModerationBatchIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Dry-run preview: show exactly which topics the batch will touch."""
    tenant_id = require_tenant_id()
    await _require_moderator(db, current_user)
    if payload.action in ("reject", "changes") and len(payload.note.strip()) < 4:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="请写至少 4 个字的处理说明",
        )
    topics = (
        (
            await db.execute(
                select(ForumTopic).where(
                    ForumTopic.id.in_(payload.topic_ids),
                    ForumTopic.tenant_id == tenant_id,
                    ForumTopic.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    if len(topics) != len(set(payload.topic_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部分主题帖不存在")
    target_status = {
        "approve": "published",
        "changes": "changes_requested",
        "reject": "rejected",
    }[payload.action]
    items = [
        {
            "id": topic.id,
            "title": topic.title,
            "status": topic.moderation_status,
            "target_status": target_status,
            "will_change": topic.moderation_status != target_status,
            "risk_score": topic.risk_score,
            "signals": topic.moderation_signals or [],
            "review_eta_at": topic.review_eta_at,
        }
        for topic in topics
    ]
    return {
        "count": len(items),
        "action": payload.action,
        "will_change_count": sum(1 for item in items if item["will_change"]),
        "unchanged_count": sum(1 for item in items if not item["will_change"]),
        "items": items,
    }


@router.post("/moderation/batch")
async def batch_decide_topics(
    payload: ModerationBatchIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    tenant_id = require_tenant_id()
    await _require_moderator(db, current_user)
    if payload.action in ("reject", "changes") and len(payload.note.strip()) < 4:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="请写至少 4 个字的处理说明"
        )
    topics = (
        (
            await db.execute(
                select(ForumTopic).where(
                    ForumTopic.id.in_(payload.topic_ids),
                    ForumTopic.tenant_id == tenant_id,
                    ForumTopic.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    if len(topics) != len(set(payload.topic_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部分主题帖不存在")
    batch_id = payload.batch_id or uuid4().hex[:12]
    for topic in topics:
        await moderation.apply_decision(
            db,
            tenant_id=tenant_id,
            topic=topic,
            action=payload.action,
            note=payload.note.strip(),
            actor_id=current_user.id,
            batch_id=batch_id,
        )
    await db.commit()
    for topic in topics:
        await moderation.notify_author(
            db, tenant_id=tenant_id, topic=topic, action=payload.action, note=payload.note.strip()
        )
    return {"count": len(topics), "batch_id": batch_id}


@router.post("/moderation/batch/{batch_id}/undo")
async def undo_batch_decision(
    batch_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Compensating rollback for a batch, valid for ten minutes.

    History is never rewritten: a new ``batch_undo`` event is appended and the
    topic is restored to the status captured before the batch.
    """
    from app.domain.notifications import services as notifications

    tenant_id = require_tenant_id()
    await _require_moderator(db, current_user)
    cutoff = utcnow() - timedelta(minutes=10)
    events = (
        (
            await db.execute(
                select(ForumModerationEvent)
                .where(
                    ForumModerationEvent.tenant_id == tenant_id,
                    ForumModerationEvent.created_at >= cutoff,
                    ForumModerationEvent.action.in_(("approve", "reject", "changes")),
                )
                .order_by(ForumModerationEvent.created_at.desc(), ForumModerationEvent.id.desc())
            )
        )
        .scalars()
        .all()
    )
    latest: dict[int, ForumModerationEvent] = {}
    for event in events:
        if (event.meta or {}).get("batch_id") != batch_id:
            continue
        latest.setdefault(event.topic_id, event)
    if not latest:
        raise HTTPException(status_code=404, detail="该批次不存在或已超过 10 分钟撤销窗口")
    restored = 0
    for topic_id, event in latest.items():
        topic = (
            await db.execute(
                select(ForumTopic).where(
                    ForumTopic.id == topic_id,
                    ForumTopic.tenant_id == tenant_id,
                    ForumTopic.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if topic is None or topic.moderation_status != event.to_status:
            continue
        meta = event.meta or {}
        before = event.from_status or "published"
        topic.moderation_status = before
        topic.manual_review_reason = meta.get("from_manual_review_reason")
        topic.review_eta_at = (
            datetime.fromisoformat(meta["from_review_eta_at"])
            if meta.get("from_review_eta_at")
            else None
        )
        topic.published_at = (
            datetime.fromisoformat(meta["from_published_at"])
            if meta.get("from_published_at")
            else None
        )
        topic.reviewed_by = current_user.id
        topic.reviewed_at = utcnow()
        db.add(
            ForumModerationEvent(
                tenant_id=tenant_id,
                topic_id=topic.id,
                actor_id=current_user.id,
                action="batch_undo",
                from_status=event.to_status,
                to_status=before,
                note="批量处置撤销",
                meta={"batch_id": batch_id, "source_event_id": event.id},
                created_at=utcnow(),
            )
        )
        await notifications.create(
            db,
            tenant_id=tenant_id,
            user_id=topic.author_id,
            type_="forum.moderation",
            title=f"审核结果已撤销：{topic.title[:80]}",
            body="之前的一次批量处置已撤销，帖子状态恢复到操作前。",
            related_type="forum_topic",
            related_id=str(topic.id),
        )
        restored += 1
    await db.commit()
    return {"restored": restored}


@router.patch("/topics/{topic_id}/edit", response_model=TopicOut)
async def edit_topic(
    topic_id: int,
    payload: TopicEditRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TopicOut:
    """作者修改自己的帖子；锁定后只读，不能改。"""
    tenant_id = require_tenant_id()
    topic = (
        await db.execute(
            select(ForumTopic).where(
                ForumTopic.id == topic_id,
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")
    if topic.author_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能编辑自己的主题帖")
    if topic.is_locked:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="主题帖已锁定，不能再编辑")
    if (
        payload.title is None
        and payload.body is None
        and payload.board_id is None
        and payload.is_fictional is None
        and payload.paper_id is None
        and not payload.clear_paper
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="没有要修改的内容")
    if payload.paper_id is not None and payload.clear_paper:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="关联作品与清除关联不能同时提交",
        )

    new_title = payload.title.strip() if payload.title is not None else topic.title
    new_body = payload.body.strip() if payload.body is not None else topic.body
    if payload.title is not None or payload.body is not None:
        blocked = rejection_detail(f"{new_title}\n{new_body}")
        if blocked is not None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=blocked)

    new_category = topic.category
    new_board_id = topic.board_id
    if payload.board_id is not None:
        board = await _resolve_board(db, tenant_id, board_id=payload.board_id)
        if board is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="版块不存在")
        if not board.is_active:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="版块已关闭")
        new_board_id = board.id
        new_category = board.slug

    # Resolve the linkage before mutating the row: a rejected paper must not
    # leave a half-applied topic in the session.
    new_paper_id = topic.paper_id
    if payload.clear_paper:
        new_paper_id = None
    elif payload.paper_id is not None:
        paper = (
            await db.execute(
                select(Resource).where(
                    Resource.id == payload.paper_id,
                    Resource.tenant_id == tenant_id,
                    *public_conditions(),
                )
            )
        ).scalar_one_or_none()
        if paper is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="关联作品不存在或尚未公开",
            )
        new_paper_id = paper.id

    # 引文属于原来那篇作品：换作品或取消关联时，页边引文一并撤下。
    keep_passage = new_paper_id is not None and new_paper_id == topic.paper_id
    has_passage = keep_passage and bool(topic.passage_quote)
    if len(new_body) < 2 and not has_passage:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="正文至少 2 个字",
        )

    topic.title = new_title
    topic.body = new_body
    topic.board_id = new_board_id
    topic.category = new_category
    topic.paper_id = new_paper_id
    if not keep_passage:
        topic.passage_quote = None
        topic.passage_prefix = None
        topic.passage_suffix = None
    if payload.is_fictional is not None:
        topic.is_fictional = payload.is_fictional
    # 已公开或需修改的主题再次改正文时，重新进入人工核验，避免先通过再改成广告。
    if payload.title is not None or payload.body is not None:
        edit_board = (
            await _resolve_board(db, tenant_id, board_id=new_board_id)
            if new_board_id is not None
            else None
        )
        base_policy = await moderation.get_policy(db, tenant_id)
        policy = moderation.effective_policy(
            base_policy,
            board_slug=edit_board.slug if edit_board is not None else new_category,
            role="admin" if current_user.is_admin else current_user.role,
        )
        assessment = assess_text(
            new_title,
            new_body,
            manual_threshold=policy.manual_threshold,
            auto_publish_enabled=policy.auto_publish_enabled,
            sla_minutes=policy.sla_minutes,
            weights=policy.weights,
        )
        before_status = topic.moderation_status
        topic.moderation_status = "manual_review"
        topic.risk_score = assessment.risk_score
        topic.moderation_signals = [asdict(signal) for signal in assessment.signals]
        topic.manual_review_reason = assessment.reason
        topic.review_eta_at = utcnow() + timedelta(minutes=policy.sla_minutes)
        topic.sla_reminded_at = None
        topic.published_at = None
        await moderation.record_event(
            db,
            tenant_id=tenant_id,
            topic=topic,
            action="resubmitted",
            from_status=before_status,
            to_status="manual_review",
            actor_id=current_user.id,
            note="作者修改正文后重新提交，进入人工核验。",
            meta={"risk_score": assessment.risk_score},
        )
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action="forum.edit",
            target_type="forum_topic",
            target_id=str(topic.id),
            payload={"title": topic.title, "board_id": topic.board_id, "paper_id": topic.paper_id},
        )
    )
    await db.commit()
    await db.refresh(topic)
    authors = await _author_map(db, {topic.author_id})
    boards = await _board_index(db, tenant_id)
    return _topic_out(topic, authors, boards=boards, show_passage=True)


@router.patch("/topics/{topic_id}", response_model=TopicOut)
async def moderate_topic(
    topic_id: int,
    payload: ModerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TopicOut:
    """版主操作：置顶 / 锁定。"""
    await _require_moderator(db, current_user)
    tenant_id = require_tenant_id()
    topic = (
        await db.execute(
            select(ForumTopic).where(ForumTopic.id == topic_id, ForumTopic.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found")
    if payload.is_pinned is not None:
        topic.is_pinned = payload.is_pinned
    if payload.is_locked is not None:
        topic.is_locked = payload.is_locked
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action="forum.moderate",
            target_type="forum_topic",
            target_id=str(topic.id),
            payload={"is_pinned": topic.is_pinned, "is_locked": topic.is_locked},
        )
    )
    await db.commit()
    await db.refresh(topic)
    authors = await _author_map(db, {topic.author_id})
    boards = await _board_index(db, tenant_id)
    return _topic_out(topic, authors, boards=boards)


@router.get("/topics/{topic_id}/follow")
async def topic_follow_status(
    topic_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Whether the current user watches this topic, plus total watchers."""
    tenant_id = require_tenant_id()
    topic = (
        await db.execute(
            select(ForumTopic.id).where(
                ForumTopic.id == topic_id,
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")
    following = (
        await db.execute(
            select(ForumTopicFollow.id).where(
                ForumTopicFollow.tenant_id == tenant_id,
                ForumTopicFollow.user_id == current_user.id,
                ForumTopicFollow.topic_id == topic_id,
            )
        )
    ).scalar_one_or_none() is not None
    followers = (
        await db.execute(
            select(func.count(ForumTopicFollow.id)).where(
                ForumTopicFollow.tenant_id == tenant_id,
                ForumTopicFollow.topic_id == topic_id,
            )
        )
    ).scalar_one()
    return {"following": following, "followers_count": int(followers)}


@router.post("/topics/{topic_id}/follow", response_model=None)
async def follow_topic(
    topic_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Watch a topic. Idempotent: following twice is a no-op."""
    tenant_id = require_tenant_id()
    topic = (
        await db.execute(
            select(ForumTopic.id).where(
                ForumTopic.id == topic_id,
                ForumTopic.tenant_id == tenant_id,
                ForumTopic.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="主题帖不存在")
    existing = (
        await db.execute(
            select(ForumTopicFollow.id).where(
                ForumTopicFollow.tenant_id == tenant_id,
                ForumTopicFollow.user_id == current_user.id,
                ForumTopicFollow.topic_id == topic_id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            ForumTopicFollow(
                tenant_id=tenant_id,
                user_id=current_user.id,
                topic_id=topic_id,
            )
        )
        await db.commit()
    return await topic_follow_status(topic_id, current_user, db)


@router.delete("/topics/{topic_id}/follow", response_model=None)
async def unfollow_topic(
    topic_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Stop watching a topic. Idempotent: unfollowing twice is a no-op."""
    tenant_id = require_tenant_id()
    follow = (
        await db.execute(
            select(ForumTopicFollow).where(
                ForumTopicFollow.tenant_id == tenant_id,
                ForumTopicFollow.user_id == current_user.id,
                ForumTopicFollow.topic_id == topic_id,
            )
        )
    ).scalar_one_or_none()
    if follow is not None:
        await db.delete(follow)
        await db.commit()
    return await topic_follow_status(topic_id, current_user, db)


@router.delete("/topics/{topic_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic(
    topic_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """删除帖子（软删除）：作者本人或版主。"""
    tenant_id = require_tenant_id()
    topic = (
        await db.execute(
            select(ForumTopic).where(ForumTopic.id == topic_id, ForumTopic.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found")
    is_moderator = current_user.is_admin or await user_has_role(db, current_user, ROLE_EDITOR)
    if topic.author_id != current_user.id and not is_moderator:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除该帖")
    topic.deleted_at = utcnow()
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action="forum.delete",
            target_type="forum_topic",
            target_id=str(topic.id),
            payload={"moderator": is_moderator},
        )
    )
    await db.commit()


# ---------------------------------------------------------------------------
# 多维反馈（forum_reactions）
# ---------------------------------------------------------------------------


class ReactionToggle(BaseModel):
    target_type: Literal["topic", "reply"]
    target_id: int = Field(ge=1)
    kind: Literal["agree", "helpful", "bookmark"]


class ReactionOut(BaseModel):
    target_type: str
    target_id: int
    kind: str
    active: bool
    counts: dict[str, int]


@router.post("/reactions/toggle", response_model=ReactionOut)
async def toggle_reaction(
    payload: ReactionToggle,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReactionOut:
    """赞同 / 有帮助 / 收藏：再点一次取消。

    不做“反对/踩”。知乎的多维反馈里，赞同与感谢是两件事：前者是
    “我同意”，后者是“这对我有用”；收藏则是“以后还要回看”。这三件事
    对学术讨论都有意义，且不会把少数意见踩下去。
    """
    tenant_id = require_tenant_id()
    if payload.target_type == "topic":
        target = (
            await db.execute(
                select(ForumTopic).where(
                    ForumTopic.id == payload.target_id,
                    ForumTopic.tenant_id == tenant_id,
                    ForumTopic.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
    else:
        target = (
            await db.execute(
                select(ForumReply).where(
                    ForumReply.id == payload.target_id,
                    ForumReply.tenant_id == tenant_id,
                    ForumReply.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="反馈对象不存在")

    existing = (
        await db.execute(
            select(ForumReaction).where(
                ForumReaction.tenant_id == tenant_id,
                ForumReaction.user_id == current_user.id,
                ForumReaction.target_type == payload.target_type,
                ForumReaction.target_id == payload.target_id,
                ForumReaction.kind == payload.kind,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            ForumReaction(
                tenant_id=tenant_id,
                user_id=current_user.id,
                target_type=payload.target_type,
                target_id=payload.target_id,
                kind=payload.kind,
            )
        )
        active = True
    else:
        await db.delete(existing)
        active = False
    await db.commit()

    counts, _ = await _reaction_summary(
        db,
        target_type=payload.target_type,
        target_ids=[payload.target_id],
        viewer_id=None,
    )
    return ReactionOut(
        target_type=payload.target_type,
        target_id=payload.target_id,
        kind=payload.kind,
        active=active,
        counts=counts.get(payload.target_id, {k: 0 for k in REACTION_KINDS}),
    )


# ---------------------------------------------------------------------------
# 举报（forum_reports）
# ---------------------------------------------------------------------------


class ReportCreate(BaseModel):
    topic_id: int | None = None
    reply_id: int | None = None
    reason: str = Field(default="", max_length=200)


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    topic_id: int | None
    reply_id: int | None
    reason: str
    status: str
    created_at: datetime
    resolved_at: datetime | None = None
    source: str = "forum"
    target_type: str | None = None
    target_id: int | None = None
    target_excerpt: str | None = None
    target_author: AuthorBrief | None = None
    reporter: AuthorBrief | None = None


@router.post("/reports", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
async def create_report(
    payload: ReportCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReportOut:
    """举报帖子或回复。登录即可。

    幂等：同一用户对同一对象（topic 或 reply）已有 open 举报时直接返回
    已存在的记录（HTTP 200 语义上是"已存在"，但用 201 也无妨——
    这里统一用 200 让前端区分"新提交"与"重复提交"）。
    """
    tenant_id = require_tenant_id()
    if payload.topic_id is None and payload.reply_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="必须指定 topic_id 或 reply_id",
        )
    # 校验目标存在且未软删
    if payload.topic_id is not None:
        topic = (
            await db.execute(
                select(ForumTopic).where(
                    ForumTopic.id == payload.topic_id,
                    ForumTopic.tenant_id == tenant_id,
                    ForumTopic.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if topic is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found")
    if payload.reply_id is not None:
        reply = (
            await db.execute(
                select(ForumReply).where(
                    ForumReply.id == payload.reply_id,
                    ForumReply.tenant_id == tenant_id,
                    ForumReply.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if reply is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reply not found")

    # 幂等：查同一用户对同一对象是否已有 open 记录
    target_clause = (
        ForumReport.reply_id == payload.reply_id
        if payload.reply_id is not None
        else ForumReport.topic_id == payload.topic_id
    )
    existing = (
        await db.execute(
            select(ForumReport).where(
                ForumReport.tenant_id == tenant_id,
                ForumReport.reporter_id == current_user.id,
                ForumReport.status == "open",
                target_clause,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        # 重复举报：返回 200 + 已有记录，前端 toast 提示"已举报过"
        authors = await _author_map(db, {current_user.id})
        return ReportOut(
            id=existing.id,
            topic_id=existing.topic_id,
            reply_id=existing.reply_id,
            reason=existing.reason,
            status=existing.status,
            created_at=existing.created_at,
            resolved_at=existing.resolved_at,
            target_type="reply" if existing.reply_id else "topic",
            reporter=authors.get(current_user.id),
        )

    report = ForumReport(
        tenant_id=tenant_id,
        reporter_id=current_user.id,
        topic_id=payload.topic_id,
        reply_id=payload.reply_id,
        reason=payload.reason.strip()[:200],
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    authors = await _author_map(db, {current_user.id})
    return ReportOut(
        id=report.id,
        topic_id=report.topic_id,
        reply_id=report.reply_id,
        reason=report.reason,
        status=report.status,
        created_at=report.created_at,
        resolved_at=report.resolved_at,
        target_type="reply" if report.reply_id else "topic",
        reporter=authors.get(current_user.id),
    )


@router.get("/reports", response_model=list[ReportOut])
async def list_reports(
    status_filter: str | None = Query(default="open", pattern=r"^(open|resolved|rejected)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[ReportOut]:
    """管理端：查看举报队列。仅管理员。"""
    tenant_id = require_tenant_id()
    stmt = select(ForumReport).where(ForumReport.tenant_id == tenant_id)
    if status_filter:
        stmt = stmt.where(ForumReport.status == status_filter)
    stmt = stmt.order_by(ForumReport.created_at.desc()).limit(200)
    rows = (await db.execute(stmt)).scalars().all()
    topic_ids = {r.topic_id for r in rows if r.topic_id}
    reply_ids = {r.reply_id for r in rows if r.reply_id}
    topics = (
        {
            t.id: t
            for t in (await db.execute(select(ForumTopic).where(ForumTopic.id.in_(topic_ids))))
            .scalars()
            .all()
        }
        if topic_ids
        else {}
    )
    replies = (
        {
            r.id: r
            for r in (await db.execute(select(ForumReply).where(ForumReply.id.in_(reply_ids))))
            .scalars()
            .all()
        }
        if reply_ids
        else {}
    )
    target_author_ids = {
        *(t.author_id for t in topics.values()),
        *(r.author_id for r in replies.values()),
    }
    authors = await _author_map(db, {r.reporter_id for r in rows} | target_author_ids)
    out: list[ReportOut] = []
    for r in rows:
        topic = topics.get(r.topic_id) if r.topic_id else None
        reply = replies.get(r.reply_id) if r.reply_id else None
        target = topic or reply
        excerpt = None
        if topic is not None:
            excerpt = f"{topic.title} · {topic.body[:120]}"
        elif reply is not None:
            excerpt = reply.body[:140]
        out.append(
            ReportOut(
                id=r.id,
                topic_id=r.topic_id,
                reply_id=r.reply_id,
                reason=r.reason,
                status=r.status,
                created_at=r.created_at,
                resolved_at=r.resolved_at,
                target_type="reply" if reply is not None else "topic",
                target_excerpt=excerpt,
                target_author=authors.get(target.author_id) if target is not None else None,
                reporter=authors.get(r.reporter_id),
            )
        )
    # 合并评论/发布举报：与论坛举报同一队列、同一套处置动作。
    from app.domain.comments.models import Comment
    from app.domain.submission.models import Submission
    from app.models import ContentReport

    content_stmt = select(ContentReport).where(ContentReport.tenant_id == tenant_id)
    if status_filter:
        content_stmt = content_stmt.where(ContentReport.status == status_filter)
    content_rows = (
        (await db.execute(content_stmt.order_by(ContentReport.created_at.desc()).limit(200)))
        .scalars()
        .all()
    )
    comment_ids = {r.target_id for r in content_rows if r.target_type == "comment"}
    submission_ids = {r.target_id for r in content_rows if r.target_type == "submission"}
    comments = (
        {
            c.id: c
            for c in (await db.execute(select(Comment).where(Comment.id.in_(comment_ids))))
            .scalars()
            .all()
        }
        if comment_ids
        else {}
    )
    submissions = (
        {
            x.id: x
            for x in (await db.execute(select(Submission).where(Submission.id.in_(submission_ids))))
            .scalars()
            .all()
        }
        if submission_ids
        else {}
    )
    content_author_ids = {
        *(c.user_id for c in comments.values()),
        *(x.submitted_by for x in submissions.values()),
    }
    content_authors = await _author_map(
        db, {r.reporter_id for r in content_rows} | content_author_ids
    )
    for r in content_rows:
        author_id: int | None = None
        excerpt: str | None = None
        if r.target_type == "comment":
            comment = comments.get(r.target_id)
            if comment is not None:
                author_id = comment.user_id
                excerpt = comment.body[:140]
        else:
            submission = submissions.get(r.target_id)
            if submission is not None:
                author_id = submission.submitted_by
                excerpt = f"{submission.title} · {submission.abstract[:120]}"
        out.append(
            ReportOut(
                id=r.id,
                topic_id=None,
                reply_id=None,
                source="content",
                target_type=r.target_type,
                target_id=r.target_id,
                reason=r.reason,
                status=r.status,
                created_at=r.created_at,
                resolved_at=r.resolved_at,
                target_excerpt=excerpt,
                target_author=content_authors.get(author_id) if author_id else None,
                reporter=content_authors.get(r.reporter_id),
            )
        )
    return out


class ContentReportCreate(BaseModel):
    target_type: Literal["comment", "submission"]
    target_id: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=200)


@router.post("/content-reports", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
async def create_content_report(
    payload: ContentReportCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReportOut:
    """举报评论或发布。登录即可；同一用户同一对象只保留一条 open。"""
    from app.domain.comments.models import Comment
    from app.domain.submission.models import Submission
    from app.models import ContentReport

    tenant_id = require_tenant_id()
    target_author_id: int
    excerpt: str
    if payload.target_type == "comment":
        target = (
            await db.execute(
                select(Comment).where(
                    Comment.id == payload.target_id, Comment.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if target is None or target.status == "rejected":
            raise HTTPException(status_code=404, detail="评论不存在")
        target_author_id = target.user_id
        excerpt = target.body[:140]
    else:
        target = (
            await db.execute(
                select(Submission).where(
                    Submission.id == payload.target_id,
                    Submission.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if target is None:
            raise HTTPException(status_code=404, detail="作品不存在")
        is_staff = current_user.is_admin or await user_has_role(db, current_user, ROLE_EDITOR)
        if target.submitted_by != current_user.id and not is_staff:
            raise HTTPException(status_code=403, detail="无权举报该作品")
        target_author_id = target.submitted_by
        excerpt = f"{target.title} · {target.abstract[:120]}"
    if target_author_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能举报自己的内容")

    existing = (
        (
            await db.execute(
                select(ContentReport).where(
                    ContentReport.tenant_id == tenant_id,
                    ContentReport.reporter_id == current_user.id,
                    ContentReport.target_type == payload.target_type,
                    ContentReport.target_id == payload.target_id,
                    ContentReport.status == "open",
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        authors = await _author_map(db, {existing.reporter_id, target_author_id})
        return ReportOut(
            id=existing.id,
            topic_id=None,
            reply_id=None,
            source="content",
            target_type=existing.target_type,
            target_id=existing.target_id,
            reason=existing.reason,
            status=existing.status,
            created_at=existing.created_at,
            resolved_at=existing.resolved_at,
            target_excerpt=excerpt,
            target_author=authors.get(target_author_id),
            reporter=authors.get(existing.reporter_id),
        )

    report = ContentReport(
        tenant_id=tenant_id,
        reporter_id=current_user.id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        reason=payload.reason.strip(),
        status="open",
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    authors = await _author_map(db, {current_user.id, target_author_id})
    return ReportOut(
        id=report.id,
        topic_id=None,
        reply_id=None,
        source="content",
        target_type=report.target_type,
        target_id=report.target_id,
        reason=report.reason,
        status=report.status,
        created_at=report.created_at,
        resolved_at=report.resolved_at,
        target_excerpt=excerpt,
        target_author=authors.get(target_author_id),
        reporter=authors.get(report.reporter_id),
    )


@router.patch("/content-reports/{report_id}", response_model=ReportOut)
async def handle_content_report(
    report_id: int,
    payload: ReportAction,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ReportOut:
    """评论/发布举报处置：驳回 / 下架 / 停用作者。"""
    from app.domain.comments.models import Comment
    from app.domain.submission.models import Submission
    from app.models import ContentReport

    tenant_id = require_tenant_id()
    report = (
        await db.execute(
            select(ContentReport).where(
                ContentReport.id == report_id, ContentReport.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=404, detail="举报不存在")
    if report.status != "open":
        raise HTTPException(status_code=409, detail="该举报已处理")
    author: User | None = None
    excerpt: str | None = None
    if report.target_type == "comment":
        target = (
            await db.execute(
                select(Comment).where(
                    Comment.id == report.target_id, Comment.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if target is None:
            raise HTTPException(status_code=404, detail="被举报评论已被删除")
        author = (
            await db.execute(select(User).where(User.id == target.user_id))
        ).scalar_one_or_none()
        excerpt = target.body[:140]
    else:
        target = (
            await db.execute(
                select(Submission).where(
                    Submission.id == report.target_id, Submission.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if target is None:
            raise HTTPException(status_code=404, detail="被举报作品已被删除")
        author = (
            await db.execute(select(User).where(User.id == target.submitted_by))
        ).scalar_one_or_none()
        excerpt = f"{target.title} · {target.abstract[:120]}"

    now = utcnow()
    if payload.action == "dismiss":
        report.status = "rejected"
    else:
        if report.target_type == "comment":
            target.status = "rejected"
            target.moderated_by = current_user.id
            target.moderated_at = now
            target.moderation_note = payload.note
        else:
            target.status = "rejected"
            target.admin_note = payload.note or "举报处置：下架"
            target.reviewed_at = now
        report.status = "resolved"
    report.resolved_at = now
    if payload.action == "suspend_author" and author is not None:
        if author.id != current_user.id:
            author.is_active = False
            author.token_version = (author.token_version or 0) + 1
            db.add(
                AuditLog(
                    tenant_id=tenant_id,
                    actor_user_id=current_user.id,
                    action="content.report.suspend_author",
                    target_type="user",
                    target_id=str(author.id),
                    payload={"report_id": report.id, "note": payload.note},
                )
            )
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action=f"content.report.{payload.action}",
            target_type=report.target_type,
            target_id=str(report.target_id),
            payload={"report_id": report.id, "note": payload.note},
        )
    )
    await db.commit()
    await db.refresh(report)
    authors = await _author_map(
        db, {report.reporter_id, author.id} if author is not None else {report.reporter_id}
    )
    return ReportOut(
        id=report.id,
        topic_id=None,
        reply_id=None,
        source="content",
        target_type=report.target_type,
        target_id=report.target_id,
        reason=report.reason,
        status=report.status,
        created_at=report.created_at,
        resolved_at=report.resolved_at,
        target_excerpt=excerpt,
        target_author=authors.get(author.id) if author is not None else None,
        reporter=authors.get(report.reporter_id),
    )


class ReportAction(BaseModel):
    action: Literal["dismiss", "remove_content", "suspend_author"]
    note: str | None = Field(default=None, max_length=500)


@router.patch("/reports/{report_id}", response_model=ReportOut)
async def handle_report(
    report_id: int,
    payload: ReportAction,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ReportOut:
    """举报处置：驳回 / 移除内容 / 暂停作者账号。

    - dismiss：举报不成立，标记 rejected，不动内容；
    - remove_content：软删被举报帖子或回复，标记 resolved；
    - suspend_author：停用被举报内容作者（token_version+1，立即踢下线），
      并移除内容。处罚本身写 AuditLog，后台可追溯。
    """
    tenant_id = require_tenant_id()
    report = (
        await db.execute(
            select(ForumReport).where(
                ForumReport.id == report_id, ForumReport.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=404, detail="举报不存在")
    if report.status != "open":
        raise HTTPException(status_code=409, detail="该举报已处理")

    topic = None
    reply = None
    if report.topic_id:
        topic = (
            await db.execute(
                select(ForumTopic).where(
                    ForumTopic.id == report.topic_id, ForumTopic.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
    if report.reply_id:
        reply = (
            await db.execute(
                select(ForumReply).where(
                    ForumReply.id == report.reply_id, ForumReply.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
    target = topic or reply
    if target is None:
        raise HTTPException(status_code=404, detail="被举报内容已被删除")

    now = utcnow()
    action = payload.action
    if action == "dismiss":
        report.status = "rejected"
        report.resolved_at = now
    else:
        if topic is not None:
            topic.deleted_at = now
        if reply is not None:
            reply.deleted_at = now
        report.status = "resolved"
        report.resolved_at = now
    if action == "suspend_author":
        author = (
            await db.execute(select(User).where(User.id == target.author_id))
        ).scalar_one_or_none()
        if author is not None and author.id != current_user.id:
            author.is_active = False
            author.token_version = (author.token_version or 0) + 1
            db.add(
                AuditLog(
                    tenant_id=tenant_id,
                    actor_user_id=current_user.id,
                    action="forum.report.suspend_author",
                    target_type="user",
                    target_id=str(author.id),
                    payload={"report_id": report.id, "note": payload.note},
                )
            )
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action=f"forum.report.{action}",
            target_type="forum_report",
            target_id=str(report.id),
            payload={
                "topic_id": report.topic_id,
                "reply_id": report.reply_id,
                "note": payload.note,
            },
        )
    )
    await db.commit()
    await db.refresh(report)
    authors = await _author_map(db, {report.reporter_id, target.author_id})
    excerpt = (
        f"{topic.title} · {topic.body[:120]}"
        if topic is not None
        else (reply.body[:140] if reply is not None else None)
    )
    return ReportOut(
        id=report.id,
        topic_id=report.topic_id,
        reply_id=report.reply_id,
        reason=report.reason,
        status=report.status,
        created_at=report.created_at,
        resolved_at=report.resolved_at,
        target_type="reply" if reply is not None else "topic",
        target_excerpt=excerpt,
        target_author=authors.get(target.author_id),
        reporter=authors.get(report.reporter_id),
    )


# ---------------------------------------------------------------------------
# 版块管理（管理员）
# ---------------------------------------------------------------------------

_BOARD_SLUG = re.compile(r"^[a-z0-9-]{2,40}$")


class BoardCreate(BaseModel):
    parent_id: int | None = Field(default=None, ge=1)
    slug: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=200)
    sort_order: int = Field(default=0, ge=0, le=9999)
    is_active: bool = True


class BoardUpdate(BaseModel):
    parent_id: int | None = Field(default=None, ge=1)
    slug: str | None = Field(default=None, min_length=2, max_length=40)
    name: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=200)
    sort_order: int | None = Field(default=None, ge=0, le=9999)
    is_active: bool | None = None


@router.get("/admin/boards")
async def admin_list_boards(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict[str, object]:
    """管理员版块列表（含停用项，方便恢复）。"""
    tenant_id = require_tenant_id()
    rows = (
        (
            await db.execute(
                select(ForumBoard)
                .where(ForumBoard.tenant_id == tenant_id)
                .order_by(ForumBoard.sort_order, ForumBoard.id)
            )
        )
        .scalars()
        .all()
    )
    return {
        "data": [
            {
                "id": b.id,
                "parent_id": b.parent_id,
                "slug": b.slug,
                "name": b.name,
                "description": b.description,
                "sort_order": b.sort_order,
                "is_active": b.is_active,
            }
            for b in rows
        ]
    }


@router.post("/admin/boards", status_code=status.HTTP_201_CREATED)
async def create_board(
    payload: BoardCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    tenant_id = require_tenant_id()
    slug = payload.slug.strip().lower()
    if not _BOARD_SLUG.match(slug):
        raise HTTPException(status_code=422, detail="slug 只能是小写字母、数字、连字符（2-40 位）")
    if payload.parent_id is not None:
        parent = (
            await db.execute(
                select(ForumBoard).where(
                    ForumBoard.id == payload.parent_id, ForumBoard.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if parent is None:
            raise HTTPException(status_code=404, detail="父版块不存在")
    exists = (
        await db.execute(
            select(ForumBoard.id).where(ForumBoard.tenant_id == tenant_id, ForumBoard.slug == slug)
        )
    ).scalar_one_or_none()
    if exists is not None:
        raise HTTPException(status_code=409, detail="slug 已存在")
    board = ForumBoard(
        tenant_id=tenant_id,
        parent_id=payload.parent_id,
        slug=slug,
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
        sort_order=payload.sort_order,
        is_active=payload.is_active,
    )
    db.add(board)
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action="forum.board.create",
            target_type="forum_board",
            target_id=slug,
            payload={"name": board.name, "parent_id": payload.parent_id},
        )
    )
    await db.commit()
    await db.refresh(board)
    return {
        "id": board.id,
        "parent_id": board.parent_id,
        "slug": board.slug,
        "name": board.name,
        "description": board.description,
        "sort_order": board.sort_order,
        "is_active": board.is_active,
    }


@router.patch("/admin/boards/{board_id}")
async def update_board(
    board_id: int,
    payload: BoardUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    tenant_id = require_tenant_id()
    board = (
        await db.execute(
            select(ForumBoard).where(ForumBoard.id == board_id, ForumBoard.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=404, detail="版块不存在")
    before = {
        "parent_id": board.parent_id,
        "slug": board.slug,
        "name": board.name,
        "description": board.description,
        "sort_order": board.sort_order,
        "is_active": board.is_active,
    }
    if payload.parent_id is not None:
        if payload.parent_id == board.id:
            raise HTTPException(status_code=422, detail="版块不能挂到自己下面")
        parent = (
            await db.execute(
                select(ForumBoard).where(
                    ForumBoard.id == payload.parent_id, ForumBoard.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if parent is None:
            raise HTTPException(status_code=404, detail="父版块不存在")
        # 防环：父链上不能出现自己
        cursor: ForumBoard | None = parent
        seen: set[int] = set()
        while cursor is not None and cursor.id not in seen:
            if cursor.id == board.id:
                raise HTTPException(status_code=422, detail="父版块会形成循环")
            seen.add(cursor.id)
            cursor = (
                (
                    await db.execute(
                        select(ForumBoard).where(
                            ForumBoard.id == cursor.parent_id,
                            ForumBoard.tenant_id == tenant_id,
                        )
                    )
                ).scalar_one_or_none()
                if cursor.parent_id
                else None
            )
        board.parent_id = payload.parent_id
    if payload.name is not None:
        board.name = payload.name.strip()
    if payload.description is not None:
        board.description = payload.description.strip() or None
    if payload.sort_order is not None:
        board.sort_order = payload.sort_order
    if payload.is_active is not None:
        board.is_active = payload.is_active
    if payload.slug is not None:
        slug = payload.slug.strip().lower()
        if not _BOARD_SLUG.match(slug):
            raise HTTPException(
                status_code=422, detail="slug 只能是小写字母、数字、连字符（2-40 位）"
            )
        if slug != board.slug:
            exists = (
                await db.execute(
                    select(ForumBoard.id).where(
                        ForumBoard.tenant_id == tenant_id, ForumBoard.slug == slug
                    )
                )
            ).scalar_one_or_none()
            if exists is not None:
                raise HTTPException(status_code=409, detail="slug 已存在")
            board.slug = slug
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action="forum.board.update",
            target_type="forum_board",
            target_id=str(board.id),
            payload={
                "before": before,
                "after": {
                    "parent_id": board.parent_id,
                    "slug": board.slug,
                    "name": board.name,
                    "description": board.description,
                    "sort_order": board.sort_order,
                    "is_active": board.is_active,
                },
            },
        )
    )
    await db.commit()
    await db.refresh(board)
    return {
        "id": board.id,
        "parent_id": board.parent_id,
        "slug": board.slug,
        "name": board.name,
        "description": board.description,
        "sort_order": board.sort_order,
        "is_active": board.is_active,
    }


@router.delete("/admin/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(
    board_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    """删除空版块；有子版块或帖子时拒绝，避免帖子失去归属。"""
    tenant_id = require_tenant_id()
    board = (
        await db.execute(
            select(ForumBoard).where(ForumBoard.id == board_id, ForumBoard.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=404, detail="版块不存在")
    child_count = (
        await db.execute(
            select(func.count(ForumBoard.id)).where(
                ForumBoard.tenant_id == tenant_id, ForumBoard.parent_id == board.id
            )
        )
    ).scalar_one()
    topic_count = (
        await db.execute(
            select(func.count(ForumTopic.id)).where(
                ForumTopic.tenant_id == tenant_id, ForumTopic.board_id == board.id
            )
        )
    ).scalar_one()
    if child_count or topic_count:
        raise HTTPException(
            status_code=409,
            detail=f"版块下还有 {int(child_count)} 个子版块、{int(topic_count)} 个主题帖，不能直接删除",
        )
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action="forum.board.delete",
            target_type="forum_board",
            target_id=str(board.id),
            payload={"slug": board.slug, "name": board.name},
        )
    )
    await db.delete(board)
    await db.commit()


# ---------------------------------------------------------------------------
# 新手任务与社区信用
# ---------------------------------------------------------------------------


@router.get("/starter")
async def get_forum_starter(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """新手四项的完成度与奖励领取状态。登录后即可查看。"""
    return await engagement.starter_summary(db, current_user)


@router.post("/starter/claim")
async def claim_forum_starter(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """四项都完成后领取 25 经验；重复领取只返回现状，不重复发奖。"""
    summary = await engagement.starter_summary(db, current_user)
    if summary["claimed"]:
        return summary
    if not summary["all_done"]:
        missing = summary["total"] - summary["completed"]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"还有 {missing} 项没完成，完成后才能领取",
        )
    from app.domain.gamification import service as gamification

    await gamification.award(
        db,
        current_user,
        engagement.NEWBIE_REWARD_ACTION,
        ref_type=engagement.NEWBIE_REF_TYPE,
        ref_id=engagement.NEWBIE_REF_ID,
        note="完成论坛新手四项",
    )
    await gamification.evaluate_badges(db, current_user)
    await db.commit()
    return await engagement.starter_summary(db, current_user)


@router.get("/credit/me")
async def get_my_forum_credit(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """我的社区信用：分数、等级与最近的加减分来源。"""
    return await engagement.credit_summary(db, current_user)
