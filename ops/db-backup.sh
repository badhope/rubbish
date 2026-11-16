#!/usr/bin/env bash
# 每日备份：PostgreSQL 逻辑 dump + uploads 卷打包，带保留策略与失败即报。
# 替代原先 /home/ubuntu/backup.sh（发版时被清掉导致 cron 静默失败）。
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups}"
LOG="${LOG:-/home/ubuntu/rubbish-backup.log}"
DB_CONTAINER="${DB_CONTAINER:-rubbish-db-1}"
DB_USER="${DB_USER:-rubbish_legacy}"
DB_NAME="${DB_NAME:-rubbish}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-rubbish_uploads}"
KEEP_DB="${KEEP_DB:-30}"   # 保留最近 30 份数据库 dump
KEEP_UP="${KEEP_UP:-10}"    # 保留最近 10 份 uploads 归档
TS="$(date +%Y-%m-%d_%H%M)"

note(){ printf '[%s] %s\n' "$(date -Is)" "$*" >> "$LOG"; }
mkdir -p "$BACKUP_DIR"

# 1) 数据库（不带 --clean：恢复目标是空库，带 clean 会在 DROP POLICY 处断掉）：先写临时文件、校验 gzip 完整性，通过后才改名落盘（避免半截文件被当成有效备份）
db_file="$BACKUP_DIR/db-$TS.sql.gz"
db_tmp="$BACKUP_DIR/.db-$TS.partial.gz"
rm -f "$db_tmp"
if docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner \
     | gzip -6 > "$db_tmp" && gzip -t "$db_tmp" 2>/dev/null; then
  size=$(du -h "$db_tmp" | cut -f1)
  mv "$db_tmp" "$db_file"
  note "db ok $(basename "$db_file") $size"
else
  rm -f "$db_tmp"
  note "FAIL db dump ($DB_CONTAINER/$DB_USER/$DB_NAME)"
  exit 1
fi

# 2) uploads：用宿主 uid 运行，归档文件属主不会被写成 root
up_file="$BACKUP_DIR/uploads-$TS.tar.gz"
up_tmp=".uploads-$TS.partial.tar.gz"
if docker run --rm \
     --user "$(id -u):$(id -g)" \
     -v "$UPLOADS_VOLUME":/data:ro \
     -v "$BACKUP_DIR":/backup \
     alpine tar czf "/backup/$up_tmp" -C /data . >>"$LOG" 2>&1; then
  size=$(du -h "$BACKUP_DIR/$up_tmp" | cut -f1)
  mv "$BACKUP_DIR/$up_tmp" "$up_file"
  note "uploads ok $(basename "$up_file") $size"
else
  rm -f "$BACKUP_DIR/$up_tmp"
  note "FAIL uploads archive ($UPLOADS_VOLUME)"
  exit 1
fi

# 3) 保留策略：只清本脚本命名规范的备份，别的文件一概不碰
ls -1t "$BACKUP_DIR"/db-2*.sql.gz 2>/dev/null | tail -n +$((KEEP_DB + 1)) | xargs -r rm -f
ls -1t "$BACKUP_DIR"/uploads-2*.tar.gz 2>/dev/null | tail -n +$((KEEP_UP + 1)) | xargs -r rm -f

note "done db=$(basename "$db_file") up=$(basename "$up_file") disk=$(df -P / | awk 'NR==2{print $5}')"
