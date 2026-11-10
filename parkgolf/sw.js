// 오프라인에서도 앱 화면이 열리도록 기본 파일을 저장해 둠 (날씨·검색은 인터넷 필요)
const CACHE = 'parkgolf-v2';
const FILES = ['./', './index.html', './style.css', './app.js', './analysis.js', './weather.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // 날씨·지도는 항상 인터넷에서
  // 앱 파일은 새 버전을 먼저 받아 보고, 안 되면 저장본 사용
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
