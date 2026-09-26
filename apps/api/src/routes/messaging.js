// واتساب + التنبيهات + المهمة اليومية (تذكير المواعيد والتذكير اليومي بالخطة)
import { Router } from 'express';
import { db, getSetting, setSettings, audit } from '../db.js';
import { badRequest, notFound, str, wrap, todayISO, nowTimeHM, addDaysISO } from '../lib.js';
import { canWrite, adminOnly } from '../auth.js';
import { waStatus, sendMessage, appointmentText, dailyText, planText, templateFor, normalizePhone, waLink } from '../whatsapp.js';
import { dayIndex, buildShoppingList, shoppingListText } from '../nutrition.js';
import { sweepOffers, cleanupCalls, publicUrl } from '../care.js';
import { pushToPatient, dailyPushOn } from '../push.js';

export const router = Router();

const clinicInfo = async () => {
  const phone = await getSetting('clinic.phone', '');
  return { clinicName: await getSetting('clinic.name', 'العيادة'), clinicPhone: /000 000/.test(phone) ? '' : phone };
};
const getPatient = async (id) => {
  const p = await db.get(`SELECT * FROM patients WHERE id=?`, id);
  if (!p) throw notFound('المريض غير موجود');
  return p;
};
async function planWithMeals(planId) {
  const plan = await db.get(`SELECT * FROM diet_plans WHERE id=?`, planId);
  if (!plan) throw notFound('البرنامج الغذائي غير موجود');
  const meals = await db.all(`SELECT * FROM diet_meals WHERE plan_id=? ORDER BY day_of_week NULLS FIRST, position, id`, planId);
  return { plan, meals };
}
/** وجبات يوم معيّن: وجبات ذلك اليوم في الخطة الأسبوعية + وجبات «كل يوم» */
const mealsForDate = (meals, iso) => {
  const d = dayIndex(iso);
  return meals.filter((m) => m.day_of_week === null || m.day_of_week === d)
    .sort((a, b) => String(a.slot_time || '').localeCompare(String(b.slot_time || '')) || a.position - b.position);
};

/** يبني نص الرسالة (والقالب إن وُجد) لنوع معيّن */
async function compose({ kind, patient, refId, text, days }) {
  const { clinicName, clinicPhone } = await clinicInfo();
  if (kind === 'appointment_reminder') {
    const appt = await db.get(`SELECT * FROM appointments WHERE id=? AND patient_id=?`, refId, patient.id);
    if (!appt) throw badRequest('الموعد غير موجود لهذا المريض');
    const today = todayISO();
    const when = appt.date === today ? 'اليوم' : appt.date === addDaysISO(today, 1) ? 'غداً' : '';
    const tpl = templateFor(kind);
    return { text: appointmentText({ patient, appt, clinicName, clinicPhone, when }), template: tpl ? { name: tpl, params: [patient.first_name, appt.date, appt.time] } : null, appt };
  }
  if (kind === 'plan' || kind === 'shopping_list' || kind === 'daily_reminder') {
    const planId = refId || (await db.get(`SELECT id FROM diet_plans WHERE patient_id=? AND status='active' ORDER BY id DESC LIMIT 1`, patient.id))?.id;
    if (!planId) throw badRequest('لا توجد خطة غذائية نشطة لهذا المريض');
    const { plan, meals } = await planWithMeals(planId);
    if (plan.patient_id !== patient.id) throw badRequest('الخطة لا تخص هذا المريض');
    if (kind === 'plan') return { text: planText({ patient, plan, meals, clinicName }), refId: planId };
    if (kind === 'shopping_list') {
      const n = Math.max(1, Math.min(31, Number(days) || 7));
      const groups = buildShoppingList(meals, { days: n });
      return { text: shoppingListText({ patientName: `${patient.first_name} ${patient.last_name}`, planTitle: plan.title, days: n, groups, clinicName }), refId: planId };
    }
    const todays = mealsForDate(meals, todayISO());
    const tpl = templateFor(kind);
    const summary = todays.map((m) => m.title).join('، ').slice(0, 300);
    return { text: dailyText({ patient, meals: todays, clinicName }), template: tpl ? { name: tpl, params: [patient.first_name, summary || 'التزم بخطتك واشرب الماء'] } : null, refId: planId };
  }
  if (kind === 'custom') {
    const t = str(text, 4000);
    if (!t) throw badRequest('نص الرسالة مطلوب');
    return { text: t };
  }
  throw badRequest('نوع رسالة غير معروف');
}

