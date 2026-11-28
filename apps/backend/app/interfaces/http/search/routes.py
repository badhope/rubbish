# mypy: ignore-errors
"""One query, four public result kinds.

The old search page joined two unrelated APIs in the browser: catalog results
came from ``/catalog`` and threads from ``/forum/topics``. That made counts
inconsistent, hid authors and tags, and left no single place to explain what
"result" meant. This router keeps the same source tables but computes the four
public surfaces under one tenant check and one response envelope.

It is a projection, not a second index: no shadow table, no write path, no
ranking model that claims more than the data can support. Title matches sort
first; everything else falls back to recency.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Text, case, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_optional, require_tenant_id
from app.core.db import get_db
from app.domain.catalog.models import Resource
from app.domain.catalog.visibility import public_conditions
from app.domain.follows.models import AuthorFollow
from app.domain.forum.models import ForumTopic
from app.interfaces.http.explore.routes import (
    ExploreResourceCard,
    ExploreTopicCard,
    _resource_cards,
    _topic_cards,
)
from app.models import User

router = APIRouter(prefix="/search", tags=["search"])

SearchKind = Literal["all", "resources", "topics", "people", "tags"]
_VISIBLE_TOPIC_STATUS = ("published", "auto_approved", "approved")


class SearchPersonCard(BaseModel):
    username: str
    display_name: str | None = None
    avatar_url: str | None = None
    bio: str | None = None
    affiliation: str | None = None
    works: int = 0
    followers: int = 0
    # 科目领域是公开资料；审稿领域绝不进入检索卡片。
    subject_disciplines: list[str] = []


class SearchTagCard(BaseModel):
    name: str
    count: int


class SearchTotals(BaseModel):
    resources: int
    topics: int
    people: int
    tags: int


class SearchMeta(BaseModel):
    query: str
    kind: SearchKind
    page: int
    page_size: int
    totals: SearchTotals


class SearchResponse(BaseModel):
    resources: list[ExploreResourceCard]
    topics: list[ExploreTopicCard]
    people: list[SearchPersonCard]
    tags: list[SearchTagCard]
    meta: SearchMeta


def _resource_match(q: str):
    like = f"%{q}%"
    return [
        Resource.tenant_id == require_tenant_id(),
        *public_conditions(),
        or_(
            Resource.title.ilike(like),
            Resource.short_title.ilike(like),
            Resource.abstract.ilike(like),
            Resource.preview.ilike(like),
            Resource.editor_note.ilike(like),
            Resource.discipline.ilike(like),
            Resource.doi.ilike(like),
            cast(Resource.authors, Text).ilike(like),
            cast(Resource.tags, Text).ilike(like),
        ),
    ]


def _topic_match(q: str):
    like = f"%{q}%"
    return [
        ForumTopic.tenant_id == require_tenant_id(),
        ForumTopic.deleted_at.is_(None),
        or_(
            ForumTopic.moderation_status.in_(_VISIBLE_TOPIC_STATUS),
            ForumTopic.moderation_status.is_(None),
        ),
        or_(ForumTopic.title.ilike(like), ForumTopic.body.ilike(like)),
    ]


def _people_match(q: str | None, discipline: str | None = None):
    conditions = [
        User.tenant_id == require_tenant_id(),
        User.is_active.is_(True),
        User.deleted_at.is_(None),
        User.profile_visibility == "public",
    ]
    if q:
        like = f"%{q}%"
        conditions.append(
            or_(
                User.username.ilike(like),
                User.display_name.ilike(like),
                User.bio.ilike(like),
                User.affiliation.ilike(like),
                User.research_interests.ilike(like),
            )
        )
    if discipline:
        # JSONB 序列化后 slug 一定带双引号；用带引号的精确片段匹配，
        # 避免 ``computer-science`` 误命中 ``computer-science-education``。
        conditions.append(
            cast(User.subject_disciplines, Text).ilike(f'%"{discipline}"%')
        )
    return conditions


async def _count(db: AsyncSession, stmt) -> int:
    return int((await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one())


async def _people_cards(db: AsyncSession, users: list[User]) -> list[SearchPersonCard]:
    if not users:
        return []
    user_ids = [row.id for row in users]
    works_rows = (
        await db.execute(
            select(Resource.owner_id, func.count(Resource.id))
            .where(
                Resource.tenant_id == users[0].tenant_id,
                Resource.owner_id.in_(user_ids),
                *public_conditions(),
            )
            .group_by(Resource.owner_id)
        )
    ).all()
    works = {int(owner): int(count) for owner, count in works_rows if owner is not None}
    names = [name for row in users for name in (row.display_name, row.username) if name]
    follower_rows = (
        await db.execute(
            select(AuthorFollow.author_name, func.count(AuthorFollow.id))
            .where(
                AuthorFollow.tenant_id == users[0].tenant_id,
                AuthorFollow.author_name.in_(names),
            )
            .group_by(AuthorFollow.author_name)
        )
    ).all()
    followers_by_name = {str(name): int(count) for name, count in follower_rows}
    out: list[SearchPersonCard] = []
    for row in users:
        followers = sum(followers_by_name.get(name, 0) for name in (row.display_name, row.username) if name)
        out.append(
            SearchPersonCard(
                username=row.username,
                display_name=row.display_name,
                avatar_url=row.avatar_url,
                bio=row.bio,
                affiliation=row.affiliation,
                works=works.get(row.id, 0),
                followers=followers,
                subject_disciplines=list(row.subject_disciplines or []),
            )
        )
    return out


async def _tag_cards(db: AsyncSession, q: str, *, limit: int = 500) -> list[SearchTagCard]:
    """Tag facets are small enough to collapse in Python.

    ``tags`` is a JSON column and its textual representation differs between
    PostgreSQL JSONB and SQLite JSON. Scanning the public tag lists keeps the
    same semantics on both backends; the catalog facets endpoint does the same
    for the unfiltered tag cloud.
    """
    tenant_id = require_tenant_id()
    rows = (
        await db.execute(
            select(Resource.tags)
            .where(
                Resource.tenant_id == tenant_id,
                *public_conditions(),
            )
            .limit(10000)
        )
    ).scalars().all()
    counts: dict[str, int] = {}
    lowered = q.casefold()
    for group in rows:
        for tag in group or []:
            name = str(tag).strip()
            if name and lowered in name.casefold():
                counts[name] = counts.get(name, 0) + 1
    return [SearchTagCard(name=name, count=count) for name, count in counts.items()][:limit]


@router.get("", response_model=SearchResponse)
async def search(
    q: str | None = Query(default=None, max_length=80),
    discipline: str | None = Query(
        default=None,
        max_length=100,
        pattern=r"^[a-z0-9][a-z0-9-]{0,99}$",
    ),
    kind: SearchKind = Query(default="all", alias="type"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=8, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    _viewer: User | None = Depends(get_current_user_optional),
) -> SearchResponse:
    """Search public works, threads, members and tags in one request.

    ``type=all`` returns a short preview of each surface for the landing view.
    A specific type pages that surface while still returning every count, so
    the tab bar never has to guess.

    ``discipline`` lets a field page ask "who works in this area?" without a
    keyword. When supplied alone, only the member surface is populated; works
    and topics still need a text query.
    """
    text = (q or "").strip()
    if not text and not discipline:
        raise HTTPException(status_code=422, detail="检索词不能为空")

    resource_stmt = select(Resource.id).where(*_resource_match(text)) if text else None
    topic_stmt = select(ForumTopic.id).where(*_topic_match(text)) if text else None
    people_stmt = select(User.id).where(*_people_match(text or None, discipline))
    tags_all = await _tag_cards(db, text) if text else []

    total_resources = await _count(db, resource_stmt) if resource_stmt is not None else 0
    total_topics = await _count(db, topic_stmt) if topic_stmt is not None else 0
    total_people = await _count(db, people_stmt)
    totals = SearchTotals(
        resources=total_resources,
        topics=total_topics,
        people=total_people,
        tags=len(tags_all),
    )

    preview = kind == "all"
    per_kind = min(page_size, 6) if preview else page_size
    offset = 0 if preview else (page - 1) * page_size

    resources: list[ExploreResourceCard] = []
    if text and kind in ("all", "resources") and total_resources:
        like = f"%{text}%"
        resource_rows = (
            await db.execute(
                select(Resource)
                .where(*_resource_match(text))
                .order_by(
                    case(
                        (Resource.short_title.ilike(like), 0),
                        (Resource.title.ilike(like), 1),
                        else_=2,
                    ),
                    func.coalesce(Resource.publish_at, Resource.created_at).desc(),
                    Resource.id.desc(),
                )
                .offset(offset)
                .limit(per_kind)
            )
        ).scalars().all()
        resources = await _resource_cards(db, resource_rows, limit=per_kind)

    topics: list[ExploreTopicCard] = []
    if text and kind in ("all", "topics") and total_topics:
        like = f"%{text}%"
        topic_rows = (
            await db.execute(
                select(ForumTopic)
                .where(*_topic_match(text))
                .order_by(
                    case((ForumTopic.title.ilike(like), 0), else_=1),
                    func.coalesce(ForumTopic.last_reply_at, ForumTopic.created_at).desc(),
                )
                .offset(offset)
                .limit(per_kind)
            )
        ).scalars().all()
        topics = await _topic_cards(db, topic_rows, limit=per_kind)

    people: list[SearchPersonCard] = []
    if kind in ("all", "people") and total_people:
        order_by = [User.username]
        if text:
            order_by = [
                case(
                    (User.username.ilike(f"%{text}%"), 0),
                    (User.display_name.ilike(f"%{text}%"), 1),
                    else_=2,
                ),
                User.username,
            ]
        user_rows = (
            await db.execute(
                select(User)
                .where(*_people_match(text or None, discipline))
                .order_by(*order_by)
                .offset(offset)
                .limit(per_kind)
            )
        ).scalars().all()
        people = await _people_cards(db, user_rows)

    tags: list[SearchTagCard] = []
    if kind in ("all", "tags"):
        tags = tags_all[:per_kind] if preview else tags_all[offset : offset + page_size]

    return SearchResponse(
        resources=resources,
        topics=topics,
        people=people,
        tags=tags,
        meta=SearchMeta(
            query=text,
            kind=kind,
            page=page,
            page_size=per_kind,
            totals=totals,
        ),
    )


__all__ = ["router"]
