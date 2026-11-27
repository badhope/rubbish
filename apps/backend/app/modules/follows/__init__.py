"""Follows module — author follow + discipline subscription.

Implements the ``author_follows`` + ``discipline_subscriptions`` flow
in a module-shaped home.

Design choices:

- Tenant-scoped (``tenant_id`` + RLS).
- Author follows key on the author NAME (string), not a separate
  ``authors`` table. The catalog module's design comment explicitly
  defers the structured ``Author`` (ORCID/affiliation) table to a
  future phase; the primary author storage on main is the JSON
  ``authors`` list[str] column on ``resources``. Following a string
  name matches that model and avoids forcing a cross-module FK to a
  table that does not exist yet.
- No rate limiting of its own; the shared RateLimitMiddleware
  covers these endpoints.
- Follower fan-out lives in ``app.domain.follows.fanout`` and is called
  from the approval/publication paths (catalog publish, release scheduler,
  release routes). This module owns the relationships and listings; the
  catalog/submission modules own the event that triggers delivery.
"""

from __future__ import annotations

from app.core.modules import ModuleManifest, registry

# Importing this package registers AuthorFollow + DisciplineSubscription
# with the shared core Base.metadata so Alembic and tests see them.
from app.domain.follows import models  # noqa: F401
from app.interfaces.http.follows.routes import router

registry.register(
    ModuleManifest(
        name="follows",
        version="0.1.0",
        description="Author follow + discipline subscription.",
        dependencies=frozenset(),
        router=router,
    )
)
