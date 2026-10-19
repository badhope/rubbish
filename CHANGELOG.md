# Changelog

本文件记录 ScholarHUB 每个版本值得关注的变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)
，版本号遵循语义化版本 `主版本.次版本.修订号`（三段都要写全，修订号不得省略）。

版本号的唯一真源是仓库根目录 `VERSION`，必须与
`apps/backend/pyproject.toml`、`apps/frontend/package.json`、`apps/backend/app/__init__.py`
四处完全一致，由 `scripts/check-version.sh` 守门。

## [0.2.2] — 2026-10-18

安全加固版本，修完全部 9 项 P0 级安全问题。

### Changed

- **依赖树全量升级到最新**：后端 `uv lock --upgrade`（websockets 17.2、typer 0.27.3、
  mako 1.4.3、watchfiles/uvloop/wcwidth/typing-inspection 等；fastapi 0.139、
  pydantic 2.13.4、SQLAlchemy 2.0.51、alembic 1.18.5 此前已是最新不变）；
  前端 npm 依赖全量升级（react 19.3.1、vite 8.3.4、@sentry/react 11.8.0、
  vitest 5.0.5、playwright 1.64.1、eslint 10.13、axios 1.20.0、radix/tailwind 系列），
  TypeScript 保持在 5.x（TS 7 为原生编译器预览线，生态未就绪，按计划排除）。
- **Sentry JS SDK v11 适配**：`sendDefaultPii` 配置项在 v11 中移除（PII 默认即被剥离），
  删除 `src/lib/monitoring.ts` 中的该字段。
- **vitest 5 测试适配**：`src/lib/__tests__/api.test.ts` 的模块加载时机调整为用例内
  `vi.resetModules()` + 动态 import——vitest 5 中 beforeAll 期间产生的 mock 调用不会
  保留到用例执行阶段；同时将 4 处 `if (!interceptor) return` 假绿守卫改为硬断言
  （`expect(...).toBeTypeOf('function')` + `if (!x) throw` 类型收窄）。
- **移除 next-themes 依赖**：其 ThemeProvider 内部无条件渲染一个 inline `<script>`
  （ThemeScript 组件）。在纯 client-render 的 Vite SPA 中该 script 永远不会执行，
  React 19.3 起 dev 模式还会告警 "Encountered a script tag while rendering React
  component"，且 index.html 的 CSP `script-src 'self'` 会直接拦截 inline script
  （线上同样报 CSP violation）。改为自研的极简 ThemeProvider
  （localStorage 持久化 + matchMedia 系统偏好 + 多标签同步 + class 切换），
  首屏防闪烁沿用 `public/theme-bootstrap.js` 外链脚本；修复后移动端 5 个 E2E
  用例的 console 零报错断言恢复通过，全量 68 个 E2E 全绿。

### Added

- **编辑端双盲匿名稿链接 UI**：后端 `PUT /api/submissions/{id}/anonymized-file`
  此前只有 API、没有任何前端入口，编辑只能直接调接口才能为双盲评审提供匿名稿。
  现在编辑工作台（`/submissions/pending`）每张卡片新增「匿名稿」按钮与弹窗：
  可填写 http(s) 匿名稿外链或清除已有链接，并明确提示服务端不具备剥离 PDF
  元数据的能力（需由编辑确认匿名稿本身不含作者姓名与单位）。前端类型同步补上
  `anonymized_file_url`，并新增 `useSetAnonymizedFile` mutation。

### Security

- **双盲绕过 v2 修复（P0-4 加固）**：审稿人文件端点在双盲下曾把审稿人 302 重定向到
  `download_url`，但该字段**完全作者可控**（创建端点与作者编辑端点均可写）——
  作者填一条带身份的 URL 即可直穿双盲（重定向目标对审稿人可见，页面内容更可直接
  暴露姓名单位）；审稿人视角的 JSON 序列化同样保留了作者可控的
  `download_url`/`external_url`（原注释假设其为"编辑提供的匿名稿"，与控制面不符）。
  现新增**编辑专属**列 `submissions.anonymized_file_url`（迁移 `d4e5f6a7b8c9`），
  只由编辑端点 `PUT /api/submissions/{id}/anonymized-file` 写入：
  - 双盲 + 审稿人取稿件：只放行到编辑提供的匿名稿外链，否则 403 并提示编辑补传；
  - 双盲审稿人 JSON：`download_url`/`external_url` 抹除，作者可控链接不再流出；
  - 作者编辑端点的 schema 不含该字段，作者无法经编辑通道写入。
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

