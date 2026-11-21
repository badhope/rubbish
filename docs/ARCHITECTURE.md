# Architecture

**English · [简体中文](ARCHITECTURE.zh-CN.md)**

## Shape

Rubbish is a modular monolith. One FastAPI process serves the HTTP API and, in the all-in-one deployment, the built frontend. PostgreSQL holds both community data and the archive.

```text
React SPA (Vite, TanStack Router)
            │  HTTP
            ▼
FastAPI ── core: config, database, auth, tenancy, storage, mail, rate limits
   │
   ├── domain: catalog, forum, comments, reader, notifications, follows,
   │           library, recommendations, gamification, announcements
   ├── interfaces/http: route modules and request/response models
   ├── api: auth, admin, health, me, SEO, privacy, support
   └── modules: manifest that mounts the enabled domain routers
            │
            ▼
PostgreSQL 17 (row-level security) + local uploads or S3-compatible storage
```

## Backend layers

| Layer | Responsibility |
|---|---|
| `app/core` | Configuration, DB session, tenant context, security, logging, mail, storage, rate limiting |
| `app/domain` | Models and business rules; no imports from HTTP or FastAPI |
| `app/interfaces/http` | Routers, DTOs, visibility checks, pagination |
| `app/api` | Cross-cutting HTTP surfaces such as auth, admin, health, SEO, privacy |
| `app/models` | Shared identity and tenancy models |
| `app/modules` | Composition manifests that declare a module's router and dependencies |

The dependency direction is inward: `api` / `interfaces` → `domain` → `core`. `tests/test_architecture_layers.py` enforces the core-to-domain boundary. The one exception is `core/bootstrap.py`, which seeds the default forum boards at startup.

## Tenancy

Every tenant-scoped table carries `tenant_id`, and PostgreSQL row-level security is enabled with `FORCE ROW LEVEL SECURITY`. The default deployment is single-tenant: the middleware resolves one tenant ID before any query runs. Multi-tenant host lookup exists in the schema but is not enabled in the product UI.

When querying production data outside the app, set the tenant context explicitly:

```bash
PGOPTIONS="-c app.current_tenant_id=<tenant-uuid>" psql ...
```

`pg_dump` needs `--enable-row-security` for the same reason.

## Community and archive

- **Forum** lives in `forum_topics`, `forum_replies`, and board metadata. Topics can be marked `is_fictional`; the badge is part of the public response.
- **Catalog** stores archive entries and their versions. Public visibility is decided by `publication_status` plus publish time; drafts are visible only to editors and the linked author.
- **Reader** keeps per-user progress and reading history. **Library** stores bookmarks and reading lists. **Follows** and **notifications** connect authors, topics, and readers.
- **Comments** are attached to archive entries. Moderation reports cover both posts and comments.
- **Gamification** owns points, check-in, and the shop. Points are reputation only and never grant moderation rights; roles do that.

Legacy submission, review, and ingest packages remain in the tree for historical archive conversion and encrypted-backup tooling. Their HTTP routers are not mounted.

## Frontend

The SPA uses React, TypeScript, Vite, TanStack Router, TanStack Query, and Tailwind. Desktop and mobile layouts are separate: mobile uses a bottom tab bar and its own card layout rather than a scaled desktop view.

Public routes are `home`, `community`, `archive`, `guide`, `about`, `privacy`, and `me`. The admin shell lives under `/admin` and is gated by the API's permission role.

## Deployment

The repository ships a reproducible Compose stack: PostgreSQL, the app, and Caddy; Alembic runs on startup. The current public server uses a different shape: systemd `rubbish-app.service` on `127.0.0.1:8080`, Nginx for TLS/gzip/cache, a local PostgreSQL 17 container, and `/opt/rubbish-app/static` for the built SPA. Both shapes run the same application code; deployment commands, backups and rollback differ.

See [DEPLOY.md](../DEPLOY.md) for both procedures and [ENGINEERING.md](ENGINEERING.md) for the live paths.
