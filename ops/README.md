# 运维自动化

| 脚本 | 频率 | 作用 |
|---|---|---|
| `site-health.sh` | 每 5 分钟 | HTTP、HTML `no-cache`、API、stats、备份≤36h、磁盘≤85%、三容器 |
| `site-refresh.sh` | 每日 04:10 | 首页/论文/副刊/sitemap/RSS/API + 最新 5 篇预热 |
| `backup-verify.sh` | 每周日 04:30 | 解压校验、临时库恢复、resources 行数核对 |
| `deploy.sh` | 手动/CI | 构建、容器内旧静态备份、替换、重启、健康检查、预热、失败回滚 |
| `offsite-backup.sh` | 每日 04:50 | **只备份数据**（DB + uploads），不备份代码/镜像；无远端时明确 SKIP，配置 `RCLONE_REMOTE` 后自动生效 |
| `install-automation.sh` | 一次性 | 幂等写 `/etc/cron.d/rubbish-automation` |

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
