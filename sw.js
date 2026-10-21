/* 家账本 · Service Worker
 * 导航请求走网络优先，静态资源走缓存优先并在后台更新。
 * 仅在 HTTPS / localhost 下注册；file:// 打开时不会启用。
 */
'use strict';

const CACHE = 'family-ledger-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/store.js',
  './js/charts.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) {
          return caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function store(request, response) {
  if (!response || !response.ok || request.method !== 'GET') return;
  const copy = response.clone();
  caches.open(CACHE).then(function (cache) { return cache.put(request, copy); }).catch(function () {});
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          store(request, response);
          return response;
        })
        .catch(function () {
          return caches.match('./index.html').then(function (hit) {
            return hit || caches.match('./');
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      const network = fetch(request)
        .then(function (response) {
          store(request, response);
          return response;
        })
        .catch(function () { return cached; });
      return cached || network;
    })
  );
});
