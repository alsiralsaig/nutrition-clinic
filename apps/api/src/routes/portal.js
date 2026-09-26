// بوابة المريض (الويب الآن، وتطبيق Android/iPhone لاحقاً بنفس المسارات)
// الدخول: مسح QR (token) أو رقم الملف + الرمز. كل ما بعده مقصور على بيانات المريض نفسه.
import { Router } from 'express';
import { db, audit, getSettings } from '../db.js';
import { HttpError, badRequest, conflict, forbidden, notFound, wrap, todayISO, nowTimeHM, calcBMI, bmiCategory } from '../lib.js';
import { patientRequired, signPatientToken } from '../auth.js';
import {
  publicUrl, findAccess, habitSummary, upsertHabit, ACTIVITY_TYPES,
  addToWaitlist, listWaitlist, normalizeWaitlist, offerSlot, sweepOffers, acceptOffer, declineOffer, offersFor,
  callFor, postSignal, pullSignals, endCall, iceServers,
} from '../care.js';
import { withTotals } from './plans.js';
import { dayIndex } from '../nutrition.js';

export const router = Router();

// ---------- الدخول (عام) ----------
async function login(req, res, row) {
  const s = await getSettings();
  if (s['clinic.portal_enabled'] === false) throw forbidden('بوابة المرضى متوقفة حالياً — تواصل مع العيادة');
  if (!row) throw new HttpError(401, 'رمز الدخول غير صالح أو أُلغي — اطلب رمزاً جديداً من العيادة');
  if (row.patient_status === 'archived') throw forbidden('الملف مؤرشف — تواصل مع العيادة');
  const p = await db.get(`SELECT id, first_name, last_name, file_no FROM patients WHERE id=?`, row.patient_id);
  await audit({ userId: null, action: 'portal.login', entity: 'patients', entityId: p.id, detail: { via: req.path.endsWith('qr') ? 'qr' : 'code' } });
  res.json({ token: signPatientToken({ patientId: p.id, accessId: row.id }), patient: p, clinic: { name: s['clinic.name'], phone: s['clinic.phone'] } });
}
router.post('/auth/qr', wrap(async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw badRequest('رمز QR غير صالح');
  await login(req, res, await findAccess({ token }));
}));
router.post('/auth/code', wrap(async (req, res) => {
  const { file_no: fileNo, code } = req.body || {};
  if (!fileNo || !code) throw badRequest('رقم الملف والرمز مطلوبان');
  await login(req, res, await findAccess({ fileNo, code }));
}));

// ---------- تعريف العلامة (عام) — يقرؤه تطبيق المريض (PWA) ----------
router.get('/branding', wrap(async (req, res) => {
  const s = await getSettings();
  res.json({
    name: s['clinic.name'] || 'تطبيق المريض',
    phone: s['clinic.phone'] || '',
    address: s['clinic.address'] || '',
    logo: s['clinic.app_logo'] || '',
    banner: s['clinic.app_banner'] || '',
  });
}));

