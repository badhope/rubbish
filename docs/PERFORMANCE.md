# Performance & loading

This is the working budget for the public site. Measurements below are from the 1.19.13 build on the production server; they are transfer sizes, not repository sizes.

## Current budget

| Surface | Budget | Notes |
|---|---|---|
| HTML shell | ≤ 5 KB gzip | Includes the boot skeleton and `modulepreload` list |
| Initial JS | ≤ 300 KB gzip | Entry + React/TanStack/Radix/Lucide vendors |
| Initial CSS | ≤ 35 KB gzip | One compiled Tailwind sheet |
| CJK webfont | 0 KB | System serif stack; no Chinese webfont is downloaded |
| Article JS | ≤ 120 KB gzip extra | Markdown renderer and KaTeX load only on article routes |
| Admin charts | lazy | ECharts chunk loads after the dashboard shell |

The 1.19.12 home page transferred about 1.8 MB because two Chinese font subsets alone were 1.36 MB. 1.19.13 removes both; the hashed entry JS also drops from 268 KB to about 81 KB over the wire once Nginx gzip is enabled.

## Loading strategy

- **Route splitting**: TanStack Router auto-splits routes. Do not import admin pages, the forum editor, or ECharts from a public entry.
- **Intent preload**: `createRouter({ defaultPreload: 'intent' })` prefetches a route when the user hovers or focuses a link. Keep route loaders small; do not put heavy libraries in a route's top-level import.
- **Lazy boundaries**: the forum editor (`@uiw/react-md-editor`, ~892 KB raw) and admin analytics (`echarts`, ~259 KB raw) are dynamic imports with a visible skeleton.
- **Images**: article and markdown images use `loading="lazy"` and `decoding="async"`; covers that are part of the first screen use `priority`. Always give thumbnails `width` and `height`.
- **Search**: archive search debounces 350 ms; community search submits on Enter. Both are paginated and capped server-side.

## HTTP caching

Nginx, not the Python app, owns cache headers:

```nginx
gzip on;
gzip_vary on;
gzip_comp_level 6;
gzip_min_length 1024;
gzip_proxied any;
gzip_types text/plain text/css text/javascript application/javascript application/json application/xml application/rss+xml image/svg+xml application/manifest+json;

location ^~ /assets/ {
    # proxy to 127.0.0.1:8080
    expires 1y;
}
location ^~ /covers/ {
    # proxy to 127.0.0.1:8080
    expires 30d;
}
```

- Hashed `/assets/*` are immutable for one year. If a filename changes, the URL changes.
- `/covers/*` is content-addressed by upload name; 30 days is safe and keeps article covers warm.
- HTML, sitemap and RSS stay `no-cache, must-revalidate` from the app middleware.
- Never add `Cache-Control` inside a location that also needs the server-level security headers unless those headers are repeated; Nginx `add_header` in a child block replaces the parent set.

Verify after a deploy:

```bash
curl -sI --compressed -H 'Accept-Encoding: gzip' \
  --resolve rubbish.argjiemi.cn:443:103.116.247.174 \
  https://rubbish.argjiemi.cn/assets/index-<hash>.js | \
  grep -Ei 'content-encoding|cache-control|expires'
```

## API and database

- List endpoints cap `page_size` (catalog 100, forum 100, comments 100). Do not remove the cap for a UI convenience.
- Forum search uses `ILIKE '%q%'` on title and body. At the current scale (tens of topics) a sequential scan is cheaper than an index. When `forum_topics` passes roughly 10,000 rows, add a `pg_trgm` GIN index in a migration and keep the same query shape.
- Avoid per-request aggregate queries in list views. Counters such as `reply_count` and `last_reply_at` are denormalized on write.
- The admin dashboard requests claims, comments, and reports counts separately. Keep them `staleTime: 60s`; they are triage aids, not billing data.

## Review checklist

Before a release:

1. `npm run build` and confirm no `.woff2` in `dist/assets` other than KaTeX/Playfair subsets.
2. Confirm the entry chunk and CSS are under the budget above.
3. Run the Playwright audit at 1440 and 390; check `scrollWidth`, console errors, and broken images.
4. Check the production headers with `curl --compressed`; a missing `content-encoding: gzip` is a release blocker.
5. Check that the admin dashboard still renders after the lazy chart chunk loads.
