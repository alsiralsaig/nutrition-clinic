// مسارات العيادة للمرحلة D: عادات المريض، رمز QR للبوابة، قائمة الانتظار، الاستشارات المرئية
import { Router } from 'express';
import { db, audit } from '../db.js';
import { badRequest, notFound, wrap, isDate, isTime, toNum } from '../lib.js';
import { canWrite } from '../auth.js';
import {
  publicUrl, portalLink, issueAccess, accessStatus, revokeAccess,
  habitSummary, upsertHabit,
  addToWaitlist, listWaitlist, normalizeWaitlist, offerSlot, sweepOffers, acceptOffer, declineOffer, offersFor,
  startCall, callFor, postSignal, pullSignals, endCall, iceServers,
} from '../care.js';
import { sendMessage } from '../whatsapp.js';
import { pushToPatient, devicesFor, pushStatus } from '../push.js';
import { str } from '../lib.js';

export const router = Router();
const pid = (req) => Number(req.params.id);
async function mustPatient(id) {
  const p = await db.get(`SELECT * FROM patients WHERE id=?`, id);
  if (!p) throw notFound('المريض غير موجود');
  return p;
}
const lastWeight = async (id) => (await db.get(`SELECT weight_kg FROM measurements WHERE patient_id=? ORDER BY measured_on DESC, id DESC LIMIT 1`, id))?.weight_kg ?? null;

// ---------- العادات اليومية (مرآة سجلات البوابة في الملف السريري) ----------
router.get('/patients/:id(\\d+)/habits', wrap(async (req, res) => {
  const p = await mustPatient(pid(req));
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
  res.json(await habitSummary(p.id, { days, patient: p, weightKg: await lastWeight(p.id) }));
}));

router.put('/patients/:id(\\d+)/habits/:date', canWrite(), wrap(async (req, res) => {
  const p = await mustPatient(pid(req));
  const row = await upsertHabit({ patientId: p.id, date: String(req.params.date), body: req.body || {}, source: 'clinic' });
  await audit({ userId: req.user.id, action: 'habit.log', entity: 'habit_logs', entityId: row.id });
  res.json(row);
}));

router.put('/patients/:id(\\d+)/habit-targets', canWrite(), wrap(async (req, res) => {
  const p = await mustPatient(pid(req));
  const b = req.body || {};
  const v = (x, min, max) => {
    if (x === null || x === '' || x === undefined) return null;
    const n = toNum(x);
    if (n === null || n < min || n > max) throw badRequest(`قيمة الهدف خارج النطاق (${min}–${max})`);
    return n;
  };
  await db.run(`UPDATE patients SET water_target_ml=?, sleep_target_h=?, activity_target_min=? WHERE id=?`,
    v(b.water_ml, 500, 6000), v(b.sleep_hours, 4, 12), v(b.activity_min, 0, 300), p.id);
  await audit({ userId: req.user.id, action: 'habit.targets', entity: 'patients', entityId: p.id, detail: b });
  res.json(await habitSummary(p.id, { days: 30, weightKg: await lastWeight(p.id) }));
}));

// ---------- بوابة المريض: رمز QR ----------
router.get('/patients/:id(\\d+)/portal-access', wrap(async (req, res) => {
  await mustPatient(pid(req));
  res.json({ ...(await accessStatus(pid(req))), portal_url: portalLink(publicUrl(req)), app_url: `${publicUrl(req)}/app`, push_devices: await devicesFor(pid(req)) });
}));

/** يصدر رمزاً جديداً (ويلغي القديم). الرمز يظهر مرة واحدة فقط — لا يُخزَّن إلا الـ hash */
router.post('/patients/:id(\\d+)/portal-access', canWrite(), wrap(async (req, res) => {
  const out = await issueAccess({ patientId: pid(req), userId: req.user.id, base: publicUrl(req) });
  res.status(201).json(out);
}));