router.get('/manifest', wrap(async (req, res) => {
  const s = await getSettings();
  const name = s['clinic.name'] || 'تطبيق المريض';
  res.json({
    name: `${name} — تطبيق المريض`,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    description: `برنامجك الغذائي، متابعة الماء والنوم والنشاط، مواعيدك، وتواصل مع ${name}`,
    start_url: '/patient-app/index.html',
    scope: '/patient-app/',
    display: 'standalone',
    orientation: 'portrait',
    dir: 'rtl',
    lang: 'ar',
    background_color: '#47704c',
    theme_color: '#0e7c66',
    icons: [
      ...(s['clinic.app_logo'] ? [{ src: s['clinic.app_logo'], sizes: '512x512', type: 'image/png', purpose: 'any' }] : []),
      { src: '/patient-app/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/patient-app/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/patient-app/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
}));

// ---------- كل ما بعده للمريض المسجّل فقط ----------
router.use(patientRequired);
const me = (req) => req.patient.id;

router.get('/me', wrap(async (req, res) => {
  const id = me(req);
  await sweepOffers({ base: publicUrl(req) });
  const s = await getSettings();
  const p = await db.get(`SELECT id, file_no, first_name, last_name, gender, birth_date, height_cm, start_weight, goal_weight, goal, status, phone,
    water_target_ml, sleep_target_h, activity_target_min,
    chronic_conditions, allergies, medications, forbidden_foods, blood_type FROM patients WHERE id=?`, id);
  const meas = await db.all(`SELECT measured_on, weight_kg, waist_cm, hip_cm, body_fat_pct, height_cm FROM measurements WHERE patient_id=? ORDER BY measured_on, id`, id);
  const last = meas.at(-1);
  const bmi = last ? calcBMI(last.weight_kg, last.height_cm ?? p.height_cm) : null;
  const planRow = await db.get(`SELECT * FROM diet_plans WHERE patient_id=? AND status='active' ORDER BY id DESC LIMIT 1`, id);
  const plan = planRow ? withTotals(planRow, await db.all(`SELECT * FROM diet_meals WHERE plan_id=? ORDER BY day_of_week NULLS FIRST, position, id`, planRow.id)) : null;
  const today = todayISO();
  const appts = await db.all(`SELECT id, date, time, duration_min, visit_type, status, mode FROM appointments WHERE patient_id=? ORDER BY date DESC, time DESC LIMIT 30`, id);
  const upcoming = appts.filter((a) => a.date >= today && ['scheduled', 'confirmed'].includes(a.status)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const call = await db.get(`
    SELECT c.id, c.status, c.appointment_id, c.created_at, u.full_name AS doctor_name FROM call_sessions c
    LEFT JOIN users u ON u.id=c.started_by
    WHERE c.patient_id=? AND c.status<>'ended' ORDER BY c.id DESC LIMIT 1`, id);
  res.json({
    patient: p,
    clinic: { name: s['clinic.name'], phone: s['clinic.phone'], address: s['clinic.address'] },
    progress: {
      start_weight: meas[0]?.weight_kg ?? p.start_weight, current_weight: last?.weight_kg ?? p.start_weight, goal_weight: p.goal_weight,
      bmi, bmi_category: bmiCategory(bmi)?.label ?? null, last_measured: last?.measured_on ?? null,
      series: meas.map((m) => ({ date: m.measured_on, weight_kg: m.weight_kg, waist_cm: m.waist_cm, body_fat_pct: m.body_fat_pct })),
    },
    plan: plan && { id: plan.id, title: plan.title, target_kcal: plan.target_kcal, target_fiber_g: plan.target_fiber_g, target_water_ml: plan.target_water_ml, instructions: plan.instructions, totals: plan.totals, weekly: plan.weekly,
      meals: plan.meals.map((m) => ({ id: m.id, slot: m.slot, slot_time: m.slot_time, title: m.title, items: m.items, portions: m.portions, kcal: m.kcal, fiber_g: m.fiber_g, day_of_week: m.day_of_week })),
      today_index: dayIndex(today) },
    habits: await habitSummary(id, { days: 14, patient: p, weightKg: last?.weight_kg ?? null }),
    appointments: { upcoming, past: appts.filter((a) => !upcoming.includes(a)).slice(0, 10) },
    waitlist: await listWaitlist(`w.patient_id=? AND w.status='waiting'`, id),
    offers: await offersFor(`o.patient_id=? AND o.status='pending'`, id),
    call,
    activity_types: ACTIVITY_TYPES,
    now: { date: today, time: nowTimeHM() },
  });
}));

// ---------- العادات ----------
router.get('/habits', wrap(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 7), 90);
  res.json(await habitSummary(me(req), { days }));
}));
router.put('/habits/:date', wrap(async (req, res) => {
  const row = await upsertHabit({ patientId: me(req), date: String(req.params.date), body: req.body || {}, source: 'portal' });
  res.json({ log: row, summary: (await habitSummary(me(req), { days: 14 })).summary });
}));

// ---------- المواعيد ----------
router.post('/appointments/:id(\\d+)/cancel', wrap(async (req, res) => {
  const a = await db.get(`SELECT * FROM appointments WHERE id=? AND patient_id=?`, Number(req.params.id), me(req));
  if (!a) throw notFound('الموعد غير موجود');
  if (!['scheduled', 'confirmed'].includes(a.status)) throw conflict('لا يمكن إلغاء هذا الموعد');
  const hoursLeft = (new Date(`${a.date}T${a.time}:00Z`) - new Date(`${todayISO()}T${nowTimeHM()}:00Z`)) / 36e5;
  if (hoursLeft < 3) throw conflict('الإلغاء من البوابة متاح قبل الموعد بـ 3 ساعات على الأقل — اتصل بالعيادة');
  await db.run(`UPDATE appointments SET status='cancelled', notes=COALESCE(notes || ' · ', '') || 'ألغاه المريض من البوابة' WHERE id=?`, a.id);
  await audit({ userId: null, action: 'appointment.cancel_by_patient', entity: 'appointments', entityId: a.id });
  const wl = await offerSlot({ date: a.date, time: a.time, duration: a.duration_min, sourceAppointmentId: a.id, excludePatientId: a.patient_id, base: publicUrl(req) });
  res.json({ cancelled: true, waitlist: { offered: wl.offered } });
}));

// ---------- قائمة الانتظار ----------
router.post('/waitlist', wrap(async (req, res) => {
  const id = await addToWaitlist({ patientId: me(req), body: req.body || {}, source: 'portal' });
  res.status(201).json((await listWaitlist(`w.id=?`, id))[0]);
}));
router.put('/waitlist/:id(\\d+)', wrap(async (req, res) => {
  const w = await db.get(`SELECT * FROM waitlist WHERE id=? AND patient_id=? AND status='waiting'`, Number(req.params.id), me(req));
  if (!w) throw notFound('الطلب غير موجود');
  const d = normalizeWaitlist({ ...w, ...req.body });
  await db.run(`UPDATE waitlist SET date_from=@date_from, date_to=@date_to, days=@days, time_pref=@time_pref, visit_type=@visit_type, mode=@mode, note=@note,
    updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id=@id`, { ...d, id: w.id });
  res.json((await listWaitlist(`w.id=?`, w.id))[0]);
}));
router.delete('/waitlist/:id(\\d+)', wrap(async (req, res) => {
  const r = await db.run(`UPDATE waitlist SET status='cancelled', updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id=? AND patient_id=? AND status='waiting'`, Number(req.params.id), me(req));
  if (!r.changes) throw notFound('الطلب غير موجود');
  await db.run(`UPDATE waitlist_offers SET status='declined' WHERE waitlist_id=? AND status='pending'`, Number(req.params.id));
  res.json({ cancelled: true });
}));
router.post('/offers/:id(\\d+)/accept', wrap(async (req, res) => {
  res.json({ appointment: await acceptOffer({ offerId: Number(req.params.id), patientId: me(req) }) });
}));
router.post('/offers/:id(\\d+)/decline', wrap(async (req, res) => {
  res.json(await declineOffer({ offerId: Number(req.params.id), patientId: me(req), base: publicUrl(req) }));
}));

// ---------- الاستشارة المرئية ----------
router.get('/ice', wrap(async (req, res) => res.json({ ice_servers: iceServers() })));
router.get('/calls/active', wrap(async (req, res) => {
  const c = await db.get(`SELECT id FROM call_sessions WHERE patient_id=? AND status<>'ended' ORDER BY id DESC LIMIT 1`, me(req));
  res.json({ call: c ? await callFor(c.id, { patientId: me(req) }) : null, ice_servers: iceServers() });
}));
router.get('/calls/:id(\\d+)/signals', wrap(async (req, res) => {
  await callFor(Number(req.params.id), { patientId: me(req) });
  res.json(await pullSignals({ callId: Number(req.params.id), reader: 'patient', after: Number(req.query.after ?? 0) }));
}));
router.post('/calls/:id(\\d+)/signal', wrap(async (req, res) => {
  await callFor(Number(req.params.id), { patientId: me(req) });
  res.json(await postSignal({ callId: Number(req.params.id), sender: 'patient', kind: String(req.body?.kind || ''), payload: req.body?.payload }));
}));
router.post('/calls/:id(\\d+)/leave', wrap(async (req, res) => {
  await callFor(Number(req.params.id), { patientId: me(req) });
  // المريض يغادر فقط؛ إنهاء الجلسة بيد الأخصائي (قد يعود المريض بعد انقطاع)
  const id = await db.insert(`INSERT INTO call_signals (call_id, sender, kind) VALUES (?, 'patient', 'bye')`, Number(req.params.id));
  res.json({ left: true, id });
}));
