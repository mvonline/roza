const cacheName = "roza-v2";
const assets = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const responseForCache = response.clone();
        if (response.ok) event.waitUntil(caches.open(cacheName).then((cache) => cache.put(event.request, responseForCache)));
        return response;
      });
    }).catch(() => caches.match("/"))
  );
});