router.delete('/patients/:id(\\d+)/portal-access', canWrite(), wrap(async (req, res) => {
  await mustPatient(pid(req));
  res.json({ revoked: await revokeAccess(pid(req), req.user.id) });
}));

/** حالة إشعارات تطبيق المريض (للإعدادات) */
router.get('/push/status', wrap(async (req, res) => res.json({ ...(await pushStatus()), app_url: `${publicUrl(req)}/app` })));

/** إشعار مخصص من العيادة إلى تطبيق المريض */
router.post('/patients/:id(\\d+)/push', canWrite(), wrap(async (req, res) => {
  const p = await mustPatient(pid(req));
  const title = str(req.body?.title, 120) || 'رسالة من العيادة';
  const body = str(req.body?.body, 400);
  if (!body) throw badRequest('نص الإشعار مطلوب');
  const r = await pushToPatient(p.id, { title, body, kind: 'custom', url: '/#/portal', userId: req.user.id });
  if (!r.devices) throw badRequest('المريض لم يفعّل إشعارات التطبيق على أي جهاز بعد');
  await audit({ userId: req.user.id, action: 'push.custom', entity: 'patients', entityId: p.id, detail: { sent: r.sent } });
  res.json(r);
}));

/** إرسال رابط الدخول بواتساب (يُصدر رمزاً جديداً لأن القديم غير محفوظ) */
router.post('/patients/:id(\\d+)/portal-access/send', canWrite(), wrap(async (req, res) => {
  const p = await mustPatient(pid(req));
  const out = await issueAccess({ patientId: p.id, userId: req.user.id, base: publicUrl(req) });
  const text = `مرحباً ${p.first_name} 👋\nهذا رابط بوابتك في العيادة: خطتك الغذائية، مواعيدك، قياساتك، وتسجيل الماء والنوم والنشاط يومياً.\n${out.url}\nرقم الملف: ${out.file_no} · الرمز: ${out.code}\nلا تشارك الرابط مع أحد.`;
  const r = await sendMessage({ patient: p, kind: 'portal_access', text, refId: out.id, userId: req.user.id });
  res.status(r.status === 'failed' ? 502 : 200).json({ ...out, message: r, text });
}));

// ---------- قائمة الانتظار ----------
router.get('/waitlist', wrap(async (req, res) => {
  await sweepOffers({ base: publicUrl(req) });
  const status = ['waiting', 'booked', 'cancelled', 'expired'].includes(req.query.status) ? req.query.status : 'waiting';
  const items = await listWaitlist(`w.status=?`, status);
  const offers = await offersFor(`o.status='pending' OR o.created_at >= to_char((now() AT TIME ZONE 'UTC') - interval '7 days','YYYY-MM-DD HH24:MI:SS')`);
  res.json({ items, offers, counts: await db.get(`
    SELECT COUNT(*) FILTER (WHERE status='waiting') AS waiting, COUNT(*) FILTER (WHERE status='booked') AS booked FROM waitlist`) });
}));

router.post('/waitlist', canWrite(), wrap(async (req, res) => {
  const p = await mustPatient(Number(req.body?.patient_id));
  const id = await addToWaitlist({ patientId: p.id, body: req.body, source: 'clinic', userId: req.user.id });
  res.status(201).json((await listWaitlist(`w.id=?`, id))[0]);
}));

router.put('/waitlist/:id(\\d+)', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const w = await db.get(`SELECT * FROM waitlist WHERE id=?`, id);
  if (!w) throw notFound();
  const d = normalizeWaitlist({ ...w, ...req.body });
  await db.run(`UPDATE waitlist SET date_from=@date_from, date_to=@date_to, days=@days, time_pref=@time_pref, visit_type=@visit_type, mode=@mode, note=@note,
    updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id=@id`, { ...d, id });
  await audit({ userId: req.user.id, action: 'waitlist.update', entity: 'waitlist', entityId: id });
  res.json((await listWaitlist(`w.id=?`, id))[0]);
}));

