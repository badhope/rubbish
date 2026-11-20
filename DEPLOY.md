# Deployment

**English · [简体中文](DEPLOY.zh-CN.md)**

The repository ships a single-server Compose stack: PostgreSQL, the FastAPI app with the built frontend, and Caddy for TLS. A 1 vCPU / 2 GB VPS is enough for a small community.

## Requirements

- Linux with Docker Engine and Compose v2
- A domain whose DNS `A` record points at the server
- Ports 80 and 443 reachable

## First deployment

```bash
git clone https://github.com/badhope/rubbish.git
cd rubbish
cp .env.example .env
```

Fill in at least:

| Variable | What it is |
|---|---|
| `SITE_DOMAIN` | Public hostname, for example `community.example.com` |
| `POSTGRES_PASSWORD` | Password for the PostgreSQL container |
| `RUBBISH_SECRET_KEY` | JWT signing key, 32 random bytes |
| `RUBBISH_FERNET_KEY` | Fernet key used to encrypt TOTP secrets |
| `RUBBISH_ADMIN_PASSWORD` | Bootstrap administrator password, at least 12 characters |

Generate the secrets:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
python -c "import secrets; print(secrets.token_urlsafe(24))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Start the stack:

```bash
docker compose up -d --build
docker compose ps
curl -fsS "https://${SITE_DOMAIN}/api/health"
```

The `app` container waits for PostgreSQL, runs `alembic upgrade head`, then starts the server. Caddy obtains a certificate on the first request.

## Row-level security

The Compose stack creates a non-superuser database role, `rubbish_app`, during the first PostgreSQL initialization. The app connects with that role, so `FORCE ROW LEVEL SECURITY` actually applies.

If the database volume already exists from an older deployment, initialization does not run again. Set `RUBBISH_APP_DB_PASSWORD` and `RUBBISH_DB_APP_USER=rubbish_app` is the intended state; if the log warns `rls_bypassed_by_superuser`, fix the role before exposing the site.

## Updating

```bash
git pull --ff-only
docker compose up -d --build
docker compose logs -f app
```

Migrations run automatically. Take a database backup before a release that changes the schema.

## Backup

At minimum, back up two things:

```bash
docker compose exec -T db pg_dump -U rubbish rubbish > db.sql
docker run --rm -v rubbish_uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads.tar.gz -C /data .
```

Encrypt both before storing them anywhere shared. The repository snapshot uses AES-256-CBC with PBKDF2; the key is kept outside the repository, on the server and in the operator's local password store.

## Logs and health

```bash
docker compose logs -f app
docker compose logs -f caddy
curl -fsS "https://${SITE_DOMAIN}/api/health"
```

`/api/health` returns the app version and database status. `/api/ready` is the readiness probe used by orchestration.

## Email and SSO

Both are optional and off by default. See [docs/integrations.md](docs/integrations.md) for SMTP and OIDC.

## What not to do

- Do not commit `.env` or the backup encryption key.
- Do not run the app as the PostgreSQL superuser in production.
- Do not expose `/metrics` without a private network or authentication.
- Do not copy old journal redirects back into `Caddyfile`; the current route set starts at `/`.
