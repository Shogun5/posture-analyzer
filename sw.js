// sw.js — Service worker：預先快取程式、Chart.js、MediaPipe WASM 與 heavy 模型 → 可離線使用
// 更新程式時：把 CACHE 版本號 +1（並同步 js/app.js 的 APP_VERSION），使用者下次開啟即取得新版。
const CACHE = 'posture-v1.0.2';
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

const LOCAL = [
  './', './index.html', './manifest.json', './css/style.css',
  './js/app.js', './js/i18n.js', './js/pose.js', './js/biomech.js', './js/filters.js', './js/posture.js',
  './js/overlay.js', './js/voice.js', './js/recorder.js', './js/storage.js', './js/charts.js', './js/export.js',
  './icons/icon-192.png', './icons/icon-512.png',
];
const REMOTE = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  `${MP}/vision_bundle.mjs`,
  `${MP}/wasm/vision_wasm_internal.js`, `${MP}/wasm/vision_wasm_internal.wasm`,
  `${MP}/wasm/vision_wasm_nosimd_internal.js`, `${MP}/wasm/vision_wasm_nosimd_internal.wasm`,
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(LOCAL);
    // 遠端檔案逐一快取；單一失敗不阻擋安裝（之後由 fetch 時再補快取）
    await Promise.all(REMOTE.map(u => c.add(new Request(u, { mode: 'cors' })).catch(err => console.warn('precache fail', u, err))));
    self.skipWaiting(); // 新版立即接手
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); // 刪除舊版快取
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isLocal = url.origin === location.origin;
  const isCDN = /cdn\.jsdelivr\.net|storage\.googleapis\.com/.test(url.host);
  if (!isLocal && !isCDN) return;
  if (isLocal) {
    // 本機程式：network-first（線上時拿最新，離線用快取）
    e.respondWith(fetch(req).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
  } else {
    // CDN（版本固定）：cache-first，未命中再抓並存入（lite/full 模型會在第一次使用時被快取）
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return res;
    })));
  }
});
