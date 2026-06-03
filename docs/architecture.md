---
title: Architecture
aside: false
---

# Architecture

A technical overview of how ScholarLib is built, structured, and operated.

## High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      GitHub Repository                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │  papers/     │  │  docs/       │  │  templates/        │   │
│  │  (sources)   │  │  (VitePress) │  │  (paper template)  │   │
│  └──────┬───────┘  └──────┬───────┘  └────────────────────┘   │
│         │                 │                                     │
│  ┌──────▼─────────────────▼─────────────────────────────────┐  │
│  │           Build Pipeline (Python + VitePress)            │  │
│  │  build_sidebar.py │ validate_papers.py │ postbuild_a11y │  │
│  │  generate_rss.py  │ generate_citation_graph.py          │  │
│  │  generate_summaries.py (Claude API)                      │  │
│  │  recover_pdfs.py (arXiv, Sci-Hub, direct URL)            │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                             │                                   │
│                  ┌──────────▼──────────┐                        │
│                  │  docs/.vitepress/   │                        │
│                  │      dist/          │                        │
│                  │  (static HTML/CSS)  │                        │
│                  └──────────┬──────────┘                        │
└─────────────────────────────┼────────────────────────────────────┘
                              │ Upload artifact
                              ▼
                  ┌──────────────────────────┐
                  │  GitHub Actions          │
                  │  deploy-docs.yml         │
                  │  (OIDC + pages)          │
                  └────────────┬─────────────┘
                               │
                               ▼
                  ┌──────────────────────────┐
                  │  GitHub Pages (CDN)      │
                  │  badhope.github.io/      │
                  │  ScholarLib/             │
                  └──────────────────────────┘