router.delete('/waitlist/:id(\\d+)', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.run(`UPDATE waitlist SET status='cancelled', updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id=? AND status='waiting'`, id);
  await db.run(`UPDATE waitlist_offers SET status='declined' WHERE waitlist_id=? AND status='pending'`, id);
  await audit({ userId: req.user.id, action: 'waitlist.cancel', entity: 'waitlist', entityId: id });
  res.json({ cancelled: r.changes > 0 });
}));

/** عرض موعد شاغر يدوياً على قائمة الانتظار (مثلاً فجوة في الجدول) */
router.post('/waitlist/offer-slot', canWrite(), wrap(async (req, res) => {
  const { date, time } = req.body || {};
  if (!isDate(String(date || '')) || !isTime(String(time || ''))) throw badRequest('التاريخ والساعة مطلوبان');
  const r = await offerSlot({ date, time, duration: Number(req.body.duration_min) || 30, base: publicUrl(req), userId: req.user.id });
  res.json(r);
}));

router.post('/waitlist/offers/:id(\\d+)/accept', canWrite(), wrap(async (req, res) => {
  res.json({ appointment: await acceptOffer({ offerId: Number(req.params.id), userId: req.user.id }) });
}));
router.post('/waitlist/offers/:id(\\d+)/decline', canWrite(), wrap(async (req, res) => {
  res.json(await declineOffer({ offerId: Number(req.params.id), userId: req.user.id, base: publicUrl(req) }));
}));

// ---------- الاستشارات المرئية ----------
router.get('/calls/ice', wrap(async (req, res) => res.json({ ice_servers: iceServers(), turn: !!process.env.TURN_URL })));

/** بدء (أو استئناف) مكالمة الموعد. notify=true يرسل للمريض رابط الانضمام بواتساب */
router.post('/appointments/:id(\\d+)/call', canWrite(), wrap(async (req, res) => {
  const call = await startCall({ appointmentId: Number(req.params.id), userId: req.user.id });
  const join = portalLink(publicUrl(req), '/call');
  let message = null;
  // إشعار فوري على جوال المريض (إن فعّل الإشعارات) — أولوية عالية، صالح 10 دقائق فقط
  const push = await pushToPatient(call.patient_id, {
    title: '📹 الأخصائي بانتظارك الآن', body: 'اضغط للانضمام إلى الاستشارة المرئية', url: '/#/portal/call',
    kind: 'video_call', tag: `call-${call.id}`, refId: call.id, userId: req.user.id, urgency: 'high', ttl: 600,
  });
  if (req.body?.notify) {
    const p = await db.get(`SELECT * FROM patients WHERE id=?`, call.patient_id);
    const text = `مرحباً ${p.first_name} 👋\nأخصائية التغذية بانتظارك الآن في الاستشارة المرئية.\nافتح بوابتك واضغط «انضم للمكالمة»:\n${join}`;
    message = await sendMessage({ patient: p, kind: 'video_call', text, refId: call.id, userId: req.user.id });
  }
  res.status(201).json({ call: await callFor(call.id), ice_servers: iceServers(), join_url: join, message, push });
}));

router.get('/calls/:id(\\d+)', wrap(async (req, res) => res.json({ call: await callFor(Number(req.params.id)), ice_servers: iceServers() })));
router.get('/calls/:id(\\d+)/signals', wrap(async (req, res) => {
  res.json(await pullSignals({ callId: Number(req.params.id), reader: 'doctor', after: Number(req.query.after ?? 0) }));
}));
router.post('/calls/:id(\\d+)/signal', canWrite(), wrap(async (req, res) => {
  res.json(await postSignal({ callId: Number(req.params.id), sender: 'doctor', kind: String(req.body?.kind || ''), payload: req.body?.payload }));
}));
router.post('/calls/:id(\\d+)/end', canWrite(), wrap(async (req, res) => {
  res.json(await endCall({ callId: Number(req.params.id), sender: 'doctor', userId: req.user.id }));
}));
