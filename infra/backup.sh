#!/usr/bin/env bash
#
# Rubbish database backup script.
#
# Usage:
#   ./backup.sh [--db-url URL] [--output-dir PATH]
#
# Defaults:
#   --db-url      postgresql://rubbish:rubbish_dev@localhost:5432/rubbish
#   --output-dir  ./backups
#
# Behaviour:
#   - Runs pg_dump in custom format (already compressed); timestamps filename.
#   - Keeps the last 7 daily backups; removes older ones.
#   - Logs to stdout with [YYYY-MM-DD HH:MM:SS] timestamps.

set -euo pipefail

# --- defaults -----------------------------------------------------------
DB_URL="postgresql://rubbish:rubbish_dev@localhost:5432/rubbish"
OUTPUT_DIR="./backups"
RETENTION_DAYS=7

# --- helpers ------------------------------------------------------------
log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

# --- parse args ---------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-url)
      DB_URL="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--db-url URL] [--output-dir PATH]"
      echo ""
      echo "  --db-url URL      PostgreSQL connection URL (default: postgresql://rubbish:rubbish_dev@localhost:5432/rubbish)"
      echo "  --output-dir PATH Directory to store backups (default: ./backups)"
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

# --- pre-flight checks --------------------------------------------------
command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found — install PostgreSQL client tools"

mkdir -p "$OUTPUT_DIR"

# --- run backup ---------------------------------------------------------
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_FILE="${OUTPUT_DIR}/rubbish-${TIMESTAMP}.dump"

log "Starting backup → ${BACKUP_FILE}"

# pg_dump --format=custom already compresses; writing directly to the
# output file means `set -e` aborts on any failure (no pipe → no dead
# PIPESTATUS guard needed). The file is restored directly with pg_restore.
pg_dump --dbname="$DB_URL" --format=custom --no-owner --no-acl --file="$BACKUP_FILE" 2>&1 \
  || die "pg_dump failed — backup aborted"

SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
log "Backup complete — ${BACKUP_FILE} (${SIZE})"

# --- rotate old backups -------------------------------------------------
log "Rotating backups older than ${RETENTION_DAYS} days…"

DELETED=0
while IFS= read -r -d '' old; do
  log "Removing old backup: $(basename "$old")"
  rm -f "$old"
  DELETED=$((DELETED + 1))
done < <(find "$OUTPUT_DIR" -maxdepth 1 -name 'rubbish-*.dump' -mtime "+${RETENTION_DAYS}" -print0 2>/dev/null || true)

if [[ $DELETED -eq 0 ]]; then
  log "No old backups to rotate"
else
  log "Rotated ${DELETED} old backup(s)"
fi

log "Done"
