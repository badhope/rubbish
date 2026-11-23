# ops/release — 发布工具链

整改发布用脚本集：D0 基线快照、D7 QA 部署校验、D8 canary 冒烟、D9 全量切换 / 回滚 / 旧物清理。

约定：POSIX sh + `set -eu`；全参数化；破坏性动作默认 dry-run，显式 `--apply` 才落盘；脚本内不写明文密钥，不读取 `.env` 内容。

## 脚本

| 脚本 | 阶段 | 作用 |
|---|---|---|
| `baseline-check.sh` | D0 / 各闸门 | 采集 HEAD、VERSION、版本一致性、typecheck、生产/QA health 与静态资产清单，输出 JSON + 可读表格 |
| `canary-deploy.sh` | D7 / D8 | 新构建产物放到 canary 目录或 `static-next`；可选起独立端口 canary unit；只读 GET 冒烟探针（首页 / 关键路由 / 入口 hash / 入口文件可达性） |
| `promote.sh` | D9 | 原子切换静态根（symlink 改链或 mv 整目录），切换前后校验入口齐全与 health，切换后 reload 服务；10 分钟预算 |
| `rollback.sh` | 回滚 | 优先 symlink 回切，其次 `static.prev` 还原 + reload；数据库只打印人工恢复路径，不自动恢复 |
| `prune-old.sh` | D9 后期 | 清点旧静态目录、旧入口 chunk、旧品牌资产、旧模板、旧 canary 入口；默认 dry-run，`--apply` 删 SAFE 清单；护栏保护 `/opt/backups` |
| `verify-site.sh` | 发布后 | 健康版本、入口引用可达性、站内断链抽查、旧资产 / 旧术语残留、CSP 与安全头、favicon / manifest / robots / sitemap / OG 可访问性 |
| `lib/release-common.sh` | — | 公共默认路径、日志、dry-run / SSH 引导、时间预算、探针与摘要工具函数 |

## 两种执行方式

- 目标机直跑：`sudo -n sh ops/release/<脚本>.sh [参数]`
- 控制端 SSH：`sh ops/release/<脚本>.sh --ssh deploy@103.116.247.174 [参数]`（脚本包上传临时目录，跑完清理）

完整命令序列、校验点、耗时与失败首步见交付文档：
`rubbish-remediation/d8-canary/发布Runbook.md`、`rubbish-remediation/d0-baseline/基线校验脚本说明.md`。

## 安全护栏

- 所有删除 / 移动 / reload 动作在 dry-run 下只打印计划；
- `prune-old.sh` 拒绝把 `/opt/backups` 下列入删除清单；
- `rollback.sh` 不执行数据库恢复；`--apply` 必须带 `--confirm`；
- canary 探针全部为 GET，写操作只在 QA 或测试账号。
