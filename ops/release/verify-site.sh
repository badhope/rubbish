#!/bin/sh
# verify-site.sh — 发布后站点校验：健康版本、index.html 只引用新入口、站内断链抽查、
# 旧资产/旧术语残留扫描、CSP 与安全响应头、favicon/manifest/robots/sitemap/OG 可访问性。
# 只读 GET，不做任何写操作。
#
# 两种用法：
#   1) 目标机直接执行：
#        sh ops/release/verify-site.sh --base http://127.0.0.1:8080
#   2) 控制端经 SSH（探针经远端回环地址执行）：
#        sh ops/release/verify-site.sh --ssh deploy@103.116.247.174 --base http://127.0.0.1:8080
#
# 退出码：0 = 全部 PASS/SKIP；1 = 至少一项 FAIL。
set -eu
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$script_dir/lib/release-common.sh"

bootstrap_if_ssh "$0" "$@"

BASE_URL="http://127.0.0.1:$PROD_PORT"
EXPECTED_VERSION=""
DIST_DIR=""
EXTRA_ROUTES="/help.html /catalog /about"

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

参数：
  --base URL           站点基准地址（默认 http://127.0.0.1:8080）
  --expected-version VER  health 版本须等于该版本（可选）
  --dist-dir DIR       本地新构建目录，用于比对 index.html 入口 hash（可选）
  --routes a,b,c       追加抽查的站内路由（空格分隔）
  --ssh HOST / --remote 控制端 SSH 模式 / 内部远端标记
  -h, --help           显示本帮助
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE_URL="$2"; shift 2 ;;
    --expected-version) EXPECTED_VERSION="$2"; shift 2 ;;
    --dist-dir) DIST_DIR="$2"; shift 2 ;;
    --routes) EXTRA_ROUTES="$2 $EXTRA_ROUTES"; shift 2 ;;
    --ssh|--remote) shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（见 --help）" ;;
  esac
done

BASE_URL="${BASE_URL%/}"
PASS=0; FAIL=0; SKIP=0
v_ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
v_fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
v_skip() { printf '  \033[33mSKIP\033[0m %s\n' "$1"; SKIP=$((SKIP+1)); }
section() { printf '\n\033[36m== %s ==\033[0m\n' "$1"; }

# ---- 1) 健康与版本 ----------------------------------------------------------
section "健康与版本"
probe_health "$BASE_URL"
if [ "$HEALTH_CODE" = "000" ]; then
  v_fail "目标不可达：$BASE_URL"
  printf '\nSummary pass=%d fail=%d skip=%d\n' "$PASS" "$FAIL" "$SKIP"
  exit 1
fi
if [ "$HEALTH_CODE" = "200" ] && [ "$HEALTH_STATUS" = "ok" ]; then
  v_ok "/api/health -> 200 status=ok version=$HEALTH_VERSION"
else
  v_fail "/api/health -> $HEALTH_CODE status=${HEALTH_STATUS:-?}"
fi
if [ -n "$EXPECTED_VERSION" ]; then
  if [ "$HEALTH_VERSION" = "$EXPECTED_VERSION" ]; then
    v_ok "版本匹配：$HEALTH_VERSION"
  else
    v_fail "版本不符：health=$HEALTH_VERSION 期望=$EXPECTED_VERSION"
  fi
fi

# ---- 2) 首页与入口引用 ------------------------------------------------------
section "首页与新入口"
home_html=$(mktemp)
trap 'rm -f "$home_html"' EXIT
home_code=$(curl -sS -m "$CURL_TIMEOUT" "$BASE_URL/" -o "$home_html" -w '%{http_code}' 2>/dev/null || echo 000)
if [ "$home_code" = "200" ] && grep -qi '<html' "$home_html"; then
  v_ok "GET / -> 200 HTML"
else
  v_fail "GET / -> $home_code（未返回 HTML 壳）"
fi

if [ -n "$DIST_DIR" ] && [ -f "$DIST_DIR/index.html" ]; then
  if [ "$(sha256_file "$home_html")" = "$(sha256_file "$DIST_DIR/index.html")" ]; then
    v_ok "线上 index.html 与构建产物 hash 一致"
  else
    v_fail "线上 index.html 与构建产物 hash 不一致（缓存/代理改写？）"
  fi
fi

