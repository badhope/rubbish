"""Related reading for a forum topic.

The topic already carries an optional ``paper_id``. This service turns that
single integer into a reader-facing block: the linked work, other discussions
of the same work, nearby threads in the same board, and a few works from the
same direction. It deliberately does not rely on a vector index (the site is
small and SQLite-backed in tests); a light bigram overlap plus board/paper
signals is enough to avoid recommending an unrelated announcement.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.catalog.models import Resource
from app.domain.catalog.visibility import public_conditions
from app.domain.forum.models import ForumTopic

VISIBLE_TOPIC_STATUS = ("published", "auto_approved", "approved")

_PUNCT = re.compile(r"[\s\W_]+", re.UNICODE)
_WORD = re.compile(r"[a-z0-9]{3,}")


def _signature(title: str, body: str) -> set[str]:
    """Character bigrams + latin words; cheap, deterministic and language-safe."""
    text = f"{title}\n{body}".lower()
    compact = _PUNCT.sub("", text)
    grams = {compact[i : i + 2] for i in range(max(0, len(compact) - 1))}
    words = set(_WORD.findall(text))
    return grams | words


def _topic_score(
    topic: ForumTopic,
    signature: set[str],
    *,
    same_paper: bool,
    same_board: bool,
) -> tuple[int, str | None]:
    if same_paper:
        return 100, "同一作品"
    score = 2 if same_board else 0
    overlap = len(signature & _signature(topic.title, topic.body))
    score += min(overlap, 8)
    if overlap >= 3:
        return score, "话题相近"
    if same_board and score >= 4:
        return score, "同一分区"
    return score, None


def _work_score(work: Resource, paper: Resource) -> tuple[int, str | None]:
    score = 0
    if work.subdiscipline and work.subdiscipline == paper.subdiscipline:
        score += 3
    if work.type == paper.type:
        score += 1
    shared_tags = set(work.tags or []) & set(paper.tags or [])
    score += min(len(shared_tags) * 2, 6)
    shared_keywords = set(work.keywords or []) & set(paper.keywords or [])
    score += min(len(shared_keywords), 4)
    if score <= 1:
        return score, None
    if shared_tags:
        return score, "共同标签"
    if work.subdiscipline and work.subdiscipline == paper.subdiscipline:
        return score, "同一细分方向"
    return score, "同一方向"


def _visible_topics() -> Select[tuple[ForumTopic]]:
    return select(ForumTopic).where(
        ForumTopic.deleted_at.is_(None),
        or_(
            ForumTopic.moderation_status.in_(VISIBLE_TOPIC_STATUS),
            ForumTopic.moderation_status.is_(None),
        ),
    )


async def find_related(
    db: AsyncSession,
    *,
    tenant_id: Any,
    topic: ForumTopic,
    topic_limit: int = 4,
    work_limit: int = 3,
) -> tuple[Resource | None, list[tuple[ForumTopic, str]], list[tuple[Resource, str]]]:
    """Return ``(linked_paper, related_topics, related_works)``.

    The caller owns serialization; this service only applies visibility and
    ranking so the endpoint and future AI tools share one rule set.
    """
    paper: Resource | None = None
    if topic.paper_id:
        paper = (
            await db.execute(
                select(Resource).where(
                    Resource.id == topic.paper_id,
                    Resource.tenant_id == tenant_id,
                    *public_conditions(),
                )
            )
        ).scalar_one_or_none()

    signature = _signature(topic.title, topic.body)
    candidates: set[int] = set()
    rows: list[ForumTopic] = []
    if topic.paper_id is not None:
        same_paper_rows = (
            (
                await db.execute(
                    _visible_topics()
                    .where(
                        ForumTopic.tenant_id == tenant_id,
                        ForumTopic.paper_id == topic.paper_id,
                        ForumTopic.id != topic.id,
                    )
                    .order_by(ForumTopic.id.desc())
                    .limit(20)
                )
            )
            .scalars()
            .all()
        )
        for row in same_paper_rows:
            if row.id not in candidates:
                candidates.add(row.id)
                rows.append(row)
    board_query = _visible_topics().where(
        ForumTopic.tenant_id == tenant_id,
        ForumTopic.id != topic.id,
    )
    if topic.board_id:
        board_query = board_query.where(ForumTopic.board_id == topic.board_id)
    recent_rows = (
        (
            await db.execute(
                board_query.order_by(
                    func.coalesce(ForumTopic.last_reply_at, ForumTopic.created_at).desc(),
                    ForumTopic.id.desc(),
                ).limit(80)
            )
        )
        .scalars()
        .all()
    )
    for row in recent_rows:
        if row.id not in candidates:
            candidates.add(row.id)
            rows.append(row)

    scored: list[tuple[int, ForumTopic, str]] = []
    for row in rows:
        same_paper = bool(topic.paper_id and row.paper_id == topic.paper_id)
        same_board = bool(topic.board_id and row.board_id == topic.board_id)
        score, reason = _topic_score(row, signature, same_paper=same_paper, same_board=same_board)
        if reason is None:
            continue
        scored.append((score, row, reason))
    scored.sort(
        key=lambda item: (
            item[0],
            item[1].last_reply_at or item[1].created_at,
            item[1].id,
        ),
        reverse=True,
    )
    related_topics = [(row, reason) for _, row, reason in scored[:topic_limit]]

    related_works: list[tuple[Resource, str]] = []
    if paper is not None:
        work_query = select(Resource).where(
            Resource.tenant_id == tenant_id,
            Resource.id != paper.id,
            *public_conditions(),
        )
        if paper.discipline:
            work_query = work_query.where(Resource.discipline == paper.discipline)
        work_rows = (
            (
                await db.execute(
                    work_query.order_by(Resource.created_at.desc(), Resource.id.desc()).limit(40)
                )
            )
            .scalars()
            .all()
        )
        works_scored: list[tuple[int, Resource, str]] = []
        for work in work_rows:
            score, reason = _work_score(work, paper)
            if reason is None:
                continue
            works_scored.append((score, work, reason))
        works_scored.sort(key=lambda item: (item[0], item[1].id), reverse=True)
        related_works = [(work, reason) for _, work, reason in works_scored[:work_limit]]

    return paper, related_topics, related_works


__all__ = ["VISIBLE_TOPIC_STATUS", "find_related"]
