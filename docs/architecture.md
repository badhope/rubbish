---
title: Architecture
aside: false
---

# Architecture

How the pieces fit together. Not a sales pitch.

## Build pipeline

```
papers/  +  docs/  +  templates/
        │
        ▼
   validate_papers.py         (CI: every PR)
   generate_index.py          (consolidated references.bib)
   generate_rss.py            (RSS feed)
   generate_citation_graph.py (graph data + page)
   build_sidebar.py           (rewrites sidebar block in config.ts)
        │
        ▼
   vitepress build docs
        │
        ▼
   postbuild_a11y.py          (adds <main>, aria-labels)
        │
        ▼
   docs/.vitepress/dist/      (artifact → GitHub Pages)
```

All Python scripts in `scripts/` are plain CLI tools, no framework. They're called either from `package.json`'s `scripts` block or from the Makefile. `build_sidebar.py` lives at the repo root because it's run before the docs are even built.

## Why these choices

- **Static site, not SPA.** The site is a content viewer. SPA routing, hydration, and runtime fetching would all be overhead.
- **Per-paper folder, not a single `papers.json`.** Means I can move a topic out into its own repo without rewriting an index. The validation script is the one place that has to know the structure.
- **Python for build scripts.** Same as the validation logic in the rest of the repo. Could have been Node, but pulling in JS just to read JSON feels wrong.
- **Service worker only in prod.** HMR fights the SW cache. The `import.meta.env.DEV` short-circuit was the difference between a usable dev loop and a frustrating one.

## Internationalization

VitePress's built-in `locales` config, no plugin. English is at the root, `zh-CN` is under `/zh/`. The paper content itself isn't translated — only the site chrome. Translating abstracts is a separate, much larger project.

## Accessibility

WCAG 2.1 AA. The actual fixes live in `postbuild_a11y.py` and `docs/.vitepress/theme/custom.css`:

- `<main>` landmark (added post-build, since VitePress' default theme uses a `<div>`)
- skip-link
- aria-labels on icon-only buttons (VPSwitch, DocSearch)
- 44px touch targets for the small theme buttons
- focus-visible styling

If the audit regresses, the postbuild script will surface it in CI before the change ships.

## Security

- Static site, no server. Attack surface is the build-time scripts and the paper metadata.
- `recover_pdfs.py` has a domain allowlist — without it, a malicious metadata entry could trigger a request to an internal address.
- The CI security workflow runs gitleaks and `npm audit` weekly.
- See `SECURITY.md` for disclosure contact.

## Things that are deliberately not in here

- Search server / Algolia. The default `local` provider scales fine to a few thousand docs.
- Comments. GitHub issues are enough.
- Analytics. Nothing on the site needs them.
- Comments on the architecture document. (See also: this document.)
