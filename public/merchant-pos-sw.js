var SHELL = [
  "/merchant-preview",
  "/merchant-preview.html",
  "/assets/merchant-preview.css?pfv=20260923pos6",
  "/assets/merchant-pos.js?pfv=20260923pos6",
  "/assets/merchant-preview.js?pfv=20260923pos1",
  "/merchant-pos.webmanifest"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open("ervenow-pos-shell-v1").then(function (cache) {
    return cache.addAll(SHELL).catch(function () {});
  }));
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0 || url.pathname.indexOf("/socket.io") === 0) return;
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && SHELL.indexOf(url.pathname + url.search) !== -1) {
        var copy = res.clone();
        caches.open("ervenow-pos-shell-v1").then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        return cached || caches.match("/merchant-preview");
      });
    })
  );
});
