const CACHE_NAME = 'etiket-rsud-labuha-v18';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/lapor.html',
  '/track.html',
  '/qrcodes.html',
  '/css/custom.css?v=4.14',
  '/js/supabase-client.js?v=4.14',
  '/js/qrcode.min.js?v=4.14',
  '/js/bcrypt.min.js?v=4.14',
  '/js/sound.js?v=4.14',
  '/js/app.js?v=4.14',
  '/js/lapor.js?v=4.14',
  '/manifest.json'
];

function cloneAsNonRedirectedResponse(res) {
  const headers = new Headers(res.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers
  });
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        ASSETS_TO_CACHE.map(async (assetUrl) => {
          try {
            const res = await fetch(assetUrl, { cache: 'no-cache' });
            if (res && res.ok) {
              const toCache = res.redirected ? cloneAsNonRedirectedResponse(res) : res;
              await cache.put(assetUrl, toCache);
            }
          } catch (err) {
            console.log('SW cache err:', assetUrl, err);
          }
        })
      );
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
  const reqUrl = e.request.url || '';
  if (
    e.request.method !== 'GET' ||
    reqUrl.includes('/api/') ||
    reqUrl.includes('/socket.io/') ||
    reqUrl.includes('/downloads/') ||
    reqUrl.includes('/version.json') ||
    reqUrl.includes('supabase.co')
  ) {
    return;
  }

  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request.url, { cache: 'no-cache' });
        if (res && res.redirected) {
          // Chrome/WebView rejects redirected responses for navigate requests
          return cloneAsNonRedirectedResponse(res);
        }
        return res;
      } catch (err) {
        return (await caches.match(e.request, { ignoreSearch: true }))
          || (await caches.match(new URL(e.request.url).pathname))
          || (await caches.match('/'))
          || Response.error();
      }
    })());
    return;
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

