'use strict';

const APP_CACHE  = 'walknav-app-v3';  // バージョンを上げて古いキャッシュを強制削除
const TILE_CACHE = 'walknav-tiles-v1';

const APP_SHELL = [
  './offline.html',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// v1/v2 の古いキャッシュを全削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== APP_CACHE && k !== TILE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // タイル → Cache First
  if (url.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(res => {
            if (res.ok || res.type === 'opaque') cache.put(event.request, res.clone());
            return res;
          }).catch(() => new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // offline.html → Network First（常に最新を取得）
  if (url.endsWith('offline.html')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          caches.open(APP_CACHE).then(c => c.put(event.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // その他 → Network First
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
