// Service Worker: macht die App installierbar und meldet neue Versionen.
// Bei jeder Änderung an der App diese Nummer erhöhen.
const VERSION = 'camino-1.0.0';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// Immer zuerst aus dem Netz (Online-App); nur die Startseite fällt bei fehlender Verbindung auf den Zwischenspeicher zurück.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true })));
});
