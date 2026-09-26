/* عامل خدمة تطبيق المريض: تثبيت · عمل دون اتصال · إشعارات
 * - التنقل: الشبكة أولاً، وعند انقطاعها الصفحة المخزّنة
 * - ملفات الواجهة (/assets/* بأسماء مُجزّأة): المخزّن أولاً
 * - /api/portal/me: الشبكة أولاً مع نسخة احتياطية لعرض الخطة والمواعيد دون إنترنت
 * - بقية /api لا تُخزَّن أبداً (بيانات الموظفين لا تُحفظ على الجهاز)
 */
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DATA = 'portal-data';
const PRECACHE = ['/', '/index.html', '/app.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'portal-logout') e.waitUntil(caches.delete(DATA));
  if (e.data?.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(SHELL); c.put('/index.html', res.clone()); }
        return res;
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
      return res;
    })());
    return;
  }

  if (url.pathname === '/api/portal/me') {
    e.respondWith((async () => {
      const key = '/api/portal/me';
      try {
        const res = await fetch(req);
        const c = await caches.open(DATA);
        if (res.ok) c.put(key, res.clone());
        else if (res.status === 401) c.delete(key);
        return res;
      } catch {
        const hit = await caches.match(key, { cacheName: DATA });
        if (!hit) throw new Error('offline');
        const h = new Headers(hit.headers); h.set('X-Offline', '1');
        return new Response(await hit.blob(), { status: 200, headers: h });
      }
    })());
  }
});

// ---------------------------------------------------------------- الإشعارات
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  const title = d.title || 'عيادة التغذية';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: 'https://gzkuoczegwcszdoqisjn.supabase.co/storage/v1/object/public/bucket/icon-192.png',
    badge: 'https://gzkuoczegwcszdoqisjn.supabase.co/storage/v1/object/public/bucket/favicon-64.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: d.kind === 'video_call',
    vibrate: d.kind === 'video_call' ? [300, 150, 300, 150, 300] : [120, 60, 120],
    dir: 'rtl',
    lang: 'ar',
    data: { url: d.url || '/#/portal' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/#/portal', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        w.postMessage({ type: 'navigate', url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
