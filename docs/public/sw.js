/* ScholarLib Service Worker
 * Strategy:
 *   - Navigation requests: network-first, fall back to cached offline page.
 *   - Same-origin static assets (JS/CSS/font/image): stale-while-revalidate.
 *   - Cross-origin: passthrough.
 * Version is bumped on every release to invalidate old caches.
 */
const VERSION = 'v1.0.0'
const CACHE_RUNTIME = `scholarlib-runtime-${VERSION}`
const CACHE_OFFLINE = `scholarlib-offline-${VERSION}`
const OFFLINE_URL = '/ScholarLib/offline.html'

const PRECACHE_URLS = [
  '/ScholarLib/',
  '/ScholarLib/index.html',
  '/ScholarLib/about',
  '/ScholarLib/manifest.webmanifest',
  '/ScholarLib/og-image.svg',
  OFFLINE_URL,
]

// ── install: pre-cache critical assets ───────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_RUNTIME)
      // best-effort precache — failures shouldn't block install
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)))
      await self.skipWaiting()
    })()
  )
})

// ── activate: clean old caches ───────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
})

// ── fetch: route by request type ─────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Only handle same-origin GET
  if (url.origin !== self.location.origin) return

  // Navigation requests → network-first with offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(CACHE_RUNTIME)
          cache.put(req, fresh.clone())
          return fresh
        } catch {
          const cached = await caches.match(req)
          return (
            cached ||
            (await caches.match(OFFLINE_URL)) ||
            new Response('Offline', { status: 503, statusText: 'Offline' })
          )
        }
      })()
    )
    return
  }

  // Static assets → stale-while-revalidate
  if (
    url.pathname.startsWith('/ScholarLib/assets/') ||
    /\.(?:js|css|woff2?|ttf|svg|png|jpg|jpeg|webp|ico|webmanifest)$/.test(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_RUNTIME)
        const cached = await cache.match(req)
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone())
            return res
          })
          .catch(() => cached)
        return cached || network
      })()
    )
  }
})

// ── message: allow page to skip waiting ──────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