- **DOI 撞号治理加固**：`POST /api/doi/register` 的自定义后缀此前只与**当前资源**的
  doi 列比对，复用另一资源已铸出的后缀会把铸造请求发往 DataCite、污染永久标识元数据，
  最后才在 commit 时撞唯一约束（500）。现在铸造前先查 `doi_registrations` 全局撞号
  → 409 且不打扰 DataCite；并发/预检漏过场景由 commit 的 IntegrityError → 409 兜底，
  目标资源 doi 列保持未设置。
- **公开文件端点纵深防御**（P0-1 加固）：`GET /api/catalog/{id}/file` 此前只校验
  资源存在，未校验 `publication_status`。编辑在"接受"投稿时可以把稿件对接到
  任一带 `resource_id` 的现有条目，若该条目为 draft/in_review，未公开稿件仍可
  经此公开端点匿名流出。查询现已加 `publication_status == "published"` 过滤，
  并补 4 个回归测试（published 200 / draft 404 / in_review 404 / 无文件 404）。
- **存储文件清理（孤儿对象治理）**：删除 pending 稿件与替换式上传此前都不清理
  存储后端（本地磁盘 / S3）中的旧文件，导致删除稿件后仍残留 PDF、重复上传无限
  累积孤儿对象，既造成存储泄漏，也留下"已删数据"的残留痕迹。现在
  `DELETE /api/submissions/{id}` 在删除记录后 best-effort 清理 `file_path` 对应
  文件；替换式 `POST /api/submissions/{id}/files` 在覆盖 `file_path` 前清理旧文件
  （uuid 碰撞兜底跳过自删）。清理失败仅告警、不阻断主流程。补 2 个回归测试
  （替换上传清旧文件 / 删除稿件清文件）。
- **CI 依赖锁同步**：`uv.lock` 未随 `pyproject.toml` 更新，导致 GitHub Actions 后端/迁移/安全/e2e 四个 job 全部失败于 `uv sync --locked`。重新生成锁定文件，`setup-uv` 升级到 0.13.1 与锁生成器一致。
- **Ruff lint/format**：修复 `bootstrap.py` 导入排序（I001）与 `catalog/models.py`、`doi/schemas.py` 格式问题，本地 642 测试通过。
- **GitHub 分支保护规则中移除不存在的幽灵检查项** `Scan for secrets`（该检查无对应 workflow，导致直接推送死锁），替换为 CI 实际产出的 8 个检查。
- **存储清理 helper 的打日志方式回正**：上次修复随 PR rebase 进入核心仓库，但真源 gitcode 的原始提交漏带了 lint/mypy 两处修正——`import logging` 位置错误（I001）、`logger.warning(..., key=key)` 不是标准 logging 的合法 kwarg（存储删除失败时实际会抛 `TypeError` 盖过主流程）、无用的 `# noqa: BLE001`（RUF100）。三处修正现已 cherry-pick 回真源，与核心仓库对齐。
- **限流器 circuit breaker 不再永久断开**：`RedisRateLimiterStore` 的熔断标志一旦置位，旧代码此后所有请求都短路到内存回退，**Redis 恢复后永远不会再被使用**——限流退化回单副本计数，与熔断注释宣称的"下次请求自动恢复"直接矛盾。现在熔断带冷却时间：冷却内走内存回退、不重复探活，冷却后首个请求探测 Redis，成功即重新 wire Redis 路径（多副本重新共享计数）。
- **内存限流桶不再无限驻留**：`MemoryRateLimiterStore` 此前只清理单个 key 内部的过期时间戳，bucket key 本身（`IP|路径桶`）一旦创建就永久驻留——换 IP 扫描的请求会让 `_buckets` 无界增长。现在 hit_and_check 内以低频率全图清扫（默认 60s 一次，删除最新条目老于 10 分钟的 key；最长配置窗口仅 60s，活桶不可能被误删）。
- **2FA pending token 获得密钥轮换兼容**：`create/decode_two_factor_pending_token` 此前绕过 `key_rotation` 直接用当前密钥签/验，注释却声称"hot reload 到达验签"——轮换后旧密钥签发的 pending token 立即失效，正好落在"密码步已过、验证码步失败"的登录半途。现在统一走 `encode_jwt`/`decode_jwt(expected_type=...)`：kid 头 + previous keys 回退，type 不符仍拒绝，不给攻击者猜测 type 的空间。
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
- 代码审计发现的 P1（31 项）与 P2（约 55 项）尚未处理，后续按优先级排期。

## [0.2.0] — 2026-09-14

- 部署指南、治理模板、版本守门脚本落地。
- 迁移收敛为单个初始迁移（`3392b958c074_001_initial_schema`）。
- 三平台 CI、依赖锁定、官网中英文切换。

## [0.1.0] — 2026-09-02

- 首个可运行版本：投稿、评审、目录、阅读器主链路。
