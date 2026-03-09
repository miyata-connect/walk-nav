'use strict';

/**
 * WalkNav Offline - Service Worker
 * タイルとアプリシェルをキャッシュ
 */

const APP_CACHE  = 'walknav-app-v1';
const TILE_CACHE = 'walknav-tiles-v1';

// アプリシェル（オフライン時も動作させるファイル）
const APP_SHELL = [
  './offline.html',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'https://unpkg.com/pmtiles@3.2.0/dist/pmtiles.js',
];

// インストール時にアプリシェルをキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// 古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== APP_CACHE && k !== TILE_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// フェッチ戦略
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // タイルリクエスト → Cache First
  if (url.includes('tile.openstreetmap.org') || url.includes('.pbf') || url.includes('pmtiles')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(res => {
            if (res.ok || res.type === 'opaque') cache.put(event.request, res.clone());
            return res;
          }).catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // アプリシェル → Cache First
  if (APP_SHELL.some(s => url.includes(s) || url.endsWith('offline.html'))) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // その他（API等）→ Network First、失敗時キャッシュ
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
