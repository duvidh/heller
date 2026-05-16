// Heller PWA service worker — cache-first with network fallback
const VERSION = 'heller-v13';
const SHELL = [
  './',
  './index.html',
  './css/styles.css?v=10',
  './js/app.js?v=10',
  './js/data.js',
  './js/storage.js',
  './js/ui.js',
  './js/cloud.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Network-first for HTML so the user gets new versions
  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html');
  if (isHTML) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }
  // Cache-first for everything else
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (req.url.startsWith(self.location.origin) || req.url.includes('fonts.g'))) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy).catch(() => {}));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
