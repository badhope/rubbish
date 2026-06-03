<div align="center">

# 📚 ScholarLib

**The Open-Access Scholarly Library**

_A curated collection of influential research papers in **Computer Science** and **Economics & Management** — browse, search, and cite, all in one place._

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/Site-Live-brightgreen)](https://badhope.github.io/ScholarLib/)
[![Deploy](https://github.com/badhope/ScholarLib/actions/workflows/deploy-docs.yml/badge.svg)](https://github.com/badhope/ScholarLib/actions/workflows/deploy-docs.yml)
[![Link Check](https://github.com/badhope/ScholarLib/actions/workflows/link-checker.yml/badge.svg)](https://github.com/badhope/ScholarLib/actions/workflows/link-checker.yml)
[![Lighthouse](https://github.com/badhope/ScholarLib/actions/workflows/lighthouse.yml/badge.svg)](https://github.com/badhope/ScholarLib/actions/workflows/lighthouse.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Code of Conduct](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)
[![Security](https://img.shields.io/badge/Security-Policy-green)](SECURITY.md)

[🌐 Visit the Documentation Site](https://badhope.github.io/ScholarLib/) · [📖 Browse the Source](https://github.com/badhope/ScholarLib) · [💬 Discussions](https://github.com/badhope/ScholarLib/discussions)

</div>

---

## 🎯 What is ScholarLib?

**ScholarLib** is a systematically organized, open-access repository of research papers in two major disciplines:

- 🤖 **Computer Science** — **33** curated topics from Machine Learning and Deep Learning to Algorithms, Systems, Security, and beyond
- 📊 **Economics & Management** — **18** research fields organized by year (2020 – 2026)

Every paper comes with a **ready-to-use BibTeX citation** — copy, paste, and keep writing.

> **No more hunting through Google Scholar, juggling tabs, or wrestling with paywalls.**

## 📊 At a Glance

| Metric                        |               Value |
| ----------------------------- | ------------------: |
| Computer Science topics       |              **33** |
| Economics & Management fields |              **18** |
| Publication years covered     | **7** (2020 – 2026) |
| Paper entries                 |          **2,500+** |
| Documented pages on the site  |             **50+** |
| Repository size               |             ~412 MB |
| License                       |                 MIT |

## ✨ Features

- 🔍 **Local full-text search** — fuzzy + prefix matching, instant results
- 🌗 **Dark / light mode** — auto-detects your system preference
- 📱 **Mobile-friendly** — responsive design, works on all screen sizes
- 🗂️ **Topic-based + year-based navigation** — find papers your way
- 📄 **Ready-to-cite BibTeX** — for every paper
- 🚀 **GitHub Pages deployed** — fast, free, reliable hosting
- 🛡️ **Comprehensive SEO** — sitemap, RSS, Open Graph, JSON-LD
- ♿ **Accessibility** — skip links, semantic HTML, ARIA labels
- 🤖 **LLM-friendly** — `vitepress-plugin-llms` integration
- 🔄 **CI/CD** — auto-deploy on every push, weekly link check, Lighthouse audits

## 📂 Repository Structure

```
ScholarLib/
├── docs/                          # VitePress documentation site
│   ├── .vitepress/
│   │   ├── config.ts              # Site config (SEO, sidebar, theme)
│   │   ├── theme/
│   │   │   ├── custom.css         # Custom theme overrides
│   │   │   └── index.ts           # Theme extension
│   ├── 404.md                     # Custom 404 page
│   ├── about.md
│   ├── index.md                   # Home page
│   ├── papers/
│   │   ├── computer-science/      # 33 CS topic pages
│   │   └── economics-management/  # 18 EM field pages
│   └── public/
│       ├── og-image.svg           # Social preview (1200×630)
│       └── robots.txt
├── papers/                        # Source paper resources
│   ├── computer-science/          # 33 CS topic folders (from CS repo)
│   └── economics-management/      # 7 year folders (from EM repo)
├── templates/
├── scripts/
├── .github/
│   ├── workflows/
│   │   ├── deploy-docs.yml        # Auto-deploy to GitHub Pages
│   │   ├── link-checker.yml       # Weekly + on-PR link check
│   │   └── lighthouse.yml         # Performance/A11y/SEO audits
│   ├── ISSUE_TEMPLATE/            # 3 templates
│   ├── pull_request_template.md
│   ├── dependabot.yml             # Auto-update dependencies
│   └── FUNDING.yml
├── .scholarlib.yaml               # EM taxonomy config
├── .editorconfig                  # Editor consistency
├── .prettierrc.json               # Code formatting
├── .nvmrc                         # Node version pin
├── package.json                   # VitePress + Prettier
├── package-lock.json              # Locked dependencies
├── README.md                      # This file
├── CHANGELOG.md                   # Version history
├── LICENSE                        # MIT
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── CITATION.cff
```

## 🌐 Live Documentation Site

The full site is built with [VitePress 1.6](https://vitepress.dev/) and deployed via GitHub Actions:

👉 **https://badhope.github.io/ScholarLib/**

### Browse the Library

- 🤖 [Computer Science Papers](https://badhope.github.io/ScholarLib/papers/computer-science/) — 33 topics
- 📊 [Economics & Management Papers](https://badhope.github.io/ScholarLib/papers/economics-management/) — 18 fields
- 📜 [About ScholarLib](https://badhope.github.io/ScholarLib/about) — Mission, history, contributing

## 🆕 Migration Notice (2026)

This repository is the **successor** of two earlier projects. All content has been merged here:

| Old Repo                                                    | What it held                                         | Status                             |
| ----------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| [`ScholarLib-CS`](https://github.com/badhope/ScholarLib-CS) | Computer Science papers (33 topics, ~2,500 entries)  | ✅ Merged & archived               |
| [`ScholarLib-EM`](https://github.com/badhope/ScholarLib-EM) | Economics & Management papers (18 fields, 2020-2026) | ✅ Renamed in place → `ScholarLib` |

If you have external links pointing to the old repositories:

- **`ScholarLib-EM`** → GitHub automatically redirects old URLs to `ScholarLib`. No action needed.
- **`ScholarLib-CS`** → Please update your links to point to `ScholarLib/papers/computer-science/{topic}/`.

## 🤝 Contributing

We welcome new papers, typo fixes, metadata corrections, and topic suggestions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. Quick start:

1. Fork this repo
2. Add your paper to the appropriate topic folder
3. Include a `.bib` citation and a `metadata.json`
4. Open a pull request

Or use the [paper submission issue template](https://github.com/badhope/ScholarLib/issues/new?template=new_paper.md).

## 📜 License

This repository is released under the [MIT License](LICENSE). Individual papers retain their own licenses — please check each paper's metadata before redistribution.

## 📖 Citing

If you use ScholarLib in your research, please cite it. See [CITATION.cff](CITATION.cff) for the canonical citation, or use the **"Cite this repository"** button on the GitHub repo page.

## 🛡️ Security

Found a security issue? See [SECURITY.md](SECURITY.md) for responsible disclosure.

## 👤 Maintainer

Maintained by [@badhope](https://github.com/badhope).

## ⭐ Star History

If this project helps you, consider starring ⭐ the repo to help others find it.
