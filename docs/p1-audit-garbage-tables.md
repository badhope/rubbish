# P1 #16 — 生产遗留垃圾表清理清单与口径

审计（`rubbish-issues-20261115.md` #16）：生产库累积 **19 张**手工备份/草稿表，
全无 RLS，膨胀备份、干扰 schema 巡检、易被误认为活表。构成：

| 类别 | 数量 | 匹配口径 |
|---|---|---|
| `*_bak_*` 快照 | 7 | `tablename LIKE '%\_bak\_%'` |
| `*_backup_YYYYMMDD` | 10 | `tablename ~ '\_backup\_[0-9]{8}$'` |
| `p0_fix` / `content_fix_20261107` | 2 | `tablename IN ('p0_fix','content_fix_20261107')`（含 1989 + 370 行） |

> 确切表名是**生产独有**的：仓库与 git 历史无法逐一验证（品牌 purge 后 grep
> 仅命中一个名字，见下）。因此完整名单由 `ops/drop-garbage-tables.sh` 在服务器
> 上**运行时清点**（`pg_tables`）后 finalized，不在本文件硬编码 19 个名字。
> 运维执行 dry-run 后，把脚本打印的 TARGET 清单回填到本表下方「生产实测清单」。

## 仓库可验证的唯一垃圾名

- `users_backup_20261107` — `migrations-sql/20261107_role_axis.sql:13` 的
  `CREATE TABLE ... AS SELECT * FROM users` 全量快照（role-axis 收敛前）。
  这是迁移 `055_drop_garbage_tables.py` 唯一硬编码删除的名字。

## 明确保留的回滚点（绝不删除）

以下两张是 authors_meta / keywords 规范化的**文档化回滚锚点**
（见 TECH-DEBT-CLOSURE），虽匹配 `*_backup_YYYYMMDD` 口径，但被迁移 055 与
ops 脚本**共同排除**：

- `resources_authors_meta_backup_20261112`
- `resources_keywords_backup_20261112`

口径单一来源：迁移 055 的 `_PRESERVED_ROLLBACK_POINTS` 与 ops 脚本的 `PRESERVED`
数组必须保持一致。新增保留表时两处同步更新。

## 处置分工

| 产物 | 职责 | 是否执行 |
|---|---|---|
| 迁移 `055_drop_garbage_tables.py` | 只删仓库可验证的 `users_backup_20261107`；fresh 库 no-op | 交付，**未应用** |
| `ops/drop-garbage-tables.sh` | 运行时清点全部 19 张，排除 2 回滚点，逐表 `pg_dump -t` 归档后 DROP | 交付，**默认 dry-run，未执行** |
| 本文件 | 清单口径、保留表、归档位置、生产实测回填 | 文档 |

### 运行（服务器上，人工确认后）

```bash
# 1) 只读清点，打印 TARGET / PRESERVE，不改动任何表
RUBBISH_DATABASE_URL=postgresql://... ops/drop-garbage-tables.sh

# 2) 核对清单无误后，归档 + 删除（DROP 不可逆，恢复依赖归档）
RUBBISH_DATABASE_URL=postgresql://... ops/drop-garbage-tables.sh --confirm
```

- 归档位置：`$ARCHIVE_DIR`（默认 `/home/ubuntu/garbage-table-archive-<stamp>/`），
  每表一个 `<table>.sql`（`pg_dump -t public.<table>`）。
- 恢复单表：`psql "$RUBBISH_DATABASE_URL" -f $ARCHIVE_DIR/<table>.sql`。
- 脚本自动把 `postgresql+asyncpg://` 等 SQLAlchemy URL 转成 libpq 形式。
- 迁移 055 的 `downgrade` 是 no-op：删表不可逆，恢复同样依赖 drop 前归档。

## 生产实测清单（运维 dry-run 后回填）

> 执行 `ops/drop-garbage-tables.sh`（dry-run）后，把打印的 TARGET 逐行粘贴到此，
> 形成可审计的最终删除名单。保留表无需列入。

```
（待生产 dry-run 回填）
```

## 关联：review_scores 的 RLS 处置（P1 #13）

`review_scores`（审计时 29 行）**不在**上述垃圾名单，也**排除**出迁移 054 的
自动 RLS 名单：它无 ORM 模型、无迁移、无代码引用，是纯生产遗留表，且
`tenant_id` 来源不保证。先用只读脚本探查再决策：

```bash
RUBBISH_DATABASE_URL=postgresql://... ops/inspect-review-scores.sh
```

两条条件路径：

1. **有 `tenant_id` 且全部非空、单租户干净** → 走标准 `ENABLE + FORCE +
   tenant_isolation`（与 054 同款 `::uuid` policy），随后纳入迁移。
2. **无 `tenant_id`，或存在 NULL / 跨租户混写** → 先决定：加列并按业务回填，
   还是确认无代码依赖后归档 / drop。**决策前不要启用 RLS**（policy 会把全表锁死）。

代码引用守卫（仓库内执行，预期无命中）：

```bash
grep -ri review_scores apps/backend/app apps/backend/alembic
```