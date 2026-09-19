// static/sw.js — Nedwork service worker
// Intentionally passive: no caching, every request goes to the network
// exactly as if the service worker didn't exist.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // no respondWith → normal network behavior