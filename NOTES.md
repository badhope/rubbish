# Notes

Things I want to remember about this repo. Not docs, not a changelog — just a scratchpad for future-me (or whoever picks this up).

## Decisions I'm no longer sure about

- **VitePress sidebar lives in `config.ts`, not a JSON file.** This means `build_sidebar.py` has to do string surgery on TS source. I considered moving the sidebar to `theme/sidebar.ts` to make this cleaner, but it would mean re-wiring the layout and I haven't been bothered enough yet.
- **CS topics are Title-Case-With-Dashes (`Machine-Learning`) but EM fields are kebab-case.** The asymmetry comes from how the two original repos were organized. I should probably normalize at some point.
- **`recover_pdfs.py` includes a sci-hub fallback.** Sci-Hub is a legal grey area and a lot of CI runners will rate-limit it almost immediately. I'm leaving it in because the PDFs _are_ open-access anyway, but anyone forking this should make their own call.

## Things that bit me during development

- The original config.ts had `base: '/'` instead of `/ScholarLib/`. The site built fine locally and was completely broken on GitHub Pages. Now I always set `base` first and check a built `dist/index.html` references work before deploying.
- `parent.glob('*.pdf')` in two different places. Both of them used the parent directory's PDF as a proxy for the current paper having a PDF, which silently skipped papers that were actually missing. Easy mistake to make — the parent dir is right there, it has PDFs in it, of course you'd find one.
- The service worker's activate handler used to filter with `!k.endsWith(VERSION)`, which would have _kept_ a stale cache that just happened to share a suffix. Now it requires both the prefix and the current version suffix to match. Lesson: name your caches with a content-addressable prefix, not just a suffix.

## Stuff I haven't done but probably should

- The CS topic pages (`docs/papers/computer-science/<topic>.md`) are hand-maintained tables. The 33 of them should be generated from `papers/` the same way the EM indices are. I just haven't gotten to it.
- There's no per-paper page in the static site. The `README.md` per paper is the only thing that gets linked, and the auto-generated index only shows the title and a link. A real per-paper page would be a useful PR if someone has the time.
- PDF caching on the server. Some of the PDFs are 30+ MB and GitHub Pages will serve them just fine, but a CDN in front would help. Not worth the complexity for a personal project.

## Stack I'd pick differently today

- VitePress for the site → still happy with this.
- Python for the build scripts → I'd still use Python, but I'd reach for `click` instead of argparse, and `pydantic` for the metadata schema.
- `unittest` for tests → works fine, but `pytest` would be more ergonomic. Switched costs aren't worth it for a project this size.
