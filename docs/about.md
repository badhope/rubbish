---
title: About
aside: true
---

# About ScholarLib

A curated, open-access scholarly library of Computer Science, Economics & Management papers. Browse, search, and cite — without paywalls.

## Mission

ScholarLib exists to solve three persistent problems in academic work:

1. **Discovery** — Finding the most important papers in a field is hard. Google Scholar is noisy, arXiv is unfiltered, and most journal sites hide papers behind paywalls.
2. **Access** — When you finally find a paper, getting a full-text copy is often impossible without institutional access.
3. **Citation** — Citing papers correctly is tedious, and missing fields break your bibliography.

ScholarLib provides curated, organized, and downloadable open-access papers — with ready-to-use BibTeX citations.

## History

ScholarLib was formed by merging two earlier projects:

- **[ScholarLib-CS](https://github.com/badhope/ScholarLib-CS)** — Computer Science paper reference library (originally 33 topics, ~2,500 paper entries). Merged in 2026.
- **[ScholarLib-EM](https://github.com/badhope/ScholarLib-EM)** — Economics & Management paper library (18 fields, 2020 – 2026). Merged in 2026.

Both legacy repositories are now archived. All content has been migrated here under a unified structure:

```
papers/
├── computer-science/      # 33 CS topics, organized by topic → year
└── economics-management/  # 18 EM fields, organized by year → field
```

## License

ScholarLib is released under the [MIT License](https://github.com/badhope/ScholarLib/blob/main/LICENSE). Individual papers retain their own licenses — please check each paper's metadata before redistribution.

## Contributing

We welcome new papers, typo fixes, metadata corrections, and topic suggestions.

**Before you contribute**, please read [CONTRIBUTING.md](https://github.com/badhope/ScholarLib/blob/main/CONTRIBUTING.md).

**Quick start:**

1. Add your paper to the appropriate topic folder under `papers/`
2. Include a `.bib` citation and a `metadata.json` (see template)
3. Open a pull request

**Tools:**

- Use the [paper submission template](https://github.com/badhope/ScholarLib/issues/new?template=new_paper.md) to suggest a paper
- Use the [bug report template](https://github.com/badhope/ScholarLib/issues/new?template=bug_report.md) for broken links or site issues
- Use the [feature request template](https://github.com/badhope/ScholarLib/issues/new?template=feature_request.md) for ideas

## Maintainer

Maintained by [@badhope](https://github.com/badhope).

## Sponsoring

If ScholarLib helps your research, consider supporting development:

- GitHub Sponsors: [@badhope](https://github.com/sponsors/badhope)
- Open Collective: [badhope/scholarlib](https://opencollective.com/scholarlib)

## Tech Stack

- **[VitePress 1.6](https://vitepress.dev/)** — Documentation site generator
- **[GitHub Actions](https://github.com/features/actions)** — CI/CD
- **[Lychee](https://github.com/lycheeverse/lychee)** — Link checker
- **[Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)** — Performance, a11y, SEO audits
- **[Dependabot](https://github.com/dependabot)** — Automated dependency updates

## Acknowledgments

- [VitePress](https://vitepress.dev/) for the excellent static site generator
- [GitHub Pages](https://pages.github.com/) for free hosting
- All paper authors and contributors who make this library possible
