/* ScholarLib Service Worker
 * Strategy:
 *   - Navigation requests: network-first, fall back to cached offline page.
 *   - Same-origin static assets (JS/CSS/font/image): stale-while-revalidate.
 *   - Cross-origin: passthrough.
 *
 * NOTE: Bump VERSION (in both this file and Layout.vue's auto-update
 * interval) on every release to invalidate old caches.
 */
const VERSION = "v1.0.1";
const CACHE_RUNTIME = `scholarlib-runtime-${VERSION}`;
const OFFLINE_URL = "/ScholarLib/offline.html";
const BASE = "/ScholarLib/";

const PRECACHE_URLS = [
  BASE,
  `${BASE}index.html`,
  `${BASE}about.html`,
  `${BASE}architecture.html`,
  `${BASE}citation-graph.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}og-image.svg`,
  `${BASE}og-image.png`,
  `${BASE}favicon.svg`,
  OFFLINE_URL,
];

// ── install: pre-cache critical assets ───────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_RUNTIME);
      // best-effort precache — failures shouldn't block install
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)));
      await self.skipWaiting();
    })(),
  );
});

// ── activate: clean old caches ────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Delete any cache that doesn't match the current version
      await Promise.all(
        keys
          .filter(
            (k) => !k.startsWith("scholarlib-runtime-") || !k.endsWith(VERSION),
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// ── fetch: route by request type ──────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Only handle same-origin GET
  if (url.origin !== self.location.origin) return;

  // Navigation requests → network-first with offline fallback
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          // Only cache successful 2xx responses
          if (fresh && fresh.status === 200) {
            const cache = await caches.open(CACHE_RUNTIME);
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          // Try the exact request first, then OFFLINE_URL
          const cached = await caches.match(req);
          return (
            cached ||
            (await caches.match(OFFLINE_URL)) ||
            new Response("Offline", {
              status: 503,
              statusText: "Offline",
              headers: { "Content-Type": "text/plain" },
            })
          );
        }
      })(),
    );
    return;
  }

  // Static assets → stale-while-revalidate
  const isAsset =
    url.pathname.startsWith(`${BASE}assets/`) ||
    /\.(?:js|css|woff2?|ttf|svg|png|jpg|jpeg|webp|ico|webmanifest|json)$/.test(
      url.pathname,
    );

  if (isAsset) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_RUNTIME);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        return cached || network || new Response("", { status: 504 });
      })(),
    );
  }
});

// ── message: allow page to skip waiting ───────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
