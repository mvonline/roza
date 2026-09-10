const cacheName = "roza-v4";
const assets = ["/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request);
    }).catch(() => caches.match("/"))
  );
});
