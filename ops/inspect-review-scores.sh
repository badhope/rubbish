#!/usr/bin/env bash
# P1 #13 — 只读探查生产遗留表 review_scores，决定其 RLS 处置路径。
#
# review_scores 无 ORM 模型、无 alembic 迁移、无代码引用（grep 确认），是
# 纯生产遗留表（审计时约 29 行）。其 tenant_id 来源不保证，因此**排除**出
# 迁移 054 的自动 RLS 名单。本脚本只读，不改动任何数据/结构，输出供人工决策：
#
#   * 若有 tenant_id 且全部非空 → 可走标准 ENABLE+FORCE+tenant_isolation
#     （与 054 同款 ::uuid policy），随后纳入迁移。
#   * 若无 tenant_id 或存在 NULL/跨租户混写 → 需先决定：加列并按业务回填，
#     还是归档后 drop（确认无代码依赖）。在决策前不要启用 RLS（会锁死全表）。
#
# 需要 $RUBBISH_DATABASE_URL（postgresql[+driver]://...），自动转 libpq 形式。
# 用法：RUBBISH_DATABASE_URL=postgresql://... ops/inspect-review-scores.sh
set -euo pipefail

: "${RUBBISH_DATABASE_URL:?set RUBBISH_DATABASE_URL (postgresql://user:pass@host:port/db)}"
LIBPQ_URL="${RUBBISH_DATABASE_URL/postgresql+asyncpg/postgresql}"
LIBPQ_URL="${LIBPQ_URL/postgresql+psycopg2/postgresql}"
LIBPQ_URL="${LIBPQ_URL/postgresql+psycopg/postgresql}"

q() { psql "$LIBPQ_URL" -v ON_ERROR_STOP=1 "$@"; }

echo "=== review_scores existence ==="
EXISTS=$(q -At -c "SELECT to_regclass('public.review_scores') IS NOT NULL;")
if [[ "$EXISTS" != "t" ]]; then
  echo "review_scores does not exist — nothing to inspect."
  exit 0
fi

echo "=== columns (\\d) ==="
q -c "\d public.review_scores"

echo "=== row count ==="
q -c "SELECT count(*) AS rows FROM public.review_scores;"

echo "=== tenant_id provenance ==="
HAS_TENANT=$(q -At -c "SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='review_scores' AND column_name='tenant_id');")
if [[ "$HAS_TENANT" == "t" ]]; then
  echo "tenant_id column present. null / distinct breakdown:"
  q -c "SELECT count(*) FILTER (WHERE tenant_id IS NULL) AS null_tenant,
               count(DISTINCT tenant_id) AS distinct_tenant
        FROM public.review_scores;"
  q -c "SELECT tenant_id, count(*) FROM public.review_scores GROUP BY tenant_id ORDER BY 2 DESC;"
else
  echo "NO tenant_id column — cannot enable tenant_isolation RLS as-is."
fi

echo "=== current RLS state ==="
q -c "SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class WHERE oid='public.review_scores'::regclass;"
q -c "SELECT policyname, cmd FROM pg_policies WHERE tablename='review_scores';"

echo "=== code reference guard (run in repo) ==="
echo "grep -ri review_scores apps/backend/app apps/backend/alembic  # expect: no hits"
echo "Decision: tenant_id clean -> standard RLS (like 054); else archive/drop or add+backfill column."