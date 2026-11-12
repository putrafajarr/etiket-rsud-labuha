const CACHE_NAME = 'etiket-rsud-labuha-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/lapor.html',
  '/track.html',
  '/css/custom.css',
  '/js/sound.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.log('SW cache err:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Network first, fallback to cache for pages
  if (e.request.url.includes('/api/') || e.request.url.includes('/socket.io/')) {
    return; // Pass through network
  }

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Native Mobile & OS Push Notification Handler
self.addEventListener('push', (event) => {
  let data = { title: '🚨 Tiket Baru RSUD Labuha', body: 'Laporan kendala baru telah masuk', url: '/index.html' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/index.html' },
    requireInteraction: true
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Click notification on mobile lockscreen/tray -> open app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

