<div align="center">

<img src="docs/assets/logo-horizontal.svg" alt="Rubbish" width="300" />

# Rubbish

**A self-hostable public writing and discussion community — open a question, keep the process, say the thing plainly.**

**English · [简体中文](README.zh-CN.md)**

[![CI](https://github.com/badhope/rubbish/actions/workflows/ci.yml/badge.svg)](https://github.com/badhope/rubbish/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-orange.svg)](LICENSE)

</div>

Rubbish does not ask for a particular format. A long piece can be a careful investigation, a short story, or an essay; a short thread can be a stuck point or an argument. Finished work goes into the library, unfinished thoughts stay in the forum, and readers can reply or just read.

It is one FastAPI service, one React app, and PostgreSQL. You can run the whole thing on a single small server.

## What you can do

- **Talk in the sections.** Writing methods, retrospectives, team-finding, creative life, and site feedback each have their own place.
- **Publish a piece.** A longer piece gets a stable page with a body, revision history, downloads, comments, and related work.
- **Mark fiction as fiction.** Stories, jokes, and invented situations can carry a visible fiction label, so readers are not misled.
- **Follow what matters.** Bookmarks, reading progress, author follows, notifications, and topic subscriptions work across devices.
- **Keep moderation practical.** Reports, section management, announcements, audit logs, and a small admin area are built in.
- **Run it yourself.** Docker Compose, automatic HTTPS through Caddy, Alembic migrations, and PostgreSQL row-level security are already wired up.

## Quick start

```bash
git clone https://github.com/badhope/rubbish.git
cd rubbish
cp .env.example .env
# Set SITE_DOMAIN, POSTGRES_PASSWORD, RUBBISH_SECRET_KEY, RUBBISH_FERNET_KEY, RUBBISH_ADMIN_PASSWORD
docker compose up -d --build
```

Open `https://<your-domain>` and check `https://<your-domain>/api/health`. The first startup runs the database migrations.

For local development without Docker:

```bash
# backend
cd apps/backend
uv sync
uv run alembic upgrade head
uv run python e2e_run_server.py

# frontend, in another terminal
cd apps/frontend
npm ci
npm run dev
```

The frontend runs on `http://localhost:5173`; the API runs on `http://localhost:8000`.

## Project layout

| Path | Purpose |
|---|---|
| `apps/backend` | FastAPI app, domain modules, Alembic migrations, tests |
| `apps/frontend` | React + TypeScript SPA, section UI, reader, admin shell |
| `infra/` | Docker, Caddy, and deployment helpers |
| `ops/` | Server maintenance and release scripts |
| `content/articles` | Public article texts and author names, including drafts and duplicate records |
| `docs/` | Product notes, architecture, deployment, and screenshots |

## Published work

The current server texts and author names are in [`content/articles`](content/articles/README.md): 274 published entries, 21 pending, and 15 duplicate records. This is public work only. Scores, review notes, account details, and server secrets are not stored here.

## Docs

| Document | English | 中文 |
|---|---|---|
| Product and vocabulary | [docs/POSITIONING.md](docs/POSITIONING.md) | [docs/POSITIONING.zh-CN.md](docs/POSITIONING.zh-CN.md) |
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | [docs/ARCHITECTURE.zh-CN.md](docs/ARCHITECTURE.zh-CN.md) |
| Deployment | [DEPLOY.md](DEPLOY.md) | [DEPLOY.zh-CN.md](DEPLOY.zh-CN.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) | [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) |
| Security | [SECURITY.md](SECURITY.md) | [SECURITY.zh-CN.md](SECURITY.zh-CN.md) |

## Checks

```bash
cd apps/backend
uv run ruff check .
uv run mypy app --exclude 'app/domain/submission' --exclude 'app/domain/ingest' \
  --exclude 'app/interfaces/http/submission' --exclude 'app/interfaces/http/review'
uv run pytest -q

cd ../frontend
npm run lint
npm run typecheck
npm run build
```

## License

Source code is available under the [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use needs a separate agreement.
