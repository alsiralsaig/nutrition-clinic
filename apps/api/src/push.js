// إشعارات تطبيق المريض (Web Push — يعمل على Android، وعلى iPhone بعد تثبيت التطبيق على الشاشة الرئيسية، iOS 16.4+)
//
// مفاتيح VAPID: من متغيرات البيئة VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY إن وُجدت،
// وإلا تُولَّد مرة واحدة وتُحفظ في جدول الإعدادات (مفتاح مخفي «_vapid») — فلا يحتاج صاحب العيادة أي إعداد.
// الإرسال: نجهّز الطلب المشفّر بـ web-push (generateRequestDetails) ونرسله بـ fetch — نفس التشفير الرسمي،
// مع إمكانية اختباره على خادم محلي. PUSH_DRY_RUN=1 يسجّل دون إرسال (للاختبارات).
import webpush from 'web-push';
import { db, getSetting } from './db.js';
import { str } from './lib.js';

const SUBJECT = () => process.env.VAPID_SUBJECT || 'mailto:admin@nutrition-clinic.app';
let cached = null;

/** مفاتيح VAPID (تُنشأ وتُحفظ تلقائياً عند أول استعمال — آمنة مع عدة حاويات تقلع معاً) */
export async function vapidKeys() {
  if (cached) return cached;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cached = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, source: 'env' };
    return cached;
  }
  let row = await db.get(`SELECT value FROM settings WHERE key='_vapid'`);
  if (!row) {
    const k = webpush.generateVAPIDKeys();
    await db.run(`INSERT INTO settings (key, value) VALUES ('_vapid', ?) ON CONFLICT (key) DO NOTHING`, JSON.stringify(k));
    row = await db.get(`SELECT value FROM settings WHERE key='_vapid'`); // الفائز في السباق هو المعتمد
  }
  const v = JSON.parse(row.value);
  cached = { publicKey: v.publicKey, privateKey: v.privateKey, source: 'db' };
  return cached;
}

export async function pushStatus() {
  const k = await vapidKeys();
  const r = await db.get(`SELECT COUNT(*)::int AS devices, COUNT(DISTINCT patient_id)::int AS patients FROM push_subscriptions`);
  return { enabled: true, keys: k.source, devices: r?.devices ?? 0, patients: r?.patients ?? 0, dry_run: process.env.PUSH_DRY_RUN === '1' };
}

// ---------------------------------------------------------------- الاشتراكات
function cleanSub(sub) {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  if (!/^https?:\/\/[^\s]{8,}$/.test(endpoint) || endpoint.length > 1000) return null;
  if (!/^[A-Za-z0-9_\-=+/]{40,200}$/.test(p256dh) || !/^[A-Za-z0-9_\-=+/]{8,64}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

export async function subscribe({ patientId, subscription, userAgent, platform: hint }) {
  const s = cleanSub(subscription);
  if (!s) return null;
  // من ترويسة المتصفح، وإن لم تُعرف نأخذ ما يرسله التطبيق (ios/android)
  let platform = platformOf(userAgent);
  if (platform === 'other' && ['ios', 'android'].includes(hint)) platform = hint;
  // نفس الجهاز لمريض آخر (تسجيل دخول مختلف) → ينتقل الاشتراك للمريض الحالي
  await db.run(`
    INSERT INTO push_subscriptions (patient_id, endpoint, p256dh, auth, platform, user_agent)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT (endpoint) DO UPDATE SET patient_id=EXCLUDED.patient_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth,
      platform=EXCLUDED.platform, user_agent=EXCLUDED.user_agent, failures=0,
      updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`,
  patientId, s.endpoint, s.p256dh, s.auth, platform, str(userAgent, 300));
  return devicesFor(patientId);
}

export async function unsubscribe({ patientId, endpoint }) {
  await db.run(`DELETE FROM push_subscriptions WHERE patient_id=? AND endpoint=?`, patientId, String(endpoint || ''));
  return devicesFor(patientId);
}

export async function devicesFor(patientId) {
  return db.all(`SELECT id, platform, created_at, last_success_at, failures FROM push_subscriptions WHERE patient_id=? ORDER BY id`, patientId);
}

function platformOf(ua = '') {
  const u = String(ua);
  if (/iPhone|iPad|iPod/i.test(u)) return 'ios';
  if (/Android/i.test(u)) return 'android';
  if (/Mac OS X/i.test(u)) return 'mac';
  if (/Windows/i.test(u)) return 'windows';
  return 'other';
}

// ---------------------------------------------------------------- الإرسال
/**
 * يرسل إشعاراً لكل أجهزة المريض. لا يرمي أخطاء (الإشعار إضافة، لا يُفشل العملية الأصلية).
 * urgency: high للمكالمات. الاشتراكات المنتهية (404/410) تُحذف تلقائياً.
 */
export async function pushToPatient(patientId, { title, body, url = '/#/portal', tag, kind = 'custom', refId = null, userId = null, urgency = 'normal', ttl = 24 * 3600 } = {}) {
  const out = { sent: 0, failed: 0, removed: 0, devices: 0 };
  try {
    const subs = await db.all(`SELECT * FROM push_subscriptions WHERE patient_id=?`, patientId);
    out.devices = subs.length;
    if (!subs.length) return out;
    const k = await vapidKeys();
    const payload = JSON.stringify({ title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 400), url, tag: tag || kind, kind });
    for (const sub of subs) {
      let status = 0; let error = null;
      try {
        const d = webpush.generateRequestDetails(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload,
          { vapidDetails: { subject: SUBJECT(), publicKey: k.publicKey, privateKey: k.privateKey }, TTL: ttl, urgency },
        );
        if (process.env.PUSH_DRY_RUN === '1') {
          status = /\/gone\b/.test(sub.endpoint) ? 410 : 201;
        } else {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 8000);
          try {
            const r = await fetch(d.endpoint, { method: d.method, headers: d.headers, body: d.body, signal: ctl.signal });
            status = r.status;
            if (status >= 400) error = (await r.text().catch(() => '')).slice(0, 300) || `HTTP ${status}`;
          } finally { clearTimeout(t); }
        }
      } catch (e) { error = e.message; }
      if (status >= 200 && status < 300) {
        out.sent += 1;
        await db.run(`UPDATE push_subscriptions SET last_success_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'), failures=0 WHERE id=?`, sub.id);
      } else if (status === 404 || status === 410) {
        out.removed += 1;
        await db.run(`DELETE FROM push_subscriptions WHERE id=?`, sub.id);
      } else {
        out.failed += 1;
        await db.run(`UPDATE push_subscriptions SET failures=failures+1 WHERE id=?`, sub.id);
        await db.run(`DELETE FROM push_subscriptions WHERE id=? AND failures >= 10`, sub.id); // جهاز معطّل دائماً
        out.error = error;
      }
    }
    const status = out.sent ? 'sent' : (out.failed ? 'failed' : 'skipped');
    await db.run(`
      INSERT INTO message_log (patient_id, channel, kind, body, status, error, ref_id, created_by)
      VALUES (?, 'push', ?, ?, ?, ?, ?, ?)`,
    patientId, kind, `${title}\n${body}`, status, out.error || (out.removed && !out.sent ? 'انتهى اشتراك الجهاز' : null), refId, userId);
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

/** هل الإشعارات اليومية مفعّلة في إعدادات العيادة */
export async function dailyPushOn() {
  return (await getSetting('clinic.push_daily', true)) !== false;
}
