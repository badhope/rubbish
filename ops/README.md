# 运维自动化

> **当前生产形态**：`/opt/rubbish-app` + systemd `rubbish-app.service` + Nginx + PostgreSQL 容器 `rubbish-db-1`。本目录的 `deploy.sh` 默认发布当前公网 systemd 形态；仓库自带的 Docker Compose 只作本地/演练参考。

| 脚本 | 频率 | 作用 |
|---|---|---|
| `site-health.sh` | 每 5 分钟 | HTTP、HTML `no-cache`、`/api/health`、公开资源数、备份≤36h 且 `deploy` 可读、磁盘≤85%、systemd `rubbish-app` + `rubbish-db-1` |
| `site-refresh.sh` | 每日 04:10 | 首页/内容库/合集/发现/论坛/关于/公开 API + 概览推荐 5 篇预热；登录墙版本不预热 sitemap/RSS |
| `db-backup.sh` | 手动/参考 | 当前生产路径的 DB + uploads + config 打包；`.partial` 校验后落盘，保留 30 天，文件 0640、目录 0750 且 `deploy` 可读 |
| `backup-verify.sh` | 每周日 04:30 | 解压校验、临时库恢复、resources/users 行数核对；生产安装在 `/usr/local/sbin/rubbish-backup-verify.sh`，临时库用完即删 |
| `deploy.sh` | 手动/CI | 当前公网静态发版：构建、服务器旧静态快照、`rsync --delete` 替换、重启 `rubbish-app.service`、40 秒健康门禁、失败自动回滚、预热、只留 3 份快照 |
| `offsite-backup.sh` | 每日 04:50 | **只备份数据**（DB + uploads），不备份代码/镜像；无远端时明确 SKIP，配置 `RCLONE_REMOTE` 后自动生效 |
| `content-export.sh` | 手动 | A 方案公开内容快照：只导已发表内容，命中邮箱/内部标识即失败，不产出半成品 |
| `install-automation.sh` | 一次性 | 把 health/refresh 安装到 `/usr/local/lib/rubbish-ops`，幂等写 `/etc/cron.d/rubbish-automation`；不重复备份演练 |
| `remove-legacy-cron.sh` | 一次性（服务器） | **默认 dry-run**；归档后删除 scholarhub-* 遗留 cron 与日志（P1 #14） |
| `drop-garbage-tables.sh` | 手动（服务器） | **默认 dry-run**；清点 19 张垃圾表，排除 2 回滚点，逐表 `pg_dump -t` 归档后 DROP（P1 #16） |
| `inspect-review-scores.sh` | 手动（服务器） | **只读**探查 review_scores 的 tenant_id 来源，决定 RLS 处置路径（P1 #13） |

日志：`/var/log/rubbish-health.log`、`/var/log/rubbish-refresh.log`、`/var/log/rubbish-backup-verify.log`（生产备份日志 `/var/log/rubbish-backup.log`）。

## 生产备份现状

- 每日 03:00：`/etc/cron.d/rubbish-backup` 以 root 执行 `/usr/local/sbin/rubbish-backup.sh`，产出 `db-*.sql.gz`、`uploads-*.tar.gz`、`config-*.tar.gz` 到 `/www/backups/rubbish`；目录 `0750 root:deploy`、文件 `0640 root:deploy`，应用用户可读，admin 健康检查不再误报。
- 每周日 04:30：同一 cron 文件执行 `/usr/local/sbin/rubbish-backup-verify.sh`，在临时库恢复最新 dump，核对 `resources` 与 `users` 行数后 DROP，不碰业务库。
- 恢复演练日志：`/var/log/rubbish-backup-verify.log`。

## 异地备份启用方式

生产机已安装 `rclone`。拿到对象存储或另一台服务器的凭证后，在 `offsite-backup.sh` 同目录的 `offsite.env` 写：

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

注：当前生产已配置 `RUBBISH_REDIS_URL=redis://127.0.0.1:6379/0`，共享吊销列表正常；更换 Redis 前
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

> 备份链路的**重建**由 `/etc/cron.d/rubbish-backup` 负责（DB/uploads/config + 每周恢复演练），
> `rubbish-automation` 只管站点健康与预热；异地复制作为独立开关，不配置时明确 SKIP。

## 发版与回滚流程

`ops/deploy.sh` 默认发布当前公网形态（`deploy@103.116.247.174:/opt/rubbish-app`，systemd `rubbish-app.service`）：

1. 本地 `npm run build` → `tar` 打包 `dist` → `scp` 到服务器 `/tmp`。
2. 服务器把旧 `static/` 复制为 `static-<stamp>` 快照，解包新构建后用 `rsync -a --delete` 整目录替换，避免旧 hash 资源残留。
3. `systemctl restart rubbish-app`，随后在 40 秒内轮询 `/api/health`、`/`、`/catalog`；任一失败就用快照回滚并重启，再验一次。
4. 成功后调用已安装的 `/usr/local/lib/rubbish-ops/site-refresh.sh` 预热，日志写 `/var/log/rubbish-refresh.log`。
5. 只保留最近 3 份 `static-<stamp>` 快照；根目录旧 `static-prev-*` 不参与自动清理。

回滚要点：

- 自动回滚源是 `/opt/rubbish-app/static-<stamp>`；手动回滚用同一目录 `rsync -a --delete` 回 `static/` 后重启服务。
- **`deploy.sh` 只发前端静态，不构建后端、不跑 alembic 迁移**。后端代码与迁移上线仍是独立流程，发版前先在 scratch 库验证迁移链（见 `docs/p1-audit-garbage-tables.md` 与迁移 052–055 注释）。
