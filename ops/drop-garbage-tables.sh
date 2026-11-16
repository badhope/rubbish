#!/usr/bin/env bash
# P1 #16 — 清点并归档后删除生产遗留的垃圾备份/草稿表。
#
# 迁移 055 只删仓库可验证的一个名字（users_backup_20261107）；其余 ~18 张是
# 生产独有、仓库/git 历史无法验证的名字，由本脚本**运行时清点**后处理。
# 完整清单与保留口径见 docs/p1-audit-garbage-tables.md。
#
# 匹配口径（与文档一致）：
#   tablename LIKE '%\_bak\_%'             -- 任意 *_bak_* 快照（子串任意位置）
#   OR tablename ~ '\_backup\_[0-9]{8}$'   -- *_backup_YYYYMMDD
#   OR tablename IN ('p0_fix','content_fix_20261107')
# 明确排除两个回滚点（绝不删除）：
#   resources_authors_meta_backup_20261112
#   resources_keywords_backup_20261112
#
# 安全：默认 dry-run，只打印清点结果与将执行的动作。--confirm 才真正
# 逐表 pg_dump -t 归档到 $ARCHIVE_DIR 后 DROP。DROP 不可逆，恢复依赖归档。
# 需要 $RUBBISH_DATABASE_URL（postgresql[+driver]://...），脚本自动转 libpq 形式。
#
# 用法：
#   RUBBISH_DATABASE_URL=postgresql://... ops/drop-garbage-tables.sh            # dry-run
#   RUBBISH_DATABASE_URL=postgresql://... ops/drop-garbage-tables.sh --confirm  # 归档+删除
set -euo pipefail

CONFIRM=0
[[ "${1:-}" == "--confirm" ]] && CONFIRM=1

: "${RUBBISH_DATABASE_URL:?set RUBBISH_DATABASE_URL (postgresql://user:pass@host:port/db)}"
# 去掉 SQLAlchemy 驱动后缀（+asyncpg / +psycopg2 / +psycopg）→ libpq URL。
LIBPQ_URL="${RUBBISH_DATABASE_URL/postgresql+asyncpg/postgresql}"
LIBPQ_URL="${LIBPQ_URL/postgresql+psycopg2/postgresql}"
LIBPQ_URL="${LIBPQ_URL/postgresql+psycopg/postgresql}"

STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE_DIR="${ARCHIVE_DIR:-/home/ubuntu/garbage-table-archive-$STAMP}"

PRESERVED=(
  resources_authors_meta_backup_20261112
  resources_keywords_backup_20261112
)

say() { printf '%s\n' "$*"; }

# 清点（只读）。-At = 无对齐、仅元组，便于逐行读。
INVENTORY_SQL="SELECT tablename FROM pg_tables
  WHERE schemaname='public'
    AND (tablename LIKE '%\_bak\_%'
         OR tablename ~ '\_backup\_[0-9]{8}\$'
         OR tablename IN ('p0_fix','content_fix_20261107'))
  ORDER BY tablename;"

mapfile -t CANDIDATES < <(psql "$LIBPQ_URL" -At -c "$INVENTORY_SQL")

# 过滤保留表。
TARGETS=()
for t in "${CANDIDATES[@]}"; do
  skip=0
  for p in "${PRESERVED[@]}"; do
    [[ "$t" == "$p" ]] && skip=1
  done
  [[ "$skip" == "0" ]] && TARGETS+=("$t")
done

say "=== garbage table inventory (CONFIRM=$CONFIRM) ==="
say "matched ${#CANDIDATES[@]} candidate(s); preserved ${#PRESERVED[@]} rollback point(s)"
for p in "${PRESERVED[@]}"; do
  say "  PRESERVE: $p"
done
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  say "no garbage tables to drop."
  exit 0
fi
say "archive dir: $ARCHIVE_DIR"
for t in "${TARGETS[@]}"; do
  say "  TARGET: $t"
done

if [[ "$CONFIRM" != "1" ]]; then
  say "dry-run complete. re-run with --confirm to archive (pg_dump -t) then DROP each target."
  exit 0
fi

mkdir -p "$ARCHIVE_DIR"
for t in "${TARGETS[@]}"; do
  say "archiving $t ..."
  pg_dump "$LIBPQ_URL" -t "public.$t" -f "$ARCHIVE_DIR/$t.sql"
  say "dropping $t ..."
  psql "$LIBPQ_URL" -v ON_ERROR_STOP=1 -c "DROP TABLE IF EXISTS public.\"$t\";"
done
say "done. ${#TARGETS[@]} table(s) archived to $ARCHIVE_DIR and dropped."
say "restore a table with: psql \"\$RUBBISH_DATABASE_URL\" -f $ARCHIVE_DIR/<table>.sql"