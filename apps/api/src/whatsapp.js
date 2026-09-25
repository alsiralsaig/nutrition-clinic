// ============================================================
//  واتساب: إرسال تلقائي عبر WhatsApp Cloud API (Meta) إن ضُبطت المفاتيح،
//  وإلا رابط wa.me جاهز يفتح المحادثة والرسالة مكتوبة (إرسال بضغطة من الموظف).
//
//  متغيرات البيئة (Vercel → Settings → Environment Variables):
//    WHATSAPP_TOKEN            رمز الوصول الدائم (System User token) من Meta Business
//    WHATSAPP_PHONE_ID         Phone number ID من WhatsApp → API Setup
//    WHATSAPP_TEMPLATE_APPT    (اختياري) اسم قالب معتمد لتذكير الموعد: {{1}} الاسم، {{2}} التاريخ، {{3}} الوقت
//    WHATSAPP_TEMPLATE_DAILY   (اختياري) اسم قالب معتمد للتذكير اليومي: {{1}} الاسم، {{2}} نص قصير
//    WHATSAPP_TEMPLATE_LANG    لغة القوالب (افتراضي ar)
//    WHATSAPP_DRY_RUN=1        لا يتصل بـ Meta (اختبار): يسجّل الرسالة كأنها أُرسلت
//  ملاحظة Meta: الرسائل التي تبدأها العيادة خارج نافذة 24 ساعة تتطلب «قالباً معتمداً».
// ============================================================
import { db, getSetting } from './db.js';

const env = () => ({
  token: process.env.WHATSAPP_TOKEN || '',
  phoneId: process.env.WHATSAPP_PHONE_ID || '',
  version: process.env.WHATSAPP_API_VERSION || 'v21.0',
  base: process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com',
  tplAppt: process.env.WHATSAPP_TEMPLATE_APPT || '',
  tplDaily: process.env.WHATSAPP_TEMPLATE_DAILY || '',
  tplLang: process.env.WHATSAPP_TEMPLATE_LANG || 'ar',
  dryRun: process.env.WHATSAPP_DRY_RUN === '1',
});

export function waStatus() {
  const e = env();
  return {
    configured: !!(e.token && e.phoneId) || e.dryRun,
    provider: e.dryRun ? 'dry-run' : (e.token && e.phoneId ? 'whatsapp-cloud-api' : 'link'),
    phone_id: e.phoneId ? `…${e.phoneId.slice(-4)}` : null,
    templates: { appointment: e.tplAppt || null, daily: e.tplDaily || null, lang: e.tplLang },
    dry_run: e.dryRun,
  };
}

