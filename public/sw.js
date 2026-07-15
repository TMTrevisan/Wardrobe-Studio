// Wardrobe Studio service worker.
// Never cache navigations or Next.js bundles here. A previous cache-first
// worker kept phones on an old demo build after production deployments.

const OBSOLETE_CACHES = ['antigravity-threads-v1', 'wardrobe-studio-shell-v1'];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => OBSOLETE_CACHES.includes(cacheName) || cacheName.startsWith('wardrobe-studio-'))
        .map((cacheName) => caches.delete(cacheName))
    ))
  );
  self.clients.claim();
});
