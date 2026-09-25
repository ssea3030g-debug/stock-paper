// 아침증권신문 서비스 워커: 페이지는 네트워크 우선(오프라인이면 마지막으로 본 것), 아이콘은 캐시 우선
var CACHE = "paper-v2";
self.addEventListener("install", function (e) { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function (e) {
  var req = e.request;
  var u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.indexOf("/api/") === 0 || u.pathname === "/__login") return;   // 저장소·시세·로그인은 항상 네트워크로
  if (req.mode === "navigate" || req.destination === "document") {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) {   // 로그인 화면(401) 같은 응답은 오프라인용으로 남기지 않음
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || caches.match("./"); });
    }));
    return;
  }
  e.respondWith(caches.match(req).then(function (r) {
    return r || fetch(req).then(function (res) {
      if (res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  }));
});
