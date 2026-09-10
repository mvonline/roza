const cacheName = "roza-v1";
const assets = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets))));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response.ok && new URL(event.request.url).origin === location.origin) {
          caches.open(cacheName).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      });
      return cached || network;
    }).catch(() => caches.match("/"))
  );
});
