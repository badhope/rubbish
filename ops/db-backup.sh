#!/usr/bin/env bash
# Daily backup for the current production shape:
#   PostgreSQL container rubbish-db-1 + host uploads + config files.
# The application runs as deploy and must be able to read the archives; this
# script keeps the directory 0750 root:deploy and files 0640 so admin
# /system/health does not report a false "backup unreadable" warning.
#
# Manual/reference script only. Production cron still calls the installed
# /usr/local/sbin/rubbish-backup.sh; keep the two in sync when changing paths.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/www/backups/rubbish}"
LOG="${LOG:-/var/log/rubbish-backup.log}"
DB_CONTAINER="${DB_CONTAINER:-rubbish-db-1}"
DB_USER="${DB_USER:-rubbish}"
DB_NAME="${DB_NAME:-rubbish}"
UPLOADS_DIR="${UPLOADS_DIR:-/www/wwwroot/rubbish.argjiemi.cn/uploads}"
CONFIG_DIR="${CONFIG_DIR:-/www/wwwroot/rubbish.argjiemi.cn}"
BACKUP_GROUP="${BACKUP_GROUP:-deploy}"
KEEP_DAYS="${KEEP_DAYS:-30}"
TS="$(date +%Y%m%d-%H%M)"

mkdir -p "$(dirname "$LOG")"
note() { printf '[%s] %s\n' "$(date -Is)" "$*" >>"$LOG"; }
install -d -o root -g "$BACKUP_GROUP" -m 0750 "$BACKUP_DIR" 2>/dev/null \
  || { mkdir -p "$BACKUP_DIR"; chgrp "$BACKUP_GROUP" "$BACKUP_DIR" 2>/dev/null || true; chmod 0750 "$BACKUP_DIR"; }

DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="sudo -n docker"

# 1) DB dump: write a .partial, validate gzip, then rename.
db_file="$BACKUP_DIR/db-$TS.sql.gz"
db_tmp="$BACKUP_DIR/.db-$TS.partial.gz"
rm -f "$db_tmp"
if $DOCKER exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner \
     | gzip -6 >"$db_tmp" && gzip -t "$db_tmp" 2>/dev/null; then
  chgrp "$BACKUP_GROUP" "$db_tmp" 2>/dev/null || true
  chmod 0640 "$db_tmp"
  mv "$db_tmp" "$db_file"
  note "db ok $(basename "$db_file") $(du -h "$db_file" | cut -f1)"
else
  rm -f "$db_tmp"
  note "FAIL db dump ($DB_CONTAINER/$DB_USER/$DB_NAME)"
  exit 1
fi

# 2) uploads from the host path used by systemd, not a Docker volume.
up_file="$BACKUP_DIR/uploads-$TS.tar.gz"
up_tmp="$BACKUP_DIR/.uploads-$TS.partial.tar.gz"
if tar czf "$up_tmp" -C "$UPLOADS_DIR" . >>"$LOG" 2>&1; then
  chgrp "$BACKUP_GROUP" "$up_tmp" 2>/dev/null || true
  chmod 0640 "$up_tmp"
  mv "$up_tmp" "$up_file"
  note "uploads ok $(basename "$up_file") $(du -h "$up_file" | cut -f1)"
else
  rm -f "$up_tmp"
  note "FAIL uploads archive ($UPLOADS_DIR)"
  exit 1
fi

# 3) Config archive: enough to rebuild the service, no secrets copied elsewhere.
cfg_file="$BACKUP_DIR/config-$TS.tar.gz"
cfg_tmp="$BACKUP_DIR/.config-$TS.partial.tar.gz"
if tar czf "$cfg_tmp" -C "$CONFIG_DIR" .env docker-compose.yml docker-compose.bt.yml >>"$LOG" 2>&1; then
  chgrp "$BACKUP_GROUP" "$cfg_tmp" 2>/dev/null || true
  chmod 0640 "$cfg_tmp"
  mv "$cfg_tmp" "$cfg_file"
  note "config ok $(basename "$cfg_file")"
else
  rm -f "$cfg_tmp"
  note "FAIL config archive ($CONFIG_DIR)"
  exit 1
fi

# 4) Retention: only archives this script names; never touch other files.
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'db-*.sql.gz' -o -name 'uploads-*.tar.gz' -o -name 'config-*.tar.gz' \) \
  -mtime +"$KEEP_DAYS" -delete

note "done db=$(basename "$db_file") up=$(basename "$up_file") cfg=$(basename "$cfg_file") disk=$(df -P / | awk 'NR==2{print $5}')"
