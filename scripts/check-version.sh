#!/usr/bin/env bash
# Verify that the release version is declared identically in every place
# that carries one. A drift here means the FastAPI OpenAPI docs, the
# frontend build metadata and the git tag disagree with each other.
#
# Sources of truth (all must match VERSION at the repo root):
#   - VERSION
#   - apps/backend/pyproject.toml        (version = "x.y.z")
#   - apps/frontend/package.json         ("version": "x.y.z")
#   - apps/backend/app/__init__.py       (__version__ = "x.y.z")
#
# Usage: scripts/check-version.sh        (exits 1 on drift)
set -euo pipefail
cd "$(dirname "$0")/.."

expected="$(tr -d '[:space:]' < VERSION)"
fail=0

check() {
    local file="$1" label="$2" actual="$3"
    if [ "$actual" = "$expected" ]; then
        printf '  ✔ %-28s %s\n' "$label" "$actual"
    else
        printf '  ✘ %-28s %s (expected %s)\n' "$label" "$actual" "$expected"
        fail=1
    fi
}

pyproject="$(sed -n 's/^version = "\(.*\)"/\1/p' apps/backend/pyproject.toml | head -1)"
pkgjson="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' apps/frontend/package.json | head -1)"
dunder="$(sed -n 's/^__version__ = "\(.*\)"$/\1/p' apps/backend/app/__init__.py | head -1)"

printf 'Version consistency (expected %s):\n' "$expected"
check "VERSION" "repo root" "$expected"
check "apps/backend/pyproject.toml" "backend package" "$pyproject"
check "apps/frontend/package.json" "frontend package" "$pkgjson"
check "apps/backend/app/__init__.py" "API __version__" "$dunder"

if [ "$fail" -ne 0 ]; then
    printf 'Version drift detected — bump all four sources together.\n' >&2
    exit 1
fi
