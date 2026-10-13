/* sw.js — 1% Battery Service Worker
 * 安装时预缓存全部应用外壳；运行时缓存优先，保证断网可用。
 */
const CACHE = 'one-percent-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/state.js',
  './js/bit.js',
  './js/huffman.js',
  './js/phrasebook.js',
  './js/protocol.js',
  './js/network.js',
  './js/energy.js',
  './js/bench.js',
  './js/ui/common.js',
  './js/ui/mission.js',
  './js/ui/lab.js',
  './js/ui/network-view.js',
  './js/ui/bench-view.js',
  './assets/icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // 运行时新发现的同源成功响应也缓存
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    }),
  );
});