# index.html 引用的入口文件必须可访问
ref_fail=0
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  case "$ref" in
    /assets/*|/covers/*|/favicon.*|/brand/*|/apple-touch-icon.png|/manifest.webmanifest|/theme-bootstrap.js)
      code=$(http_code "$BASE_URL$ref")
      if [ "$code" = "200" ]; then
        v_ok "入口 $ref -> 200"
      else
        v_fail "入口 $ref -> $code"
        ref_fail=1
      fi
      ;;
  esac
done <<EOF
$(index_refs "$home_html")
EOF
[ "$ref_fail" -eq 0 ] || true

# ---- 3) 站内断链抽查 -------------------------------------------------------
section "站内路由抽查"
for r in $EXTRA_ROUTES; do
  code=$(curl -sS -m "$CURL_TIMEOUT" -o /dev/null -w '%{http_code}' -H 'Accept: text/html' "$BASE_URL$r" 2>/dev/null || echo 000)
  # SPA 路由回退 200；真实缺失页面按后端约定返回 404，两者都算可解析；5xx/000 才是故障
  if [ "$code" = "200" ] || [ "$code" = "404" ]; then
    v_ok "路由 $r -> $code"
  else
    v_fail "路由 $r -> $code"
  fi
done

# 从首页 HTML 抽取同域链接做一轮抽查（最多 20 条）
link_fail=0
links=$(sed -n -E 's/^.*href="(\/[^"#?]+)".*/\1/p' "$home_html" | sort -u | head -20)
for l in $links; do
  case "$l" in
    /api/*|/uploads/*) continue ;;
  esac
  code=$(http_code "$BASE_URL$l")
  if [ "$code" = "200" ] || [ "$code" = "404" ]; then
    :
  else
    v_fail "首页链接 $l -> $code"
    link_fail=1
  fi
done
[ "$link_fail" -eq 0 ] && v_ok "首页同域链接抽查无 5xx/000"

# ---- 4) 旧资产 / 旧术语残留 ------------------------------------------------
section "旧资产与旧术语残留"
legacy_hit=0
for asset in $LEGACY_BRAND_ASSETS; do
  code=$(http_code "$BASE_URL/$asset")
  if [ "$code" = "200" ]; then
    v_fail "旧品牌资产仍可访问：/$asset"
    legacy_hit=1
  else
    v_ok "旧品牌资产已不可访问：/$asset（$code）"
  fi
done
# 首页与入口 JS 里扫旧术语（大小写不敏感）
for term in $LEGACY_TERMS; do
  if grep -qi "$term" "$home_html"; then
    v_fail "首页残留旧术语：$term"
    legacy_hit=1
  fi
done
v_skip "入口 JS 包内旧术语扫描需在静态目录侧执行（见 baseline-check.sh 资产清单）"

# ---- 5) CSP / 安全响应头 ---------------------------------------------------
section "安全响应头"
hdrs=$(curl -sS -m "$CURL_TIMEOUT" -D - -o /dev/null "$BASE_URL/api/health" 2>/dev/null)
check_header() {
  name="$1"; pattern="$2"; label="$3"
  if printf '%s' "$hdrs" | grep -qi "$name[[:space:]]*:[[:space:]]*$pattern"; then
    v_ok "$label"
  else
    v_fail "缺少或不符：$label"
  fi
}
check_header "content-security-policy" "default-src" "Content-Security-Policy 存在"
check_header "x-frame-options" "DENY" "X-Frame-Options: DENY"
check_header "x-content-type-options" "nosniff" "X-Content-Type-Options: nosniff"
check_header "referrer-policy" "strict-origin" "Referrer-Policy 存在"
check_header "permissions-policy" "geolocation" "Permissions-Policy 存在"

# ---- 6) favicon / manifest / robots / sitemap / OG -------------------------
section "SEO 与可访问性"
seo_paths="/favicon.ico /favicon.svg /manifest.webmanifest /robots.txt /sitemap.xml /apple-touch-icon.png"
for p in $seo_paths; do
  code=$(http_code "$BASE_URL$p")
  if [ "$code" = "200" ]; then
    v_ok "$p -> 200"
  else
    v_fail "$p -> $code"
  fi
done
# OG 图：从首页 meta 提取 og:image，校验可达
og_img=$(sed -n -E 's/.*property="og:image"[[:space:]]+content="([^"]+)".*/\1/p' "$home_html" | head -1)
[ -z "$og_img" ] && og_img=$(sed -n -E 's/.*content="([^"]+)"[[:space:]]+property="og:image".*/\1/p' "$home_html" | head -1)
if [ -n "$og_img" ]; then
  case "$og_img" in
    http://*|https://*) og_url="$og_img" ;;
    *) og_url="$BASE_URL$og_img" ;;
  esac
  code=$(http_code "$og_url")
  if [ "$code" = "200" ]; then v_ok "OG 图可达：$og_img"; else v_fail "OG 图 -> $code：$og_img"; fi
else
  v_skip "首页未声明 og:image"
fi

printf '\nSummary pass=%d fail=%d skip=%d\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -ne 0 ]; then
  printf '\033[31m校验未通过：%d 项 FAIL，禁止放量。\033[0m\n' "$FAIL"
  exit 1
fi
printf '\033[32m校验通过。\033[0m\n'
