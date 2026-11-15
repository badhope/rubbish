#!/usr/bin/env bash
# Start the full Rubbish dev stack on bare metal: PostgreSQL + API + SPA.
#
# Why this exists: the Compose path builds the backend from
# ``ghcr.io/astral-sh/uv``, which is unreachable on some networks. This
# script is the scripted version of the README's "Option 2 — Local bare
# metal" path, so the stack still comes up with one command.
#
# Usage (from anywhere):   ./scripts/dev.sh [--no-backend] [--no-frontend]
# Stop everything:         Ctrl-C   (or: ./scripts/dev.sh --stop)
#
# Logs live in .run/backend.log and .run/frontend.log.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
RUN_DIR="$ROOT/.run"

API_PORT="${RUBBISH_API_PORT:-8000}"
WEB_PORT="${RUBBISH_WEB_PORT:-5173}"

START_BACKEND=1
START_FRONTEND=1

for arg in "$@"; do
    case "$arg" in
        --no-backend)  START_BACKEND=0 ;;
        --no-frontend) START_FRONTEND=0 ;;
        --stop)
            if [ -d "$RUN_DIR" ]; then
                for pidfile in "$RUN_DIR"/*.pid; do
                    [ -f "$pidfile" ] || continue
                    pid="$(cat "$pidfile" 2>/dev/null || true)"
                    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
                        echo "stopping pid $pid"
                        kill "$pid" 2>/dev/null || true
                    fi
                    rm -f "$pidfile"
                done
            fi
            echo "stopped"
            exit 0
            ;;
        -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
        *) echo "unknown flag: $arg" >&2; exit 2 ;;
    esac
done

info() { printf '\033[36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m    %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m    %s\033[0m\n' "$1"; }
die()  { printf '\033[31merror: %s\033[0m\n' "$1" >&2; exit 1; }

mkdir -p "$RUN_DIR"

# --- 1. PostgreSQL -------------------------------------------------------
ensure_postgres() {
    if command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
        ok "PostgreSQL is already accepting connections"
        return
    fi
    if command -v pg_ctlcluster >/dev/null 2>&1; then
        local ver
        ver="$(ls /usr/lib/postgresql 2>/dev/null | sort -V | tail -1 || true)"
        [ -n "$ver" ] || die "no PostgreSQL cluster under /usr/lib/postgresql"
        info "starting PostgreSQL $ver"
        if [ "$(id -u)" -eq 0 ]; then
            pg_ctlcluster "$ver" main start || true
        else
            sudo pg_ctlcluster "$ver" main start || true
        fi
        for _ in $(seq 1 30); do
            pg_isready -q && { ok "PostgreSQL ready"; return; }
            sleep 1
        done
        die "PostgreSQL did not become ready (check: pg_ctlcluster $ver main start)"
    fi
    warn "pg_ctlcluster not found — assuming RUBBISH_DATABASE_URL points elsewhere"
}

# --- 2. .env bootstrap ---------------------------------------------------
# The app reads .env from its own working directory, so the backend needs a
# copy even though Compose reads the one at the repo root.
bootstrap_env() {
    local target="apps/backend/.env"
    [ -f "$target" ] && { ok "$target present"; return; }
    [ -f "$target.example" ] || die "missing $target.example"
    warn "creating $target from the template with freshly generated secrets"
    cp "$target.example" "$target"
    python3 - "$target" <<'PY'
import base64
import os
import secrets
import sys

path = sys.argv[1]
generated = {
    "RUBBISH_SECRET_KEY": secrets.token_hex(32),
    "RUBBISH_ADMIN_PASSWORD": "Sch0lar!" + secrets.token_urlsafe(12),
    "RUBBISH_FERNET_KEY": base64.urlsafe_b64encode(os.urandom(32)).decode(),
}
lines = []
for line in open(path, encoding="utf-8"):
    key = line.split("=", 1)[0].strip()
    if key in generated and not line.lstrip().startswith("#"):
        lines.append(f"{key}={generated[key]}\n")
    else:
        lines.append(line)
with open(path, "w", encoding="utf-8") as fh:
    fh.writelines(lines)
PY
    ok "generated SECRET_KEY / ADMIN_PASSWORD / FERNET_KEY"
}

# --- 3. Backend ----------------------------------------------------------
start_backend() {
    info "starting API on :$API_PORT"
    (
        cd apps/backend
        command -v uv >/dev/null 2>&1 || die "uv is required (https://docs.astral.sh/uv)"
        # If PyPI is unreachable you can `export UV_DEFAULT_INDEX=<mirror>`,
        # but that rewrites every package URL inside uv.lock. Restore the file
        # (`git checkout apps/backend/uv.lock`) before committing, otherwise
        # CI and other contributors get pinned to your mirror.
        [ -d .venv ] || uv sync
        uv run alembic upgrade head
        nohup uv run uvicorn app.main:app \
            --host 0.0.0.0 --port "$API_PORT" --reload \
            > "$RUN_DIR/backend.log" 2>&1 &
        echo $! > "$RUN_DIR/backend.pid"
    )
}

# --- 4. Frontend ---------------------------------------------------------
start_frontend() {
    info "starting SPA on :$WEB_PORT"
    (
        cd apps/frontend
        command -v npm >/dev/null 2>&1 || die "npm is required"
        [ -d node_modules ] || npm ci
        nohup npm run dev -- --host 0.0.0.0 --port "$WEB_PORT" \
            > "$RUN_DIR/frontend.log" 2>&1 &
        echo $! > "$RUN_DIR/frontend.pid"
    )
}

wait_for() {
    local name="$1" url="$2" tries="${3:-60}"
    for _ in $(seq 1 "$tries"); do
        if curl -fsS -o /dev/null "$url" 2>/dev/null; then
            ok "$name is up ($url)"
            return
        fi
        sleep 1
    done
    warn "$name did not respond in ${tries}s — see $RUN_DIR"
}

cleanup() {
    echo
    info "shutting down"
    for pidfile in "$RUN_DIR"/*.pid; do
        [ -f "$pidfile" ] || continue
        pid="$(cat "$pidfile" 2>/dev/null || true)"
        [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
        rm -f "$pidfile"
    done
    exit 0
}
trap cleanup INT TERM

ensure_postgres
bootstrap_env
[ "$START_BACKEND" -eq 1 ]  && start_backend
[ "$START_FRONTEND" -eq 1 ] && start_frontend

[ "$START_BACKEND" -eq 1 ]  && wait_for "API"  "http://127.0.0.1:$API_PORT/api/health" 90
[ "$START_FRONTEND" -eq 1 ] && wait_for "SPA"  "http://127.0.0.1:$WEB_PORT/" 90

cat <<EOF

$(printf '\033[32mRubbish dev stack is running\033[0m')
  API docs : http://localhost:$API_PORT/docs
  SPA      : http://localhost:$WEB_PORT
  logs     : $RUN_DIR/{backend,frontend}.log
  stop     : Ctrl-C   (or ./scripts/dev.sh --stop)
EOF

# Keep the script attached so Ctrl-C tears the children down.
wait
