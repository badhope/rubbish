#!/bin/sh
# baseline-check.sh — D0 基线快照：HEAD / VERSION / 版本一致性 / typecheck 结果 /
# 生产与 QA health / 静态资产清单。输出 JSON 快照 + 可读表格，供整改前后比对。
#
# 只读：不重启服务、不改静态目录、不读取 .env 内容；远程只取版本号、路径、health。
#
# 两种用法：
#   1) 控制端本地采集（仓库在本地，经 SSH 取远端 health 与资产清单）：
#        sh ops/release/baseline-check.sh --ssh deploy@103.116.247.174 --out baseline.json
#   2) 目标机上直接采集（health 走本机回环，静态目录读本地）：
#        sudo -n sh ops/release/baseline-check.sh --out baseline.json
set -eu
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$script_dir/lib/release-common.sh"

bootstrap_if_ssh "$0" "$@"

REPO_DIR="$(cd "$script_dir/../.." && pwd)"
PROD_URL="http://127.0.0.1:$PROD_PORT"
QA_URL="http://127.0.0.1:$QA_PORT"
OUT_FILE=""
RUN_TYPECHECK=0

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

参数：
  --repo DIR          仓库根目录（默认按脚本位置推算）
  --prod-url URL      生产 health 地址（默认 http://127.0.0.1:8080）
  --qa-url URL        QA health 地址（默认 http://127.0.0.1:8090）
  --out FILE          JSON 快照输出路径（默认 ops/release/baseline-<时间戳>.json）
  --run-typecheck     实际执行前端/后端类型检查（默认只记录 skipped）
  --ssh HOST          控制端模式：经 SSH 在远端采集 health 与静态清单
  --remote            内部远端标记
  -h, --help          显示本帮助
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO_DIR="$2"; shift 2 ;;
    --prod-url) PROD_URL="$2"; shift 2 ;;
    --qa-url) QA_URL="$2"; shift 2 ;;
    --out) OUT_FILE="$2"; shift 2 ;;
    --run-typecheck) RUN_TYPECHECK=1; shift ;;
    --ssh) SSH_HOST="$2"; shift 2 ;;
    --remote) REMOTE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（见 --help）" ;;
  esac
done

stamp=$(date +%Y%m%d-%H%M%S)
[ -n "$OUT_FILE" ] || OUT_FILE="$script_dir/baseline-$stamp.json"

# ---------------------------------------------------------------------------
# 仓库侧事实
# ---------------------------------------------------------------------------
head_sha=""
branch=""
repo_version=""
version_consistent="unknown"
tc_front_status="skipped"; tc_front_rc=""; tc_front_tail=""
tc_back_status="skipped"; tc_back_rc=""; tc_back_tail=""

if [ -d "$REPO_DIR/.git" ]; then
  head_sha=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo "")
  branch=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
fi
if [ -f "$REPO_DIR/VERSION" ]; then
  repo_version=$(tr -d '[:space:]' < "$REPO_DIR/VERSION")
fi

if [ -x "$REPO_DIR/scripts/check-version.sh" ]; then
  if "$REPO_DIR/scripts/check-version.sh" >/tmp/baseline-version-$stamp.log 2>&1; then
    version_consistent="yes"
  else
    version_consistent="no"
  fi
fi