// ---------- واتساب ----------
router.get('/whatsapp/status', wrap(async (req, res) => {
  const last = await db.get(`SELECT value FROM settings WHERE key='_cron_last_run'`);
  res.json({ ...waStatus(), country_code: await getSetting('clinic.country_code', '249'), cron_last_run: last?.value ? JSON.parse(last.value) : null });
}));

/**
 * إرسال (أو تجهيز) رسالة لمريض. إن كانت المفاتيح مضبوطة تُرسل آلياً،
 * وإلا ترجع status='link' مع رابط wa.me يفتحه المتصفح. preview=true: النص والرابط بلا تسجيل.
 */
router.post('/whatsapp/send', canWrite(), wrap(async (req, res) => {
  const b = req.body || {};
  const patient = await getPatient(Number(b.patient_id));
  const kind = String(b.kind || 'custom');
  const c = await compose({ kind, patient, refId: Number(b.ref_id) || null, text: b.text, days: b.days });
  const text = b.text && kind !== 'custom' ? str(b.text, 4000) : c.text; // يسمح بتعديل النص قبل الإرسال
  if (b.preview) {
    const to = normalizePhone(patient.phone, await getSetting('clinic.country_code', '249'));
    return res.json({ preview: true, text, to, link: to ? waLink(to, text) : null, ...waStatus() });
  }
  const r = await sendMessage({ patient, kind, text, template: b.text ? null : c.template, refId: c.refId ?? (Number(b.ref_id) || null), userId: req.user.id });
  if (kind === 'appointment_reminder' && (r.status === 'sent' || r.status === 'link') && c.appt) {
    await db.run(`UPDATE appointments SET reminded_at=to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id=?`, c.appt.id);
  }
  res.status(r.status === 'failed' ? 502 : 200).json({ ...r, text });
}));

router.post('/whatsapp/test', adminOnly(), wrap(async (req, res) => {
  const phone = str(req.body?.phone, 40);
  if (!phone) throw badRequest('رقم الهاتف مطلوب');
  const { clinicName } = await clinicInfo();
  const r = await sendMessage({ patient: { id: null, phone, first_name: '' }, kind: 'test', text: `رسالة تجريبية من ${clinicName} ✅ — الربط مع واتساب يعمل.`, userId: req.user.id });
  res.status(r.status === 'failed' ? 502 : 200).json(r);
}));

router.get('/whatsapp/log', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const pid = Number(req.query.patient_id) || null;
  const rows = await db.all(`
    SELECT ml.*, p.first_name, p.last_name, p.file_no FROM message_log ml
    LEFT JOIN patients p ON p.id = ml.patient_id
    ${pid ? 'WHERE ml.patient_id = ?' : ''}
    ORDER BY ml.id DESC LIMIT ${limit}`, ...(pid ? [pid] : []));
  res.json({ items: rows });
}));

