# Changelog

All notable changes to ScholarLib will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Comprehensive SEO: Open Graph, Twitter Card, JSON-LD structured data
- Sitemap and RSS feed auto-discovery
- `docs/404.md` custom 404 page
- `docs/public/robots.txt` for crawlers
- `docs/public/og-image.svg` social preview
- `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- `.editorconfig`, `.prettierrc.json`, `.nvmrc` for consistent formatting
- GitHub Actions: link checker, Lighthouse CI, Dependabot
- Issue & PR templates
- "Edit this page on GitHub" link on every doc page
- Last-updated timestamp on every doc page
- Local search with fuzzy matching and prefix search
- Custom site title template (`:title — ScholarLib`)

### Changed
- **BREAKING**: VitePress config now in proper TypeScript (was JSON-mixed)
- `.gitignore` no longer excludes `*.pdf` (PDFs can now be tracked)
- `package.json` adds `homepage`, `repository`, `bugs` fields
- Sidebar auto-generated from filesystem via `build_sidebar.py`

### Fixed
- **Critical**: `base: '/ScholarLib/'` set in VitePress config (was missing, breaking all assets)
- All asset references now correctly prefixed with `/ScholarLib/`
- Mixed JSON/TypeScript syntax in `config.ts`

## [1.0.0] - 2026-06-02

### Added
- Initial unified ScholarLib repository
- Merged from `ScholarLib-CS` (33 CS topics) and `ScholarLib-EM` (18 EM fields, 2020–2026)
- VitePress documentation site
- GitHub Pages deployment via GitHub Actions
- README, LICENSE (MIT), CONTRIBUTING, CITATION.cff
- 2,726 files, ~412 MB of paper resources

[Unreleased]: https://github.com/badhope/ScholarLib/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/badhope/ScholarLib/releases/tag/v1.0.0
