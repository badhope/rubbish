# 架构

**[English](ARCHITECTURE.md) · 简体中文**

## 整体形状

Rubbish 是一个模块化单体。一个 FastAPI 进程提供 HTTP API，在单机部署里也直接提供构建后的前端。PostgreSQL 同时保存社区数据和档案。

```text
React SPA（Vite、TanStack Router）
            │  HTTP
            ▼
FastAPI ── core：配置、数据库、认证、租户、存储、邮件、限流
   │
   ├── domain：catalog、forum、comments、reader、notifications、follows、
   │           library、recommendations、gamification、announcements
   ├── interfaces/http：路由模块与请求/响应模型
   ├── api：auth、admin、health、me、SEO、privacy、support
   └── modules：挂载已启用领域路由的清单
            │
            ▼
PostgreSQL 17（行级安全）+ 本地上传目录或 S3 兼容存储
```

## 后端分层

| 层 | 职责 |
|---|---|
| `app/core` | 配置、数据库会话、租户上下文、安全、日志、邮件、存储、限流 |
| `app/domain` | 模型与业务规则；不导入 HTTP 层或 FastAPI |
| `app/interfaces/http` | 路由、DTO、可见性判断、分页 |
| `app/api` | 认证、后台、健康检查、SEO、隐私等横切接口 |
| `app/models` | 共享的身份与租户模型 |
| `app/modules` | 声明模块路由与依赖的组合清单 |

依赖方向只能向内：`api` / `interfaces` → `domain` → `core`。`tests/test_architecture_layers.py` 会检查 core 不反向依赖 domain。唯一例外是 `core/bootstrap.py`，它在启动时给新租户种默认版块。

## 租户

每个租户表都带 `tenant_id`，并启用 `FORCE ROW LEVEL SECURITY`。默认部署是单租户：中间件在任何查询之前解析出一个租户 ID。多租户的 host 查找只存在于表结构里，产品界面尚未启用。

在应用之外查生产数据时，需要显式设置租户上下文：

```bash
PGOPTIONS="-c app.current_tenant_id=<租户UUID>" psql ...
```

`pg_dump` 同样需要 `--enable-row-security`。

## 社区与档案

- **社区**数据在 `forum_topics`、`forum_replies` 和版块表里。帖子可以标 `is_fictional`，公开响应里会带“虚构”徽标。
- **档案**保存长内容和版本。公开可见性由 `publication_status` 和发布时间共同决定；草稿只对内容管理员和关联作者可见。
- **阅读器**保存每人的阅读进度和历史；**收藏夹**保存书签和阅读列表；**关注**和**通知**把作者、主题与读者连起来。
- **评论**挂在档案条目上，举报同时覆盖帖子和评论。
- **积分**负责签到、积分和兑换。积分只是荣誉，不授予管理权限；权限由角色决定。

旧的 submission、review、ingest 包仍留在代码树里，仅供历史档案转换和加密备份工具使用，对应的 HTTP 路由没有挂载。

## 前端

前端使用 React、TypeScript、Vite、TanStack Router、TanStack Query 和 Tailwind。桌面与手机分别设计：手机使用底部 Tab 栏和自己的卡片布局，不把桌面版缩小了事。

公开路由是 `首页 / 社区 / 档案 / 指南 / 关于 / 隐私 / 我的`。后台壳在 `/admin` 下，由 API 返回的权限档位控制。

## 部署

`docker compose` 启动 PostgreSQL、应用和 Caddy。启动时执行 Alembic 迁移。Caddy 负责 TLS 和反向代理。上传文件放在持久卷里；生产备份在进入仓库前已经加密。

完整步骤见 [DEPLOY.zh-CN.md](../DEPLOY.zh-CN.md)。
