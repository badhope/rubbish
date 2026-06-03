#!/usr/bin/env node
// Copy any bundled paper assets (PDF / .bib / README.md) from the canonical
// `papers/` tree into `docs/public/papers/` so VitePress serves them
// at /ScholarLib/papers/<relpath>/<filename>. Without this step the
// "📄 PDF" links in the topic tables would 404 on GitHub Pages.
//
// The source of truth stays in `papers/`; this is just a build-time
// mirror. The script is idempotent and runs in ~5 ms for the current
// 1-PDF repo.
//
// For .md files we only mirror the per-leaf README.md (i.e. the one
// that sits next to a metadata.json). Intermediate overview READMEs
// from older years/fields stay in the repo and are rendered by
// VitePress from `docs/`, so we don't want to shadow them.

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";

const SRC = "papers";
const DEST = "docs/public/papers";
const ASSET_EXTS = new Set([".pdf", ".bib"]);
const LEAF_README = "README.md";

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      walk(p, out);
    } else if (s.isFile()) {
      const dot = entry.lastIndexOf(".");
      const ext = dot >= 0 ? entry.slice(dot) : "";
      if (ASSET_EXTS.has(ext)) {
        out.push(p);
      } else if (entry === LEAF_README) {
        // Only mirror a README.md if it lives in a leaf directory
        // (i.e. its parent folder also contains metadata.json).
        const parent = dirname(p);
        if (existsSync(join(parent, "metadata.json"))) {
          out.push(p);
        }
      }
    }
  }
  return out;
}

if (!existsSync(SRC)) {
  console.log(`[copy-paper-assets] ${SRC}/ not found, nothing to copy.`);
  process.exit(0);
}

const files = walk(SRC, []);
let copied = 0;
for (const src of files) {
  const rel = relative(SRC, src);
  const dest = join(DEST, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  copied += 1;
}

console.log(`[copy-paper-assets] ${copied} file(s) copied to ${DEST}/`);
