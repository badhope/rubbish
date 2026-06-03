# Contributing to ScholarLib

Thank you for your interest in improving ScholarLib! 🎉
This document covers everything you need to contribute effectively.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [What can I contribute?](#what-can-i-contribute)
- [Quick start](#quick-start)
- [Adding a paper](#adding-a-paper)
- [Fixing or improving a paper entry](#fixing-or-improving-a-paper-entry)
- [Adding a new topic](#adding-a-new-topic)
- [Improving the documentation site](#improving-the-documentation-site)
- [Adding a new locale](#adding-a-new-locale)
- [Submitting code changes](#submitting-code-changes)
- [PR checklist](#pr-checklist)
- [Style guide](#style-guide)

## Code of Conduct

This project adheres to the [Contributor Covenant](CODE_OF_CONDUCT.md).
By participating, you agree to uphold its principles. Please report
unacceptable behavior via [SECURITY.md](SECURITY.md).

## What can I contribute?

| Type                    | Difficulty  | Where                      |
| ----------------------- | ----------- | -------------------------- |
| Add a paper             | ⭐ Easy     | `papers/<section>/...`     |
| Fix typo / broken link  | ⭐ Easy     | Anywhere in `papers/`      |
| Improve metadata        | ⭐ Easy     | `papers/**/metadata.json`  |
| Translate a page        | ⭐⭐ Medium | `docs/<locale>/`           |
| Add a new topic         | ⭐⭐ Medium | New folder + config update |
| Add a new script        | ⭐⭐⭐ Hard | `scripts/` + tests + docs  |
| CI / build improvements | ⭐⭐⭐ Hard | `.github/workflows/`       |

## Quick start

### 1. Fork and clone

```bash
# Click "Fork" on GitHub, then:
git clone https://github.com/YOUR-USERNAME/ScholarLib.git
cd ScholarLib
```

### 2. Install dependencies

```bash
make init        # installs npm + reminds you about optional pip packages
# or: npm install
```

Optional Python packages for full functionality:

```bash
pip install requests beautifulsoup4 pillow cairosvg anthropic
```

### 3. Start the dev server

```bash
make dev
# Opens http://localhost:5173 with hot-reload
```

### 4. Create a branch

```bash
git checkout -b add/papers-ml-2025-attention-is-all-you-need
```

Use prefixes: `add/`, `fix/`, `docs/`, `refactor/`, `ci/`, `i18n/`.

## Adding a paper

> **Important:** Only submit papers you have the right to redistribute.
> All papers in ScholarLib must be **open-access** or have an explicit
> redistribution license (e.g., arXiv preprints, CC-BY journal articles).

### Step 1: Determine the path

The path layout depends on which section your paper belongs to:

**Computer Science** (`papers/computer-science/`):

```
papers/computer-science/<Topic>/<Year>/<paper-kebab-name>/
```

For example:

```
papers/computer-science/Machine-Learning/2017/Vaswani-2017-AttentionIsAllYouNeed/
```

**Economics & Management** (`papers/economics-management/`):

```
papers/economics-management/<Year>/<Field>/<Topic>/<JournalTier>/<Method>/<Scenario>/<paper-kebab-name>/
```

For example:

```
papers/economics-management/2025/finance/asset-pricing/FT50-UTD24/empirical/cross-country/fama-french-five-factor/
```

The full taxonomy is defined in `.scholarlib.yaml`.

### Step 2: Copy the template

```bash
cp -r templates/paper-template papers/<your-path>
```

### Step 3: Fill in the files

#### `metadata.json` (required)

```json
{
  "title": "Attention Is All You Need",
  "authors": ["Vaswani, Ashish", "Shazeer, Noam"],
  "year": 2017,
  "journal": "NeurIPS",
  "doi": "10.5555/3295222.3295349",
  "url": "https://papers.nips.cc/paper/7181-attention-is-all-you-need",
  "abstract": "We propose a new simple network architecture, the Transformer...",
  "keywords": ["transformer", "attention", "neural networks"],
  "category": "machine-learning",
  "submitted_by": "your-github-username",
  "date_added": "2026-06-02"
}
```

#### `<paper-name>.bib` (required)

```bibtex
@inproceedings{vaswani2017attention,
  title   = {{Attention Is All You Need}},
  author  = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  booktitle = {NeurIPS},
  year    = {2017},
  doi     = {10.5555/3295222.3295349},
  url     = {https://papers.nips.cc/paper/7181-attention-is-all-you-need}
}
```

#### `paper.pdf` (required)

Drop the full-text PDF in the same directory. If the PDF is large (>5 MB),
Git LFS will handle it automatically thanks to `.gitattributes`.

### Step 4: Validate

```bash
make validate
```

This will check schema, kebab-case folder names, missing files, etc.

### Step 5: Update the topic page (CS only)

For CS papers, add an entry to
`docs/papers/computer-science/<topic>.md` so the paper appears in the
sidebar table:

```markdown
| Title                                                   | Year | Authors        | Link                                                                                                 |
| ------------------------------------------------------- | ---: | -------------- | ---------------------------------------------------------------------------------------------------- |
| [Attention Is All You Need](https://papers.nips.cc/...) | 2017 | Vaswani et al. | [PDF](../papers/computer-science/Machine-Learning/2017/Vaswani-2017-AttentionIsAllYouNeed/paper.pdf) |
```

For EM papers, the index pages are auto-generated, but you can manually
update the year/field index in `docs/papers/economics-management/`.

### Step 6: Commit and push

```bash
git add papers/ docs/
git commit -m "papers: add Vaswani 2017 Attention Is All You Need"
git push origin add/papers-ml-2017-attention
```

## Fixing or improving a paper entry

Small fixes don't need an issue — just send a PR:

- **Typo in title or abstract** → edit the `.md` or `metadata.json`
- **Missing DOI** → add it to both `metadata.json` and the `.bib`
- **Wrong year** → fix the metadata and `.bib`
- **Missing PDF** → add the PDF (or run `python3 scripts/recover_pdfs.py`)

## Adding a new topic

CS topics are auto-discovered by `build_sidebar.py`. To add one:

1. Create `papers/computer-science/<New-Topic>/` (use Title-Case-With-Dashes)
2. Add the pretty name to `CS_PRETTY` in `build_sidebar.py`
3. Add the topic to `.scholarlib.yaml` under `computer_science_topics`
4. Create `docs/papers/computer-science/<new-topic>.md` (use kebab-case slug)
5. Run `make sidebar` to regenerate the sidebar
6. Open a PR

EM fields are auto-discovered too, but you should still add them to
`.scholarlib.yaml` under `economics_management_fields` and add a
`docs/papers/economics-management/<field>.md` overview.

## Improving the documentation site

The site is built with VitePress 1.6. All content is in `docs/`.

- **Homepage** — `docs/index.md` (uses `layout: home`)
- **About** — `docs/about.md`
- **Topic pages** — `docs/papers/computer-science/<topic>.md`
- **Citation graph** — `docs/citation-graph.md` (auto-generated)
- **404** — `docs/404.md`
- **Architecture** — `docs/architecture.md`

When adding new docs, follow the existing style: concise intro, table of
papers (if applicable), "How to contribute" section.

## Adding a new locale

We welcome translations! Currently English (root) and 简体中文 are
supported. To add a new one:

1. Create `docs/<lang>/` (use a [BCP 47](https://tools.ietf.org/html/bcp47) tag)
2. Translate:
   - `docs/index.md` → `docs/<lang>/index.md`
   - `docs/about.md` → `docs/<lang>/about.md`
   - Paper overview pages (use the English ones as reference)
3. Update `docs/.vitepress/config.ts`:
   ```ts
   locales: {
     ...
     <lang>: {
       label: 'Your Language',
       lang: '<bcp47>',
       description: '...',
       themeConfig: { nav: [...] },
     },
   }
   ```
4. Build and visually verify: `make build && make preview`
5. Open a PR

Note: We don't translate individual paper pages — the content is
fundamentally the same across languages, and contributors should be
able to read English abstracts. Only the site chrome is translated.

## Submitting code changes

For non-content changes (scripts, CI, theme):

1. **Discuss first** — open an issue or discussion for large changes
2. **Add tests** — every Python script in `scripts/` should have a test in `tests/`
3. **Run `make ci`** locally before pushing
4. **Update CHANGELOG.md** under `[Unreleased]`

## PR checklist

Before opening a PR, verify:

- [ ] `make ci` passes locally
- [ ] `make validate` shows no errors (warnings OK)
- [ ] New paper entries have all required fields
- [ ] Folder names use kebab-case (`my-paper-name`)
- [ ] `.bib` uses the same cite key as the folder
- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/):
  ```
  papers: add Vaswani 2017 Attention
  fix: broken link in CS index
  docs: clarify contributing guide
  ci: add python 3.13 to test matrix
  i18n: add Spanish translation
  ```
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] If you added a script, added tests in `tests/`
- [ ] If you changed the sidebar/structure, ran `make sidebar` and `make build`

## Style guide

### Markdown

- ATX-style headings (`#`, `##`, ...)
- One blank line between sections
- Use `[link text](url)` not `<a href>`
- Wrap tables with leading/trailing pipes
- Reference papers with `[Author Year]` → link to local `paper.pdf`

### Python

- Python 3.10+ syntax
- `pathlib.Path` over `os.path`
- Type hints where practical
- Docstrings on public functions
- One blank line between top-level definitions
- Imports at the top, sorted stdlib → third-party → local

### TypeScript

- Strict mode (enforced by `tsconfig.json`)
- `import type` for type-only imports
- 2-space indentation
- No `any` unless absolutely necessary

### Commits

- One logical change per commit
- Imperative mood: "add feature" not "added feature"
- Body explains **why**, not **what** (the diff shows the what)

## Getting help

- **General questions** — [GitHub Discussions](https://github.com/badhope/ScholarLib/discussions)
- **Bug reports** — [Bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- **Feature requests** — [Feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- **Paper submission** — [Paper submission template](.github/ISSUE_TEMPLATE/new_paper.md)
- **Security issues** — see [SECURITY.md](SECURITY.md) (do not file public issues)

## Recognition

Contributors are listed in the GitHub contributors graph and acknowledged
in release notes. Significant contributions may be invited to become
collaborators.

---

Thank you for helping make academic research more accessible! 📚
