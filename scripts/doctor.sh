#!/usr/bin/env bash
# Environment self-check for Rubbish development.
#
# Answers "why won't this start?" before you spend time on stack traces:
# toolchain versions, PostgreSQL reachability, .env presence, port conflicts,
# and whether dependencies have been installed at all.
#
# Usage:  ./scripts/doctor.sh
# Exit code 0 = everything looks runnable, 1 = at least one blocker.

set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

API_PORT="${RUBBISH_API_PORT:-8000}"
WEB_PORT="${RUBBISH_WEB_PORT:-5173}"

PASS=0
WARN=0
FAIL=0

ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; WARN=$((WARN + 1)); }
bad()  { printf '  \033[31m✘\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
head_() { printf '\n\033[36m%s\033[0m\n' "$1"; }

version_ge() {
    # version_ge "$have" "$want" — compares dotted numeric prefixes
    [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]
}

port_in_use() {
    (command -v ss >/dev/null && ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN) ||
    (command -v lsof >/dev/null && lsof -ti tcp:"$1" >/dev/null 2>&1)
}

head_ "Toolchain"
# Prefer the interpreter the project actually runs on (uv-managed venv); the
# system python3 may be older while uv provisions 3.12 on its own.
if [ -x apps/backend/.venv/bin/python ]; then
    pv="$(apps/backend/.venv/bin/python -V 2>&1 | awk '{print $2}')"
    if version_ge "$pv" "3.12"; then ok "backend venv python $pv (>= 3.12)";
    else bad "backend venv python $pv — 3.12+ required"; fi
elif command -v python3 >/dev/null 2>&1; then
    pv="$(python3 -V 2>&1 | awk '{print $2}')"
    if version_ge "$pv" "3.12"; then ok "python3 $pv (>= 3.12)";
    else warn "system python3 $pv — 3.12 required; uv will provision it"; fi
else bad "no python interpreter found"; fi

if command -v uv >/dev/null 2>&1; then ok "uv $(uv --version 2>&1 | awk '{print $2}')";
else bad "uv not found — https://docs.astral.sh/uv"; fi

if command -v node >/dev/null 2>&1; then
    nv="$(node -v | tr -d 'v')"
    if version_ge "$nv" "20.0.0"; then ok "node $nv (>= 20)";
    else bad "node $nv — 20+ required"; fi
else bad "node not found"; fi

if command -v npm >/dev/null 2>&1; then ok "npm $(npm -v)"; else bad "npm not found"; fi

head_ "Database"
if command -v pg_isready >/dev/null 2>&1; then
    if pg_isready -q 2>/dev/null; then
        ok "PostgreSQL accepting connections"
        if command -v psql >/dev/null 2>&1; then
            v="$(psql -tAc 'SHOW server_version;' 2>/dev/null || echo unknown)"
            [ "$v" != "unknown" ] && ok "server version $v"
        fi
    else
        warn "PostgreSQL installed but not running — try: sudo pg_ctlcluster <ver> main start"
    fi
else
    warn "PostgreSQL client tools not found — relying on RUBBISH_DATABASE_URL"
fi

head_ "Configuration"
if [ -f apps/backend/.env ]; then
    ok "apps/backend/.env present (read from the backend working directory)"
    if grep -qE '^RUBBISH_SECRET_KEY=change-me' apps/backend/.env 2>/dev/null; then
        bad "RUBBISH_SECRET_KEY is still the placeholder — generate one: openssl rand -hex 32"
    fi
    if grep -qE '^RUBBISH_ADMIN_PASSWORD=change-me' apps/backend/.env 2>/dev/null; then
        bad "RUBBISH_ADMIN_PASSWORD is still the placeholder"
    fi
else
    warn "apps/backend/.env missing — ./scripts/dev.sh will create it"
fi
[ -f .env ] && ok "repo-root .env present (used by docker compose)" || warn "repo-root .env missing (needed by docker compose)"

head_ "Dependencies"
[ -d apps/backend/.venv ] && ok "backend venv installed" || warn "backend deps missing — run: cd apps/backend && uv sync"
[ -d apps/frontend/node_modules ] && ok "frontend node_modules installed" || warn "frontend deps missing — run: cd apps/frontend && npm ci"

head_ "Ports"
if port_in_use "$API_PORT"; then
    ok "port $API_PORT in use (API appears to be running)"
    curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null \
        && ok "GET /api/health responded" \
        || warn "port $API_PORT busy but /api/health did not answer"
else
    warn "port $API_PORT free — API not running"
fi
if port_in_use "$WEB_PORT"; then
    ok "port $WEB_PORT in use (SPA appears to be running)"
else
    warn "port $WEB_PORT free — SPA not running"
fi

head_ "Migrations"
if [ -d apps/backend/.venv ]; then
    heads="$(cd apps/backend && .venv/bin/alembic heads 2>/dev/null | grep -c '(head)' || echo 0)"
    if [ "${heads:-0}" -eq 1 ]; then ok "single alembic head — 'alembic upgrade head' works"
    elif [ "${heads:-0}" -gt 1 ]; then bad "$heads alembic heads — 'upgrade head' will fail; create a merge revision"
    else warn "could not determine alembic heads"; fi
    # Model/migration drift: catches columns/tables/indexes that exist in
    # one but not the other (the unit tests build from metadata on SQLite
    # and cannot see this class of bug). Needs a reachable database.
    if (cd apps/backend && .venv/bin/alembic check >/dev/null 2>&1); then
        ok "alembic check — model metadata matches migrated schema"
    else
        warn "alembic check failed or DB unreachable — run 'alembic check' to inspect drift"
    fi
else
    warn "skipped (backend deps not installed)"
fi

printf '\n\033[36mSummary\033[0m  pass=%s warn=%s fail=%s\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -eq 0 ]; then
    printf '\033[32mNo blockers found.\033[0m\n'
    exit 0
fi
printf '\033[31m%d blocker(s) must be fixed before the stack will start.\033[0m\n' "$FAIL"
exit 1