if [ "$RUN_TYPECHECK" -eq 1 ]; then
  set +e
  if [ -d "$REPO_DIR/apps/frontend" ] && [ -f "$REPO_DIR/apps/frontend/package.json" ]; then
    log "执行前端 typecheck（npm run typecheck）"
    (cd "$REPO_DIR/apps/frontend" && npm run typecheck) >/tmp/baseline-tc-front-$stamp.log 2>&1
    tc_front_rc=$?
    [ "$tc_front_rc" -eq 0 ] && tc_front_status="pass" || tc_front_status="fail"
    tc_front_tail=$(tail -n 5 /tmp/baseline-tc-front-$stamp.log 2>/dev/null | tr '\n' ' ' | sed 's/"/'\''/g')
  fi
  if [ -d "$REPO_DIR/apps/backend" ]; then
    if command -v ruff >/dev/null 2>&1; then
      log "执行后端 ruff check"
      ruff check "$REPO_DIR/apps/backend/app" >/tmp/baseline-tc-back-$stamp.log 2>&1
      tc_back_rc=$?
      [ "$tc_back_rc" -eq 0 ] && tc_back_status="pass" || tc_back_status="fail"
      tc_back_tail=$(tail -n 5 /tmp/baseline-tc-back-$stamp.log 2>/dev/null | tr '\n' ' ' | sed 's/"/'\''/g')
    else
      tc_back_status="skipped(ruff 未安装)"
    fi
  fi
  set -e
fi

# ---------------------------------------------------------------------------
# 环境侧事实：health + 静态资产清单
# ---------------------------------------------------------------------------
# inventory <dir>：输出 key=value 行（在本地或远端 shell 执行）
inventory_script='
if [ ! -d "$dir" ]; then echo "static_present=no"; exit 0; fi
echo "static_present=yes"
files=$(find -L "$dir" -type f | wc -l | tr -d " ")
assets=$(find -L "$dir/assets" -type f 2>/dev/null | wc -l | tr -d " ")
echo "static_files=$files"
echo "static_assets=$assets"
top=$(ls -1 "$dir" 2>/dev/null | tr "\n" "," | sed "s/,$//")
echo "top_entries=$top"
for a in brand-rubbish.png brand-rubbish-lockup.png og-cover.png; do
  [ -f "$dir/$a" ] && echo "legacy_present=$a"
done
'

# 远端/本地通用命令执行器
run_sh() {
  if [ -n "$SSH_HOST" ]; then
    ssh -o BatchMode=yes "$SSH_HOST" "$1"
  else
    sh -c "$1"
  fi
}

collect_env() { # $1 label $2 url $3 static_dir -> 写全局 ENV_JSON_<label> / 表格行
  label="$1"; url="$2"; dir="$3"
  code=$(http_code "$url/api/health")
  body=$(http_body "$url/api/health")
  st=$(health_status "$body"); ver=$(health_version "$body")
  inv=$(run_sh "dir='$dir'; $inventory_script" 2>/dev/null || true)
  # index hash 单独算（兼容远端无 sha256_file 函数）
  hash=""
  if run_sh "test -f '$dir/index.html'" >/dev/null 2>&1; then
    hash=$(run_sh "sha256sum '$dir/index.html' 2>/dev/null | awk '{print \$1}' || shasum -a 256 '$dir/index.html' 2>/dev/null | awk '{print \$1}'")
  fi
  eval "INV_${label}_code='$code' INV_${label}_status='$st' INV_${label}_ver='$ver' INV_${label}_dir='$dir' INV_${label}_hash='$hash'"
  # 解析清单行
  eval "INV_${label}_inv=\$inv"
}

collect_env prod "$PROD_URL" "$STATIC_DIR"
collect_env qa "$QA_URL" "$QA_DIR/static"

# 清单行解析为 JSON 片段
inv_json() {
  inv="$1"
  files=$(printf '%s\n' "$inv" | sed -n 's/^static_files=\(.*\)/\1/p')
  assets=$(printf '%s\n' "$inv" | sed -n 's/^static_assets=\(.*\)/\1/p')
  top=$(printf '%s\n' "$inv" | sed -n 's/^top_entries=\(.*\)/\1/p')
  legacy=$(printf '%s\n' "$inv" | sed -n 's/^legacy_present=\(.*\)/\1/p' | tr '\n' ',' | sed 's/,$//')
  [ -z "$files" ] && files=0
  [ -z "$assets" ] && assets=0
  printf '{"files":%s,"assets":%s,"top_entries":"%s","legacy_present":"%s"}' "$files" "$assets" "$top" "$legacy"
}

env_json() { # $1 label $2 url
  label="$1"; url="$2"
  eval "code=\$INV_${label}_code; st=\$INV_${label}_status; ver=\$INV_${label}_ver; dir=\$INV_${label}_dir; hash=\$INV_${label}_hash; inv=\$INV_${label}_inv"
  printf '{"url":"%s","http_code":"%s","status":"%s","version":"%s","static_dir":"%s","index_hash":"%s","inventory":%s}' \
    "$url" "${code:-000}" "${st:-unreachable}" "${ver:-}" "$dir" "${hash:-}" "$(inv_json "$inv")"
}

# ---------------------------------------------------------------------------
# 写 JSON
# ---------------------------------------------------------------------------
mkdir -p "$(dirname "$OUT_FILE")"
cat > "$OUT_FILE" <<JSON
{
  "snapshot_at": "$(date -Is)",
  "baseline": "D0",
  "repo": {
    "head": "${head_sha:-unknown}",
    "branch": "${branch:-unknown}",
    "version": "${repo_version:-unknown}",
    "version_consistent": "$version_consistent",
    "typecheck": {
      "frontend": {"status": "$tc_front_status", "rc": "${tc_front_rc:-}", "tail": "$tc_front_tail"},
      "backend": {"status": "$tc_back_status", "rc": "${tc_back_rc:-}", "tail": "$tc_back_tail"}
    }
  },
  "environments": {
    "prod": $(env_json prod "$PROD_URL"),
    "qa": $(env_json qa "$QA_URL")
  },
  "legacy_terms": "$LEGACY_TERMS",
  "legacy_brand_assets": "$LEGACY_BRAND_ASSETS"
}
JSON

# ---------------------------------------------------------------------------
# 可读表格
# ---------------------------------------------------------------------------
line() { printf '%s\n' "------------------------------------------------------------"; }
line
printf 'Rubbish D0 基线快照  %s\n' "$(date -Is)"
line
printf '%-22s %s\n' "仓库 HEAD" "${head_sha:-unknown}"
printf '%-22s %s\n' "分支" "${branch:-unknown}"
printf '%-22s %s\n' "VERSION" "${repo_version:-unknown}"
printf '%-22s %s\n' "版本一致性" "$version_consistent"
printf '%-22s %s / %s\n' "typecheck(前/后)" "$tc_front_status" "$tc_back_status"
line
printf '%-8s %-8s %-10s %-10s %s\n' "环境" "HTTP" "status" "version" "static 清单"
for label in prod qa; do
  eval "code=\$INV_${label}_code; st=\$INV_${label}_status; ver=\$INV_${label}_ver; inv=\$INV_${label}_inv"
  files=$(printf '%s\n' "$inv" | sed -n 's/^static_files=\(.*\)/\1/p')
  assets=$(printf '%s\n' "$inv" | sed -n 's/^static_assets=\(.*\)/\1/p')
  legacy=$(printf '%s\n' "$inv" | sed -n 's/^legacy_present=\(.*\)/\1/p' | tr '\n' ' ')
  printf '%-8s %-8s %-10s %-10s files=%s assets=%s legacy=[%s]\n' \
    "$label" "${code:-000}" "${st:-?}" "${ver:-?}" "${files:-0}" "${assets:-0}" "$legacy"
done
line
printf 'JSON 快照：%s\n' "$OUT_FILE"
ok "基线采集完成"
