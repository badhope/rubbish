"""Shared editorial recipient lookup.

Role names drifted across the codebase: triage reminders and release alerts
covered the full editorial set, while the author-withdraw path only knew
``editor`` and ``chief_editor``. That meant most section/deputy/board editors
never received withdrawal notices even though they own the queue.

Keep one query here so every workflow that needs "everyone who can act on
this" uses the same role set, plus active admins and an optional creator.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Role, User, UserRole

# The full editorial family. ``editor_in_chief`` is the canonical permission
# rank; the other names are the real editorial seats minted by bootstrap.
EDITOR_ROLES = (
    "editor",
    "editor_in_chief",
    "section_editor",
    "deputy_editor",
    "board_editor",
    "chief_editor",
)


async def editor_recipients(
    db: AsyncSession,
    tenant_id: Any,
    *,
    include_user_id: int | None = None,
    include_admins: bool = True,
) -> list[User]:
    """Return active users with any editorial role, de-duplicated by id.

    Do not use SQL ``DISTINCT`` on whole ``User`` rows: historical
    ``notification_prefs`` is a plain JSON column in some databases, and
    PostgreSQL cannot compare ``json`` values. De-duplicate in Python.
    """
    rows = list(
        (
            await db.execute(
                select(User)
                .join(UserRole, UserRole.user_id == User.id)
                .join(Role, Role.id == UserRole.role_id)
                .where(
                    User.tenant_id == tenant_id,
                    User.is_active.is_(True),
                    UserRole.tenant_id == tenant_id,
                    Role.tenant_id == tenant_id,
                    Role.name.in_(EDITOR_ROLES),
                )
            )
        )
        .scalars()
        .all()
    )
    if include_admins:
        rows.extend(
            (
                await db.execute(
                    select(User).where(
                        User.tenant_id == tenant_id,
                        User.is_active.is_(True),
                        User.is_admin.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
    by_id = {user.id: user for user in rows}
    if include_user_id is not None and include_user_id not in by_id:
        creator = (
            await db.execute(
                select(User).where(User.id == include_user_id, User.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if creator is not None:
            by_id[creator.id] = creator
    return list(by_id.values())


__all__ = ["EDITOR_ROLES", "editor_recipients"]
