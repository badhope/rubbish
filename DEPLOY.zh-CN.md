# 部署

**[English](DEPLOY.md) · 简体中文**

仓库自带一套单机 Compose 部署：PostgreSQL、带前端静态文件的 FastAPI 服务，以及负责 HTTPS 的 Caddy。小型社区用 1 核 2G 的 VPS 就够。

## 准备

- 已安装 Docker Engine 和 Compose v2 的 Linux 服务器
- 一个域名，DNS `A` 记录指向服务器
- 80 和 443 端口可从公网访问

## 第一次部署

```bash
git clone https://github.com/badhope/rubbish.git
cd rubbish
cp .env.example .env
```

至少填写：

| 变量 | 含义 |
|---|---|
| `SITE_DOMAIN` | 对外域名，例如 `community.example.com` |
| `POSTGRES_PASSWORD` | PostgreSQL 容器密码 |
| `RUBBISH_SECRET_KEY` | JWT 签名密钥，32 位随机字节 |
| `RUBBISH_FERNET_KEY` | 加密 TOTP 密钥用的 Fernet key |
| `RUBBISH_ADMIN_PASSWORD` | 初始管理员密码，至少 12 位 |

生成密钥：

```bash
python -c "import secrets; print(secrets.token_hex(32))"
python -c "import secrets; print(secrets.token_urlsafe(24))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

启动：

```bash
docker compose up -d --build
docker compose ps
curl -fsS "https://${SITE_DOMAIN}/api/health"
```

`app` 容器会等 PostgreSQL 就绪，执行 `alembic upgrade head`，然后启动服务。Caddy 在第一次请求时申请证书。

## 行级安全

Compose 在 PostgreSQL 第一次初始化时会创建非超级用户角色 `rubbish_app`。应用用这个角色连库，`FORCE ROW LEVEL SECURITY` 才会真正生效。

如果数据库卷是旧部署留下的，初始化不会重跑。设置 `RUBBISH_APP_DB_PASSWORD`，并确认 `RUBBISH_DB_APP_USER=rubbish_app`；日志里出现 `rls_bypassed_by_superuser` 时，先修好角色再对外开放。

## 更新

```bash
git pull --ff-only
docker compose up -d --build
docker compose logs -f app
```

迁移会自动执行。涉及表结构变更的版本，发布前先做数据库备份。

## 备份

至少备份两样东西：

```bash
docker compose exec -T db pg_dump -U rubbish rubbish > db.sql
docker run --rm -v rubbish_uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads.tar.gz -C /data .
```

放进任何共享位置之前都要加密。仓库里的快照使用 AES-256-CBC + PBKDF2，密钥只放在服务器和运维自己的密码库里，不进仓库。

## 日志与健康检查

```bash
docker compose logs -f app
docker compose logs -f caddy
curl -fsS "https://${SITE_DOMAIN}/api/health"
```

`/api/health` 返回版本和数据库状态；`/api/ready` 供编排系统做就绪探针。

## 邮件与单点登录

两者都是可选项，默认关闭。配置方式见 [docs/INTEGRATIONS.zh-CN.md](docs/INTEGRATIONS.zh-CN.md)。

## 不要做的事

- 不要把 `.env` 或备份密钥提交进仓库。
- 生产环境不要用 PostgreSQL 超级用户跑应用。
- 不要把 `/metrics` 直接暴露到公网。
- 不要把旧的期刊跳转规则加回 `Caddyfile`；现在的路由从 `/` 开始。
