<div align="center">

<img src="docs/assets/logo-horizontal.svg" alt="Rubbish" width="300" />

# Rubbish

**一个可以自己部署的荒诞科研社区：问点奇怪的问题，老老实实记录，公开失败，也公开争论。**

**[English](README.md) · 简体中文**

[![CI](https://github.com/badhope/rubbish/actions/workflows/ci.yml/badge.svg)](https://github.com/badhope/rubbish/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-orange.svg)](LICENSE)

</div>

Rubbish 收留那些不太符合常规格式的研究。你可以在还没答案时先贴出计划，记录实际发生了什么，把失败的过程留在原地，再让其他人来质疑结果。长内容可以整理进档案，短讨论留在社区。

整个项目是一个 FastAPI 服务、一个 React 前端和一份 PostgreSQL 数据库，一台小服务器就能跑起来。

## 可以做什么

- **在版块里讨论。** 研究计划、实验记录、田野观察、失败档案、科研生存、组队招募，各有各的位置。
- **发布档案。** 较长的记录会得到稳定页面，包含正文、版本记录、下载、评论和相关内容。
- **虚构内容明确标注。** 社区帖子可以带上醒目的“虚构”徽标，想象出来的东西不会冒充真实记录。
- **跟进关心的内容。** 收藏、阅读进度、关注作者、通知和主题订阅都能跨设备使用。
- **够用的管理能力。** 举报、版块管理、公告、审计日志和后台入口都已经接好。
- **自己部署。** Docker Compose、Caddy 自动 HTTPS、Alembic 迁移和 PostgreSQL 行级安全都已配置。

## 快速开始

```bash
git clone https://github.com/badhope/rubbish.git
cd rubbish
cp .env.example .env
# 填写 SITE_DOMAIN、POSTGRES_PASSWORD、RUBBISH_SECRET_KEY、RUBBISH_FERNET_KEY、RUBBISH_ADMIN_PASSWORD
docker compose up -d --build
```

打开 `https://<你的域名>`，再访问 `https://<你的域名>/api/health` 检查服务。首次启动会自动执行数据库迁移。

不用 Docker 的本地开发方式：

```bash
# 后端
cd apps/backend
uv sync
uv run alembic upgrade head
uv run python e2e_run_server.py

# 前端，另开一个终端
cd apps/frontend
npm ci
npm run dev
```

前端地址是 `http://localhost:5173`，API 地址是 `http://localhost:8000`。

## 目录

| 路径 | 用途 |
|---|---|
| `apps/backend` | FastAPI、领域模块、Alembic 迁移和测试 |
| `apps/frontend` | React + TypeScript 前端、版块、阅读器和后台 |
| `infra/` | Docker、Caddy 和部署辅助文件 |
| `ops/` | 服务器维护与发布脚本 |
| `docs/` | 产品说明、架构、部署和截图 |

## 文档

| 文档 | English | 中文 |
|---|---|---|
| 产品与用词 | [docs/POSITIONING.md](docs/POSITIONING.md) | [docs/POSITIONING.zh-CN.md](docs/POSITIONING.zh-CN.md) |
| 架构 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | [docs/ARCHITECTURE.zh-CN.md](docs/ARCHITECTURE.zh-CN.md) |
| 部署 | [DEPLOY.md](DEPLOY.md) | [DEPLOY.zh-CN.md](DEPLOY.zh-CN.md) |
| 贡献 | [CONTRIBUTING.md](CONTRIBUTING.md) | [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) |
| 安全 | [SECURITY.md](SECURITY.md) | [SECURITY.zh-CN.md](SECURITY.zh-CN.md) |

## 检查

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

## 许可

源码采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。商业用途需要单独授权。
