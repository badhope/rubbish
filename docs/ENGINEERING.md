# Engineering & project management

How this repository is maintained. Keep it short enough to use during a release.

## Module map

The backend is a modular monolith. A module owns one product surface and must not import another module's HTTP layer.

| Module | Public surface | Owns |
|---|---|---|
| `forum` | `/api/forum/*` | Boards, topics, replies, moderation, reports |
| `catalog` | `/api/resources`, `/api/catalog/*` | Archive records, covers, catalog search and facets |
| `comments` | `/api/comments/*` | Threaded comments and comment moderation |
| `library` | `/api/reading-lists/*` | Reading lists and saved items |
| `gamification` | `/api/gamification/*` | Points, check-in, ledger, shop and fulfilment |
| `follows` | `/api/follows/*` | Author follows and discipline subscriptions |
| `notifications` | `/api/notifications/*` | In-app notifications |
| `reader` | `/api/reader/*` | Reading progress and history |
| `announcements` | `/api/announcements/*` | Public notices |

Shared identity, tenancy, auth, mail, storage and rate limits live in `app/core`, `app/api` and `app/models`. The dependency direction is `interfaces/http → domain → core`. `tests/test_architecture_layers.py` is the guardrail.

### Adding a module

1. Add `app/domain/<module>/` (models and rules) and `app/interfaces/http/<module>/` (router and DTOs).
2. Add `app/modules/<module>/__init__.py` with a manifest: router, prefix, tags, dependencies.
3. Register the module in `app/modules/__init__.py`; the module list is the single source of mounted routers.
4. Add the migration, RLS policy, and at least one integration test for the happy path plus one permission failure.
5. Add the frontend hook and route. A module should not need edits in three existing pages to become reachable.

Do not create a second router for the same resource. Do not put business rules in a route handler if a domain service can own them.

## Versioning and release

- Versions are three-part `1.19.x`. A small fix or UI iteration bumps only the last digit; do not spend `1.20` on a patch.
- Update `VERSION`, `apps/backend/pyproject.toml`, `apps/backend/app/__init__.py`, `apps/backend/uv.lock`, `apps/frontend/package.json`, `apps/frontend/package-lock.json`, and `CHANGELOG.md` in the same commit.
- Keep `main` deployable. Feature work lands through a pull request or a single release commit; the five mirrors (`ghbad`, `ghms`, `ghx`, `gitcode`, `gitee`) all point at `main` and no long-lived branches are kept.
- A release note must state what changed for a user, what was removed or redirected, and what was verified. "Refactor" alone is not a release note.

### Release gate

```bash
cd apps/backend && .venv/bin/python -m pytest -q
cd apps/frontend && npm run typecheck && npm run build
```

Plus:

- Backend lint/format/type: `ruff check`, `ruff format --check`, `mypy`.
- Migrations and RLS smoke job from CI (`.github/workflows/ci.yml`).
- Playwright smoke and the desktop/mobile audit for changed routes.
- Production health: `/api/health` must return the new version.
- If a route was removed, a 301 must exist and be verified with `curl -I`.

## Production shape

The live server is **systemd + Nginx**, not the Compose reference:

| Piece | Location |
|---|---|
| App | `/opt/rubbish-app` |
| Virtualenv | `/opt/rubbish-app/.venv` |
| Static build | `/opt/rubbish-app/static` |
| Service | `rubbish-app.service`, bound to `127.0.0.1:8080` |
| Environment | `/www/wwwroot/rubbish.argjiemi.cn/.env` |
| Nginx vhost | `/www/server/panel/vhost/nginx/rubbish.argjiemi.cn.conf` |
| Legacy redirects | `/www/server/panel/vhost/nginx/rubbish-legacy-redirects.inc` |
| Database | PostgreSQL 17 container `rubbish-db-1` |

The Compose stack in `docker-compose.yml` remains the reproducible reference for a fresh install. When changing deployment behavior, update the live section in `DEPLOY.md` as well; do not silently document only the reference stack.

## Project rhythm

- **Weekly**: triage reports, claims and comments; check `site-health.sh`; review the slowest public route in the performance budget.
- **Monthly**: dependency updates in one PR, then the full CI gate; check backup restore, not only backup creation.
- **Quarterly**: module boundary review against `docs/ARCHITECTURE.md`; delete a route or module that has no owner, no tests and no user path. Growth is not a success metric by itself.
- **Before adding a feature**: name the one user action it serves and the one screen it changes. If it needs a new settings page, a new permission and a new background job, split it or defer it.

## Known boundaries

- `/library/$listId` is reachable from the profile reading-list section; there is no `/library` index by design.
- Legacy submission/review domain packages stay for archive conversion and encrypted backups; their HTTP routers are not mounted.
- `forum_editor` and admin charts are intentionally large lazy chunks. Do not import them from shared layout code.
- The Chinese serif face is the system stack. Reintroducing a CJK webfont requires a new performance review.
