# Contributing

Bug reports and paper additions are the most useful contributions. Code changes to the site/scripts are welcome but please open an issue first — the surface is small and it's easy to step on each other.

## Adding a paper

1. Open an issue using the `new_paper` template. The form asks for the fields `validate_papers.py` will check, and a PR that skips the issue will bounce.
2. Files per paper: `README.md`, `metadata.json`, `<key>.bib`, and ideally `paper.pdf`. There's a template at `templates/paper-template/`.
3. Folder name is the cite key, kebab-case. The CS layout is `papers/computer-science/<Topic>/<Year>/<key>/`; the EM layout is per `.scholarlib.yaml`.
4. Run `make validate` before opening the PR.

## Fixing existing entries

Typo, missing DOI, broken link, wrong year, missing PDF — just send a PR. If the PDF is the only thing missing, `python3 scripts/recover_pdfs.py --download` can fetch it from arXiv for you.

## Changing the site or scripts

- Open an issue describing the change first.
- Touch `docs/.vitepress/config.ts` carefully — most of it is generated.
- Add a test in `tests/` if you add a script.
- `make ci` must pass.

## Commit messages

Loose Conventional Commits is fine:

```
papers: add Vaswani 2017 Attention
fix: broken link in CS index
docs: clarify contributing guide
ci: add python 3.13 to test matrix
```

One thing per commit. The body, if any, should explain _why_.

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant, standard.

## Security

See [SECURITY.md](SECURITY.md). Please don't file security issues publicly.
