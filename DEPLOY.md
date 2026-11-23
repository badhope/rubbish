# Deployment

**English · [简体中文](DEPLOY.zh-CN.md)**

The repository ships a single-server Compose stack: PostgreSQL, the FastAPI app with the built frontend, and Caddy for TLS. A 1 vCPU / 2 GB VPS is enough for a small community.

## Current public server (systemd + Nginx)

The live host is not the Compose stack below. It runs:

| Piece | Path / unit |
|---|---|
| Application | `/opt/rubbish-app` |
| Virtualenv | `/opt/rubbish-app/.venv` |
| Built SPA | `/opt/rubbish-app/static` |
| Service | `rubbish-app.service` on `127.0.0.1:8080` |
| Environment | `/www/wwwroot/rubbish.argjiemi.cn/.env` |
| Nginx vhost | `/www/server/panel/vhost/nginx/rubbish.argjiemi.cn.conf` |
| Legacy redirects | `/www/server/panel/vhost/nginx/rubbish-legacy-redirects.inc`; repo copy in `infra/nginx-legacy-redirects.inc` |
| PostgreSQL | container `rubbish-db-1` |

Do not re-add redirects for `/review` or `/editor/*`: those are live workbench routes, and a 301 makes them unreachable from the public domain. Update `infra/nginx-legacy-redirects.inc` whenever the live include changes.

A frontend-only release replaces `/opt/rubbish-app/static` and does not need a restart. A backend release copies the changed `app/` files and restarts the service. Always keep the previous static directory and the previous file next to the new one.

```bash
# on the build machine
cd apps/frontend && npm run build
tar -C dist -czf /tmp/rubbish-static.tgz .

# on the server (deploy user has sudo -n)
stamp=$(date +%Y%m%d%H%M)
cp -a /opt/rubbish-app/static "/opt/rubbish-app/static-$stamp"
tar -xzf /tmp/rubbish-static.tgz -C /opt/rubbish-app/static
curl -fsS -H 'Host: rubbish.argjiemi.cn' http://127.0.0.1:8080/api/health
```

If the health check fails, restore `"/opt/rubbish-app/static-$stamp"` and re-check. For backend changes, take a copy of the file before replacing it, run `systemctl restart rubbish-app`, then check the health version. Nginx changes require `nginx -t` before `nginx -s reload`.

Do not use `ops/deploy.sh` on this host: it is the Docker static-hot-swap reference. The systemd procedure is the one that applies here.

## Requirements

- Linux with Docker Engine and Compose v2
- A domain whose DNS `A` record points at the server
- Ports 80 and 443 reachable

## Mainland access gate

The backend can put a password gate in front of visitors whose public IP is
inside the bundled mainland-China CIDR snapshot
(`apps/backend/app/data/mainland_cn_ip_ranges.txt`). It wraps every page, API
and static asset, so the site shell is never sent before the password is
verified.

Enable it in the live service environment:

```dotenv
RUBBISH_MAINLAND_GATE_ENABLED=true
RUBBISH_MAINLAND_GATE_PASSWORD=<at least 12 characters>
RUBBISH_MAINLAND_GATE_COOKIE_DAYS=7
# Nginx / Caddy is one hop in front of the app.
RUBBISH_TRUSTED_PROXIES_COUNT=1
```

The live Nginx vhost must pass the client address:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

After a restart, check `/api/health` and `/gate`. A correct password sets the
`rubbish_mainland_gate` HttpOnly cookie; a wrong password is rate-limited.
The CIDR list is a snapshot, not a legal boundary. Refresh it periodically
from the public CN zone at `https://www.ipdeny.com/ipblocks/data/countries/cn.zone`
and `https://www.ipdeny.com/ipv6/ipaddresses/blocks/cn.zone`. Do not treat IP
geolocation as a substitute for local compliance advice.

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
