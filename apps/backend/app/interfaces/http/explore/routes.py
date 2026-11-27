# mypy: ignore-errors
"""Discovery surface: what is worth reading, who is writing, and what is moving.

The data already exists in catalog, forum, follows, library and reader. This
router is a read-only projection, not a second source of truth. It keeps the
home page editorial and gives readers a second, more social entrance.

No new tables and no background recomputation: the catalogue is small enough
that one bounded scan + the existing engagement helper is cheaper than keeping
a denormalised "hot" table in sync.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_current_user_optional, require_tenant_id
from app.core.db import get_db
from app.core.time import utcnow
from app.domain.catalog.engagement import load_raw_engagement
from app.domain.catalog.models import Resource
from app.domain.catalog.visibility import public_conditions
from app.domain.follows.models import AuthorFollow, DisciplineSubscription
from app.domain.forum.models import ForumReaction, ForumTopic, ForumTopicFollow
from app.models import User

router = APIRouter(prefix="/explore", tags=["explore"])


class ExploreStats(BaseModel):
    resources: int
    topics: int
    members: int
    tags: int


class ExploreResourceCard(BaseModel):
    id: int
    title: str
    short_title: str | None = None
    type: str
    discipline: str
    year: int
    cover_image: str | None = None
    cover_theme: str | None = None
    author_name: str
    author_username: str | None = None
    reads: int = 0
    downloads: int = 0
    saves: int = 0
    score: float = 0.0


class ExploreTopicCard(BaseModel):
    id: int
    title: str
    excerpt: str
    reply_count: int
    agree_count: int = 0
    helpful_count: int = 0
    last_reply_at: datetime | None = None
    author_name: str
    author_username: str | None = None


class ExploreAuthorCard(BaseModel):
    username: str
    display_name: str | None = None
    avatar_url: str | None = None
    works: int = 0
    followers: int = 0
    reads: int = 0
    downloads: int = 0


class ExploreTagCard(BaseModel):
    name: str
    count: int


class ExploreOverviewResponse(BaseModel):
    stats: ExploreStats
    top_resources: list[ExploreResourceCard]
    top_topics: list[ExploreTopicCard]
    top_authors: list[ExploreAuthorCard]
    top_tags: list[ExploreTagCard]
    generated_at: datetime


class FollowingFeedResponse(BaseModel):
    resources: list[ExploreResourceCard]
    topics: list[ExploreTopicCard]
    followed_authors: int
    subscribed_disciplines: int
    followed_topics: int
    generated_at: datetime


def _plain_excerpt(body: str, limit: int = 90) -> str:
    """Strip the lightest Markdown noise for a card; keep the sentence."""
    import re

    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", body or "")
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[*_`~>#]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


async def _user_map(db: AsyncSession, ids: set[int]) -> dict[int, User]:
    if not ids:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return {row.id: row for row in rows}


async def _resource_cards(
    db: AsyncSession,
    resources: list[Resource],
    *,
    limit: int,
) -> list[ExploreResourceCard]:
    if not resources:
        return []
    raw = await load_raw_engagement(db, [row.id for row in resources], resources[0].tenant_id)
    owners = await _user_map(db, {row.owner_id for row in resources if row.owner_id})
    cards: list[ExploreResourceCard] = []
    for row in resources:
        reads, downloads, saves = raw.get(row.id, (0, 0, 0))
        owner = owners.get(row.owner_id) if row.owner_id else None
        cards.append(
            ExploreResourceCard(
                id=row.id,
                title=row.title,
                short_title=row.short_title,
                type=row.type,
                discipline=row.discipline,
                year=row.year,
                cover_image=row.cover_image,
                cover_theme=row.cover_theme,
                author_name=(
                    (owner.display_name or owner.username)
                    if owner
                    else ((row.authors or ["佚名"])[0])
                ),
                author_username=owner.username if owner else None,
                reads=reads,
                downloads=downloads,
                saves=saves,
                score=round(reads * 1.0 + downloads * 1.4 + saves * 1.8, 2),
            )
        )
    return cards[:limit]


async def _topic_cards(
    db: AsyncSession, topics: list[ForumTopic], *, limit: int
) -> list[ExploreTopicCard]:
    if not topics:
        return []
    topic_ids = [row.id for row in topics]
    counts = (
        await db.execute(
            select(ForumReaction.target_id, ForumReaction.kind, func.count(ForumReaction.id))
            .where(
                ForumReaction.tenant_id == topics[0].tenant_id,
                ForumReaction.target_type == "topic",
                ForumReaction.target_id.in_(topic_ids),
                ForumReaction.kind.in_(("agree", "helpful")),
            )
            .group_by(ForumReaction.target_id, ForumReaction.kind)
        )
    ).all()
    reactions: dict[int, dict[str, int]] = {}
    for target_id, kind, count in counts:
        reactions.setdefault(int(target_id), {})[str(kind)] = int(count)
    authors = await _user_map(db, {row.author_id for row in topics})
    cards = [
        ExploreTopicCard(
            id=row.id,
            title=row.title,
            excerpt=_plain_excerpt(row.body),
            reply_count=row.reply_count,
            agree_count=reactions.get(row.id, {}).get("agree", 0),
            helpful_count=reactions.get(row.id, {}).get("helpful", 0),
            last_reply_at=row.last_reply_at or row.created_at,
            author_name=(
                (authors[row.author_id].display_name or authors[row.author_id].username)
                if row.author_id in authors
                else "已注销用户"
            ),
            author_username=authors[row.author_id].username if row.author_id in authors else None,
        )
        for row in topics
    ]
    return cards[:limit]


@router.get("/overview", response_model=ExploreOverviewResponse)
async def overview(
    limit: int = Query(default=6, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    _viewer: User | None = Depends(get_current_user_optional),
) -> ExploreOverviewResponse:
    """A bounded snapshot for the discover page.

    Resources are scored by recorded attention (reads/downloads/saves), not
    editorial ranking. Topics are ranked by replies + reactions. Authors are
    ranked by published works and attention. There is deliberately no
    "personalised" input here; the following feed is a separate endpoint.
    """
    tenant_id = require_tenant_id()
    resources = list(
        (
            await db.execute(
                select(Resource).where(Resource.tenant_id == tenant_id, *public_conditions())
            )
        )
        .scalars()
        .all()
    )
    # Engagement is a small aggregate over the whole catalogue, not per-page.
    raw = await load_raw_engagement(db, [row.id for row in resources], tenant_id)
    ranked = sorted(
        resources,
        key=lambda row: (
            raw.get(row.id, (0, 0, 0))[0]
            + raw.get(row.id, (0, 0, 0))[1] * 1.4
            + raw.get(row.id, (0, 0, 0))[2] * 1.8,
            row.publish_at or row.created_at,
        ),
        reverse=True,
    )
    if not any(sum(raw.get(row.id, (0, 0, 0))) > 0 for row in ranked):
        # A fresh deployment has no attention yet; "newest" is more honest than
        # an empty "hot" shelf.
        ranked = sorted(
            resources,
            key=lambda row: row.publish_at or row.created_at,
            reverse=True,
        )
    top_resources = await _resource_cards(db, ranked[:limit], limit=limit)

    topic_rows = list(
        (
            await db.execute(
                select(ForumTopic)
                .where(
                    ForumTopic.tenant_id == tenant_id,
                    ForumTopic.deleted_at.is_(None),
                    ForumTopic.moderation_status.in_(("published", "approved", "auto_approved")),
                )
                .order_by(
                    ForumTopic.reply_count.desc(),
                    func.coalesce(ForumTopic.last_reply_at, ForumTopic.created_at).desc(),
                )
                .limit(limit * 4)
            )
        )
        .scalars()
        .all()
    )
    topic_cards = await _topic_cards(db, topic_rows, limit=limit * 4)
    topic_cards = sorted(
        topic_cards,
        key=lambda card: (
            card.reply_count * 2 + card.agree_count + card.helpful_count,
            card.last_reply_at or datetime.min,
        ),
        reverse=True,
    )[:limit]

    # Authors: ownership lives on Resource.owner_id; follow counts use names
    # because the historical follows table is name-keyed.
    owner_ids = {row.owner_id for row in resources if row.owner_id}
    owners = await _user_map(db, owner_ids)
    follow_rows = (
        await db.execute(
            select(AuthorFollow.author_name, func.count(AuthorFollow.id))
            .where(AuthorFollow.tenant_id == tenant_id)
            .group_by(AuthorFollow.author_name)
        )
    ).all()
    follows_by_name = {str(name): int(count) for name, count in follow_rows}
    author_stats: dict[int, dict[str, Any]] = {}
    for row in resources:
        if not row.owner_id:
            continue
        stats = author_stats.setdefault(row.owner_id, {"works": 0, "reads": 0, "downloads": 0})
        stats["works"] += 1
        reads, downloads, _saves = raw.get(row.id, (0, 0, 0))
        stats["reads"] += reads
        stats["downloads"] += downloads
    top_authors: list[ExploreAuthorCard] = []
    for owner_id, stats in sorted(
        author_stats.items(),
        key=lambda item: item[1]["works"] * 20 + item[1]["reads"] + item[1]["downloads"],
        reverse=True,
    )[:limit]:
        owner = owners.get(owner_id)
        if owner is None:
            continue
        names = [name for name in (owner.display_name, owner.username) if name]
        top_authors.append(
            ExploreAuthorCard(
                username=owner.username,
                display_name=owner.display_name,
                avatar_url=owner.avatar_url,
                works=int(stats["works"]),
                followers=sum(follows_by_name.get(name, 0) for name in names),
                reads=int(stats["reads"]),
                downloads=int(stats["downloads"]),
            )
        )

    tag_counts: dict[str, int] = {}
    for row in resources:
        for tag in row.tags or []:
            tag_counts[str(tag)] = tag_counts.get(str(tag), 0) + 1
    top_tags = [
        ExploreTagCard(name=name, count=count)
        for name, count in sorted(tag_counts.items(), key=lambda item: (-item[1], item[0]))[:12]
    ]
    members = int(
        (
            await db.execute(
                select(func.count(User.id)).where(
                    User.tenant_id == tenant_id,
                    User.deleted_at.is_(None),
                    User.is_active.is_(True),
                )
            )
        ).scalar_one()
        or 0
    )
    topics = int(
        (
            await db.execute(
                select(func.count(ForumTopic.id)).where(
                    ForumTopic.tenant_id == tenant_id,
                    ForumTopic.deleted_at.is_(None),
                    ForumTopic.moderation_status.in_(("published", "approved", "auto_approved")),
                )
            )
        ).scalar_one()
        or 0
    )
    return ExploreOverviewResponse(
        stats=ExploreStats(
            resources=len(resources),
            topics=topics,
            members=members,
            tags=len(tag_counts),
        ),
        top_resources=top_resources,
        top_topics=topic_cards,
        top_authors=top_authors,
        top_tags=top_tags,
        generated_at=utcnow(),
    )


@router.get("/following", response_model=FollowingFeedResponse)
async def following(
    limit: int = Query(default=6, ge=1, le=12),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FollowingFeedResponse:
    """A social feed, not a recommendation engine.

    It asks three concrete questions: what did the authors I follow publish,
    what appeared in directions I subscribe to, and which watched threads
    moved? Empty lists are valid — the UI explains how to fill them.
    """
    tenant_id = require_tenant_id()
    author_names = list(
        (
            await db.execute(
                select(AuthorFollow.author_name).where(
                    AuthorFollow.tenant_id == tenant_id,
                    AuthorFollow.user_id == current_user.id,
                )
            )
        )
        .scalars()
        .all()
    )
    disciplines = list(
        (
            await db.execute(
                select(DisciplineSubscription.discipline).where(
                    DisciplineSubscription.tenant_id == tenant_id,
                    DisciplineSubscription.user_id == current_user.id,
                )
            )
        )
        .scalars()
        .all()
    )
    watched_topic_ids = list(
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

    followed_owner_ids: set[int] = set()
    if author_names:
        users = (
            (
                await db.execute(
                    select(User).where(
                        User.tenant_id == tenant_id,
                        User.deleted_at.is_(None),
                        or_(User.username.in_(author_names), User.display_name.in_(author_names)),
                    )
                )
            )
            .scalars()
            .all()
        )
        followed_owner_ids = {user.id for user in users}

    resource_conditions = []
    if followed_owner_ids:
        resource_conditions.append(Resource.owner_id.in_(followed_owner_ids))
    if disciplines:
        resource_conditions.append(Resource.discipline.in_(disciplines))
    resources: list[Resource] = []
    if resource_conditions:
        resources = list(
            (
                await db.execute(
                    select(Resource)
                    .where(
                        Resource.tenant_id == tenant_id,
                        *public_conditions(),
                        or_(*resource_conditions),
                    )
                    .order_by(Resource.publish_at.desc(), Resource.id.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )

    topic_conditions = []
    if followed_owner_ids:
        topic_conditions.append(ForumTopic.author_id.in_(followed_owner_ids))
    if watched_topic_ids:
        topic_conditions.append(ForumTopic.id.in_(watched_topic_ids))
    topics: list[ForumTopic] = []
    if topic_conditions:
        topics = list(
            (
                await db.execute(
                    select(ForumTopic)
                    .where(
                        ForumTopic.tenant_id == tenant_id,
                        ForumTopic.deleted_at.is_(None),
                        ForumTopic.moderation_status.in_(
                            ("published", "approved", "auto_approved")
                        ),
                        or_(*topic_conditions),
                    )
                    .order_by(func.coalesce(ForumTopic.last_reply_at, ForumTopic.created_at).desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )

    return FollowingFeedResponse(
        resources=await _resource_cards(db, resources, limit=limit),
        topics=await _topic_cards(db, topics, limit=limit),
        followed_authors=len(followed_owner_ids),
        subscribed_disciplines=len(disciplines),
        followed_topics=len(watched_topic_ids),
        generated_at=utcnow(),
    )
