# 运维自动化

> **当前生产形态**：`/opt/rubbish-app` + systemd `rubbish-app.service` + Nginx + PostgreSQL 容器 `rubbish-db-1`。本目录的 `deploy.sh` 服务的是仓库自带的 Docker Compose 参考栈，不是公网服务器；公网发版步骤见 `DEPLOY.md` 的“当前公网服务器”一节。

| 脚本 | 频率 | 作用 |
|---|---|---|
| `site-health.sh` | 每 5 分钟 | HTTP、HTML `no-cache`（3 次重试，避免发版窗口假告警）、API、stats、备份≤36h、磁盘≤85%、三容器 |
| `site-refresh.sh` | 每日 04:10 | 首页/论文/副刊/sitemap/RSS/API + 最新 5 篇预热 |
| `db-backup.sh` | 每日 03:20 | PostgreSQL 逻辑 dump + uploads 打包，先写 `.partial` 并 `gzip -t` 校验后落盘；DB 留 30 份 / uploads 留 10 份 |
| `backup-verify.sh` | 每周日 04:30 | 解压校验、临时库恢复、resources 行数核对 |
| `deploy.sh` | 手动/CI | **仅 Docker 参考栈**：构建、容器内旧静态备份、替换、重启、健康检查、预热、失败回滚。当前公网是 systemd + Nginx，见 `docs/ENGINEERING.md` |
| `offsite-backup.sh` | 每日 04:50 | **只备份数据**（DB + uploads），不备份代码/镜像；无远端时明确 SKIP，配置 `RCLONE_REMOTE` 后自动生效 |
| `content-export.sh` | 手动 | A 方案公开内容快照：只导已发表内容，命中邮箱/内部标识即失败，不产出半成品 |
| `install-automation.sh` | 一次性 | 幂等写 `/etc/cron.d/rubbish-automation` |
| `remove-legacy-cron.sh` | 一次性（服务器） | **默认 dry-run**；归档后删除 scholarhub-* 遗留 cron 与日志（P1 #14） |
| `drop-garbage-tables.sh` | 手动（服务器） | **默认 dry-run**；清点 19 张垃圾表，排除 2 回滚点，逐表 `pg_dump -t` 归档后 DROP（P1 #16） |
| `inspect-review-scores.sh` | 手动（服务器） | **只读**探查 review_scores 的 tenant_id 来源，决定 RLS 处置路径（P1 #13） |

日志：`/home/ubuntu/rubbish-health.log`、`rubbish-refresh.log`、`rubbish-backup-verify.log`。

## 异地备份启用方式

生产机已安装 `rclone`。拿到对象存储或另一台服务器的凭证后，在 `/home/ubuntu/rubbish/ops/offsite.env` 写：

```bash
RCLONE_REMOTE=rubbish-cos:rubbish-backups
```

并确保运行 `offsite-backup.sh` 的用户能读到该环境变量；脚本会复制最新 DB 与上传包并做 size 校验。
未配置时每日 04:50 只记录 `SKIP`，不会伪装成已备份。

## Token 吊销后端（RUBBISH_REDIS_URL）

刷新令牌/登出的细粒度吊销依赖 JTI 吊销列表（`app/core/token_denylist.py`）：

- `RUBBISH_REDIS_URL` 默认空 → **进程内内存**吊销列表。仅适合单进程 dev/test；
  重启即清空，多 worker 之间不共享，已登出的 refresh token 在别的 worker 上可能仍可用。
- 生产多 worker 部署应设为共享 Redis，例如 `RUBBISH_REDIS_URL=redis://127.0.0.1:6379/0`。
- **fail-closed（P1 #9）**：配置了 Redis 但连不上时，`is_denied`/`add` 抛
  `DenylistUnavailableError`，`/auth/refresh`、`/auth/logout` 返回 **503**，
  而不是静默放行已吊销 token。Redis 客户端按命令重连，恢复后自愈；工厂探活失败
  仍安装 Redis 候选（绝不永久降级到内存）。配置了 URL 却未装 `redis` 包视为配置错误，直接抛错。
