// Bump this version on every release so old caches get evicted in `activate`.
// Without this, users keep seeing whatever HTML/JS the SW first cached, even
// after rebuilding the app. Tying it to package.json version is ideal — for
// now, bump manually when shipping a new client build.
const CACHE_NAME = 'voicescope-v0.18.2';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

// Install: pre-cache shell, immediately activate
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: delete every cache that doesn't match the current name
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//   - API requests   → bypass SW (network only, no caching)
//   - HTML / nav     → network-first (so app updates show up immediately)
//   - hashed assets  → cache-first (safe: filename contains content hash)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.pathname.startsWith('/api')) {
    return; // let the request go directly to the network
  }

  // Treat HTML / navigations as network-first. If the network fails (offline),
  // fall back to cached. This is what makes "rebuild → reload → see new UI"
  // work reliably; without it, the SW happily serves yesterday's HTML.
  const isNavigation =
    request.mode === 'navigate'
    || (request.headers.get('accept') || '').includes('text/html');
  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('/')))
    );
    return;
  }

  // Static assets: cache-first, then update in background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});

// Allow the client to force a cache wipe + reload (used by the in-app
// "強制リロード" button when users hit the SW caching trap).
self.addEventListener('message', (event) => {
  if (event.data === 'CLEAR_CACHE_AND_RELOAD') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((c) => c.navigate(c.url)))
    );
  }
});
