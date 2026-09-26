/* Service Worker — تطبيق المريض
   الواجهة تُخزَّن للعمل دون اتصال؛ بيانات الـ API لا تُخزَّن أبداً (الحساسية للتحديثات) */
const CACHE = "patient-app-v6";
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

// Cache each shell file independently. Cache.addAll() rejects the entire
// install if one request fails (for example, during a brief mobile-network
// interruption), leaving the patient PWA's worker uninstalled.
async function cacheShellFile(cache, path) {
  const url = new URL(path, self.registration.scope);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url.href, { cache: "reload", signal: controller.signal });
    if (response.ok && response.type !== "opaque") await cache.put(url.href, response);
  } catch {
    // The app remains usable online; a failed optional precache must not block install.
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map((path) => cacheShellFile(cache, path)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      // Do not remove the clinic/admin app's caches on the shared domain.
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith("patient-app-") && k !== CACHE)
        .map((k) => caches.delete(k))))
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
