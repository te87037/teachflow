const CACHE = "teachflow-v21";
const ASSETS = ["./", "./index.html", "./styles.css", "./responsive.css", "./ocr.css", "./classes.css", "./app.js", "./db.js", "./engine.js", "./ocr.js", "./ocr-parser.js", "./remote.js", "./remote-config.js", "./manifest.webmanifest", "./icon.svg", "./vendor/pdf.mjs", "./vendor/pdf.worker.mjs"];
self.addEventListener("install", (event) => event.waitUntil(Promise.all([self.skipWaiting(), caches.open(CACHE).then((cache) => cache.addAll(ASSETS))])));
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))])));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((response) => response || caches.match("./index.html"))));
});
