// IMMORTAIL™ Service Worker v2
// Cache-first for static assets, network-only for external APIs

const CACHE_NAME = 'immortail-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/engine.js',
  '/storage.js',
  '/ai.js',
  '/app.js',
  '/manifest.json',
  // Asset paths — cached when fetched, not pre-cached (avoids 404 on missing files)
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never intercept external API calls (OpenAI etc.)
  if (url.hostname !== self.location.hostname) return;

  // Navigation: cache-first, fallback to index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match(e.request)
        .then(r => r || fetch(e.request))
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Assets: cache-first, then network + cache
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => new Response('', { status: 404 }));
    })
  );
});
