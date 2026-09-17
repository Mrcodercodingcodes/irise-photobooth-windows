const CACHE_NAME = 'irise-photobooth-v12';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './photobooth.html',
  './view.html',
  './style.css',
  './manifest.json',
  './js/app.js',
  './js/core/eyeFocus.js',
  './skins/d1/raw.png',
  './skins/d1/design.png',
  './skins/d2/raw.png',
  './skins/d2/design.png',
  './skins/d3/raw.png',
  './skins/d3/design.png',
  './skins/d4/raw.png',
  './skins/d4/design.png',
  'https://cdn.hugeicons.com/font/hgi-stroke-rounded.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        // Cache files one by one to avoid total failure if one is missing
        return Promise.allSettled(
          ASSETS_TO_CACHE.map(url => {
            return cache.add(url).catch(err => console.warn(`[SW] Failed to cache: ${url}`));
          })
        );
      })
  );
  // self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
// self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  
  // Bypass Service Worker for videos - required for mobile Safari range requests
  if (event.request.url.includes('.mp4')) return;
  
  // Use Network First strategy for the main logic files to prevent caching bugs
  if (event.request.url.includes('/js/app.js') || event.request.url.includes('style.css')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clonedResponse));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }

        return fetch(event.request).then(
          function(response) {
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            var responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(function(cache) {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        ).catch(() => {
          // Gracefully handle fetch failures for missing resources
          return new Response('Resource not found', { status: 404 });
        });
      })
  );
});
