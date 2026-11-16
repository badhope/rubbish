#!/usr/bin/env bash
# P1 #14 — 清理服务器独有的 scholarhub-* 遗留 cron 与日志。
#
# 背景：品牌已从仓库应用代码与 git 历史中 purge（除本脚本与 ops/README.md 外
# grep 无 scholarhub 残留），但生产机 /etc/cron.d 下仍留有旧品牌名的定时任务与
# 日志。这些是**服务器独有**遗留，仓库里没有对应文件，因此本脚本只在服务器上
# 一次性运行，不进 cron。
#
# 安全：默认 dry-run，只打印将执行的动作，绝不改动系统。确认无误后加 --confirm
# 才真正删除/归档。幂等：目标不存在时跳过。删除前先把 cron 文件与日志归档到
# $ARCHIVE_DIR（带时间戳），便于回滚。
#
# 用法：
#   ops/remove-legacy-cron.sh            # dry-run（默认）
#   ops/remove-legacy-cron.sh --confirm  # 真正执行
set -euo pipefail

CONFIRM=0
[[ "${1:-}" == "--confirm" ]] && CONFIRM=1

STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE_DIR="${ARCHIVE_DIR:-/home/ubuntu/legacy-cron-archive-$STAMP}"
CRON_DIR=/etc/cron.d
LOG_DIR="${LOG_DIR:-/home/ubuntu}"

# 已知遗留 cron 名 + 通配兜底（任何 scholarhub-* 都视为遗留）。
KNOWN_CRON=(scholarhub-backup scholarhub-watchdog)

say() { printf '%s\n' "$*"; }
run() {
  # dry-run 只打印；--confirm 才执行。
  if [[ "$CONFIRM" == "1" ]]; then
    say "RUN: $*"
    "$@"
  else
    say "DRY-RUN: $*"
  fi
}

# 收集目标 cron 文件：已知名 + 现存 scholarhub-* 通配。
declare -A CRON_TARGETS=()
for name in "${KNOWN_CRON[@]}"; do
  CRON_TARGETS["$CRON_DIR/$name"]=1
done
for f in "$CRON_DIR"/scholarhub-*; do
  [[ -e "$f" ]] && CRON_TARGETS["$f"]=1
done

# 收集 scholarhub-*.log。
LOG_TARGETS=()
for f in "$LOG_DIR"/scholarhub-*.log; do
  [[ -e "$f" ]] && LOG_TARGETS+=("$f")
done

if [[ ${#CRON_TARGETS[@]} -eq 0 && ${#LOG_TARGETS[@]} -eq 0 ]]; then
  say "nothing to clean: no scholarhub-* cron in $CRON_DIR, no scholarhub-*.log in $LOG_DIR"
  exit 0
fi

say "=== legacy scholarhub cleanup (CONFIRM=$CONFIRM) ==="
say "archive dir: $ARCHIVE_DIR"

if [[ ${#CRON_TARGETS[@]} -gt 0 ]]; then
  run mkdir -p "$ARCHIVE_DIR/cron"
  for f in "${!CRON_TARGETS[@]}"; do
    if [[ -e "$f" ]]; then
      run cp -a "$f" "$ARCHIVE_DIR/cron/"
      run rm -f "$f"
    else
      say "skip (absent): $f"
    fi
  done
fi

if [[ ${#LOG_TARGETS[@]} -gt 0 ]]; then
  run mkdir -p "$ARCHIVE_DIR/logs"
  for f in "${LOG_TARGETS[@]}"; do
    # 归档而非直接删除：日志可能含运维线索。
    run mv "$f" "$ARCHIVE_DIR/logs/"
  done
fi

if [[ "$CONFIRM" == "1" ]]; then
  say "done. archived to $ARCHIVE_DIR; cron files removed, logs moved."
  say "reload cron if your distro caches it: sudo systemctl reload cron || true"
else
  say "dry-run complete. re-run with --confirm to apply."
fi