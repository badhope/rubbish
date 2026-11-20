# Contributing

**English · [简体中文](CONTRIBUTING.zh-CN.md)**

Thanks for helping. Keep changes small, explain the reason, and leave the repository easier to run than you found it.

## Workflow

1. Fork the repository and create a branch from `main`.
2. Make one focused change. Update code, tests, and docs in the same branch.
3. Run the checks below.
4. Open a pull request. Describe the problem, the change, and anything you could not verify.
5. A maintainer reviews; the branch is deleted after merge.

Use branch prefixes such as `feat/`, `fix/`, `docs/`, `refactor/`, and `chore/`. Do not force-push a shared branch.

## Checks

```bash
cd apps/backend
uv run ruff check .
uv run mypy app --exclude 'app/domain/submission' --exclude 'app/domain/ingest' \
  --exclude 'app/interfaces/http/submission' --exclude 'app/interfaces/http/review'
uv run pytest -q

cd ../frontend
npm run lint
npm run typecheck
npm run build
```

The excluded backend paths are retired editorial code kept for archive conversion and backups. They are not part of the running product.

## Commits

Use short, imperative messages:

```text
feat(forum): preselect the default board in the composer
fix(auth): keep the refresh cookie on the API host
docs(deploy): clarify the non-superuser database role
```

Version numbers are `MAJOR.MINOR.PATCH`. The last digit is for fixes; the middle digit is for user-visible features. Update `package.json`, `pyproject.toml`, `app/__init__.py`, `uv.lock`, and `CHANGELOG.md` together.

## Pull requests

A good PR:

- has a reproducible reason, not only a screenshot;
- adds a test for a bug fix or a new behavior;
- keeps unrelated formatting out of the diff;
- does not commit secrets, `.env` files, database dumps, or upload archives in plaintext;
- states which checks passed and which were skipped.

## Content and moderation changes

Changes to public copy, board names, or moderation rules should follow [docs/POSITIONING.md](docs/POSITIONING.md) and describe the community in its own terms.

## License

By contributing, you agree that your contribution is released under the repository's [PolyForm Noncommercial License 1.0.0](LICENSE).
