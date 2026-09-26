/* Service Worker — تطبيق المريض
   الواجهة تُخزَّن للعمل دون اتصال؛ بيانات الـ API لا تُخزَّن أبداً (الحساسية للتحديثات) */
const CACHE = "patient-app-v5";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./images/banner.jpg",
  "./images/brand-band.jpg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  /* كل طلبات الـ API تمر مباشرة (بدون تخزين) */
  if (url.pathname.startsWith("/api/")) return;

  e.respondWith(
    caches.match(e.request).then(
      (r) =>
        r ||
        fetch(e.request).then((r) => {
          const cp = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, cp));
          return r;
        })
    )
  );
});
