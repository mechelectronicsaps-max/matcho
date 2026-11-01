// Drovox installable web app: always load fresh from the network; show a friendly page when offline.
const OFFLINE = '/offline.html';
self.addEventListener('install', (e) => { e.waitUntil(caches.open('drovox-offline-v1').then((c) => c.add(OFFLINE))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;   // API calls, images and scripts go straight to the network
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
