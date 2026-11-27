#!/usr/bin/env bash
# 一条命令发布当前公网形态：本地构建 → 上传 → 服务器替换静态 → 重启 systemd → 健康门禁 → 预热。
# 生产：deploy@103.116.247.174:/opt/rubbish-app，服务 rubbish-app.service，静态目录 static/。
set -euo pipefail

HOST="${HOST:-deploy@103.116.247.174}"
APP_DIR="${APP_DIR:-/opt/rubbish-app}"
SERVICE="${SERVICE:-rubbish-app}"
KEEP_ROLLBACK="${KEEP_ROLLBACK:-3}"
STAMP="$(date +%Y%m%d%H%M%S)"
TGZ="/tmp/rubbish-static-${STAMP}.tgz"

cd "$(dirname "$0")/../apps/frontend"
npm run build
tar czf "$TGZ" -C dist .
scp -q "$TGZ" "$HOST:/tmp/rubbish-static-${STAMP}.tgz"

ssh "$HOST" "APP_DIR='$APP_DIR' SERVICE='$SERVICE' KEEP_ROLLBACK='$KEEP_ROLLBACK' STAMP='$STAMP' bash -s" <<'REMOTE'
set -euo pipefail
NEW_DIR="/tmp/rubbish-static-${STAMP}"
ROLLBACK="${APP_DIR}/static-${STAMP}"

rm -rf "$NEW_DIR"
mkdir -p "$NEW_DIR"
tar xzf "/tmp/rubbish-static-${STAMP}.tgz" -C "$NEW_DIR"

# 先完整备份旧静态，再整目录替换，避免旧 hash 资源残留。
cp -a "${APP_DIR}/static" "$ROLLBACK"
rsync -a --delete "$NEW_DIR/" "${APP_DIR}/static/"
chown -R deploy:deploy "${APP_DIR}/static"

sudo -n systemctl restart "$SERVICE"
sleep 4

health_ok() {
  curl -fsS --max-time 10 -H 'Host: rubbish.argjiemi.cn' http://127.0.0.1:8080/api/health 2>/dev/null \
    | grep -q '"status":"ok"' || return 1
  curl -fsS --max-time 10 -o /dev/null -H 'Host: rubbish.argjiemi.cn' http://127.0.0.1:8080/ 2>/dev/null || return 1
  curl -fsS --max-time 10 -o /dev/null -H 'Host: rubbish.argjiemi.cn' http://127.0.0.1:8080/catalog 2>/dev/null || return 1
}

wait_health() {
  local i
  for i in $(seq 1 40); do
    health_ok && return 0
    sleep 1
  done
  return 1
}

if ! wait_health; then
  echo "health failed after 40s, rolling back to ${ROLLBACK}"
  rsync -a --delete "${ROLLBACK}/" "${APP_DIR}/static/"
  chown -R deploy:deploy "${APP_DIR}/static"
  sudo -n systemctl restart "$SERVICE"
  if ! wait_health; then
    echo "rollback also failed"
    exit 1
  fi
  echo "rolled back"
  exit 1
fi

if [ -x /usr/local/lib/rubbish-ops/site-refresh.sh ]; then
  sudo -n bash -c '/usr/local/lib/rubbish-ops/site-refresh.sh >>/var/log/rubbish-refresh.log 2>&1' || true
fi

# 只保留最近 N 份回滚快照。
find "${APP_DIR}" -maxdepth 1 -type d -name 'static-[0-9]*' -printf '%T@ %p\n' 2>/dev/null \
  | sort -nr | tail -n +$((KEEP_ROLLBACK + 1)) | cut -d' ' -f2- | xargs -r sudo -n rm -rf
echo "deployed ${STAMP} version=$(curl -fsS -H 'Host: rubbish.argjiemi.cn' http://127.0.0.1:8080/api/health)"
REMOTE