- 批量吊销（`/auth/revoke-all`、改密）走 `token_version`/`refresh_token_version`
  自增，与 Redis 无关，始终可用。

注：当前生产 `redis_url=""` 走内存路径，本改动不影响其可用性；上线 Redis 前
请先确认 `redis` 包已安装且 URL 可达，避免吊销端点进入 503。

## 服务器一次性清理：scholarhub-* 遗留 cron（P1 #14）

品牌已从仓库**应用代码**与 git 历史中 purge（除本清理脚本与本节外，
`grep -ri scholarhub` 无其它命中），但生产机仍留有旧品牌名的定时任务与日志：

- `/etc/cron.d/scholarhub-backup` — 每天 03:00 以 root 执行**已被删除**的
  `/home/ubuntu/backup.sh` → 备份必失败，`site-health.sh` 的 36h 新鲜度阈值持续 FAIL。
- `/etc/cron.d/scholarhub-watchdog` — 每 5 分钟 root 执行**已删**的
  `health-watchdog.sh` → 持续报错。

这些是**服务器独有**遗留，仓库里没有对应文件，故清理脚本只在服务器一次性运行、
不进 cron：

```bash
ops/remove-legacy-cron.sh            # 默认 dry-run，只打印动作
ops/remove-legacy-cron.sh --confirm  # 归档到 $ARCHIVE_DIR 后删除 cron、移走日志
```

> 备份链路的**重建**（恢复 backup.sh 或改用 `offsite-backup.sh`）是独立运维动作，
> 不在本清理脚本范围；删除 scholarhub-backup cron 后请确认现行备份由
> `rubbish-automation` 的 `offsite-backup.sh` 接管，避免备份空窗。

## 发版与回滚流程（P1 #15）

`ops/deploy.sh`、`install-automation.sh`、本 README 在仓库工作树**均受版本控制**
（`git ls-files ops/` 可验证）；审计所述「被删」仅发生在服务器侧。**服务器侧恢复
被删 ops 文件不在本分支范围**（本分支只改本地仓库，不动生产）。

`deploy.sh` 是**前端静态热替换**发布，流程：

1. 本地 `npm run build` → `tar` 打包 `dist` → `scp` 到服务器。
2. 服务器解包到 `rubbish-newstatic`；`docker cp` 把容器内旧 `/app/static` 备份到
   `/home/ubuntu/static-rollback-<stamp>`（并在容器内留 `static.bak-<stamp>`）。
3. `docker cp` 新静态进容器 → `docker restart rubbish-app-1` → `sleep 8`。
4. **健康门禁**：跑 `site-health.sh`，失败则自动 `docker cp` 回滚旧静态 + 重启 + `exit 1`。
5. 成功后 `site-refresh.sh` 预热；容器内静态备份只保留最近 3 份。

回滚要点：

- 自动回滚由健康检查触发，回滚源是 `/home/ubuntu/static-rollback-<stamp>`。
- 手动回滚：`docker cp /home/ubuntu/static-rollback-<stamp>/. rubbish-app-1:/app/static/`
  后 `docker restart rubbish-app-1`。
- **`deploy.sh` 不构建后端镜像、不跑 alembic 迁移**。后端代码 / 迁移上线是独立
  手动流程（重建并重启后端容器 + 在容器内 `alembic upgrade head`），发版前请先
  在 scratch 库验证迁移链（见 `docs/p1-audit-garbage-tables.md` 与迁移 052–055 注释）。
- 本分支交付的迁移 052–055 与 ops 清理脚本**均未在生产应用/执行**；上线时按上述
  流程人工复核后逐步执行，垃圾表与遗留 cron 脚本默认 dry-run，确认后再 `--confirm`。
