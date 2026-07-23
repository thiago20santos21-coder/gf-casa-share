/* GF Casa Share — Service Worker v4 */
const CACHE_NAME = 'gf-casa-share-v4';
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;

  if (request.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname.endsWith('app.js')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((r) => r || caches.match('./index.html'))
        )
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetched;
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'NOTIFY') {
    const { title, body, tag, url } = data;
    const icon = self.location.origin + '/icons/icon-192.png';
    event.waitUntil(
      self.registration.showNotification(title || 'GF Casa Share', {
        body: body || '',
        tag: tag || 'gf-update',
        icon,
        badge: icon,
        data: { url: url || '/' },
        renotify: true
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', url: target });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'GF Casa Share', body: 'Nova atualização no grupo' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_) {
    try {
      payload.body = event.data.text();
    } catch (__) {}
  }
  const icon = self.location.origin + '/icons/icon-192.png';
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon,
      badge: icon,
      data: { url: payload.url || '/' }
    })
  );
});