// ---------- التنبيهات داخل النظام (تُحسب لحظياً) ----------
router.get('/notifications', wrap(async (req, res) => {
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);
  const now = nowTimeHM();
  const cc = await getSetting('clinic.country_code', '249');
  const { clinicName, clinicPhone } = await clinicInfo();
  const items = [];
  const appts = await db.all(`
    SELECT a.*, p.first_name, p.last_name, p.phone, p.file_no, p.reminders_opt_in FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    WHERE a.date IN (?, ?) AND a.status IN ('scheduled','confirmed') ORDER BY a.date, a.time`, today, tomorrow);
  const toMin = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
  for (const a of appts) {
    const name = `${a.first_name} ${a.last_name}`;
    const to = normalizePhone(a.phone, cc);
    const text = appointmentText({ patient: a, appt: a, clinicName, clinicPhone, when: a.date === today ? 'اليوم' : 'غداً' });
    if (a.date === today) {
      const diff = toMin(a.time) - toMin(now);
      if (diff >= -15 && diff <= 180) {
        items.push({ id: `appt-soon-${a.id}`, type: 'appointment_soon', level: diff <= 30 ? 'high' : 'info',
          title: diff <= 0 ? `موعد الآن: ${name}` : `موعد بعد ${diff < 60 ? `${diff} دقيقة` : `${Math.floor(diff / 60)} س ${diff % 60 ? `${diff % 60} د` : ''}`.trim()}`,
          body: `${name} · الساعة ${a.time}`, link: `/patients/${a.patient_id}`, at: `${a.date} ${a.time}`, minutes_to: diff,
          patient_id: a.patient_id, appointment_id: a.id });
      }
    }
    if (!a.reminded_at && a.reminders_opt_in !== 0) {
      items.push({ id: `appt-remind-${a.id}`, type: 'reminder_pending', level: 'warn',
        title: `تذكير لم يُرسل: ${name}`, body: `موعد ${a.date === today ? 'اليوم' : 'غداً'} الساعة ${a.time}${to ? '' : ' — لا يوجد رقم هاتف'}`,
        link: `/patients/${a.patient_id}`, at: `${a.date} ${a.time}`, patient_id: a.patient_id, appointment_id: a.id,
        wa_link: to ? waLink(to, text) : null });
    }
  }
  // مرضى نشطون لديهم خطة نشطة ولم يُزاروا منذ 30 يوماً ولا موعد قادم لهم
  const due = await db.all(`
    SELECT p.id, p.first_name, p.last_name, MAX(v.visit_date) AS last_visit FROM patients p
    JOIN diet_plans dp ON dp.patient_id = p.id AND dp.status = 'active'
    LEFT JOIN visits v ON v.patient_id = p.id
    WHERE p.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.date >= ? AND a.status IN ('scheduled','confirmed'))
    GROUP BY p.id, p.first_name, p.last_name
    HAVING MAX(v.visit_date) IS NULL OR MAX(v.visit_date) < ?
    ORDER BY MAX(v.visit_date) NULLS FIRST LIMIT 8`, today, addDaysISO(today, -30));
  for (const d of due) {
    items.push({ id: `followup-${d.id}-${d.last_visit || 'none'}`, type: 'followup_due', level: 'info',
      title: `متابعة متأخرة: ${d.first_name} ${d.last_name}`, body: d.last_visit ? `آخر زيارة ${d.last_visit} — احجز موعد متابعة` : 'لا زيارات مسجلة — احجز موعداً',
      link: `/patients/${d.id}`, patient_id: d.id });
  }
  const failed = await db.all(`
    SELECT ml.id, ml.kind, ml.error, ml.created_at, p.id AS patient_id, p.first_name, p.last_name FROM message_log ml
    LEFT JOIN patients p ON p.id = ml.patient_id
    WHERE ml.status = 'failed' AND ml.channel <> 'push' AND ml.created_at >= ? ORDER BY ml.id DESC LIMIT 5`, `${addDaysISO(today, -3)} 00:00:00`);
  for (const f of failed) {
    items.push({ id: `msg-failed-${f.id}`, type: 'message_failed', level: 'high', title: `فشل إرسال واتساب${f.first_name ? `: ${f.first_name} ${f.last_name}` : ''}`,
      body: f.error || 'خطأ غير معروف', link: f.patient_id ? `/patients/${f.patient_id}` : '/settings', at: f.created_at });
  }
  // المرحلة D: مريض ينتظر في مكالمة فيديو، حجوزات قائمة الانتظار، عروض معلّقة
  await sweepOffers({ base: publicUrl(req) });
  const waitingCalls = await db.all(`
    SELECT c.id, c.appointment_id, c.patient_id, p.first_name, p.last_name FROM call_sessions c JOIN patients p ON p.id=c.patient_id
    WHERE c.status<>'ended' AND c.patient_seen_at >= to_char((now() AT TIME ZONE 'UTC') - interval '20 seconds','YYYY-MM-DD HH24:MI:SS')
      AND (c.doctor_seen_at IS NULL OR c.doctor_seen_at < to_char((now() AT TIME ZONE 'UTC') - interval '20 seconds','YYYY-MM-DD HH24:MI:SS'))`);
  for (const c of waitingCalls) {
    items.push({ id: `call-wait-${c.id}`, type: 'call_waiting', level: 'high', title: `${c.first_name} ${c.last_name} بانتظارك في المكالمة المرئية`,
      body: 'افتح الموعد واضغط «بدء المكالمة»', link: `/appointments?call=${c.appointment_id}`, patient_id: c.patient_id, appointment_id: c.appointment_id });
  }
  const booked = await db.all(`
    SELECT o.id, o.slot_date, o.slot_time, o.patient_id, o.responded_at, p.first_name, p.last_name FROM waitlist_offers o JOIN patients p ON p.id=o.patient_id
    WHERE o.status='accepted' AND o.responded_at >= to_char((now() AT TIME ZONE 'UTC') - interval '24 hours','YYYY-MM-DD HH24:MI:SS') ORDER BY o.id DESC LIMIT 5`);
  for (const b of booked) {
    items.push({ id: `wl-booked-${b.id}`, type: 'waitlist_booked', level: 'info', title: `حُجز من قائمة الانتظار: ${b.first_name} ${b.last_name}`,
      body: `${b.slot_date} الساعة ${b.slot_time}`, link: `/patients/${b.patient_id}`, at: `${b.slot_date} ${b.slot_time}`, patient_id: b.patient_id });
  }
  const pendingOffers = (await db.get(`SELECT COUNT(DISTINCT slot_date || slot_time) AS n FROM waitlist_offers WHERE status='pending'`)).n;
  if (pendingOffers > 0) {
    items.push({ id: `wl-pending-${pendingOffers}`, type: 'waitlist_pending', level: 'info', title: `${pendingOffers} موعد شاغر معروض على قائمة الانتظار`,
      body: 'بانتظار تأكيد أحد المرضى — أول من يقبل يحجز', link: '/appointments?waitlist=1' });
  }

  const rank = { high: 0, warn: 1, info: 2 };
  items.sort((a, b) => rank[a.level] - rank[b.level] || String(a.at || '').localeCompare(String(b.at || '')));
  res.json({ now: `${today} ${now}`, today_count: appts.filter((a) => a.date === today).length, tomorrow_count: appts.filter((a) => a.date === tomorrow).length, items });
}));

