const STATIC_CACHE = 'static-v1';
const DYNAMIC_CACHE = 'dynamic-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/react@18/umd/react.development.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.development.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  // Serve our own assets from cache first
  if (STATIC_ASSETS.some(asset => request.url.endsWith(asset.replace('./','')))) {
    event.respondWith(
      caches.match(request).then(cached => {
        return cached || fetch(request).then(res => {
          return caches.open(STATIC_CACHE).then(cache => {
            cache.put(request, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }
  // For other requests (e.g. API calls), try network first then cache
  event.respondWith(
    fetch(request)
      .then(res => {
        return caches.open(DYNAMIC_CACHE).then(cache => {
          cache.put(request, res.clone());
          return res;
        });
      })
      .catch(() => caches.match(request))
  );
});