# ScholarLib

A small, opinionated library of CS / economics papers I've actually read or want to read, with a VitePress site on top so I can find them again.

**Live site →** https://badhope.github.io/ScholarLib/

## What's in it

- ~2,500 paper entries, 51 topic folders, organized by `papers/<discipline>/<topic>/`
- Each paper has a `README.md`, a `metadata.json`, and a `.bib` you can copy straight into LaTeX
- A static site that builds into a searchable, dark-mode-friendly doc

I originally kept this as two separate repos (CS and Econ/Management) and a pile of Google Docs bookmarks. This repo is the merge.

## Run it locally

```sh
npm install
npm run docs:dev      # http://localhost:5173
```

The Python helpers in `scripts/` only matter if you're adding or auditing papers:

```sh
python3 scripts/validate_papers.py     # CI runs this
python3 scripts/recover_pdfs.py        # one-off, fills in missing PDFs from arXiv
```

## A few choices worth flagging

- **VitePress, not Next.js / Astro.** Static output, no JS framework on the page, and VitePress' default theme is already 90% what I'd build by hand. The build is ~5s.
- **`metadata.json` per paper, not a single index.** Lets each paper's folder be self-contained — easy to vendor a topic out, easy to PR a single paper. The downside is the auto-generated sidebar has to be rebuilt after structural changes; `build_sidebar.py` does that and writes into `docs/.vitepress/config.ts`.
- **The site is multilingual (en / zh), but the paper content is English-only.** I only localized UI strings. Translating 2,500 abstracts is a different project.
- **PWA is opt-in.** The service worker only registers in production builds and on `load`, so dev HMR isn't disturbed.

## Things I deliberately didn't do

- No Algolia. The built-in `local` search is fast enough for a few thousand docs and I don't want to pay for it.
- No comment system. The repo is read-only for most people; the GitHub issue template is enough.
- No analytics.
- No telemetry on the PDF recovery script. If it pings arXiv 50 times you might get rate-limited; that's the worst case.

## Repo layout

```
.
├── docs/                       VitePress site
│   ├── .vitepress/             config, theme overrides
│   ├── {index,about,architecture,citation-graph}.md
│   ├── zh/                     Chinese UI strings
│   └── public/                 static assets, PWA manifest, sw.js
├── papers/                     the actual content
│   ├── computer-science/<topic>/
│   └── economics-management/<year>/
├── scripts/                    build-time helpers (Python)
├── tests/                      unit tests for the scripts
├── templates/paper-template/   copy this when adding a new paper
├── .github/workflows/          CI, deploy, security scans
├── build_sidebar.py            auto-generates the VitePress sidebar
├── postbuild_a11y.py           runs after vitepress build
├── Makefile                    the day-to-day commands
└── package.json
```

## Contributing

Bug reports and paper additions are the most useful. See [CONTRIBUTING.md](CONTRIBUTING.md).

If you're proposing a new paper, please use the `new_paper` issue template — it asks for the metadata fields the validation script needs, and submissions missing them just bounce.

## License

MIT for the repo and the metadata. The papers themselves keep their own licenses — check each entry's `metadata.json` before redistributing.

---

Maintained by [@badhope](https://github.com/badhope). The site rebuilds on every push to `main`.
