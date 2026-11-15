#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml (bash version).
#
# Why: catch workflow-step ordering mistakes without opening a PR.
# Run from repo root:  ./scripts/ci_local.sh [--skip-frontend] [--skip-mypy]
#
# The workflow file is the source of truth; mirror updates here.

set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_FRONTEND=0
SKIP_MYPY=0
for arg in "$@"; do
    case "$arg" in
        --skip-frontend) SKIP_FRONTEND=1 ;;
        --skip-mypy)     SKIP_MYPY=1 ;;
        *) echo "unknown flag: $arg"; exit 2 ;;
    esac
done

run() {
    local name="$1"; shift
    echo
    echo -e "\033[36m==> $name\033[0m"
    "$@"
}

# Backend
cd apps/backend
run "uv sync (--frozen --all-extras --dev)" uv sync --frozen --all-extras --dev
run "ruff (lint)"   uv run ruff check .
run "ruff format --check" uv run ruff format --check .
if [ "$SKIP_MYPY" -eq 0 ]; then
    run "mypy (typecheck)" uv run mypy app
fi
run "pytest" env RUBBISH_ENVIRONMENT=test \
                 RUBBISH_SECRET_KEY=ci-test-secret-key-must-be-at-least-32-chars-long \
                 RUBBISH_ADMIN_PASSWORD=ci-test-admin-pass-at-least-12-chars \
                 uv run pytest --maxfail=1 --tb=short -q
run "pip-audit" uv run pip-audit
cd ../..

# Frontend (opt-out)
if [ "$SKIP_FRONTEND" -eq 0 ] && [ -d apps/frontend ]; then
    cd apps/frontend
    run "npm ci"  npm ci
    run "eslint"  npm run lint
    run "typecheck" npm run typecheck
    run "vitest"  npm test
    run "build"   npm run build
    cd ../..
elif [ "$SKIP_FRONTEND" -eq 0 ]; then
    echo "apps/frontend not present; skipping"
fi

echo
echo -e "\033[32mAll CI-equivalent steps passed.\033[0m"
