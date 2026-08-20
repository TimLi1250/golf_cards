const CACHE_NAME = "golf-app-shell-v5";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon", "/clubhouse-bgm.mp3", "/game-bgm.mp3", "/knock-bgm.mp3", "/game-win.mp3", "/game-lose.mp3"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match("/")));
});
