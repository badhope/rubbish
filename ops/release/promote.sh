#!/bin/sh
# promote.sh — 全量切换：把 static-next 提升为当前静态根，原子替换，切换后 reload 服务。
#
# 两种用法：
#   1) 目标机直接执行：
#        sudo -n sh ops/release/promote.sh --apply
#   2) 控制端经 SSH：
#        sh ops/release/promote.sh --ssh deploy@103.116.247.174 --apply
#
# 默认 DRY-RUN：只打印切换计划与预检结果，不移动目录、不 reload。
# 切换预算 10 分钟；切换后健康失败不自动回滚，打印 rollback.sh 命令由人工决策。
set -eu
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$script_dir/lib/release-common.sh"

bootstrap_if_ssh "$0" "$@"

SCHEME="symlink"
HEALTH_BASE="http://127.0.0.1:$PROD_PORT"
EXPECTED_VERSION=""
DO_RELOAD=1

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

参数：
  --scheme symlink   符号链接方案（默认）：static 为指向 static-active 的软链，
                     切换 = 原子改链；回滚 = 改回 static.prev 目标。
  --scheme mv        整目录 mv 方案：static-next 直接 mv 成 static。
  --next DIR         待提升目录（默认 $NEXT_DIR）
  --prev DIR        回滚目录（默认 $PREV_DIR）
  --health URL       切换前健康探针地址（默认 http://127.0.0.1:8080）
  --expected-version VER  切换后 health 版本必须等于该版本（可选）
  --no-reload        切换后不 reload 服务（一般仅排障用）
  --apply            真正执行；缺省为 DRY-RUN
  --ssh HOST / --remote  控制端 SSH 模式 / 内部远端标记
  -h, --help         显示本帮助
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --scheme) SCHEME="$2"; shift 2 ;;
    --next) NEXT_DIR="$2"; shift 2 ;;
    --prev) PREV_DIR="$2"; shift 2 ;;
    --health) HEALTH_BASE="$2"; shift 2 ;;
    --expected-version) EXPECTED_VERSION="$2"; shift 2 ;;
    --no-reload) DO_RELOAD=0; shift ;;
    --apply) APPLY=1; shift ;;
    --ssh|--remote) shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（见 --help）" ;;
  esac
done

budget_start

case "$SCHEME" in
  symlink|mv) ;;
  *) die "未知 --scheme：$SCHEME（symlink | mv）" ;;
esac

# ---- 预检：待提升目录完整、入口文件齐全 -------------------------------------
[ -d "$NEXT_DIR" ] || die "待提升目录不存在：$NEXT_DIR（先用 canary-deploy.sh --target static-next 放置产物）"
[ -f "$NEXT_DIR/index.html" ] || die "$NEXT_DIR 缺少 index.html"
[ "$NEXT_DIR" != "$STATIC_DIR" ] || die "NEXT_DIR 与当前 static 根相同，拒绝切换"