```

## Stack

| Layer         | Tool                                                                    | Why                                       |
| ------------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| Content       | Markdown + YAML front-matter                                            | Portable, plain-text, git-friendly        |
| Static site   | [VitePress 1.6](https://vitepress.dev/)                                 | Fast, Vue-powered, great DX               |
| Type safety   | [TypeScript](https://www.typescriptlang.org/)                           | Catch config errors before build          |
| Search        | [MiniSearch](https://lucaong.github.io/minisearch/) via VitePress local | No server, instant results                |
| PWA           | Native service worker + Web App Manifest                                | Offline-first, installable                |
| Linting       | Prettier + ESLint conventions                                           | Consistent style                          |
| CI/CD         | GitHub Actions                                                          | Free for public repos, native integration |
| Deployment    | GitHub Pages + OIDC                                                     | Zero-config, global CDN                   |
| Testing       | Python `unittest`                                                       | Standard library, no extra deps           |
| Monitoring    | Lighthouse CI + Lychee                                                  | Performance + link health                 |
| AI (optional) | Claude API (claude-sonnet-4)                                            | Paper summarization                       |

## Repository Structure

```
ScholarLib/
├── docs/                              # VitePress source
│   ├── .vitepress/
│   │   ├── config.ts                  # Site config (i18n, sidebar, SEO)
│   │   ├── theme/
│   │   │   ├── index.ts               # Theme extension
│   │   │   ├── Layout.vue             # Custom layout (a11y, PWA)
│   │   │   └── custom.css             # CSS overrides
│   │   └── dist/                      # Build output (gitignored)
│   ├── papers/                        # English paper index pages
│   │   ├── computer-science/          # 33 topics
│   │   └── economics-management/      # 18 fields
│   ├── zh/                            # Chinese (zh-CN) translations
│   │   ├── index.md
│   │   ├── about.md
│   │   └── papers/
│   ├── public/                        # Static assets
│   │   ├── data/
│   │   │   └── citation-graph.json
│   │   ├── manifest.webmanifest
│   │   ├── sw.js
│   │   ├── offline.html
│   │   ├── og-image.svg
│   │   ├── robots.txt
│   │   └── rss.xml                    # Auto-generated
│   ├── 404.md
│   ├── about.md
│   ├── index.md
│   ├── citation-graph.md              # Visualization page
│   └── architecture.md                # This file
│
├── papers/                            # Source paper resources
│   ├── computer-science/
│   │   └── <Topic>/
│   │       └── <Year>/
│   │           └── <paper-kebab-name>/
│   │               ├── paper.pdf      # (via Git LFS)
│   │               ├── <name>.bib
│   │               ├── metadata.json
│   │               └── summary-v1.md  # (optional, AI-generated)
│   └── economics-management/
│       └── <Year>/
│           └── <Field>/
│               └── <Topic>/
│                   └── <JournalTier>/
│                       └── <Method>/
│                           └── <Scenario>/
│                               └── <paper-kebab-name>/
│
├── templates/
│   └── paper-template/                # Copy for new submissions
│
├── scripts/                           # Python build/utility scripts
│   ├── validate_papers.py             # CI: paper schema check
│   ├── generate_index.py              # Build: consolidated .bib
│   ├── generate_citation_graph.py     # Build: citation graph data + page
│   ├── generate_summaries.py          # Optional: AI summaries
│   ├── generate_rss.py                # Build: RSS feed
│   ├── generate_favicons.py           # Build: PNG/ICO from SVG
│   ├── recover_pdfs.py                # Optional: download missing PDFs
│   └── __init__.py
│
├── tests/                             # Python unit tests
│   ├── test_build_sidebar.py
│   ├── test_generate_index.py
│   ├── test_generate_citation_graph.py
│   ├── test_recover_pdfs.py
│   └── test_postbuild_a11y.py
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                     # PR + push checks
│   │   ├── deploy-docs.yml            # GitHub Pages deploy
│   │   ├── lighthouse.yml             # Performance audits
│   │   ├── link-checker.yml           # Weekly + on-PR link check
│   │   └── release.yml                # Tag-driven release
│   ├── ISSUE_TEMPLATE/
│   ├── pull_request_template.md
│   ├── dependabot.yml
│   └── FUNDING.yml
│
├── .gitattributes                     # Git LFS tracking
├── .editorconfig
├── .gitignore
├── .lighthouserc.json                 # Lighthouse CI config
├── .nvmrc                             # Pinned Node version
├── .prettierrc.json
├── .scholarlib.yaml                   # EM taxonomy config
│
├── build_sidebar.py                   # Regenerate sidebar
├── postbuild_a11y.py                  # Post-build a11y fixes
│
├── tsconfig.json                      # TypeScript config
├── package.json
├── package-lock.json
├── Makefile                           # Unified dev commands
│
├── README.md                          # Project overview
├── CHANGELOG.md                       # Version history
├── CONTRIBUTING.md                    # Contribution guide
├── CODE_OF_CONDUCT.md                 # Community standards
├── SECURITY.md                        # Vulnerability disclosure
├── RELEASE.md                         # Release process
├── LICENSE                            # MIT
└── CITATION.cff                       # Citation metadata
```

## Build Pipeline

The full pipeline runs on every push to `main`:

```
1. Checkout           (actions/checkout)
2. Install Node       (Node 20 via .nvmrc)
3. npm ci             (locked dependencies)
4. python3 -c "..."   (validate paper metadata)
5. npm run docs:build
   ├── vitepress build docs
   │   ├── Reads docs/**/*.md
   │   ├── Generates static HTML
   │   ├── Bundles JS/CSS
   │   ├── Generates sitemap.xml
   │   └── Outputs to docs/.vitepress/dist
   └── python3 postbuild_a11y.py
       ├── Parses all dist/*.html
       ├── Transforms <div id="VPContent"> → <main>
       ├── Adds aria-labels
       └── Re-writes 56-62 files
6. Upload artifact    (actions/upload-pages-artifact)
7. Deploy to Pages    (actions/deploy-pages, OIDC)
```

### Auxiliary scripts (manual / on-demand)

- `python3 build_sidebar.py` — Re-scan `papers/` and rewrite sidebar config
- `python3 scripts/generate_rss.py` — Build RSS feed
- `python3 scripts/generate_citation_graph.py` — Build citation graph
- `python3 scripts/validate_papers.py` — Pre-commit / CI check
- `python3 scripts/generate_summaries.py` — AI summaries (needs `CLAUDE_API_KEY`)

## Internationalization

Uses VitePress's built-in `locales` config. Currently:

| Locale           | Path   | Status                           |
| ---------------- | ------ | -------------------------------- |
| English (root)   | `/`    | ✅ Complete                      |
| 简体中文 (zh-CN) | `/zh/` | ✅ Index, About, CS/EM overviews |

To add a new locale:

1. Create `docs/<lang>/` directory
2. Copy `docs/index.md`, `about.md`, and paper index files
3. Translate content (front-matter `title` and `description` required)
4. Add an entry to `locales` in `docs/.vitepress/config.ts`
5. Add nav links under `themeConfig.nav`

## Accessibility

We target WCAG 2.1 AA. Implemented features:

- **Semantic HTML** — `<main>` landmark via postbuild script
- **Skip link** — `Skip to main content` (visible on focus)
- **ARIA labels** — every icon-only button has one
- **Color contrast** — 4.5:1 minimum for body text
- **Touch targets** — 44×44px minimum (WCAG 2.5.5)
- **Reduced motion** — animations respect `prefers-reduced-motion`
- **Keyboard navigation** — full tab order
- **Screen reader** — tested with VoiceOver / NVDA

Run `npx @axe-core/cli https://badhope.github.io/ScholarLib/` to audit.

## SEO

- `<title>` and `<meta description>` per page
- Open Graph + Twitter Card meta tags
- JSON-LD structured data (`WebSite` schema with `SearchAction`)
- `sitemap.xml` (VitePress auto-generated)
- `robots.txt` (allows all, points to sitemap)
- `rss.xml` (auto-discovery via `<link rel="alternate">`)
- Canonical URLs (no duplicate content)

## PWA

The site is installable:

- `manifest.webmanifest` — name, icons, theme color, shortcuts
- `sw.js` — service worker, stale-while-revalidate strategy
- `offline.html` — graceful fallback when network is down

The service worker is registered by `Layout.vue` on `load` event.

## Performance

Lighthouse targets (Desktop, tested on GitHub Pages):

| Category       | Target | Actual |
| -------------- | ------ | ------ |
| Performance    | ≥ 95   | 100    |
| Accessibility  | ≥ 95   | 96     |
| Best Practices | ≥ 95   | 100    |
| SEO            | ≥ 95   | 100    |

Optimizations:

- VitePress static build (no JS framework on load)
- All CSS/JS bundled, no runtime CSS-in-JS
- Images served as SVG (vector, scales to any size)
- Service worker pre-caches shell HTML

## Security

- All user input goes through VitePress's Markdown renderer (no `v-html`)
- No analytics / tracking scripts (privacy-first)
- HTTPS-only via GitHub Pages
- No secrets in code (all env vars via GitHub Actions)
- Dependabot monitors for npm + GitHub Actions updates
- See [SECURITY.md](https://github.com/badhope/ScholarLib/blob/main/SECURITY.md) for disclosure

## Data Flow

```
User edits paper → git commit → git push
   ↓
GitHub Actions triggers
   ↓
CI runs (validate, test, format, type-check)
   ↓
If on main: deploy-docs runs
   ↓
VitePress builds static site
   ↓
A11y post-processing
   ↓
Artifact uploaded
   ↓
GitHub Pages deploys (OIDC, no token in repo)
   ↓
Cloudflare CDN serves content
   ↓
Users see updated site
```

## License

This project uses the [MIT License](https://github.com/badhope/ScholarLib/blob/main/LICENSE).
Individual papers retain their own licenses — see each paper's `metadata.json` for details.
