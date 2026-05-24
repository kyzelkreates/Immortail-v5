// IMMORTAIL™ Service Worker v4
// Full offline-first PWA — caches all assets including dog images
// Stale-while-revalidate for shell, cache-first for assets

const CACHE_VERSION = 'immortail-v4';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const ASSET_CACHE   = `${CACHE_VERSION}-assets`;
const ALL_CACHES    = [SHELL_CACHE, ASSET_CACHE];

// Core shell — must all succeed for install to complete
const SHELL_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/engine.js',
  '/storage.js',
  '/ai.js',
  '/app.js',
  '/manifest.json'
];

// Dog assets — pre-cached so dog renders fully offline
const ASSET_URLS = [
  '/assets/dog/body_idle.png',
  '/assets/dog/body_happy.png',
  '/assets/dog/body_sad.png',
  '/assets/dog/eyes_idle.png',
  '/assets/dog/eyes_happy.png',
  '/assets/dog/eyes_sad.png',
  '/assets/dog/blink.webm',
  '/assets/dog/tail_wag.webm',
  '/assets/dog/bounce.webm',
  '/assets/audio/breath_idle.mp3',
  '/assets/audio/bark_soft.mp3',
  '/assets/audio/whine.mp3',
  '/assets/audio/bark_excited.mp3',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

// ── Install — cache shell (required) + assets (best-effort) ───────────────
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    // Shell: all or nothing
    const shellCache = await caches.open(SHELL_CACHE);
    await shellCache.addAll(SHELL_URLS);

    // Assets: best-effort — missing files won't block install
    const assetCache = await caches.open(ASSET_CACHE);
    await Promise.allSettled(
      ASSET_URLS.map(url =>
        fetch(url, { cache: 'no-cache' })
          .then(res => { if (res.ok) assetCache.put(url, res); })
          .catch(() => {}) // skip missing assets silently
      )
    );

    await self.skipWaiting();
  })());
});

// ── Activate — clean old caches ────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => !ALL_CACHES.includes(k)).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ── Fetch strategy ─────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // 1. Never intercept external requests (AI APIs, CDN, fonts)
  if (url.hostname !== self.location.hostname) return;

  // 2. Navigation — stale-while-revalidate (shell always loads)
  if (req.mode === 'navigate') {
    e.respondWith(staleWhileRevalidate(req, SHELL_CACHE, '/index.html'));
    return;
  }

  // 3. JS/CSS/HTML — stale-while-revalidate (updates in background)
  if (/\.(js|css|html)$/.test(url.pathname)) {
    e.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  // 4. Assets (images, video, audio, icons) — cache-first, fetch+cache on miss
  if (/\.(png|jpg|jpeg|webp|webm|mp4|mp3|ogg|wav|svg|ico)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }

  // 5. Manifest + other static — cache-first
  if (url.pathname === '/manifest.json') {
    e.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // 6. Everything else — network with cache fallback
  e.respondWith(
    fetch(req).catch(() => caches.match(req) || new Response('', { status: 503 }))
  );
});

// ── Cache strategies ───────────────────────────────────────────────────────
async function staleWhileRevalidate(req, cacheName, fallback) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req).then(res => {
    if (res && res.ok && res.type !== 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => null);

  if (cached) {
    // Return cached immediately, update in background
    fetchPromise; // fire-and-forget
    return cached;
  }

  const fresh = await fetchPromise;
  if (fresh) return fresh;
  if (fallback) return cache.match(fallback) || new Response('', { status: 404 });
  return new Response('', { status: 503 });
}

async function cacheFirst(req, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('', { status: 404 });
  }
}

// ── Background sync — update caches when back online ──────────────────────
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();

  if (e.data?.type === 'CACHE_ASSETS') {
    // Triggered by app when new assets are available
    const urls = e.data.urls || [];
    caches.open(ASSET_CACHE).then(cache => {
      urls.forEach(url =>
        fetch(url, { cache: 'no-cache' })
          .then(res => { if (res.ok) cache.put(url, res); })
          .catch(() => {})
      );
    });
  }

  if (e.data?.type === 'GET_CACHE_STATUS') {
    // Reply with what's cached
    Promise.all(
      [...SHELL_URLS, ...ASSET_URLS].map(async url => {
        const cached = await caches.match(url);
        return { url, cached: !!cached };
      })
    ).then(status => {
      e.source?.postMessage({ type: 'CACHE_STATUS', status });
    });
  }
});
