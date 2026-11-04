// Service worker: la app abre sin señal. El API nunca se guarda en caché;
// las checadas sin señal las maneja la cola de la app (src/cola.ts).
const CACHE = 'checador-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/icono.svg', '/manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    // páginas: primero la red; sin señal, la última copia
    e.respondWith(fetch(e.request).then((r) => {
      const copia = r.clone();
      caches.open(CACHE).then((c) => c.put('/', copia));
      return r;
    }).catch(() => caches.match('/')));
    return;
  }
  // archivos con hash (assets): de la caché, y si no está, de la red
  e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
    return r;
  })));
});
