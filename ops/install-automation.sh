#!/usr/bin/env bash
# Idempotent installer for the non-backup site jobs.
# Production shape: systemd rubbish-app + PostgreSQL container rubbish-db-1.
#
# Installs scripts into /usr/local/lib/rubbish-ops so a later git checkout or
# deploy cannot silently break cron by moving the repository. Backup and
# backup-verify stay in /etc/cron.d/rubbish-backup; they are not duplicated
# here (doing so used to run the same restore drill twice on Sundays).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "install-automation.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
OPS_DIR="${OPS_DIR:-/usr/local/lib/rubbish-ops}"
RUN_USER="${RUN_USER:-deploy}"
LOG_DIR="${LOG_DIR:-/var/log}"
CRON_FILE="${CRON_FILE:-/etc/cron.d/rubbish-automation}"

for script in site-health.sh site-refresh.sh; do
  [ -f "$SCRIPT_DIR/$script" ] || { echo "missing $SCRIPT_DIR/$script" >&2; exit 1; }
  bash -n "$SCRIPT_DIR/$script"
done

install -d -o root -g root -m 0755 "$OPS_DIR"
install -m 0755 -o root -g root "$SCRIPT_DIR/site-health.sh" "$OPS_DIR/site-health.sh"
install -m 0755 -o root -g root "$SCRIPT_DIR/site-refresh.sh" "$OPS_DIR/site-refresh.sh"

install -d -o root -g root -m 0755 "$LOG_DIR"
for log in rubbish-health.log rubbish-refresh.log; do
  touch "$LOG_DIR/$log"
  chown "root:$RUN_USER" "$LOG_DIR/$log" 2>/dev/null || true
  chmod 0640 "$LOG_DIR/$log"
done

cat >"$CRON_FILE" <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Health: catches HTTP/API/backup readability/disk/service regressions.
*/5 * * * * root $OPS_DIR/site-health.sh >> $LOG_DIR/rubbish-health.log 2>&1
# Warm: only real routes; login-wall build intentionally has no sitemap/RSS.
10 4 * * * root $OPS_DIR/site-refresh.sh >> $LOG_DIR/rubbish-refresh.log 2>&1
CRON
chmod 0644 "$CRON_FILE"

if command -v logrotate >/dev/null 2>&1; then
  cat >/etc/logrotate.d/rubbish <<LOGROTATE
/var/log/rubbish-health.log /var/log/rubbish-refresh.log /var/log/rubbish-backup.log /var/log/rubbish-backup-verify.log /var/log/rubbish-offsite.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    create 0640 root $RUN_USER
}
LOGROTATE
  chmod 0644 /etc/logrotate.d/rubbish
fi

if systemctl list-unit-files cron.service >/dev/null 2>&1; then
  systemctl is-active --quiet cron || echo "warning: cron service is not active" >&2
fi

echo "installed $CRON_FILE"
echo "scripts: $OPS_DIR/site-health.sh, $OPS_DIR/site-refresh.sh"
echo "repo: $REPO_DIR"