// ---------- المهمة اليومية ----------
/** يرسل تذكيرات مواعيد اليوم وغداً (مرة واحدة لكل موعد) + التذكير اليومي بالخطة للمشتركين */
export async function runDailyJob({ userId = null, source = 'cron' } = {}) {
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);
  const out = { date: today, source, appointment_reminders: { sent: 0, link: 0, failed: 0, skipped: 0 }, daily_reminders: { sent: 0, link: 0, failed: 0, skipped: 0 } };
  const remindersOn = (await getSetting('clinic.reminders_enabled', true)) !== false;
  const dailyOn = (await getSetting('clinic.daily_reminder_enabled', true)) !== false;
  if (remindersOn) {
    const appts = await db.all(`
      SELECT a.id, a.patient_id FROM appointments a JOIN patients p ON p.id = a.patient_id
      WHERE a.date IN (?, ?) AND a.status IN ('scheduled','confirmed') AND a.reminded_at IS NULL
        AND p.reminders_opt_in <> 0 AND p.status <> 'archived'
      ORDER BY a.date, a.time LIMIT 200`, today, tomorrow);
    for (const a of appts) {
      const patient = await getPatient(a.patient_id);
      const c = await compose({ kind: 'appointment_reminder', patient, refId: a.id });
      const r = await sendMessage({ patient, kind: 'appointment_reminder', text: c.text, template: c.template, refId: a.id, userId });
      out.appointment_reminders[r.status] += 1;
      // «link» لا يُعلَّم كمُرسل: يبقى ظاهراً في التنبيهات ليرسله الموظف بضغطة
      if (r.status === 'sent') await db.run(`UPDATE appointments SET reminded_at=to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id=?`, a.id);
    }
  }
  if (dailyOn && waStatus().configured) {
    const pts = await db.all(`
      SELECT DISTINCT p.id FROM patients p JOIN diet_plans dp ON dp.patient_id = p.id AND dp.status = 'active'
      WHERE p.daily_reminder = 1 AND p.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM message_log ml WHERE ml.patient_id = p.id AND ml.kind = 'daily_reminder' AND ml.channel = 'whatsapp'
                        AND ml.status = 'sent' AND ml.created_at >= ?)
      LIMIT 300`, `${today} 00:00:00`);
    for (const { id } of pts) {
      const patient = await getPatient(id);
      try {
        const c = await compose({ kind: 'daily_reminder', patient });
        const r = await sendMessage({ patient, kind: 'daily_reminder', text: c.text, template: c.template, refId: c.refId, userId });
        out.daily_reminders[r.status] += 1;
      } catch { out.daily_reminders.skipped += 1; }
    }
  }
  try { out.push = await dailyPush({ today, tomorrow, userId }); } catch (e) { out.push = { error: e.message }; }
  try { out.waitlist = await sweepOffers({ base: publicUrl(null) }); } catch (e) { out.waitlist = { error: e.message }; }
  try { out.calls = await cleanupCalls(); } catch (e) { out.calls = { error: e.message }; }
  out.finished_at = new Date().toISOString();
  await setSettings({ _cron_last_run: out });
  return out;
}

