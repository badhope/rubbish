#!/bin/sh
# rollback.sh — 10 分钟内回滚静态版本：优先符号链接回切，其次 static.prev 还原 + reload。
# 数据库不自动恢复：只打印需人工确认的恢复路径与备份包位置。
#
# 两种用法：
#   1) 目标机直接执行：
#        sudo -n sh ops/release/rollback.sh --apply --confirm
#   2) 控制端经 SSH：
#        sh ops/release/rollback.sh --ssh deploy@103.116.247.174 --apply --confirm
#
# 默认 DRY-RUN：只打印回滚计划；--apply 执行静态回滚，--confirm 为二次确认。
set -eu
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$script_dir/lib/release-common.sh"

bootstrap_if_ssh "$0" "$@"

SCHEME="auto"
HEALTH_BASE="http://127.0.0.1:$PROD_PORT"
CONFIRMED=0
DO_RELOAD=1

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

参数：
  --scheme auto|symlink|mv  回切方式（默认 auto：按当前 static 是否软链判断）
  --health URL               回滚后健康探针地址（默认 http://127.0.0.1:8080）
  --apply                    真正执行静态回滚；缺省为 DRY-RUN
  --confirm                  二次确认（--apply 时必须携带，防止误触）
  --no-reload                回切后不 reload 服务（一般仅排障/演练用）
  --ssh HOST / --remote      控制端 SSH 模式 / 内部远端标记
  -h, --help                 显示本帮助

数据库：本脚本绝不执行 pg_restore/psql 恢复；仅在结尾打印人工恢复路径。
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --scheme) SCHEME="$2"; shift 2 ;;
    --health) HEALTH_BASE="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --confirm) CONFIRMED=1; shift ;;
    --no-reload) DO_RELOAD=0; shift ;;
    --ssh|--remote) shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（见 --help）" ;;
  esac
done

budget_start

[ -d "$PREV_DIR" ] || die "回滚目录不存在：$PREV_DIR（没有可回退的上一版本）"
[ -f "$PREV_DIR/index.html" ] || die "$PREV_DIR 缺少 index.html，回滚源不完整"

# 判定回切方式
if [ "$SCHEME" = "auto" ]; then
  if [ -L "$STATIC_DIR" ]; then SCHEME="symlink"; else SCHEME="mv"; fi
fi
case "$SCHEME" in
  symlink|mv) ;;
  *) die "未知 --scheme：$SCHEME" ;;
esac

cur_desc="$STATIC_DIR"
[ -L "$STATIC_DIR" ] && cur_desc="$STATIC_DIR -> $(readlink "$STATIC_DIR")"
log "当前静态根：$cur_desc"
log "回滚源：$PREV_DIR（index.html sha256=$(sha256_file "$PREV_DIR/index.html")）"

stamp=$(date +%Y%m%d%H%M%S)
failed_dir="$APP_DIR/static.failed-$stamp"

# ---- 回滚计划 --------------------------------------------------------------
if [ "$SCHEME" = "symlink" ]; then
  log "回滚方案（symlink 回切）："
  dry "ln -sfn $PREV_DIR $STATIC_DIR（原子改链到上一版本）"
else
  log "回滚方案（mv 还原）："
  dry "mv 当前 static -> $failed_dir（保留现场，供 prune-old 后续清理）"
  dry "mv $PREV_DIR -> $STATIC_DIR"
fi
dry "systemctl reload $PROD_SERVICE（不支持 reload 则 restart）"
dry "回滚后探针：$HEALTH_BASE/api/health"

if [ "$APPLY" -eq 0 ]; then
  log "DRY-RUN 结束，未做任何变更"
else
  [ "$CONFIRMED" -eq 1 ] || die "--apply 必须同时携带 --confirm 二次确认"
  assert_not_backup_root "$PREV_DIR"
  assert_not_backup_root "$STATIC_DIR"

  if [ "$SCHEME" = "symlink" ]; then
    run_priv ln -sfn "$PREV_DIR" "$STATIC_DIR"
  else
    run_priv mv "$STATIC_DIR" "$failed_dir"
    budget_check
    run_priv mv "$PREV_DIR" "$STATIC_DIR"
  fi
  ok "静态版本已回切"

  if [ "$DO_RELOAD" -eq 1 ]; then
    service_reload "$PROD_SERVICE"
    sleep 2
  fi
  budget_check

  probe_health "$HEALTH_BASE"
  if [ "$HEALTH_CODE" = "200" ] && [ "$HEALTH_STATUS" = "ok" ]; then
    ok "回滚后 health 正常：version=$HEALTH_VERSION"
  else
    die "回滚后 health 仍异常：$HEALTH_CODE status=${HEALTH_STATUS:-?}；保留现场并排查服务日志 journalctl -u $PROD_SERVICE"
  fi
fi

# ---- 数据库恢复路径（仅提示，不执行） --------------------------------------
echo "----------------------------------------------------------------"
echo "数据库恢复（人工确认，脚本不代执行）："
echo "  回滚包目录：$BACKUP_DIR"
if [ -d "$BACKUP_DIR" ]; then
  ls -1t "$BACKUP_DIR" 2>/dev/null | sed 's/^/    /' || echo "    （目录不可读）"
else
  echo "    （$BACKUP_DIR 不存在，请核对备份位置）"
fi
cat <<EOF

  恢复前先在临时库校验备份可用性（参考 ops/backup-verify.sh），再在维护窗口执行：
    sudo docker exec -i $DB_CONTAINER psql -U <db-user> -d $DB_NAME -v ON_ERROR_STOP=1 \\
      < $BACKUP_DIR/<最新 db dump 文件>

  注意：
    - 数据库回滚会丢弃上一版本上线后产生的新数据，必须由负责人书面确认后操作；
    - <db-user> 与 dump 文件名按现场备份清单填写，脚本不读取、不打印 .env 中的凭据；
    - 恢复完成后重新跑 verify-site.sh 与站点冒烟探针。
EOF
ok "回滚流程结束（静态回滚=${APPLY:-0}；数据库未改动）"