/** يحوّل رقماً محلياً إلى صيغة دولية بلا «+» (مثال السودان: 0912345678 → 249912345678) */
export function normalizePhone(phone, countryCode = '249') {
  let d = String(phone || '').replace(/[٠-٩]/g, (x) => '٠١٢٣٤٥٦٧٨٩'.indexOf(x)).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = countryCode + d.slice(1);
  else if (d.length <= 9) d = countryCode + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export const waLink = (phoneDigits, text) =>
  `https://wa.me/${phoneDigits || ''}?text=${encodeURIComponent(text)}`;

/** إرسال فعلي عبر Cloud API. يرجع { ok, id?, error? } ولا يرمي أبداً */
async function cloudSend(to, payload) {
  const e = env();
  if (e.dryRun) return { ok: true, id: `dry-run-${Date.now()}` };
  try {
    const r = await fetch(`${e.base}/${e.version}/${e.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${e.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j?.error?.message || `HTTP ${r.status}` };
    return { ok: true, id: j?.messages?.[0]?.id || null };
  } catch (err) {
    return { ok: false, error: err?.name === 'TimeoutError' ? 'انتهت مهلة الاتصال بواتساب' : String(err?.message || err) };
  }
}

/**
 * يرسل رسالة لمريض ويسجلها في message_log.
 * template: { name, params: [...] } يُستعمل إن وُجد (مطلوب من Meta للرسائل المبادَرة)، وإلا نص عادي.
 * إن لم تُضبط المفاتيح: status = 'link' مع رابط wa.me للإرسال اليدوي.
 */
export async function sendMessage({ patient, kind, text, template, refId = null, userId = null }) {
  const cc = await getSetting('clinic.country_code', '249');
  const to = normalizePhone(patient?.phone, cc);
  const link = to ? waLink(to, text) : null;
  const e = env();
  let status; let providerId = null; let error = null;
  if (!to) { status = 'skipped'; error = 'لا يوجد رقم هاتف صالح للمريض'; }
  else if (!waStatus().configured) { status = 'link'; }
  else {
    const payload = template?.name
      ? { type: 'template', template: { name: template.name, language: { code: e.tplLang }, components: [{ type: 'body', parameters: template.params.map((p) => ({ type: 'text', text: String(p ?? '').slice(0, 1000) })) }] } }
      : { type: 'text', text: { preview_url: false, body: text.slice(0, 4096) } };
    const r = await cloudSend(to, payload);
    status = r.ok ? 'sent' : 'failed';
    providerId = r.id || null;
    error = r.error || null;
  }
  const id = await db.insert(`
    INSERT INTO message_log (patient_id, kind, to_phone, body, status, provider_id, error, ref_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  patient?.id ?? null, kind, to, text, status, providerId, error, refId, userId);
  return { id, status, to, link, provider_id: providerId, error };
}

// ---------- صياغة الرسائل ----------
const DAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const dayName = (iso) => DAY_AR[new Date(`${iso}T12:00:00Z`).getUTCDay()];

export function appointmentText({ patient, appt, clinicName, clinicPhone, when = '' }) {
  return [
    `مرحباً ${patient.first_name} 🌿`,
    `نذكّرك بموعدك ${when ? `${when} ` : ''}في ${clinicName}:`,
    `📅 ${dayName(appt.date)} ${appt.date}`,
    `⏰ الساعة ${appt.time}`,
    'يُرجى الحضور قبل الموعد بـ10 دقائق، ولا تنسَ الوزن صباحاً على الريق إن أمكن.',
    clinicPhone ? `للتأجيل أو الإلغاء: ${clinicPhone}` : 'للتأجيل أو الإلغاء يُرجى الرد على هذه الرسالة.',
  ].join('\n');
}

export function dailyText({ patient, meals, clinicName }) {
  const lines = [`صباح الخير ${patient.first_name} ☀️`, 'خطة اليوم:'];
  for (const m of meals) lines.push(`• ${m.slot}${m.slot_time ? ` (${m.slot_time})` : ''}: ${m.title}`);
  lines.push('', '💧 لا تنسَ 8 أكواب ماء على الأقل.', `بالتوفيق — ${clinicName}`);
  return lines.join('\n');
}

export function planText({ patient, plan, meals, clinicName }) {
  const out = [`🥗 *${plan.title}* — ${patient.first_name} ${patient.last_name}`];
  if (plan.target_kcal) out.push(`السعرات اليومية: ${Math.round(plan.target_kcal)} سعرة`);
  const DAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  const weekly = meals.some((m) => m.day_of_week !== null && m.day_of_week !== undefined);
  let lastDay = -2;
  for (const m of meals) {
    if (weekly && m.day_of_week !== lastDay) {
      out.push('', `*${m.day_of_week == null ? 'كل يوم' : DAYS[m.day_of_week]}*`);
      lastDay = m.day_of_week;
    } else if (!weekly && lastDay === -2) { out.push(''); lastDay = -1; }
    out.push(`• ${m.slot}: ${m.title}${m.kcal ? ` (${Math.round(m.kcal)} سعرة)` : ''}`);
  }
  if (plan.advice) out.push('', '📝 ' + plan.advice.split('\n').slice(0, 4).join('\n'));
  out.push('', `— ${clinicName}`);
  return out.join('\n');
}

export const templateFor = (kind) => {
  const e = env();
  if (kind === 'appointment_reminder' && e.tplAppt) return e.tplAppt;
  if (kind === 'daily_reminder' && e.tplDaily) return e.tplDaily;
  return null;
};
