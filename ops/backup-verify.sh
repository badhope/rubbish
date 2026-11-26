#!/usr/bin/env bash
# 备份演练：gzip/tar 完整性校验 + 临时库恢复 + 表行数核对。
# 生产由 root cron 调用；脚本本身不写业务库，只创建/删除一个临时库。
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/www/backups/rubbish}"
LOG="${LOG:-/var/log/rubbish-backup-verify.log}"
DB_CONTAINER="${DB_CONTAINER:-rubbish-db-1}"
DB_USER="${DB_USER:-rubbish}"
CHECK_DB="${CHECK_DB:-rubbish_restore_check}"
MIN_RESOURCES="${MIN_RESOURCES:-1}"

note() { printf '[%s] %s\n' "$(date -Is)" "$*" >> "$LOG"; }
mkdir -p "$(dirname "$LOG")"

db=$(ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | head -1)
up=$(ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | head -1)
if [ -z "$db" ] || [ -z "$up" ]; then
  note "FAIL no db/uploads backup under $BACKUP_DIR"
  exit 1
fi

note "checking $(basename "$db") / $(basename "$up")"
gzip -t "$db"
tar -tzf "$up" >/dev/null

cleanup() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS $CHECK_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres \
  -c "CREATE DATABASE $CHECK_DB" >/dev/null
gunzip -c "$db" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$CHECK_DB" \
  -v ON_ERROR_STOP=1 >/dev/null

resources=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$CHECK_DB" \
  -Atc 'SELECT count(*) FROM resources')
users=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$CHECK_DB" \
  -Atc 'SELECT count(*) FROM users')
[ "$resources" -ge "$MIN_RESOURCES" ] || {
  note "FAIL resources=$resources users=$users"
  exit 1
}
note "restore ok $(basename "$db") resources=$resources users=$users"
