// تطبيق المريض كـ PWA: عامل الخدمة، التثبيت على الشاشة الرئيسية، والإشعارات (Web Push)
// كل الدوال آمنة في بيئات لا تدعم هذه الميزات (متصفحات قديمة، jsdom) — ترجع false/null بلا أخطاء.

let deferredPrompt = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* تجاهل */ } });

/** يُستدعى مبكراً في main.jsx قبل أول رسم (حدث beforeinstallprompt قد يصل سريعاً) */
export function initPwa() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; emit(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; emit(); });
  const sw = navigator.serviceWorker;
  if (!sw || !window.isSecureContext) return;
  // النقر على إشعار والتطبيق مفتوح: انتقل للصفحة المطلوبة
  sw.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && e.data.url) {
      const u = new URL(e.data.url);
      if (u.origin === location.origin) location.hash = u.hash || '#/portal';
    }
  });
  window.addEventListener('load', () => { sw.register('/sw.js').catch(() => {}); });
}

export const onPwaChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const canPromptInstall = () => !!deferredPrompt;
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const e = deferredPrompt;
  deferredPrompt = null; emit();
  e.prompt();
  const r = await e.userChoice.catch(() => null);
  return r?.outcome === 'accepted';
}

export function isStandalone() {
  try { return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; }
}
export function platform() {
  const ua = navigator.userAgent || '';
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || iPadOS) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/** يدعم هذا المتصفح الإشعارات الآن؟ (iPhone: فقط من التطبيق المثبّت، iOS 16.4+) */
export function pushSupported() {
  return typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export const pushPermission = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.register('/sw.js');
}
export async function currentSubscription() {
  try { const reg = await registration(); return reg ? await reg.pushManager.getSubscription() : null; } catch { return null; }
}

/** طلب الإذن ثم الاشتراك بمفتاح العيادة العام. يرجع كائن الاشتراك (JSON) أو يرمي رسالة مفهومة */
export async function subscribePush(publicKey) {
  if (!pushSupported()) throw new Error('متصفحك لا يدعم الإشعارات');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'الإشعارات محظورة لهذا الموقع — فعّلها من إعدادات المتصفح/الجوال' : 'لم تُمنح موافقة الإشعارات');
  await registration();
  const reg = await navigator.serviceWorker.ready;
  const key = b64ToBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // اشتراك قديم بمفتاح مختلف (تغيّر مفتاح العيادة) → نجدده
  const old = sub?.options?.applicationServerKey;
  if (sub && old && new Uint8Array(old).join() !== key.join()) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return sub.toJSON();
}
export async function unsubscribePush() {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  return endpoint;
}

/** عند خروج المريض: امسح نسخة بياناته المخزّنة للعرض دون اتصال */
export function notifyPortalLogout() {
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'portal-logout' }); } catch { /* تجاهل */ }
}
