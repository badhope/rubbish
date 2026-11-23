#!/bin/sh
# prune-old.sh — 清理旧静态目录、旧入口 chunk、旧品牌资产、旧模板、旧 canary 入口。
# 默认 DRY-RUN：只打印将要删除的清单；必须显式 --apply 才删除。
# 回滚包一律保留在 /opt/backups，本脚本护栏拒绝把备份目录列入删除。
#
# 两种用法：
#   1) 目标机直接执行：
#        sudo -n sh ops/release/prune-old.sh            # 只清点
#        sudo -n sh ops/release/prune-old.sh --apply   # 删除 SAFE 清单
#   2) 控制端经 SSH：
#        sh ops/release/prune-old.sh --ssh deploy@103.116.247.174
set -eu
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$script_dir/lib/release-common.sh"

bootstrap_if_ssh "$0" "$@"

SCAN_ROOT="$APP_DIR"
INCLUDE_CHUNKS=0
LIST_ONLY=0

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

参数：
  --root DIR              扫描根目录（默认 /opt/rubbish-app）
  --include-unreferenced-chunks
                          把 assets/ 下未被 index.html 直接引用的懒加载 chunk
                          也列入删除（默认仅列为 REVIEW，不删）
  --list-only             只打印清单，等价于默认 dry-run
  --apply                 真正删除 SAFE 清单；缺省只清点
  --ssh HOST / --remote   控制端 SSH 模式 / 内部远端标记
  -h, --help              显示本帮助

删除分级：
  SAFE   旧时间戳静态目录、失败现场目录、未被引用的旧品牌资产 —— --apply 删除
  REVIEW 未引用懒加载 chunk、旧模板文件、旧后端运行目录（如 rubbish-app-1.15.1）
         —— 默认只列出，需人工核对后另行处理
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --root) SCAN_ROOT="$2"; shift 2 ;;
    --include-unreferenced-chunks) INCLUDE_CHUNKS=1; shift ;;
    --list-only) LIST_ONLY=1; shift ;;
    --apply) APPLY=1; shift ;;
    --ssh|--remote) shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（见 --help）" ;;
  esac
done

assert_not_backup_root "$SCAN_ROOT"
[ -d "$SCAN_ROOT" ] || die "扫描根目录不存在：$SCAN_ROOT"

# 受保护名单：后端运行时、在用静态目录、配置文件，任何模式下都不清理
is_protected_runtime() {
  case "$1" in
    app|alembic|alembic.ini|content|scripts|pyproject.toml|uv.lock|VERSION|\
    deploy_server.py|.venv|logs|lib|static|static-next|static.prev|static-active|\
    archive|uploads|.env|.env.*|.gitignore|.gitleaks.toml|.well-known) return 0 ;;
    *) return 1 ;;
  esac
}

safe_dirs=""
review_dirs=""
protected_entries=""
safe_files=""
review_files=""

# ---- 1) 旧静态目录 / 失败现场 / 旧 canary 目录 -----------------------------
log "扫描目录：$SCAN_ROOT"
for entry in "$SCAN_ROOT"/* "$SCAN_ROOT"/.[!.]*; do
  [ -e "$entry" ] || continue
  base=$(basename "$entry")
  if is_protected_runtime "$base"; then
    protected_entries="$protected_entries $entry"
    continue
  fi
  case "$base" in
    static.prev-old-*|static.failed-*|static-20*|static-old-*)
      safe_dirs="$safe_dirs $entry" ;;
    rubbish-app-1.*|rubbish-app-old-*)
      review_dirs="$review_dirs $entry" ;;
    *)
      # 其它非标准目录一律 REVIEW，避免误删运行时目录
      review_dirs="$review_dirs $entry" ;;
  esac
done

# 旧 canary 目录（canary 窗口结束后清理）
if [ -d "$CANARY_DIR" ]; then
  review_dirs="$review_dirs $CANARY_DIR"
fi

# ---- 2) 旧品牌资产：当前 index.html 未引用才列入 SAFE -----------------------
kept_refs=""
if [ -f "$STATIC_DIR/index.html" ]; then
  kept_refs=$(index_refs "$STATIC_DIR/index.html")
fi
for asset in $LEGACY_BRAND_ASSETS; do
  f="$STATIC_DIR/$asset"
  [ -f "$f" ] || continue
  if printf '%s\n' "$kept_refs" | grep -q "/$asset"; then
    warn "$asset 仍被当前 index.html 引用，保留待前端改壳后再清理：$f"
    continue
  fi
  safe_files="$safe_files $f"
done

# ---- 3) assets/ 未引用 chunk（懒加载，默认 REVIEW） -------------------------
if [ -d "$STATIC_DIR/assets" ] && [ -f "$STATIC_DIR/index.html" ]; then
  for f in "$STATIC_DIR"/assets/*; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    if ! printf '%s\n' "$kept_refs" | grep -q "$base"; then
      review_files="$review_files $f"
    fi
  done
fi

# ---- 4) 旧模板文件（REVIEW） -----------------------------------------------
if [ -d "$STATIC_DIR/templates" ]; then
  for f in "$STATIC_DIR"/templates/*; do
    [ -f "$f" ] || continue
    review_files="$review_files $f"
  done
fi

# ---- 清单输出 --------------------------------------------------------------
count_items() { set -- $1; echo $#; }

echo "================ 清理清单（DRY-RUN） ================"
echo "[SAFE] 可随 --apply 删除（$(count_items "$safe_dirs") 个目录 / $(count_items "$safe_files") 个文件）"
for d in $safe_dirs; do echo "  DIR  $d"; done
for f in $safe_files; do echo "  FILE $f"; done

echo "[REVIEW] 需人工核对，默认不删（$(count_items "$review_dirs") 个目录 / $(count_items "$review_files") 个文件）"
for d in $review_dirs; do echo "  DIR  $d"; done
for f in $review_files; do echo "  FILE $f"; done

echo "[PROTECTED] 后端运行时 / 在用静态目录，任何模式下都不清理（$(count_items "$protected_entries") 项）"
for p in $protected_entries; do echo "  KEEP $p"; done

if [ "$LIST_ONLY" -eq 1 ]; then exit 0; fi
if [ "$APPLY" -eq 0 ]; then
  log "DRY-RUN：未删除任何内容。确认清单无误后加 --apply（chunk 另需 --include-unreferenced-chunks）"
  exit 0
fi

# ---- 执行删除 --------------------------------------------------------------
log "开始删除 SAFE 清单"
for d in $safe_dirs; do
  assert_not_backup_root "$d"
  log "rm -rf $d"
  run_priv rm -rf "$d"
done
for f in $safe_files; do
  assert_not_backup_root "$f"
  log "rm -f $f"
  run_priv rm -f "$f"
done

if [ "$INCLUDE_CHUNKS" -eq 1 ]; then
  log "按 --include-unreferenced-chunks 删除 REVIEW chunk"
  for f in $review_files; do
    case "$f" in
      */assets/*) assert_not_backup_root "$f"; run_priv rm -f "$f" ;;
      *) log "跳过非 chunk 的 REVIEW 文件：$f" ;;
    esac
  done
else
  log "REVIEW chunk / 模板文件未删除；核对后可手工处理或加 --include-unreferenced-chunks"
fi

ok "清理完成：SAFE 目录 $(count_items "$safe_dirs") 个、SAFE 文件 $(count_items "$safe_files") 个"
echo "遗留 REVIEW 项见上方清单；旧后端运行目录与 canary unit 请按 Runbook 人工处置。"
