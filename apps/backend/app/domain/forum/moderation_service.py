"""Forum moderation service.

Routes keep HTTP concerns (auth, pagination, response shaping); this module owns
the shared moderation policy: settings snapshot + cache, gray-release thresholds,
queue priority, decision transitions and author notification.

The cache is deliberately small and per-process. It avoids a database read on
every new topic while keeping a short TTL so another worker's config change is
visible within a minute. Writers call :func:`invalidate_policy` immediately, so
the same process sees its own change at once.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from time import monotonic
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.moderation import SOFT_PATTERNS
from app.core.time import utcnow
from app.domain.forum.models import (
    ForumModerationEvent,
    ForumModerationSetting,
    ForumTopic,
)

_CACHE_TTL_SECONDS = 60.0
# tenant_id -> (monotonic timestamp, immutable snapshot)
_POLICY_CACHE: dict[str, tuple[float, ModerationPolicy]] = {}


@dataclass(frozen=True)
class ModerationPolicy:
    auto_publish_enabled: bool
    manual_threshold: int
    sla_minutes: int
    weights: dict[str, int]
    priority_risk_weight: int
    priority_age_weight: int
    gray_rules: dict[str, Any]

    def with_segment(
        self,
        *,
        threshold: int | None = None,
        auto_publish: bool | None = None,
        weights: dict[str, int] | None = None,
    ) -> ModerationPolicy:
        return replace(
            self,
            manual_threshold=(self.manual_threshold if threshold is None else threshold),
            auto_publish_enabled=(
                self.auto_publish_enabled if auto_publish is None else auto_publish
            ),
            weights={**self.weights, **(weights or {})},
        )


def sanitize_gray_rules(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Keep only known gray-rule shapes; drop everything else at the boundary."""
    if not isinstance(raw, dict):
        return {}
    cleaned: dict[str, dict[str, Any]] = {}
    for group in ("boards", "roles"):
        source = raw.get(group)
        if not isinstance(source, dict):
            continue
        items: dict[str, object] = {}
        for key, segment in list(source.items())[:50]:
            if not isinstance(key, str) or len(key) > 100:
                continue
            if isinstance(segment, (int, float)) and not isinstance(segment, bool):
                items[key] = max(1, min(99, int(segment)))
                continue
            if not isinstance(segment, dict):
                continue
            payload: dict[str, object] = {}
            threshold = segment.get("manual_threshold")
            if isinstance(threshold, (int, float)) and not isinstance(threshold, bool):
                payload["manual_threshold"] = max(1, min(99, int(threshold)))
            auto = segment.get("auto_publish_enabled")
            if isinstance(auto, bool):
                payload["auto_publish_enabled"] = auto
            weights = segment.get("weights")
            if isinstance(weights, dict):
                payload["weights"] = {
                    str(code): max(0, min(100, int(value)))
                    for code, value in weights.items()
                    if isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and str(code) in {c for c, *_ in SOFT_PATTERNS}
                }
            if payload:
                items[key] = payload
        if items:
            cleaned[group] = items
    return cleaned


def policy_from_row(row: ForumModerationSetting) -> ModerationPolicy:
    return ModerationPolicy(
        auto_publish_enabled=bool(row.auto_publish_enabled),
        manual_threshold=max(1, min(99, int(row.manual_threshold))),
        sla_minutes=max(1, int(row.sla_minutes)),
        weights={str(k): int(v) for k, v in (row.weights or {}).items()},
        priority_risk_weight=max(0, int(row.priority_risk_weight or 0)),
        priority_age_weight=max(0, int(row.priority_age_weight or 0)),
        gray_rules=dict(row.gray_rules or {}),
    )


def default_weights() -> dict[str, int]:
    return {code: weight for code, _label, _detail, weight in SOFT_PATTERNS}


def effective_weights(weights: dict[str, int] | None) -> dict[str, int]:
    return {**default_weights(), **(weights or {})}


def invalidate_policy(tenant_id: UUID) -> None:
    _POLICY_CACHE.pop(str(tenant_id), None)


