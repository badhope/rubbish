#!/bin/sh
# canary-deploy.sh — 把新构建产物放到独立 canary 目录（或 static-next 暂存目录），
# 起独立端口的只读 canary 入口，不动当前 static 根；带冒烟探针。
#
# 两种用法：
#   1) 目标机上直接执行（需要对 /opt 写权限，deploy 用户免密 sudo）：
#        sudo -n sh ops/release/canary-deploy.sh --source ./dist --apply
#   2) 控制端经 SSH 执行（脚本包自动上传到目标机临时目录，结束后清理）：
#        sh ops/release/canary-deploy.sh --ssh deploy@103.116.247.174 \
#            --source ./dist --target canary --apply --probe
#
# 默认 DRY-RUN：只打印计划动作与清点结果，不落盘、不起服务。
# 探针只发 GET 请求；注册/发帖等写操作只允许在 QA 环境进行。
set -eu
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$script_dir/lib/release-common.sh"

bootstrap_if_ssh "$0" "$@"

SOURCE=""
TARGET="canary"
START_CANARY=0
DO_PROBE=1
EXTRA_ROUTES="/help.html /manifest.webmanifest /favicon.svg"

usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

参数：
  --source DIR|TGZ     新构建产物目录（含 index.html）或 .tar.gz/.tgz 包
  --target canary      独立 canary 目录（默认 /opt/rubbish-canary/static）
  --target static-next 暂存到 /opt/rubbish-app/static-next（供 promote 使用）
  --port PORT          canary 端口（默认 8081）
  --start              部署后创建并启动 canary systemd unit（仅 --apply 时生效）
  --no-start           只放目录，不起 canary 服务
  --probe / --no-probe 部署后是否跑冒烟探针（默认探针开启）
  --apply              真正执行；缺省为 DRY-RUN
  --ssh HOST           控制端模式：经 SSH 在目标机执行
  --remote             内部标记（由 SSH 引导传入，勿手填）
  -h, --help           显示本帮助

环境变量覆盖：CANARY_DIR / CANARY_STATIC / CANARY_PORT / CANARY_SERVICE /
APP_DIR / NEXT_DIR / VENV_DIR / APP_MODULE / PROD_SERVICE / PROD_ENV_FILE
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --port) CANARY_PORT="$2"; shift 2 ;;
    --start) START_CANARY=1; shift ;;
    --no-start) START_CANARY=0; shift ;;
    --probe) DO_PROBE=1; shift ;;
    --no-probe) DO_PROBE=0; shift ;;
    --apply) APPLY=1; shift ;;
    --ssh|--remote) shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（见 --help）" ;;
  esac
done

budget_start

# ---- 解析源产物：目录直接用；压缩包先解到暂存目录 ----------------------------
staged_dir=""
remote_index=""
cleanup_tmp() {
  [ -n "$staged_dir" ] && [ "$staged_dir" != "$SOURCE" ] && rm -rf "$staged_dir"
  [ -n "$remote_index" ] && rm -f "$remote_index"
}
trap cleanup_tmp EXIT

if [ -z "$SOURCE" ]; then
  die "必须用 --source 指定新构建产物目录或压缩包"
fi
if [ -d "$SOURCE" ]; then
  [ -f "$SOURCE/index.html" ] || die "源目录 $SOURCE 缺少 index.html"
  staged_dir="$SOURCE"
elif [ -f "$SOURCE" ]; then
  case "$SOURCE" in
    *.tgz|*.tar.gz) need_cmd tar ;;
    *) die "源文件 $SOURCE 不是 .tgz/.tar.gz" ;;
  esac
  staged_dir=$(mktemp -d)
  log "解包 $SOURCE -> $staged_dir"
  if [ "$APPLY" -eq 0 ]; then
    dry "tar xzf $SOURCE -C $staged_dir"
  else
    tar xzf "$SOURCE" -C "$staged_dir"
  fi
  [ -f "$staged_dir/index.html" ] || die "解包后缺少 index.html"
else
  die "源产物不存在：$SOURCE"
fi

case "$TARGET" in
  canary) target_dir="$CANARY_STATIC" ;;
  static-next) target_dir="$NEXT_DIR" ;;
  *) die "未知 --target：$TARGET（canary | static-next）" ;;
esac

src_files=$(find "$staged_dir" -type f | wc -l | tr -d ' ')
src_index_hash=$(sha256_file "$staged_dir/index.html")
log "源产物：$staged_dir（$src_files 个文件，index.html sha256=$src_index_hash）"
log "目标目录：$target_dir"

# ---- 1) 放置产物（不触碰当前 static 根） ------------------------------------
assert_not_backup_root "$target_dir"
if [ "$APPLY" -eq 0 ]; then
  dry "mkdir -p $target_dir"
  dry "rsync -a --delete $staged_dir/ $target_dir/（清空目标目录后拷入本次 dist）"
  [ "$TARGET" = "canary" ] && dry "记录 canary 清单：$CANARY_DIR/.canary-index.sha256"
else
  run_priv mkdir -p "$target_dir"
  if command -v rsync >/dev/null 2>&1; then
    run_priv rsync -a --delete "$staged_dir/" "$target_dir/"
  else
    warn "rsync 不可用，改用 tar 整目录替换"
    run_priv sh -c "rm -rf '$target_dir'/* && tar c -C '$staged_dir' . | tar x -C '$target_dir'"
  fi
  if [ "$TARGET" = "canary" ]; then
    run_priv sh -c "printf '%s  index.html\n' '$src_index_hash' > '$CANARY_DIR/.canary-index.sha256'"
  fi
  ok "产物已就位：$target_dir"
