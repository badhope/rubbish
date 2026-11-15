<!--
  PR checklist — CI runs all of these gates, but resolving them here
  saves a round trip:

  Backend:  uv run ruff check . && uv run ruff format --check .
            uv run mypy app && uv run pytest -q
  Frontend: npm run lint && npm run typecheck && npm run test && npm run build
  Migrations: alembic check (model ↔ migration drift) — a new migration is
            required whenever Base.metadata changes; bare create_all() in
            tests cannot catch a missing revision.
  Security: bandit --severity-level low (zero-findings policy) + pip-audit.
  Version:  scripts/check-version.sh — bump VERSION, pyproject.toml,
            package.json and app/__init__.py together for releases.
-->

## Summary

<!-- What does this PR change and why? Link the issue: Fixes #123 -->

## Changes

- <!-- bullet points -->

## How was it tested?

<!-- e.g. "pytest -q (643 passed)", "npx playwright test (66 passed)", manual steps -->

## Checklist

- [ ] Tests added/updated and passing locally
- [ ] `alembic check` clean (schema changes ship with a migration)
- [ ] Docs updated (README / docs/ / CHANGELOG under [Unreleased])
- [ ] No secrets committed (gitleaks passes)