async def load_settings_row(db: AsyncSession, tenant_id: UUID) -> ForumModerationSetting:
    """Return the tenant's single settings row, creating defaults on first read."""
    row = (
        await db.execute(
            select(ForumModerationSetting).where(ForumModerationSetting.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is not None:
        return row
    row = ForumModerationSetting(
        tenant_id=tenant_id,
        auto_publish_enabled=True,
        manual_threshold=40,
        sla_minutes=30,
        weights={},
        priority_risk_weight=10,
        priority_age_weight=1,
        gray_rules={},
    )
    db.add(row)
    await db.flush()
    return row


async def get_policy(
    db: AsyncSession, tenant_id: UUID, *, refresh: bool = False
) -> ModerationPolicy:
    key = str(tenant_id)
    cached = _POLICY_CACHE.get(key)
    if not refresh and cached is not None:
        stamp, snapshot = cached
        if monotonic() - stamp < _CACHE_TTL_SECONDS:
            return snapshot
    row = await load_settings_row(db, tenant_id)
    snapshot = policy_from_row(row)
    _POLICY_CACHE[key] = (monotonic(), snapshot)
    return snapshot


def _segment_policy(base: ModerationPolicy, segment: object) -> ModerationPolicy:
    if isinstance(segment, int):
        return base.with_segment(threshold=max(1, min(99, segment)))
    if not isinstance(segment, dict):
        return base
    threshold = segment.get("manual_threshold")
    auto_publish = segment.get("auto_publish_enabled")
    weights = segment.get("weights")
    return base.with_segment(
        threshold=(
            max(1, min(99, int(threshold))) if isinstance(threshold, (int, float)) else None
        ),
        auto_publish=auto_publish if isinstance(auto_publish, bool) else None,
        weights=(
            {str(k): int(v) for k, v in weights.items() if isinstance(v, (int, float))}
            if isinstance(weights, dict)
            else None
        ),
    )


def effective_policy(
    base: ModerationPolicy,
    *,
    board_slug: str | None = None,
    role: str | None = None,
) -> ModerationPolicy:
    """Apply gray-release rules.

    Precedence: base < role segment < board segment. The more specific
    board rule wins, so an operator can tighten one noisy board without
    changing the rest of the site. Segments accept either a bare integer
    threshold or an object with ``manual_threshold`` /
    ``auto_publish_enabled`` / ``weights``.
    """
    rules = base.gray_rules or {}
    result = base
    role_rules = rules.get("roles") if isinstance(rules, dict) else None
    if role and isinstance(role_rules, dict):
        result = _segment_policy(result, role_rules.get(role))
    board_rules = rules.get("boards") if isinstance(rules, dict) else None
    if board_slug and isinstance(board_rules, dict):
        result = _segment_policy(result, board_rules.get(board_slug))
    return result


def priority_score(risk_score: float | int, age_minutes: float, policy: ModerationPolicy) -> float:
    """The same arithmetic used by the queue SQL, exposed for tests and docs."""
    return (
        float(risk_score) * policy.priority_risk_weight
        + max(0.0, float(age_minutes)) / 60.0 * policy.priority_age_weight
    )


def priority_order_expression(policy: ModerationPolicy) -> Any:
    """SQL expression: risk weight plus waiting time weight.

    ``EXTRACT(EPOCH FROM now() - created_at)`` is PostgreSQL-native and
    also compiles on the SQLite test database. The queue expression is
    evaluated at query time, so an old topic's waiting term keeps growing.
    """
    age_seconds = func.extract("epoch", func.now() - ForumTopic.created_at)
    return (
        ForumTopic.risk_score * policy.priority_risk_weight
        + age_seconds / 60.0 * policy.priority_age_weight
    )


async def record_event(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    topic: ForumTopic,
    action: str,
    from_status: str | None,
    to_status: str | None,
    actor_id: int | None,
    note: str | None,
    meta: dict[str, Any] | None = None,
) -> None:
    db.add(
        ForumModerationEvent(
            tenant_id=tenant_id,
            topic_id=topic.id,
            actor_id=actor_id,
            action=action,
            from_status=from_status,
            to_status=to_status,
            note=note,
            meta=meta,
        )
    )


async def apply_decision(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    topic: ForumTopic,
    action: str,
    note: str,
    actor_id: int,
    batch_id: str | None = None,
) -> str:
    """Write the manual decision to the topic and its audit stream. Caller commits."""
    before = topic.moderation_status
    before_published = topic.published_at
    before_reason = topic.manual_review_reason
    before_eta = topic.review_eta_at
    now = utcnow()
    if action == "approve":
        topic.moderation_status = "published"
        topic.published_at = now
        topic.manual_review_reason = None
    elif action == "changes":
        topic.moderation_status = "changes_requested"
        topic.published_at = None
        topic.manual_review_reason = note or "需要按运营说明调整"
    else:
        topic.moderation_status = "rejected"
        topic.published_at = None
        topic.manual_review_reason = note or "未通过站内规则核验"
    topic.review_eta_at = None
    topic.sla_reminded_at = None
    topic.reviewed_by = actor_id
    topic.reviewed_at = now
    await record_event(
        db,
        tenant_id=tenant_id,
        topic=topic,
        action=action,
        from_status=before,
        to_status=topic.moderation_status,
        actor_id=actor_id,
        note=note or None,
        meta={
            "risk_score": topic.risk_score,
            "batch_id": batch_id,
            "from_published_at": before_published.isoformat() if before_published else None,
            "from_manual_review_reason": before_reason,
            "from_review_eta_at": before_eta.isoformat() if before_eta else None,
        },
    )
    return topic.moderation_status


async def notify_author(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    topic: ForumTopic,
    action: str,
    note: str,
) -> None:
    """Tell the author the decision. Notification failure never rolls back the decision."""
    try:
        from app.domain.notifications import services as notifications

        if action == "approve":
            title = f"主题帖「{topic.title[:80]}」已通过核验"
            body = "内容已进入公开列表，可以继续在楼层里互动。"
        elif action == "changes":
            title = f"主题帖「{topic.title[:80]}」需要调整"
            body = note or "请按运营说明调整后重新提交。"
        else:
            title = f"主题帖「{topic.title[:80]}」未通过核验"
            body = note or "该内容未通过站内规则核验。"
        await notifications.create(
            db,
            tenant_id=tenant_id,
            user_id=topic.author_id,
            type_="forum.moderation",
            title=title,
            body=body[:240],
            related_type="forum_topic",
            related_id=str(topic.id),
        )
        # The moderation transaction is already committed; commit the
        # notification on its own so a closed session cannot drop it.
        await db.commit()
    except Exception:
        await db.rollback()
        return


# Re-export for route convenience; keeping the names stable makes the split
# mechanical and the diff easy to audit.


__all__ = [
    "ModerationPolicy",
    "apply_decision",
    "default_weights",
    "effective_policy",
    "effective_weights",
    "get_policy",
    "invalidate_policy",
    "load_settings_row",
    "notify_author",
    "policy_from_row",
    "priority_order_expression",
    "priority_score",
    "record_event",
    "sanitize_gray_rules",
]
