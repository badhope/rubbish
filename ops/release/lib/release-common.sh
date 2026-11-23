# release-common.sh — Rubbish 发布工具链公共库
#
# 被 ops/release/ 下各脚本 source，不直接执行。
# 约定：POSIX sh；set -euo pipefail 由各脚本入口设置；破坏性动作默认 dry-run。
# 本库不读取、不打印任何 .env / 密钥内容；远程只取版本号、路径、health 状态。

# ---------------------------------------------------------------------------
# 默认路径与服务标识（均可被同名环境变量覆盖）
# ---------------------------------------------------------------------------
APP_DIR="${APP_DIR:-/opt/rubbish-app}"
QA_DIR="${QA_DIR:-/opt/rubbish-qa}"
STATIC_DIR="${STATIC_DIR:-$APP_DIR/static}"
NEXT_DIR="${NEXT_DIR:-$APP_DIR/static-next}"
PREV_DIR="${PREV_DIR:-$APP_DIR/static.prev}"
ACTIVE_DIR="${ACTIVE_DIR:-$APP_DIR/static-active}"
CANARY_DIR="${CANARY_DIR:-/opt/rubbish-canary}"
CANARY_STATIC="${CANARY_STATIC:-$CANARY_DIR/static}"
CANARY_PORT="${CANARY_PORT:-8081}"
PROD_PORT="${PROD_PORT:-8080}"
QA_PORT="${QA_PORT:-8090}"
PROD_SERVICE="${PROD_SERVICE:-rubbish-app.service}"
QA_SERVICE="${QA_SERVICE:-rubbish-qa.service}"
CANARY_SERVICE="${CANARY_SERVICE:-rubbish-canary.service}"
DB_CONTAINER="${DB_CONTAINER:-rubbish-db-1}"
DB_NAME="${DB_NAME:-rubbish}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
DOMAIN="${DOMAIN:-rubbish.argjiemi.cn}"
# 生产环境变量文件：只允许被 systemd unit 以 EnvironmentFile 方式引用，
# 脚本自身绝不 cat / grep 其中的密钥。
PROD_ENV_FILE="${PROD_ENV_FILE:-/www/wwwroot/rubbish.argjiemi.cn/.env}"
VENV_DIR="${VENV_DIR:-$APP_DIR/.venv}"
APP_MODULE="${APP_MODULE:-app.main:app}"

# 整改需要从 Web 根清除的旧品牌资产文件名
LEGACY_BRAND_ASSETS="brand-rubbish.png brand-rubbish-lockup.png og-cover.png"
# 服务端/页面里不得残留的旧术语（大小写不敏感扫描）
LEGACY_TERMS="${LEGACY_TERMS:-scholarhub}"

# ---------------------------------------------------------------------------
# 运行态（由各脚本解析参数后填充）
# ---------------------------------------------------------------------------
APPLY=0            # 0 = dry-run（默认），1 = 真正执行
REMOTE=0           # 1 = 已在目标机上执行
SSH_HOST=""        # 控制端模式下的 deploy@host
START_TS=0
TIME_BUDGET="${TIME_BUDGET:-600}"   # 单步动作预算：10 分钟
CURL_TIMEOUT="${CURL_TIMEOUT:-15}"

# ---------------------------------------------------------------------------
# 日志
# ---------------------------------------------------------------------------
_rl_ts() { date +%Y-%m-%dT%H:%M:%S%z; }
log()  { printf '[%s] %s\n' "$(_rl_ts)" "$*"; }
ok()   { printf '[%s] \033[32mOK\033[0m  %s\n' "$(_rl_ts)" "$*"; }
warn() { printf '[%s] \033[33mWARN\033[0m %s\n' "$(_rl_ts)" "$*" >&2; }
die()  { printf '[%s] \033[31mFAIL\033[0m %s\n' "$(_rl_ts)" "$*" >&2; exit 1; }
dry()  { if [ "$APPLY" -eq 0 ]; then printf '[DRY-RUN] %s\n' "$*"; else printf '[APPLY]   %s\n' "$*"; fi; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少依赖命令：$1"
}

# 提权执行：root 直跑，否则免密 sudo
run_priv() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo -n "$@"
  fi
}

# ---------------------------------------------------------------------------
# 时间预算（切换/回滚必须在 10 分钟内完成）
# ---------------------------------------------------------------------------
budget_start() { START_TS=$(date +%s); }
budget_check() {
  now=$(date +%s)
  el=$((now - START_TS))
  if [ "$el" -gt "$TIME_BUDGET" ]; then
    die "超出 ${TIME_BUDGET}s 时间预算（已用 ${el}s），中止并保留现场"
  fi
}

# ---------------------------------------------------------------------------
# 摘要 / HTTP 探针
# ---------------------------------------------------------------------------
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "本机没有 sha256sum / shasum，无法做入口 hash 校验"
  fi
}

http_code() {
  out=$(curl -sS -m "$CURL_TIMEOUT" -o /dev/null -w '%{http_code}' "$1" 2>/dev/null) || true
  [ -z "$out" ] && out=000
  printf '%s' "$out"
}
http_body() {
  curl -sS -m "$CURL_TIMEOUT" "$1" 2>/dev/null || true
}

