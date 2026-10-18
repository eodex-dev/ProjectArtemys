const CACHE_NAME = 'luna-cache-v10';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(['/style.css?v=4', '/script.js?v=10', '/manifest.json', '/icon-192.png', '/icon-512.png']);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('luna-cache-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin || new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(e.request)).then((response) => response || fetch(e.request))
  );
});
