// Service worker for offline use. At build time vite.config.js fills in VERSION and FILES
// (every file in dist/), so each deploy gets a fresh cache and the whole app is available offline
// after the first visit. Dropbox calls are cross-origin and never touched.
const VERSION = /*__VERSION__*/ 'dev';
const FILES = /*__FILES__*/ [];
const CACHE = 'calories-' + VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', ...FILES.map(f => './' + f)])));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Pages: network first, so a new deploy shows up as soon as you're online.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put('./', copy));
          return r;
        })
        .catch(() => caches.match('./', { ignoreSearch: true })),
    );
    return;
  }

  // Everything else (hashed JS/CSS, icons): cache first, then network.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