fi

# ---- 2) 起独立端口 canary 入口（可选） --------------------------------------
canary_base="http://127.0.0.1:$CANARY_PORT"
if [ "$TARGET" = "canary" ] && [ "$START_CANARY" -eq 1 ]; then
  prod_user=$(systemctl show -p User --value "$PROD_SERVICE" 2>/dev/null || echo "")
  [ -n "$prod_user" ] || prod_user="root"
  unit_file="/etc/systemd/system/$CANARY_SERVICE"
  unit_content=$(cat <<UNIT
[Unit]
Description=Rubbish canary（只读冒烟，独立静态目录与端口）
After=network.target $PROD_SERVICE

[Service]
Type=simple
User=$prod_user
WorkingDirectory=$APP_DIR
Environment=RUBBISH_STATIC_DIR=$target_dir
Environment=HOST=127.0.0.1
EnvironmentFile=-$PROD_ENV_FILE
ExecStart=$VENV_DIR/bin/uvicorn $APP_MODULE --host 127.0.0.1 --port $CANARY_PORT
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
)
  log "canary unit：$unit_file（端口 $CANARY_PORT，EnvironmentFile 只引用不打印）"
  if [ "$APPLY" -eq 0 ]; then
    dry "写入 $unit_file："
    printf '%s\n' "$unit_content" | sed 's/^/    /'
    dry "systemctl daemon-reload && systemctl enable --now $CANARY_SERVICE"
  else
    run_priv sh -c "cat > '$unit_file'" <<UNIT
$unit_content
UNIT
    run_priv systemctl daemon-reload
    run_priv systemctl enable --now "$CANARY_SERVICE"
    sleep 3
    service_active "$CANARY_SERVICE" || die "canary 服务未激活，查看 journalctl -u $CANARY_SERVICE"
    ok "canary 服务已启动：$canary_base"
  fi
elif [ "$TARGET" = "canary" ]; then
  log "未启用 --start：仅放置目录，不创建 canary 服务（探针将跳过）"
fi

# ---- 3) 冒烟探针（只读 GET） ------------------------------------------------
if [ "$DO_PROBE" -eq 0 ]; then
  log "跳过冒烟探针（--no-probe）"
  exit 0
fi
if [ "$TARGET" != "canary" ]; then
  log "target=static-next：没有独立端口入口，探针在 promote 后由 verify-site.sh 执行"
  exit 0
fi
if [ "$APPLY" -eq 0 ]; then
  log "DRY-RUN：canary 服务未实际启动，跳过探针"
  exit 0
fi
if [ "$START_CANARY" -eq 0 ]; then
  warn "canary 服务未启动，无法探针；如需冒烟请加 --start"
  exit 1
fi

probe_fail=0
probe_health "$canary_base"
if [ "$HEALTH_CODE" = "200" ] && [ "$HEALTH_STATUS" = "ok" ]; then
  ok "canary /api/health -> 200 status=ok version=$HEALTH_VERSION"
else
  warn "canary /api/health -> $HEALTH_CODE status=${HEALTH_STATUS:-?}"
  probe_fail=1
fi

home_code=$(http_code "$canary_base/")
if [ "$home_code" = "200" ]; then
  ok "canary 首页 / -> 200"
else
  warn "canary 首页 / -> $home_code"
  probe_fail=1
fi

# 入口 hash 校验：线上 index.html 必须与暂存产物一致
remote_index=$(mktemp)
curl -sS -m "$CURL_TIMEOUT" "$canary_base/" -o "$remote_index" 2>/dev/null || true
if [ -s "$remote_index" ]; then
  remote_hash=$(sha256_file "$remote_index")
  if [ "$remote_hash" = "$src_index_hash" ]; then
    ok "index.html sha256 一致：$remote_hash"
  else
    warn "index.html hash 不一致：远端=$remote_hash 产物=$src_index_hash（可能被缓存或代理改写）"
    probe_fail=1
  fi
  while IFS= read -r ref; do
    case "$ref" in
      /assets/*|/covers/*|/favicon.*|/brand/*|/apple-touch-icon.png|/manifest.webmanifest|/theme-bootstrap.js)
        f="$target_dir$ref"
        if [ ! -f "$f" ]; then
          warn "入口引用缺失本地文件：$ref"
          probe_fail=1
          continue
        fi
        code=$(http_code "$canary_base$ref")
        if [ "$code" = "200" ]; then
          ok "入口 $ref -> 200"
        else
          warn "入口 $ref -> $code"
          probe_fail=1
        fi
        ;;
    esac
  done <<EOF
$(index_refs "$remote_index")
EOF
fi

for r in $EXTRA_ROUTES; do
  code=$(http_code "$canary_base$r")
  if [ "$code" = "200" ]; then
    ok "路由 $r -> 200"
  else
    warn "路由 $r -> $code"
    probe_fail=1
  fi
done

log "只读声明：本探针全部为 GET；canary 共享生产数据，禁止在 canary 上做注册/发帖/改密等写操作"
if [ "$probe_fail" -ne 0 ]; then
  die "canary 冒烟探针存在失败项，不要进入全量切换"
fi
ok "canary 冒烟探针全部通过：$canary_base"
