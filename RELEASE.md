# Release Process

This document describes how to cut a new release of ScholarLib.

## Semantic Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (v2.0.0): breaking changes — e.g., directory restructure, config schema change
- **MINOR** (v1.1.0): new features — e.g., new topic, new script, new locale
- **PATCH** (v1.0.1): bug fixes — e.g., typo, broken link, dependency update

## Pre-release Checklist

Before tagging a release, ensure:

- [ ] `make ci` passes locally
- [ ] All paper metadata is valid (`make validate`)
- [ ] CHANGELOG.md `[Unreleased]` section is filled in
- [ ] README badges and version references are up to date
- [ ] CITATION.cff `date-released` is updated
- [ ] GitHub Pages is showing the latest commit

## Release Steps

### 1. Move [Unreleased] to a new version section

Edit `CHANGELOG.md`. Move the bullet points from `## [Unreleased]` to a new
`## [VERSION] - YYYY-MM-DD` section. Add a comparison link at the bottom.

Example:

```markdown
## [Unreleased]

### Added

- (new stuff goes here)

## [1.1.0] - 2026-07-01

### Added

- Topic: Quantum Cryptography
- New script: generate_rss.py
- Spanish (es) translation

[Unreleased]: https://github.com/badhope/ScholarLib/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/badhope/ScholarLib/compare/v1.0.0...v1.1.0
```

### 2. Update CITATION.cff

Set `date-released` to today's date.

### 3. Commit and tag

```bash
git add CHANGELOG.md CITATION.cff
git commit -m "chore(release): v1.1.0"
git tag -a v1.1.0 -m "Release v1.1.0"
git push origin main
git push origin v1.1.0
```

### 4. GitHub Actions takes over

The `release.yml` workflow will:

1. Extract the `[VERSION]` section from CHANGELOG.md
2. Create a GitHub Release with those notes
3. Attach LICENSE as a downloadable asset

### 5. Verify

- [ ] Visit the [Releases page](https://github.com/badhope/ScholarLib/releases)
- [ ] Verify release notes look correct
- [ ] Check the deployment to GitHub Pages succeeded
- [ ] (Optional) Announce on social media

## Hotfix Process

For urgent fixes, use the `hotfix/` branch pattern:

```bash
git checkout -b hotfix/v1.0.1
# ... fix the bug ...
make ci
git commit -m "fix: resolve critical issue"
# Update CHANGELOG.md with hotfix entry
git commit -am "docs(changelog): add hotfix entry"
git tag -a v1.0.1 -m "Hotfix v1.0.1"
git push origin hotfix/v1.0.1
git push origin v1.0.1
# Open PR from hotfix/v1.0.1 to main
```

## Deprecation Policy

Features are marked deprecated one MINOR version before removal.
Removal happens in the next MAJOR version.

Example timeline:

| Version | Status                      |
| ------- | --------------------------- |
| v1.0.0  | Feature X introduced        |
| v1.1.0  | Feature X marked deprecated |
| v2.0.0  | Feature X removed           |

## Questions?

Open a [discussion](https://github.com/badhope/ScholarLib/discussions) or
[issue](https://github.com/badhope/ScholarLib/issues/new/choose).
