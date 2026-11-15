#!/usr/bin/env pwsh
# Local mirror of .github/workflows/ci.yml.
#
# Why: GHA YAML syntax errors / job-step mistakes are only caught
# when a PR is opened. This script lets you catch the same issues in
# a handful of seconds on your laptop before pushing. It runs the
# same backend lint + typecheck + pytest steps in the same order as
# the workflow file.
#
# Usage (from repo root):
#   pwsh scripts/ci_local.ps1                       # backend only
#   pwsh scripts/ci_local.ps1 -SkipFrontend         # skip frontend
#   pwsh scripts/ci_local.ps1 -SkipMypy             # skip mypy
#
# The CI workflow file is the source of truth for ordering; when the
# workflow changes, mirror the change here.

[CmdletBinding()]
param(
    [switch] $SkipFrontend,
    [switch] $SkipMypy
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Step([string] $name, [scriptblock] $action) {
    Write-Host ""
    Write-Host "==> $name" -ForegroundColor Cyan
    & $action
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    failed (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

# -----------------------------------------------------------
# 1. Backend: Python env + lint + typecheck + tests.
# -----------------------------------------------------------

$backendDir = Join-Path $repoRoot 'apps/backend'
Step 'uv sync (--frozen --all-extras --dev)' {
    Set-Location $backendDir
    uv sync --frozen --all-extras --dev
}

Step 'ruff (lint)' {
    Set-Location $backendDir
    uv run ruff check .
}

Step 'ruff format --check' {
    Set-Location $backendDir
    uv run ruff format --check .
}

if (-not $SkipMypy) {
    Step 'mypy (typecheck)' {
        Set-Location $backendDir
        uv run mypy app
    }
}

Step 'pytest' {
    Set-Location $backendDir
    $env:RUBBISH_ENVIRONMENT = 'test'
    $env:RUBBISH_SECRET_KEY = 'ci-test-secret-key-must-be-at-least-32-chars-long'
    $env:RUBBISH_ADMIN_PASSWORD = 'ci-test-admin-pass-at-least-12-chars'
    uv run pytest --maxfail=1 --tb=short -q
}

Step 'pip-audit (dependency vuln scan)' {
    Set-Location $backendDir
    # Use the project's lock file; the in-line `uv pip freeze`
    # output occasionally confuses pip-audit's parser on Windows.
    if (Test-Path 'uv.lock') {
        uv run pip-audit 2>&1 | Out-Null
    } else {
        Write-Host "    uv.lock not found; skipping" -ForegroundColor Yellow
    }
}

# -----------------------------------------------------------
# 2. Frontend (optional).
# -----------------------------------------------------------

if (-not $SkipFrontend) {
    $frontendDir = Join-Path $repoRoot 'apps/frontend'
    if (Test-Path $frontendDir) {
        Push-Location $frontendDir
        try {
            Step 'npm ci' {
                npm ci
            }
            Step 'eslint' {
                npm run lint --silent
            }
            Step 'typecheck' {
                npm run typecheck --silent
            }
            Step 'vitest' {
                npm test --silent
            }
            Step 'production build' {
                npm run build --silent
            }
        }
        finally {
            Pop-Location
        }
    }
    else {
        Write-Host "apps/frontend not present; skipping frontend steps" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "All CI-equivalent steps passed." -ForegroundColor Green
