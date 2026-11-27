#!/usr/bin/env bash
# Daily cache warm-up for the routes that actually exist in the login-wall
# build. Sitemap/RSS deliberately 404 while the auth wall is on; warming them
# only produced a red job every morning. Run after deploy and once at 04:10.
set -uo pipefail

BASE="${BASE:-https://rubbish.argjiemi.cn}"
LOG="${LOG:-/var/log/rubbish-refresh.log}"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
touch "$LOG" 2>/dev/null || LOG=/tmp/rubbish-refresh.log
note() { printf '[%s] %s\n' "$(date -Is)" "$*" >>"$LOG"; }
fail=0

for i in $(seq 1 30); do
  curl -fsS -L -m 5 "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 2
done

warm() {
  local path="$1" code
  code=$(curl -sS -L -m 20 -o /dev/null -w '%{http_code} %{time_starttransfer}' "$BASE$path" 2>/dev/null || true)
  note "warm $path $code"
  [ "${code%% *}" = "200" ] || fail=1
}

for p in / /catalog /issues /explore /forum '/about?tab=metrics' /api/health /api/explore/overview; do
  warm "$p"
done

# Overview is public while /api/catalog is region/login gated. Warm the five
# surfaced article pages, which are real HTML routes and are safe for guests.
ids=$(curl -sS -L -m 20 "$BASE/api/explore/overview" \
  | python3 -c 'import sys,json;print(" ".join(str(x["id"]) for x in json.load(sys.stdin).get("top_resources",[])[:5]))' 2>/dev/null || true)
for id in $ids; do
  warm "/catalog/$id"
done

if [ "$fail" -eq 0 ]; then
  note "refresh done"
else
  note "refresh finished with failures"
fi
exit "$fail"
