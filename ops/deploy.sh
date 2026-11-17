#!/usr/bin/env bash
# 一条命令发布：构建 → 备份容器内旧静态 → 替换 → 重启 → 健康检查 → 预热。
set -euo pipefail
HOST="${HOST:-rubbish}"
REPO="${REPO:-/home/ubuntu/rubbish}"
cd "$(dirname "$0")/../apps/frontend"
npm run build
tar czf /tmp/rubbish-dist.tgz -C dist .
scp -q /tmp/rubbish-dist.tgz "$HOST:/home/ubuntu/rubbish-dist.tgz"
ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
REPO="${REPO:-/home/ubuntu/rubbish}"
stamp=$(date +%Y%m%d-%H%M%S)
rm -rf /home/ubuntu/rubbish-newstatic && mkdir -p /home/ubuntu/rubbish-newstatic
tar xzf /home/ubuntu/rubbish-dist.tgz -C /home/ubuntu/rubbish-newstatic
# 整目录替换而不是覆盖：旧构建的 hash 资源不再残留，容器内只保留本次 dist。
# 容器的 app 用户没有 DAC override，直接 docker exec 改 /app/static 会 Permission denied；
# 用宿主机 nsenter 进入同一 mount namespace 做原子目录切换，保留回滚目录。
PID=$(docker inspect -f '{{.State.Pid}}' rubbish-app-1)
sudo -n nsenter -t "$PID" -m -p -- sh -c 'rm -rf /app/static.new /app/static.old'
docker cp rubbish-app-1:/app/static "/home/ubuntu/static-rollback-$stamp"
docker cp /home/ubuntu/rubbish-newstatic/. rubbish-app-1:/app/static.new/
sudo -n nsenter -t "$PID" -m -p -- sh -c 'mv /app/static /app/static.old && mv /app/static.new /app/static'
docker restart rubbish-app-1 >/dev/null
sleep 8
PID=$(docker inspect -f '{{.State.Pid}}' rubbish-app-1)
if ! bash "$REPO/ops/site-health.sh"; then
  echo "health failed, rolling back"
  sudo -n nsenter -t "$PID" -m -p -- sh -c 'rm -rf /app/static && mv /app/static.old /app/static'
  docker restart rubbish-app-1 >/dev/null
  PID=$(docker inspect -f '{{.State.Pid}}' rubbish-app-1)
  exit 1
fi
bash "$REPO/ops/site-refresh.sh"
# 只保留最近 3 份回滚备份，旧目录不再无限堆积
sudo -n nsenter -t "$PID" -m -p -- rm -rf /app/static.old
ls -1dt /home/ubuntu/static-rollback-* 2>/dev/null | tail -n +4 | xargs -r rm -rf
echo "deployed $stamp"
REMOTE