health_status() { printf '%s' "$1" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1; }
health_version() { printf '%s' "$1" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1; }

# 探测 /api/health，结果写入全局 HEALTH_CODE / HEALTH_BODY / HEALTH_STATUS / HEALTH_VERSION
probe_health() {
  HEALTH_CODE=$(http_code "$1/api/health")
  HEALTH_BODY=$(http_body "$1/api/health")
  HEALTH_STATUS=$(health_status "$HEALTH_BODY")
  HEALTH_VERSION=$(health_version "$HEALTH_BODY")
}

# 从 index.html 提取根相对引用路径（src/href，去掉 query/hash）
index_refs() {
  sed -n -E 's/^.*(src|href)="(\/[^"#?]+)".*/\2/p' "$1" | sort -u
}

# 目录属主可读性预检：返回 0 表示应用属主能读到 index.html
dir_readable_by_owner() {
  dir="$1"
  [ -f "$dir/index.html" ] || return 1
  owner=$(stat -c '%U' "$dir" 2>/dev/null || stat -f '%Su' "$dir" 2>/dev/null || echo "")
  if [ "$(id -u)" -eq 0 ] && [ -n "$owner" ] && [ "$owner" != "root" ]; then
    sudo -n -u "$owner" test -r "$dir/index.html"
  else
    test -r "$dir/index.html"
  fi
}

# 服务 reload：unit 支持 reload 就 reload，否则退回 restart（仅记录告警）
service_reload() {
  unit="$1"
  if [ "$APPLY" -eq 0 ]; then
    dry "systemctl reload $unit（若 CanReload=no 则 restart）"
    return 0
  fi
  can_reload=$(systemctl show -p CanReload --value "$unit" 2>/dev/null || echo unknown)
  if [ "$can_reload" = "yes" ]; then
    run_priv systemctl reload "$unit"
  else
    warn "$unit 不支持 reload（CanReload=$can_reload），改用 restart"
    run_priv systemctl restart "$unit"
  fi
}

service_active() { systemctl is-active --quiet "$1" 2>/dev/null; }

# ---------------------------------------------------------------------------
# SSH 引导：控制端把整个 ops/release 目录打包上传到目标机临时目录，
# 再以 --remote 方式在目标机上执行；结束后清理临时目录。
# 必须在本地参数解析之前调用：bootstrap_if_ssh "$0" "$@"
# ---------------------------------------------------------------------------
shell_quote() {
  case "$1" in
    '') printf "''" ;;
    *[!A-Za-z0-9_./-]*) printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")" ;;
    *) printf '%s' "$1" ;;
  esac
}

bootstrap_if_ssh() {
  script_path="$1"; shift
  n=$#
  i=1
  ssh_host=""
  remote=0
  while [ "$i" -le "$n" ]; do
    eval "a=\${$i}"
    if [ "$a" = "--ssh" ]; then eval "ssh_host=\${$((i+1))}"; fi
    if [ "$a" = "--remote" ]; then remote=1; fi
    i=$((i + 1))
  done
  [ -n "$ssh_host" ] || return 0
  [ "$remote" -eq 1 ] && return 0
  SSH_HOST="$ssh_host"

  rel_dir="$(cd "$(dirname "$script_path")" && pwd)"
  script_name="$(basename "$script_path")"
  remote_dir="/tmp/rubbish-release-$(date +%s)-$$"
  log "SSH 引导：$SSH_HOST -> $remote_dir（脚本 $script_name）"
  [ "$APPLY" -eq 0 ] && warn "当前为 DRY-RUN：远端只做清点/预检，不执行破坏性动作"
  need_cmd tar

  tar czf - -C "$rel_dir" . | ssh -o BatchMode=yes "$SSH_HOST" "mkdir -p '$remote_dir' && tar xzf - -C '$remote_dir'" \
    || die "上传发布脚本包到 $SSH_HOST 失败"

  cmd="sh '$remote_dir/$script_name' --remote"
  i=1
  drop_next=0
  while [ "$i" -le "$n" ]; do
    eval "a=\${$i}"
    if [ "$drop_next" -eq 1 ]; then drop_next=0; i=$((i + 1)); continue; fi
    if [ "$a" = "--ssh" ]; then drop_next=1; i=$((i + 1)); continue; fi
    cmd="$cmd $(shell_quote "$a")"
    i=$((i + 1))
  done
  log "远端执行：$cmd"
  ssh -o BatchMode=yes "$SSH_HOST" "$cmd"
  rc=$?
  ssh -o BatchMode=yes "$SSH_HOST" "rm -rf '$remote_dir'" >/dev/null 2>&1 || true
  exit "$rc"
}

# 安全护栏：清理脚本绝不允许把 /opt/backups 下的回滚包列入删除清单
assert_not_backup_root() {
  case "$1" in
    "$BACKUP_DIR"|"$BACKUP_DIR"/*) die "护栏拒绝：$1 位于回滚备份目录 $BACKUP_DIR，不得删除" ;;
  esac
}
