<div align="center">

# 📚 ScholarLib

**The Open-Access Scholarly Library**

*A curated collection of influential research papers in **Computer Science** and **Economics & Management** — browse, search, and cite, all in one place.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/Site-Live-brightgreen)](https://badhope.github.io/ScholarLib/)
[![Topics](https://img.shields.io/badge/Topics-51-blue)](https://github.com/badhope/ScholarLib)
[![Years](https://img.shields.io/badge/Years-2020--2026-green)](https://github.com/badhope/ScholarLib)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[🌐 Visit the Documentation Site](https://badhope.github.io/ScholarLib/) · [📖 Browse the Source](https://github.com/badhope/ScholarLib)

</div>

---

## 🎯 What is ScholarLib?

**ScholarLib** is a systematically organized, open-access repository of research papers in two major disciplines:

- 🤖 **Computer Science** — 33 curated topics from Machine Learning and Deep Learning to Algorithms, Systems, Security, and beyond
- 📊 **Economics & Management** — 18 research fields organized by year (2020 – 2026)

Every paper comes with a **ready-to-use BibTeX citation** — copy, paste, and keep writing.

> **No more hunting through Google Scholar, juggling tabs, or wrestling with paywalls.**

## 📂 Repository Structure

```
ScholarLib/
├── docs/                          # VitePress documentation site
│   ├── .vitepress/config.ts
│   ├── index.md                   # Home page
│   ├── papers/
│   │   ├── computer-science/      # 33 CS topics
│   │   └── economics-management/  # 18 EM fields
│   └── about.md
├── papers/                        # Source paper resources
│   ├── computer-science/
│   │   ├── Machine-Learning/
│   │   ├── Deep-Learning/
│   │   └── ... (33 topics)
│   └── economics-management/
│       ├── 2020/
│       ├── 2021/
│       └── ... (2020-2026)
├── templates/
├── scripts/
├── .scholarlib.yaml               # EM taxonomy config
├── .github/workflows/deploy-docs.yml
├── package.json
├── README.md
├── LICENSE
├── CITATION.cff
└── CONTRIBUTING.md
```

## 🌐 Live Documentation Site

The full site is built with [VitePress](https://vitepress.dev/) and deployed via GitHub Pages:

👉 **https://badhope.github.io/ScholarLib/**

Features:
- 🔍 **Local full-text search** across thousands of papers
- 🗂️ **Topic-based and year-based navigation**
- 🌓 **Dark / light mode**
- 📱 **Mobile-friendly**

## 🆕 Migration Notice (2026)

This repository is the **successor** of two earlier projects. All content has been merged here:

| Old Repo | What it held | Status |
|---|---|---|
| [`ScholarLib-CS`](https://github.com/badhope/ScholarLib-CS) | Computer Science papers (33 topics, ~2,500 entries) | ✅ Merged & archived |
| [`ScholarLib-EM`](https://github.com/badhope/ScholarLib-EM) | Economics & Management papers (18 fields, 2020-2026) | ✅ Renamed in place → `ScholarLib` |

If you have external links pointing to the old repositories:

- **`ScholarLib-EM`** → GitHub automatically redirects old URLs to `ScholarLib`. No action needed.
- **`ScholarLib-CS`** → Please update your links to point to `ScholarLib/papers/computer-science/{topic}/`.

## 🤝 Contributing

We welcome new papers, typo fixes, metadata corrections, and topic suggestions. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## 📜 License

This repository is released under the [MIT License](LICENSE). Individual papers retain their own licenses — please check each paper's metadata before redistribution.

## 📖 Citing

If you use ScholarLib in your research, please cite it. See [CITATION.cff](CITATION.cff) for the canonical citation.

## 👤 Maintainer

Maintained by [@badhope](https://github.com/badhope).
