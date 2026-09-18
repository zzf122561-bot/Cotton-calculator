const CACHE_PREFIX = "cottoncal-pwa-";
const CACHE_NAME = "cottoncal-pwa-v1-20260906-8";

// PRECACHE_START
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/calculator.js",
  "./js/decimal.js",
  "./js/storage.js",
  "./js/theme.js",
  "./js/inquiry.js",
  "./assets/cotton-boll.png",
  "./assets/author_wechat_qr.jpg",
  "./assets/guide/step-1-preset.png",
  "./assets/guide/step-2-price.png",
  "./assets/guide/step-3-details.png",
  "./assets/guide/step-4-inquiry.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];
// PRECACHE_END

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request)),
  );
});
