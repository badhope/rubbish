## Working rules

* Dependency updates: search the whole repository for every occurrence of a dependency (build files, lockfiles, CI workflows, docs) before bumping. A partial bump — declaration updated but lockfile or a pinned action left behind — is the most common cause of "works locally, CI fails". Keep lockfiles in the same commit as the declaration. Move version-coupled toolchain upgrades together in one commit.
* Refactoring: pull latest main first, work on a fresh branch, keep commits atomic with messages that state the why, and always run the full check suite before pushing (for this repo: `cd apps/backend && uv run ruff check . && uv run mypy app && uv run pytest`, `cd apps/frontend && npm run lint && npm run typecheck && npm run build`, and the pre-commit hooks). A branch left behind main cannot be merged under the repository's branch protection.
* Merge conflicts: resolve conflicts in the working tree against the latest main; never force-push shared branches; never resolve a conflict by blindly taking either side — re-read both sides and keep both changes when they are both valid.
* Versioning: releases follow X.Y.Z starting at 0.0.0. Last digit = fixes, middle digit = feature work, first digit stays 0 until a stable release is declared. Bump the version in code, CHANGELOG.md and the tag in the same change.

# Contributing to This Project

Thank you for your interest in contributing! This document outlines the workflow and standards for all contributors.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Commit Conventions](#commit-conventions)
- [Code Standards](#code-standards)
- [Issue Guidelines](#issue-guidelines)

## Getting Started

1. Fork this repository.
2. Clone your fork locally.
3. Create a feature branch from `main` (see [Branch Naming](#branch-naming)).
4. Make your changes following the standards below.
5. Push and open a Pull Request.

## Development Workflow

**All changes — without exception — must go through a Pull Request.**

No direct commits to `main` are allowed. This applies to the maintainer, contributors, and automated bots alike.

### Branch Naming

Use descriptive branch names with the following prefixes:

| Type | Format | Example |
|------|--------|---------|
| Feature | `feat/<short-description>` | `feat/add-export-function` |
| Bug fix | `fix/<short-description>` | `fix/login-redirect-loop` |
| Docs | `docs/<short-description>` | `docs/update-api-reference` |
| Refactor | `refactor/<short-description>` | `refactor/simplify-auth-module` |
| Chore | `chore/<short-description>` | `chore/upgrade-dependencies` |

### Development Checklist

Before opening a PR, verify each item below:

- [ ] Code follows the project's style guide (linting passes)
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No secrets, API keys, or credentials committed
- [ ] No debug code, console logs, or commented-out blocks
- [ ] No AI-generated boilerplate without human review
- [ ] Commit messages follow the convention below
- [ ] Branch is up to date with `main`

## Pull Request Process

1. **Open an issue first** for any non-trivial change to discuss the approach.
2. Create a branch following the naming convention.
3. Make atomic, focused commits — one logical change per commit.
4. Keep PRs small and reviewable (ideally under 400 lines of diff).
5. Fill out the PR template completely.
6. Ensure all CI checks pass before requesting review.
7. A maintainer must approve and merge the PR.

### PR Size Guidelines

| Size | Lines Changed | Action |
|------|---------------|--------|
| Ideal | < 200 | Proceed |
| Acceptable | 200–400 | Consider splitting |
| Too large | > 400 | Must split into smaller PRs |

## Commit Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>
```

### Types

- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation only
- `refactor` — Code change that neither fixes a bug nor adds a feature
- `perf` — Performance improvement
- `test` — Adding or correcting tests
- `chore` — Build, CI, dependencies, tooling
- `ci` — CI/CD changes

### Rules

- Subject line: imperative mood, lowercase, no period, max 72 characters
- Body: explain *what* and *why*, not *how* — wrap at 72 characters
- One logical change per commit — no mixed concerns
- No AI-style bulk messages (e.g., "comprehensive audit fix", "P0/P1/P2 batch fix")
- No emoji in commit messages
- Reference issues: `Closes #123`, `Refs #456`

### Examples

```
feat(auth): add JWT refresh token rotation

Implements rotating refresh tokens with a 7-day sliding window.
Blacklists compromised tokens via Redis for immediate revocation.

Closes #42
```

```
fix(api): handle null response in user endpoint

The /users/:id endpoint returned 500 when the database row was
null. Adds explicit null check and returns 404 instead.
```

## Code Standards

- Run the linter before committing — backend: `cd apps/backend && uv run ruff check . && uv run mypy app && uv run pytest`; frontend: `cd apps/frontend && npm run lint && npm run typecheck && npm run build`
- Remove trailing whitespace and unused imports
- No `any` types in TypeScript without justification
- No `console.log` in production code — use a logger
- Functions should do one thing and be testable in isolation

## Issue Guidelines

### Before Opening an Issue

- Search existing issues to avoid duplicates
- Use the appropriate issue template (bug report or feature request)
- Provide a minimal reproduction case for bugs
- Include environment details (OS, runtime version, etc.)

### Issue Lifecycle

1. **Open** — Issue is created with a template
2. **Triaged** — Maintainer labels and assigns priority
3. **In Progress** — Someone is working on it
4. **Closed** — Fixed, duplicated, or wontfix

## Repository

## Questions?

Feel free to open an issue with the `question` label if anything is unclear.

## 发布流程（维护者）

每次对外更新按此清单执行，不跳步：

1. **定版本**：按语义化版本（SemVer）——修 Bug 升补丁位、新功能升次版本、破坏性改动升主版本
2. **同步文档**：改代码的同时更新 README（版本/截图，如界面有变）与依赖清单（requirements / package.json）
3. **本地验证**：跑通测试与构建（与 CI 同款命令），全绿才继续
4. **合并**：以 PR 方式合入 `main`，CI 全绿后合并
5. **打标签**：`git tag -a vX.Y.Z -m "vX.Y.Z"` 并推送（`git push origin vX.Y.Z`）
6. **发布**：基于该 tag 创建 GitHub Release，Release Notes 写清本次变更要点
7. **部署**：确认 GitHub Pages / 站点自动部署完成且可访问

变更记录以 GitHub Releases 与 git log 为准。
