<div align="center">

<img src="docs/assets/logo-horizontal.svg" alt="Rubbish" width="300" />

# Rubbish

**A self-hostable absurd research community — ask odd questions, keep honest notes, publish failures, argue in the open.**

**English · [简体中文](README.zh-CN.md)**

[![CI](https://github.com/badhope/rubbish/actions/workflows/ci.yml/badge.svg)](https://github.com/badhope/rubbish/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-orange.svg)](LICENSE)

</div>

Rubbish is a place for research that does not fit the usual format. Post a plan before you know the answer, log what actually happened, keep the failed attempts, and let other people question the result. Long notes can be collected into an archive; short threads stay in the community.

It is one FastAPI service, one React app, and PostgreSQL. You can run the whole thing on a single small server.

## What you can do

- **Discuss in boards.** Research plans, experiment logs, field notes, failure archives, lab-life talk, and team-finding each have their own board.
- **Publish an archive entry.** Longer records get a stable page with a readable body, version history, downloads, comments, and related work.
- **Mark fiction as fiction.** Community posts can carry a visible fiction badge, so imagined work never passes as a real record.
- **Follow what matters.** Bookmarks, reading progress, author follows, notifications, and topic subscriptions work across devices.
- **Keep moderation practical.** Reports, board management, announcements, audit logs, and a small admin area are built in.
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
| `apps/frontend` | React + TypeScript SPA, board UI, reader, admin shell |
| `infra/` | Docker, Caddy, and deployment helpers |
| `ops/` | Server maintenance and release scripts |
| `docs/` | Product notes, architecture, deployment, and screenshots |

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
