<div align="center">

<img src="docs/assets/logo-horizontal.svg" alt="Rubbish" width="320" />

# Rubbish

**An open-access journal for the world's academic rubbish — Submit · Review · Publish · Read, the entire publishing loop in one codebase**

> 16 backend modules · 870 unit tests · Playwright E2E · strictly typed end to end

**🌐 [English](README.md) · [简体中文](README.zh-CN.md)**

[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-orange.svg?style=flat-square)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12+-3776AB.svg?logo=python&logoColor=white&style=flat-square)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.139-009688.svg?logo=fastapi&logoColor=white&style=flat-square)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg?logo=react&logoColor=white&style=flat-square)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1.svg?logo=postgresql&logoColor=white&style=flat-square)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker_Compose-2496ED.svg?logo=docker&logoColor=white&style=flat-square)](https://docs.docker.com/compose/)
[![Unit tests](https://img.shields.io/badge/unit_tests-870-10B981?style=flat-square&logo=pytest&logoColor=white)](#testing)
[![E2E](https://img.shields.io/badge/E2E_specs-68-22C55E?style=flat-square&logo=playwright&logoColor=white)](#testing)

**Mirrors**: [GitHub x33834](https://github.com/x33834/rubbish) · [GitHub Morningstar](https://github.com/Morningstar202604/rubbish) · [GitHub badhope](https://github.com/badhope/rubbish) · [GitCode](https://gitcode.com/badhope/rubbish) · [Gitee](https://gitee.com/badhope/rubbish)

**[Features](#features) · [Screenshots](#screenshots) · [Architecture](#architecture) · [Quick Start](#quick-start) · [Tech Stack](#tech-stack) · [Testing](#testing) · [Docs](#docs)**

</div>

---

## Positioning: open-source example vs. production service

| | What it is | Where showcase content lives |
| --- | --- | --- |
| **Open-source example** (this repo) | Reference implementation of the Rubbish journal platform — clone it, self-host it, adapt it. | `site/` marketing pages, `docs/assets/`, README screenshots |
| **Production service** ([rubbish.argjiemi.cn](https://rubbish.argjiemi.cn)) | A **live journal in production**, serving submission, review, publication and reading. The running app carries no screenshot galleries or promo material. | nowhere — de-showcased by design |

## Features

| Role | Capability |
| --- | --- |
| **Author** | Submit manuscripts (with PDF), multi-version revisions, track review status (pending / major / minor / accept / reject) |
| **Editor** | Assign reviewers, decide (with editorial notes), manuscript management workbench |
| **Reviewer** | Review reports, blind review (single / double), decision recommendation |
| **Reader** | Public catalog search, **passwordless email-code sign-in**, **in-reader typography controls (font size / line height / serif)**, **instant manuscript structure check on upload**, **in-browser reading (pdf.js) — no login wall**, cross-device reading progress (local-storage fallback for guests), follow authors, subscribe |
| **Community** | Reader comments on published papers (public read, login to post, owner/admin delete with audit), **independent discussion board (post / reply / categories / pin / lock, login to post)**, guest mode with local storage |
| **Journal** | **Two paper tracks (academic / absurd) plus a separate supplement**, required at submission, filterable in the catalog and labelled on detail pages; editorial metrics (R factor, absurdity index) with hidden methodology, author guide / policies / about pages, submission templates |
| **Admin** | Users (search / suspend / **promote to platform admin** / grant & revoke roles) / volumes / issues / journals management, **announcement management**, audit logs, batch import (BibTeX / RIS / CSV / DOI / arXiv), **one-click issue publish & reschedule** |

**Secure by default**: passwordless email-code sign-in (hashed one-time codes, rate limited), WebAuthn passkeys + TOTP 2FA, server-side JWT revocation with key rotation, sign-up captcha, per-action audit logs, multi-tenant isolation (PostgreSQL RLS).

**Lightweight deployment**: single-node `docker compose up`; PostgreSQL for production, SQLite + single-port service for dev/demo.

## Screenshots

| Public home | Paper catalog | Article page |
| --- | --- | --- |
| ![Public home](docs/assets/screenshots/rubbish-home.png) | ![Paper catalog](docs/assets/screenshots/rubbish-catalog.png) | ![Article page](docs/assets/screenshots/rubbish-reader.png) |

| Forum | Volume archive | Journal data |
| --- | --- | --- |
| ![Forum](docs/assets/screenshots/rubbish-forum.png) | ![Volume archive](docs/assets/screenshots/rubbish-archive.png) | ![Journal data](docs/assets/screenshots/rubbish-about.png) |

| Mobile catalog | Mobile article | Interface overview |
| --- | --- | --- |
| ![Mobile catalog](docs/assets/screenshots/mobile-catalog.png) | ![Mobile article](docs/assets/screenshots/mobile-detail.png) | ![Interface overview](docs/assets/screenshots-overview.png) |

## Architecture

![architecture](docs/assets/architecture.svg)

**Core flow**: Submit → assign reviewers → blind review → editor decision → publish to public catalog → read online.

![workflow](docs/assets/workflow.svg)

## Quick Start

### Option 1: Docker Compose (recommended, one command)

```bash
docker compose up -d
# open http://localhost:8000
```

### Option 2: Single-port dev/demo service (no containers)

```bash
cd apps/backend
cp .env.example .env          # adjust secrets as needed
uv sync --group dev --locked  # install dependencies
uv run alembic upgrade head   # initialize the database
uv run python deploy_server.py
# backend API + frontend static assets + uploads, all on http://localhost:8000
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19 · TypeScript 5.9 · TanStack Router/Query · Tailwind CSS v4 · pdf.js |
| Backend | FastAPI · SQLAlchemy 2 (async) · Alembic · PostgreSQL 17 / SQLite |
| Security | WebAuthn · TOTP · JWT denylist · bcrypt · CSP headers |
| Quality | pytest (870) · Playwright E2E (68) · ruff · mypy strict · npm audit |

## Testing

```bash
# Backend (unit + migration consistency)
cd apps/backend && uv run pytest

# Frontend (lint + typecheck + unit + build)
cd apps/frontend && npm ci && npm run lint && npm run typecheck && npm test

# E2E (submit → review → accept full journey)
cd apps/frontend && E2E_SPAWN_SERVER=1 npx playwright test
```

## Docs

- [Architecture deep dive](docs/ARCHITECTURE.md) · [Deployment guide](DEPLOY.md)
- [Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

## License

Code is released under [PolyForm Noncommercial 1.0.0](LICENSE): free to use, modify, and redistribute for **learning, research, and noncommercial purposes only** — commercial use, paid services, and bundling into charged products are not permitted.

Papers and site content remain the property of their authors.
