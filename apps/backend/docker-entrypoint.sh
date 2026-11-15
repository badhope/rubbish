#!/bin/sh
# 生产镜像入口：先在 root 下修正命名卷属主，再降权运行应用。
# 只用 Debian 自带 gosu，不引入 sudo；容器内 PID 1 最终是 app 用户。
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/uploads /home/app
  chown -R app:app /data/uploads /home/app
  exec gosu app "$@"
fi

exec "$@"