/**
 * إشعارات تطبيق المريض الصباحية (لمن فعّلها فقط، مجانية بلا واتساب):
 *  1) تذكير بموعد اليوم/الغد — مرة واحدة لكل موعد في اليوم
 *  2) وإلا: تحفيز صباحي بأهداف الخطة المعتمدة (السعرات والماء) — مرة واحدة يومياً
 */
/** تنفيذ متوازٍ محدود (المهمة اليومية محدودة بـ 30 ثانية على Vercel) */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function dailyPush({ today, tomorrow, userId }) {
  const out = { reminders: 0, daily: 0, failed: 0 };
  if (!(await dailyPushOn())) return { ...out, disabled: true };
  const since = `${today} 00:00:00`;
  const reminded = new Set();
  const appts = await db.all(`
    SELECT a.id, a.patient_id, a.date, a.time, a.mode FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.date IN (?, ?) AND a.status IN ('scheduled','confirmed') AND p.status <> 'archived'
      AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.patient_id = a.patient_id)
      AND NOT EXISTS (SELECT 1 FROM message_log ml WHERE ml.channel = 'push' AND ml.kind = 'push_reminder' AND ml.ref_id = a.id
                      AND ml.status = 'sent' AND ml.created_at >= ?)
    ORDER BY a.date, a.time LIMIT 300`, today, tomorrow, since);
  await pool(appts, 8, async (a) => {
    const when = a.date === today ? 'اليوم' : 'غداً';
    const r = await pushToPatient(a.patient_id, {
      title: `⏰ تذكير: موعدك ${when} الساعة ${a.time}`, body: a.mode === 'video' ? 'استشارة مرئية — افتح التطبيق قبل الموعد بدقائق' : 'نراك في العيادة — لا تنسَ الحضور قبل الموعد بقليل',
      url: '/#/portal/appointments', kind: 'push_reminder', tag: `rem-${a.id}`, refId: a.id, userId,
    });
    if (r.sent) { out.reminders += 1; reminded.add(a.patient_id); } else if (r.failed) out.failed += 1;
  });
  const pts = await db.all(`
    SELECT p.id, p.first_name, p.water_target_ml, dp.target_kcal, dp.target_water_ml, dp.id AS plan_id FROM patients p
    JOIN diet_plans dp ON dp.id = (SELECT MAX(id) FROM diet_plans WHERE patient_id = p.id AND status = 'active')
    WHERE p.status = 'active' AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.patient_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM message_log ml WHERE ml.patient_id = p.id AND ml.channel = 'push' AND ml.kind = 'push_daily'
                      AND ml.status = 'sent' AND ml.created_at >= ?)
    LIMIT 300`, since);
  await pool(pts, 8, async (p) => {
    if (reminded.has(p.id)) return; // إشعار واحد صباحاً يكفي
    const water = p.target_water_ml || p.water_target_ml;
    const goals = [p.target_kcal ? `${Math.round(p.target_kcal)} سعرة` : null, water ? `${+(water / 1000).toFixed(1)} لتر ماء` : null].filter(Boolean).join(' · ');
    const r = await pushToPatient(p.id, {
      title: `صباح الخير ${p.first_name} 🌿`, body: goals ? `هدفك اليوم: ${goals}. سجّل ماءك ونشاطك في التطبيق.` : 'افتح خطتك لليوم وسجّل ماءك ونشاطك.',
      url: '/#/portal', kind: 'push_daily', tag: 'daily', refId: p.plan_id, userId,
    });
    if (r.sent) out.daily += 1; else if (r.failed) out.failed += 1;
  });
  return out;
}

/** تشغيل يدوي من الإعدادات (المدير) */
router.post('/cron/daily/run', adminOnly(), wrap(async (req, res) => {
  const r = await runDailyJob({ userId: req.user.id, source: 'manual' });
  await audit({ userId: req.user.id, action: 'cron.daily.manual', entity: 'message_log', detail: r });
  res.json(r);
}));
