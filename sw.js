/* GraviScore PWA service worker */
const CACHE = 'graviscore-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './main.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/og.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=> self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

// Handle Share Target (POST from OS share sheet)
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target/')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const sharedUrl = form.get('url') || form.get('text') || '';
        let g = '';
        const m = sharedUrl.match(/[?#]g=([^&]+)/);
        if (m) g = m[1];
        const dest = g ? './?g=' + encodeURIComponent(g) + '&shared=1' : './';
        return Response.redirect(dest, 303);
      } catch {
        return Response.redirect('./', 303);
      }
    })());
    return;
  }

  if (e.request.method !== 'GET') return;

  // Navigations → try network first, fallback to cache index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone(); caches.open(CACHE).then(c=>c.put(e.request, copy)); return res;
      }).catch(()=> caches.match('./index.html'))
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        const copy = res.clone(); caches.open(CACHE).then(c=>c.put(e.request, copy)); return res;
      }).catch(()=> cached)
    )
  );
});
