#!/usr/bin/env bash
#
# Rubbish database restore script.
#
# Usage:
#   ./restore.sh <backup-file> [--db-url URL]
#
# Defaults:
#   --db-url  postgresql://rubbish:rubbish_dev@localhost:5432/rubbish
#
# Behaviour:
#   - Validates the backup file exists and is a pg_dump custom-format archive.
#   - Drops and recreates the public schema, then restores via pg_restore.
#   - Logs to stdout with [YYYY-MM-DD HH:MM:SS] timestamps.

set -euo pipefail

# --- defaults -----------------------------------------------------------
DB_URL="postgresql://rubbish:rubbish_dev@localhost:5432/rubbish"

# --- helpers ------------------------------------------------------------
log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

# --- parse args ---------------------------------------------------------
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file> [--db-url URL]"
  echo ""
  echo "  backup-file  Path to a pg_dump custom-format backup (produced by backup.sh)"
  echo "  --db-url URL Target PostgreSQL connection URL"
  exit 1
fi

BACKUP_FILE="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-url)
      DB_URL="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 <backup-file> [--db-url URL]"
      echo ""
      echo "  backup-file  Path to a pg_dump custom-format backup (produced by backup.sh)"
      echo "  --db-url URL Target PostgreSQL connection URL (default: postgresql://rubbish:rubbish_dev@localhost:5432/rubbish)"
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

# --- pre-flight checks --------------------------------------------------
command -v pg_restore >/dev/null 2>&1 || die "pg_restore not found — install PostgreSQL client tools"
command -v psql       >/dev/null 2>&1 || die "psql not found — install PostgreSQL client tools"

if [[ ! -f "$BACKUP_FILE" ]]; then
  die "Backup file not found: ${BACKUP_FILE}"
fi

# Validate it's a real pg_dump custom-format archive (no gzip step — the
# dump is already in custom format and is restored directly).
if ! pg_restore --list "$BACKUP_FILE" >/dev/null 2>&1; then
  die "File is not a valid pg_dump custom-format archive: ${BACKUP_FILE}"
fi

# --- restore ------------------------------------------------------------
log "Starting restore from ${BACKUP_FILE} → ${DB_URL}"

log "Dropping and recreating public schema…"
psql "$DB_URL" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" 2>&1 \
  || die "Failed to reset public schema"

log "Restoring database…"
pg_restore --dbname="$DB_URL" --clean --if-exists --no-owner --no-acl --single-transaction --format=custom --file="$BACKUP_FILE" 2>&1 \
  || die "pg_restore failed — restore may be incomplete"

log "Restore complete"
