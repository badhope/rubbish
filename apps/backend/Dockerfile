# Rubbish 后端单容器镜像（含前端静态托管，单端口）。
# 构建上下文必须是仓库根目录：
#   docker build -f apps/backend/Dockerfile -t rubbish .
FROM python:3.12-slim AS frontend-build

# --- 前端构建层 ---
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY apps/frontend/package.json apps/frontend/package-lock.json ./
RUN npm ci --registry=https://registry.npmjs.org
COPY apps/frontend/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS backend

WORKDIR /app
# 先拷依赖清单利用层缓存
COPY apps/backend/pyproject.toml apps/backend/uv.lock ./
RUN uv sync --frozen --no-dev

# 非 root 运行：与国内版一致，由 compose app-init 修正命名卷属主。
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu fonts-noto-cjk fonts-wqy-zenhei poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --create-home --home-dir /home/app app

COPY apps/backend/app ./app
COPY apps/backend/alembic ./alembic
COPY apps/backend/alembic.ini ./
COPY apps/backend/deploy_server.py ./
COPY apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R app:app /app /home/app
COPY --from=frontend-build /build/dist ./static

ENV RUBBISH_STATIC_DIR=/app/static \
    RUBBISH_STORAGE_PATH=/data/uploads \
    HOME=/home/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080
VOLUME ["/data/uploads"]
EXPOSE 8080

# 生产必须显式注入：RUBBISH_DATABASE_URL / SECRET_KEY / FERNET_KEY /
# ADMIN_PASSWORD / ALLOWED_HOSTS（见 DEPLOY.md）。
# 启动前自动 alembic upgrade head：RLS 策略只存在于迁移里，create_all
# 不会生成；PaaS（Render 等）没有交互 shell，必须在镜像内自动完成。
USER app
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "uv run --no-sync alembic upgrade head && uv run --no-sync python deploy_server.py"]
