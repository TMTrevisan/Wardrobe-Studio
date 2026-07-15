// Service worker for Antigravity Threads.
// Plain JS (not TS) — browsers parse this as JS, so no type annotations.

const CACHE_NAME = 'antigravity-threads-v1';
const ASSETS_TO_CACHE = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) return caches.delete(cache);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Skip non-GET; skip cross-origin (e.g., Supabase storage CDN) so we
  // don't intercept and cache third-party responses.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).catch(() => {
        return new Response('Offline — Antigravity Threads is loading…', {
          headers: { 'Content-Type': 'text/plain' },
        });
      });
    })
  );
});