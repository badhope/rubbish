<div align="center">

<img src="docs/assets/logo-horizontal.svg" alt="Rubbish" width="320" />

# Rubbish

**收录全球学术垃圾的开放获取期刊 — Submit · Review · Publish · Read，一个代码库跑完整个出版闭环**

> 16 个后端模块 · 870 单元测试 · Playwright E2E · 全链路严格类型

**🌐 [English](README.md) · [简体中文](README.zh-CN.md)**

[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-orange.svg?style=flat-square)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12+-3776AB.svg?logo=python&logoColor=white&style=flat-square)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.139-009688.svg?logo=fastapi&logoColor=white&style=flat-square)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg?logo=react&logoColor=white&style=flat-square)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1.svg?logo=postgresql&logoColor=white&style=flat-square)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker_Compose-2496ED.svg?logo=docker&logoColor=white&style=flat-square)](https://docs.docker.com/compose/)
[![Unit tests](https://img.shields.io/badge/unit_tests-870-10B981?style=flat-square&logo=pytest&logoColor=white)](#测试)
[![E2E](https://img.shields.io/badge/E2E_specs-68-22C55E?style=flat-square&logo=playwright&logoColor=white)](#测试)

**镜像仓库**：[GitHub x33834](https://github.com/x33834/rubbish) · [GitHub Morningstar](https://github.com/Morningstar202604/rubbish) · [GitHub badhope](https://github.com/badhope/rubbish) · [GitCode](https://gitcode.com/badhope/rubbish) · [Gitee](https://gitee.com/badhope/rubbish)

**[功能一览](#功能一览) · [界面预览](#界面预览) · [架构](#架构) · [快速开始](#快速开始) · [技术栈](#技术栈) · [测试](#测试) · [文档](#文档)**

</div>

---

## 定位：开源示例 vs 生产服务

| | 是什么 | 展示性内容放在哪 |
| --- | --- | --- |
| **开源示例**（本仓库） | Rubbish 期刊平台的参考实现——克隆、自部署、二次开发。 | `site/` 宣传页、`docs/assets/`、README 截图 |
| **生产服务**（[rubbish.argjiemi.cn](https://rubbish.argjiemi.cn)） | **正式上线的真实期刊**，直接服务投稿、评审、刊出与阅读。运行中的应用不含截图图集等宣传内容。 | 无——设计上已去展示化 |

## 功能一览

| 角色 | 能力 |
| --- | --- |
| **作者** | 新建投稿（附 PDF）、多版本修订、跟踪审核状态（待审/大修/小修/录用/拒稿） |
| **编辑** | 审稿人指派、裁决（含编辑备注）、稿件管理工作台 |
| **审稿人** | 审稿报告、盲审（单盲/双盲）、决定建议 |
| **读者** | 公开目录检索、**邮箱验证码免密登录**、**阅读页字号/行距/宋黑排版控制**、**稿件结构自动检查（上传即报缺什么）**、**浏览器内在线阅读 Markdown（图表内联、图注、KaTeX，无需登录墙）**、跨设备阅读进度（游客本地保存）、关注作者、订阅通知、**主题封面卡片** |
| **社区** | **独立讨论区（发帖/回帖/分类/置顶/锁定，登录即可发）**、论文读者评论区（公开可读、登录可评、本人/管理员可删且审计留痕）、游客模式本地存储 |
| **身份与成长** | 四层身份（读者 → 作者 → 审稿人 → 编辑，与后端权限一一对应）、积分仅作荣誉统计不充当权限、27 枚成就徽章、个人中心（`/me`）、公开的身份与评分规范（`/guide?tab=levels`）、审稿人申请通道 |
| **期刊运营** | **论文与副刊双轨（学术论文 / 荒诞论文 / 副刊，投稿必选、目录可筛、详情页徽章、分轨统计）**、编辑部自设计指标（R 因子、荒诞指数，口径不公开）、**RQS v5.1 双轨评分（学术五维 / 荒诞六维含荒诞度；每维必给分，理由与正文证据选填）**、**按月分期的定时发布（`publish_at` + 公开出版日历 `/archive`）**、首访公告、作者指南 / 政策规范 / 关于本刊页、投稿模板 |
| **管理员** | **用户提权为平台管理员**、**公告管理**、用户/卷/期/期刊管理、审计日志、批量导入（BibTeX / RIS / CSV / DOI / arXiv）、**一键发整期 / 改期** |

**安全默认开启**：邮箱验证码登录（一次性哈希码 + 频率限制）、WebAuthn 通行密钥 + TOTP 双因素、JWT 服务端吊销与密钥轮换、注册验证码、全操作审计日志、多租户隔离（PostgreSQL RLS）。

**轻量部署**：单机 `docker compose up` 即可；生产用 PostgreSQL，开发/演示用 SQLite + 单端口服务。

## 界面预览

| 公开首页 | 论文目录 | 文章页 |
| --- | --- | --- |
| ![公开首页](docs/assets/screenshots/rubbish-home.png) | ![论文目录](docs/assets/screenshots/rubbish-catalog.png) | ![文章页](docs/assets/screenshots/rubbish-reader.png) |

| 讨论区 | 卷期归档 | 本刊数据 |
| --- | --- | --- |
| ![讨论区](docs/assets/screenshots/rubbish-forum.png) | ![卷期归档](docs/assets/screenshots/rubbish-archive.png) | ![本刊数据](docs/assets/screenshots/rubbish-about.png) |

| 手机目录 | 手机文章页 | 界面总览 |
| --- | --- | --- |
| ![手机目录](docs/assets/screenshots/mobile-catalog.png) | ![手机文章页](docs/assets/screenshots/mobile-detail.png) | ![界面总览](docs/assets/screenshots-overview.png) |

## 架构

![architecture](docs/assets/architecture.svg)

**核心流程**：投稿 → 分配审稿人 → 盲审 → 编辑裁决 → 收录公开目录 → 在线阅读。

![workflow](docs/assets/workflow.svg)

## 快速开始

### 方式一：Docker Compose（推荐，一条命令）

```bash
docker compose up -d
# 打开 http://localhost:8000
```

### 方式二：单端口开发/演示服务（无需容器）

```bash
cd apps/backend
cp .env.example .env          # 按需修改密钥
uv sync --group dev --locked  # 安装依赖
uv run alembic upgrade head   # 初始化数据库
uv run python deploy_server.py
# 后端 API + 前端静态资源 + 上传文件，全部跑在 http://localhost:8000
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 · TypeScript 5.9 · TanStack Router/Query · Tailwind CSS v4 · pdf.js |
| 后端 | FastAPI · SQLAlchemy 2 (async) · Alembic · PostgreSQL 17 / SQLite |
| 安全 | WebAuthn · TOTP · JWT denylist · bcrypt · CSP 安全头 |
| 质量 | pytest (870) · Playwright E2E (68) · ruff · mypy strict · npm audit |

## 测试

```bash
# 后端（单元 + 迁移一致性）
cd apps/backend && uv run pytest

# 前端（lint + typecheck + 单测 + 构建）
cd apps/frontend && npm ci && npm run lint && npm run typecheck && npm test

# E2E（投稿 → 审稿 → 录用全链路）
cd apps/frontend && E2E_SPAWN_SERVER=1 npx playwright test
```

## 文档

- [架构详解](docs/ARCHITECTURE.md) · [部署手册](DEPLOY.md)
- [贡献指南](CONTRIBUTING.md) · [行为准则](CODE_OF_CONDUCT.md)

## License

代码以 [PolyForm Noncommercial 1.0.0](LICENSE) 发布：可自由使用、修改、再分发，但**仅限学习、研究与非商业用途**——不得商用、不得收费提供服务、不得捆绑进收费产品。论文与站点内容的著作权归作者所有。
