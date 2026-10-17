# Changelog

本文件记录 ScholarHUB 每个版本值得关注的变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)
，版本号遵循语义化版本 `主版本.次版本.修订号`（三段都要写全，修订号不得省略）。

版本号的唯一真源是仓库根目录 `VERSION`，必须与
`apps/backend/pyproject.toml`、`apps/frontend/package.json`、`apps/backend/app/__init__.py`
四处完全一致，由 `scripts/check-version.sh` 守门。

## [0.2.2] — 2026-10-18

安全加固版本，修完全部 9 项 P0（详见 `scholarhub-代码审计报告.md`）。

### Security

- **P0-1 移除 `/uploads` 静态挂载**：此前投稿上传的 PDF 以零鉴权静态目录对外提供，
  任何匿名/跨租户用户拿到 `/uploads/<uuid>.pdf` 即可下载**未公开稿件**，
  完全绕开 `GET /api/submissions/{id}/files` 的作者/编辑/审稿人鉴权。
  现在稿件文件只经鉴权端点流出；已发表文章改走新增的公开端点
  `GET /api/catalog/{id}/file`（只有进入公开目录的资源可读）。
- **P0-2 PostgreSQL RLS 真正落地**（迁移 `c5a3e91b7d20`）：19 张租户表全部
  `ENABLE` + `FORCE ROW LEVEL SECURITY` 并建 `tenant_isolation` 策略。
  此前迁移里一条 RLS 语句都没有，文档宣称的"隔离第二层"并不存在。
  配套修复 bootstrap 的 GUC 时序（改为两段会话，否则启动即 500）。
  已在 PostgreSQL 17 上实测：无 GUC 时 fail-closed、跨租户读写双向隔离。
- **P0-3 DOI 不再撞号**：默认后缀改为 `{resource_id}-{tenant_id 前 8 位}`
  （原为全局自增 id，多租户下必然重复）；后缀加 `^[A-Za-z0-9._-]+$` 校验；
  迁移 `b7f1c0d2a934` 为 `resources.doi` 与 `doi_registrations.doi` 补唯一约束。
- **P0-4 双盲评审不再被击穿**：双盲下审稿人不再拿到原始 PDF（含作者姓名单位），
  只放行编辑显式提供的匿名稿外链，否则明确报错由编辑补传。
- **P0-5 编辑机密收口**：审稿人只能读取**自己**那份报告的 `comments_to_editor`，
  此前任何有 assignment 的人（含仅受邀未接受者）都能看到全部报告的机密评论。
- **P0-6 修复登录开放重定向**：`?redirect=` 现在只接受站内相对路径
  （`safeInternalPath`），杜绝"登录成功→跳钓鱼站"。
- **P0-7 CSRF cookie 下发接线**：`_ensure_csrf_cookie` 原为死代码，开启 CSRF
  后所有写请求必然 403；现在在安全方法响应中下发。
- **P0-8 CSP 与边缘安全头**：`frame-src` 改为 `frame-ancestors`（前者方向相反，
  根本没防住点击劫持），补 `base-uri`/`form-action`；根 `Caddyfile` 补齐此前
  完全缺失的安全响应头。

### Tests

- `test_doi.py` 中固化了旧（撞号）后缀格式的断言已更新为租户维度格式。

### Fixed

- **CI 依赖锁同步**：`uv.lock` 未随 `pyproject.toml` 更新，导致 GitHub Actions 后端/迁移/安全/e2e 四个 job 全部失败于 `uv sync --locked`。重新生成锁定文件，`setup-uv` 升级到 0.13.1 与锁生成器一致。
- **Ruff lint/format**：修复 `bootstrap.py` 导入排序（I001）与 `catalog/models.py`、`doi/schemas.py` 格式问题，本地 642 测试通过。
- GitHub 分支保护规则中移除不存在的幽灵检查项 `Scan for secrets`（该检查无对应 workflow，导致直接推送死锁），替换为 CI 实际产出的 8 个检查。
- 五平台镜像同步为 append-only/强制对齐两种模式治理：镜像（Morningstar202604、X33834、gitee）与核心 badhope 保持内容一致。

## [0.2.1] — 2026-10-18

### Changed

- **许可证由 Apache-2.0 改为 MIT**（`LICENSE` 全文替换，删除 Apache 专用的 `NOTICE`，
  同步更新 `README.md` / `README.zh-CN.md` 徽章、`SUPPORT.md`、`apps/backend/pyproject.toml`
  与官网 `site/` 页脚）。MIT 对商业托管与二次分发更友好。

### Fixed

- 恢复 `.github/workflows/ci.yml` 与 `.github/workflows/deploy-site.yml`：此前两个工作流被误删，
  导致 GitHub 主仓库（badhope，核心仓库）完全失去 CI 门禁。

### Removed

- 删除与 `VERSION` 矛盾的 `v1.0.0` 轻量标签（它实际指向一个 Dependabot 配置提交，
  而当时版本是 0.2.0）。标签一律使用附注标签（`git tag -a`），并与 `VERSION` 三段完全一致。

### Housekeeping

- 明确仓库主从关系：**GitHub/badhope 为核心仓库**，GitCode、Gitee、X33834、Morningstar202604
  均为只读镜像，禁止在镜像上直接提交（此前在镜像上手工提交导致五平台 HEAD 全部分叉）。
- 五平台对齐统一走 `scholarhub-sync-all`（平台间 3 秒间隔，分叉时用 `--force`）。

### Known issues

- 演示视频与官网截图仍为旧版（含历史遗留的大文件），待本轮问题修复完成后统一重新生成并替换。
- 演示视频与官网截图仍为旧版（含历史遗留的大文件），待本轮打磨完成后统一重新生成并替换。
- 代码审计发现的 P1（31 项）与 P2（约 55 项）尚未处理，详见 `scholarhub-代码审计报告.md`。

## [0.2.0] — 2026-09-14

- 部署指南、治理模板、版本守门脚本落地。
- 迁移收敛为单个初始迁移（`3392b958c074_001_initial_schema`）。
- 三平台 CI、依赖锁定、官网中英文切换。

## [0.1.0] — 2026-09-02

- 首个可运行版本：投稿、评审、目录、阅读器主链路。
