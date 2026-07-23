/* Casa Share — Service Worker v12 (offline-first) */
const CACHE_NAME = 'casa-share-v12';
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './app.js?v=20260723m',
  './manifest.json',
  './manifest.json?v=20260723m',
  './icons/casa-192.png',
  './icons/casa-512.png',
  './icons/casa-maskable-192.png',
  './icons/casa-maskable-512.png',
  './icons/casa-apple-180.png',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        for (const url of PRECACHE) {
          try {
            await cache.add(url);
          } catch (_) {
            /* CDN pode falhar; app ainda abre */
          }
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppShell(request, url) {
  return (
    request.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('index.html') ||
    url.pathname.endsWith('app.js') ||
    url.pathname.endsWith('sw.js') ||
    url.pathname.endsWith('manifest.json')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;

  // App shell: network first, cache fallback (abre offline)
  if (isAppShell(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((r) => r || caches.match('./index.html') || caches.match('/index.html'))
        )
    );
    return;
  }

  // Mesmo origin + CDNs: cache first, atualiza em background
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
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'NOTIFY') {
    const icon = self.location.origin + '/icons/casa-192.png';
    event.waitUntil(
      self.registration.showNotification(data.title || 'Casa Share', {
        body: data.body || '',
        tag: data.tag || 'casa-update',
        icon,
        badge: icon,
        data: { url: data.url || '/' },
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
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Casa Share', body: 'Nova atualização no grupo' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_) {}
  const icon = self.location.origin + '/icons/casa-192.png';
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon,
      badge: icon,
      data: { url: payload.url || '/' }
    })
  );
});