log "预检待提升目录：$NEXT_DIR"
missing=0
while IFS= read -r ref; do
  case "$ref" in
    /assets/*|/covers/*|/favicon.*|/brand/*|/apple-touch-icon.png|/manifest.webmanifest|/theme-bootstrap.js)
      f="$NEXT_DIR$ref"
      if [ ! -f "$f" ]; then
        warn "index.html 引用的入口文件缺失：$ref"
        missing=1
      fi
      ;;
  esac
done <<EOF
$(index_refs "$NEXT_DIR/index.html")
EOF
[ "$missing" -eq 0 ] || die "待提升目录入口不完整，中止切换"
ok "待提升目录入口文件齐全（$(index_refs "$NEXT_DIR/index.html" | wc -l | tr -d ' ') 条引用）"

# 切换前健康门禁
probe_health "$HEALTH_BASE"
if [ "$HEALTH_CODE" = "200" ] && [ "$HEALTH_STATUS" = "ok" ]; then
  ok "切换前 health 正常：version=$HEALTH_VERSION"
else
  die "切换前 health 异常（$HEALTH_CODE status=${HEALTH_STATUS:-?}），先排查当前线上再切换"
fi

# 当前 static 状态盘点
if [ -L "$STATIC_DIR" ]; then
  cur_link_target=$(readlink "$STATIC_DIR")
  log "当前 $STATIC_DIR 是符号链接 -> $cur_link_target"
elif [ -d "$STATIC_DIR" ]; then
  log "当前 $STATIC_DIR 是实目录（属主 $(stat -c '%U:%G' "$STATIC_DIR" 2>/dev/null || stat -f '%Su:%Sg' "$STATIC_DIR")）"
  dir_readable_by_owner "$STATIC_DIR" || warn "当前 static 属主不可读，改链前请先核对服务进程权限"
else
  die "$STATIC_DIR 既不是目录也不是符号链接，现场异常，中止"
fi

stamp=$(date +%Y%m%d%H%M%S)
old_prev="$APP_DIR/static.prev-old-$stamp"

# ---- 切换计划（DRY-RUN 展示） ---------------------------------------------
if [ "$SCHEME" = "symlink" ]; then
  log "切换方案（symlink，原子改链）："
  dry "若旧 $PREV_DIR 存在：mv $PREV_DIR $old_prev（留给 prune-old 清理）"
  dry "mv 当前 static 目标 -> $PREV_DIR"
  dry "mv $NEXT_DIR -> $ACTIVE_DIR"
  dry "ln -sfn $ACTIVE_DIR $STATIC_DIR（原子替换符号链接）"
else
  log "切换方案（mv，整目录替换）："
  dry "若旧 $PREV_DIR 存在：mv $PREV_DIR $old_prev"
  dry "mv $STATIC_DIR $PREV_DIR"
  dry "mv $NEXT_DIR $STATIC_DIR"
fi
[ "$DO_RELOAD" -eq 1 ] && dry "切换后 systemctl reload $PROD_SERVICE"
[ "$APPLY" -eq 0 ] && { log "DRY-RUN 结束，未做任何变更"; exit 0; }

# ---- 执行切换 --------------------------------------------------------------
assert_not_backup_root "$PREV_DIR"
assert_not_backup_root "$ACTIVE_DIR"
assert_not_backup_root "$STATIC_DIR"

# 1) 旧 prev 旁置
if [ -e "$PREV_DIR" ] || [ -L "$PREV_DIR" ]; then
  log "旁置旧回滚目录：$PREV_DIR -> $old_prev"
  run_priv mv "$PREV_DIR" "$old_prev"
fi
budget_check

# 2) 交换目录
if [ "$SCHEME" = "symlink" ]; then
  # 解析当前真实目标（实目录或软链目标）
  if [ -L "$STATIC_DIR" ]; then
    cur_target=$(readlink "$STATIC_DIR")
    case "$cur_target" in
      /*) ;;
      *) cur_target="$APP_DIR/$cur_target" ;;
    esac
  else
    cur_target="$STATIC_DIR"
  fi
  log "归档当前版本：$cur_target -> $PREV_DIR"
  run_priv mv "$cur_target" "$PREV_DIR"
  budget_check
  log "提升新版本：$NEXT_DIR -> $ACTIVE_DIR"
  run_priv mv "$NEXT_DIR" "$ACTIVE_DIR"
  budget_check
  log "原子改链：$STATIC_DIR -> $ACTIVE_DIR"
  run_priv ln -sfn "$ACTIVE_DIR" "$STATIC_DIR"
else
  log "归档当前版本：$STATIC_DIR -> $PREV_DIR"
  run_priv mv "$STATIC_DIR" "$PREV_DIR"
  budget_check
  log "提升新版本：$NEXT_DIR -> $STATIC_DIR"
  run_priv mv "$NEXT_DIR" "$STATIC_DIR"
fi
ok "目录切换完成"

# 3) 切换后本地校验：新根入口文件齐全
new_root="$STATIC_DIR"
[ "$SCHEME" = "symlink" ] && new_root="$ACTIVE_DIR"
dir_readable_by_owner "$new_root" || warn "新版本目录应用属主不可读，确认服务进程有权读取 $new_root"
missing=0
while IFS= read -r ref; do
  case "$ref" in
    /assets/*|/covers/*|/favicon.*|/brand/*|/apple-touch-icon.png|/manifest.webmanifest|/theme-bootstrap.js)
      f="$new_root$ref"
      [ -f "$f" ] || { warn "新版本入口缺失：$ref"; missing=1; }
      ;;
  esac
done <<EOF
$(index_refs "$new_root/index.html")
EOF
[ "$missing" -eq 0 ] || die "切换后新版本入口不完整；立即执行 rollback.sh --apply"

# 4) reload 服务
if [ "$DO_RELOAD" -eq 1 ]; then
  service_reload "$PROD_SERVICE"
  sleep 2
fi

# 5) 切换后健康门禁
probe_health "$HEALTH_BASE"
if [ "$HEALTH_CODE" != "200" ] || [ "$HEALTH_STATUS" != "ok" ]; then
  warn "切换后 health 异常：$HEALTH_CODE status=${HEALTH_STATUS:-?}"
  echo "----------------------------------------------------------------"
  echo "立即人工回滚：sudo -n sh ops/release/rollback.sh --apply --confirm"
  echo "----------------------------------------------------------------"
  die "切换后健康门禁失败，未自动回滚，请按上述命令人工处理"
fi
log "切换后 health 正常：version=$HEALTH_VERSION"
if [ -n "$EXPECTED_VERSION" ] && [ "$HEALTH_VERSION" != "$EXPECTED_VERSION" ]; then
  die "版本不符：health=$HEALTH_VERSION 期望=$EXPECTED_VERSION"
fi
ok "全量切换完成：$STATIC_DIR -> $new_root（version=${HEALTH_VERSION:-未知}）"
