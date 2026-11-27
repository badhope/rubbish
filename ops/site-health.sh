#!/usr/bin/env bash
# Site health probe for the current production shape:
#   /opt/rubbish-app + systemd rubbish-app.service + PostgreSQL container rubbish-db-1
# Runs from cron as root, but also works as deploy for manual checks.
# Exit 0 only when every deadline-critical signal is healthy.
set -uo pipefail

BASE="${BASE:-https://rubbish.argjiemi.cn}"
BACKUP_DIR="${BACKUP_DIR:-/www/backups/rubbish}"
LOG="${LOG:-/var/log/rubbish-health.log}"
APP_SERVICE="${APP_SERVICE:-rubbish-app}"
DB_CONTAINER="${DB_CONTAINER:-rubbish-db-1}"
BACKUP_USER="${BACKUP_USER:-deploy}"
MIN_RESOURCES="${MIN_RESOURCES:-200}"
MAX_DISK_PCT="${MAX_DISK_PCT:-85}"
MAX_BACKUP_AGE_H="${MAX_BACKUP_AGE_H:-36}"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
touch "$LOG" 2>/dev/null || LOG=/tmp/rubbish-health.log

fail=0
note() { printf '[%s] %s\n' "$(date -Is)" "$*" >>"$LOG"; }
bad() { fail=1; note "FAIL $*"; }

curl_code() {
  local path="$1"
  curl -sS -L -m 20 -o /dev/null -w '%{http_code}' "$BASE$path" 2>/dev/null || echo 000
}

retry_code() {
  local path="$1" expected="$2" code=000 i
  for i in 1 2 3 4 5; do
    code=$(curl_code "$path")
    [ "$code" = "$expected" ] && break
    sleep 3
  done
  printf '%s' "$code"
}

# 1) Public shell + no-cache header (deploy restarts are allowed a short grace).
code=$(retry_code "/" 200)
[ "$code" = 200 ] || bad "home=$code"

hdr=$(mktemp)
ok=0
for i in 1 2 3; do
  curl -sS -L -m 15 -D "$hdr" -o /dev/null "$BASE/" 2>/dev/null || true
  if grep -qi 'cache-control: no-cache' "$hdr" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
rm -f "$hdr"
[ "$ok" = 1 ] || bad "html cache-control missing"

# 2) App version + database through the public health endpoint.
health=$(curl -sS -L -m 20 "$BASE/api/health" 2>/dev/null || true)
version=$(printf '%s' "$health" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("version",""))' 2>/dev/null || true)
status=$(printf '%s' "$health" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("status",""))' 2>/dev/null || true)
[ "$status" = "ok" ] || bad "api/health status=$status version=$version"

# 3) Public catalog count. /api/catalog/stats requires admin and returns 403
# for anonymous probes; /api/explore/overview is the public surface.
total=0
for i in 1 2 3; do
  total=$(curl -sS -L -m 20 "$BASE/api/explore/overview" \
    | python3 -c 'import sys,json;print((json.load(sys.stdin).get("stats") or {}).get("resources",0))' 2>/dev/null || echo 0)
  [ "${total:-0}" -ge "$MIN_RESOURCES" ] && break
  sleep 3
done
[ "${total:-0}" -ge "$MIN_RESOURCES" ] || bad "catalog resources=$total (<$MIN_RESOURCES)"

# 4) Backups: fresh AND readable by the app user. The second check is what
# admin /system/health needs; root-only backups are a false "healthy" signal.
db=$(ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | head -1)
up=$(ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | head -1)
for f in "$db" "$up"; do
  if [ -z "$f" ] || [ ! -f "$f" ]; then bad "backup missing under $BACKUP_DIR"; continue; fi
  age=$(( ( $(date +%s) - $(stat -c %Y "$f") ) / 3600 ))
  [ "$age" -le "$MAX_BACKUP_AGE_H" ] || bad "stale backup $(basename "$f") ${age}h"
done
if [ -n "$db" ] && [ -d "$BACKUP_DIR" ]; then
  if command -v runuser >/dev/null 2>&1 && id "$BACKUP_USER" >/dev/null 2>&1; then
    runuser -u "$BACKUP_USER" -- test -r "$BACKUP_DIR" && runuser -u "$BACKUP_USER" -- test -r "$db" \
      || bad "backup not readable by $BACKUP_USER"
  fi
fi

# 5) Disk headroom.
disk=$(df -P / | awk 'NR==2{gsub("%","",$5);print $5}')
[ "${disk:-100}" -le "$MAX_DISK_PCT" ] || bad "disk ${disk}% (>$MAX_DISK_PCT%)"

# 6) Service + database container. The app is systemd, not a container; the
# old rubbish-app-1 / rubbish-caddy-1 names do not exist on this host.
if systemctl list-unit-files "${APP_SERVICE}.service" >/dev/null 2>&1; then
  systemctl is-active --quiet "$APP_SERVICE" || bad "systemd $APP_SERVICE inactive"
fi
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="sudo -n docker"
db_state=$($DOCKER inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER" 2>/dev/null || echo missing)
case "$db_state" in
  healthy|running) ;;
  *) bad "$DB_CONTAINER=$db_state" ;;
esac

if [ "$fail" -eq 0 ]; then
  note "OK version=$version resources=$total backup=$(basename "${db:-none}") disk=${disk}% db=$db_state"
else
  note "DEGRADED version=$version resources=$total disk=${disk}% db=$db_state"
fi
exit "$fail"
