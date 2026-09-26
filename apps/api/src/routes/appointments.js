// المواعيد: تسجيل، حالة، جدول اليوم، وتنبيهات
import { Router } from 'express';
import { db, audit } from '../db.js';
import { badRequest, conflict, notFound, str, wrap, isDate, isTime, todayISO } from '../lib.js';
import { canWrite } from '../auth.js';
import { offerSlot, publicUrl } from '../care.js';
import { pushToPatient } from '../push.js';

/** إشعار تطبيق المريض بحجز/تغيير موعده (لا يُرسل للمواعيد الماضية) */
async function notifyAppt(appt, kind, userId) {
  if (!ACTIVE.includes(appt.status) || appt.date < todayISO()) return;
  const video = appt.mode === 'video' ? ' · استشارة مرئية 🎥' : '';
  await pushToPatient(appt.patient_id, {
    title: kind === 'appointment_booked' ? '📅 تم حجز موعدك' : '🔁 تغيّر موعدك',
    body: `${appt.date} الساعة ${appt.time}${video}`, url: '/#/portal/appointments', kind, tag: `appt-${appt.id}`, refId: appt.id, userId,
  });
}

const ACTIVE = ['scheduled', 'confirmed'];
/** موعد نشط أصبح شاغراً (إلغاء/حذف/تغيير وقت) → يُعرض تلقائياً على قائمة الانتظار */
async function freed(req, appt) {
  try {
    return await offerSlot({ date: appt.date, time: appt.time, duration: appt.duration_min, sourceAppointmentId: appt.id,
      excludePatientId: appt.patient_id, base: publicUrl(req), userId: req.user?.id ?? null });
  } catch (e) { console.error('[waitlist]', e.message); return { offered: 0, error: e.message }; }
}

export const router = Router();

const TYPES = ['initial', 'followup', 'consult', 'plan_update', 'lab_review'];
const STATUSES = ['scheduled', 'confirmed', 'done', 'cancelled', 'no_show'];

async function normalize(body, existing = {}) {
  const out = {
    patient_id: Number(body.patient_id ?? existing.patient_id),
    date: body.date !== undefined ? String(body.date) : existing.date,
    time: body.time !== undefined ? String(body.time) : existing.time,
    duration_min: Number(body.duration_min ?? existing.duration_min ?? 30),
    visit_type: TYPES.includes(body.visit_type) ? body.visit_type : (existing.visit_type ?? 'followup'),
    status: STATUSES.includes(body.status) ? body.status : (existing.status ?? 'scheduled'),
    room: body.room !== undefined ? str(body.room, 60) : (existing.room ?? null),
    mode: body.mode !== undefined ? (body.mode === 'video' ? 'video' : 'in_person') : (existing.mode ?? 'in_person'),
    notes: body.notes !== undefined ? str(body.notes, 1000) : (existing.notes ?? null),
  };
  if (!out.patient_id) throw badRequest('patient_id مطلوب');
  if (!isDate(out.date)) throw badRequest('التاريخ مطلوب بصيغة YYYY-MM-DD');
  if (!isTime(out.time)) throw badRequest('الساعة مطلوبة بصيغة HH:MM');
  if (!Number.isFinite(out.duration_min) || out.duration_min < 5 || out.duration_min > 240)
    throw badRequest('مدة الموعد يجب أن تكون بين 5 و 240 دقيقة');
  if (!(await db.get(`SELECT id FROM patients WHERE id=?`, out.patient_id)))
    throw badRequest('رقم المريض غير موجود');
  return out;
}

const SELECT = `
  SELECT a.*, p.first_name, p.last_name, p.file_no, p.phone, p.status AS patient_status,
         (p.first_name || ' ' || p.last_name) AS patient_name,
         u.full_name AS staff_name
  FROM appointments a JOIN patients p ON p.id = a.patient_id
  LEFT JOIN users u ON u.id = a.created_by`;

router.get('/today', wrap(async (req, res) => {
  const date = isDate(String(req.query.date || '')) ? req.query.date : todayISO();
  const items = await db.all(`${SELECT} WHERE a.date = ? ORDER BY a.time`, date);
  const summary = {
    date,
    total: items.length,
    done: items.filter((i) => i.status === 'done').length,
    scheduled: items.filter((i) => i.status === 'scheduled').length,
    confirmed: items.filter((i) => i.status === 'confirmed').length,
    cancelled: items.filter((i) => i.status === 'cancelled' || i.status === 'no_show').length,
    minutes: items.reduce((s, i) => s + (i.status === 'cancelled' || i.status === 'no_show' ? 0 : i.duration_min), 0),
  };
  res.json({ ...summary, items });
}));

router.get('/', wrap(async (req, res) => {
  const where = [];
  const params = {};
  if (req.query.patient_id) { where.push(`a.patient_id = @patient_id`); params.patient_id = Number(req.query.patient_id); }
  if (isDate(String(req.query.from || ''))) { where.push(`a.date >= @from`); params.from = req.query.from; }
  if (isDate(String(req.query.to || ''))) { where.push(`a.date <= @to`); params.to = req.query.to; }
  if (STATUSES.includes(String(req.query.status || ''))) { where.push(`a.status = @status`); params.status = req.query.status; }
  if (req.query.q) { where.push(`(p.first_name ILIKE @q OR p.last_name ILIKE @q OR p.file_no ILIKE @q OR COALESCE(p.phone,'') ILIKE @q)`); params.q = `%${req.query.q}%`; }
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const dir = String(req.query.dir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const items = await db.all(`
    ${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.date ${dir}, a.time ${dir} LIMIT @limit
  `, { ...params, limit });
  res.json({ items, count: items.length });
}));

router.get('/upcoming', wrap(async (req, res) => {
  const items = await db.all(`
    ${SELECT} WHERE a.date >= @today AND a.status IN ('scheduled','confirmed')
    ORDER BY a.date, a.time LIMIT 30
  `, { today: todayISO() });
  res.json({ items });
}));

router.get('/:id(\\d+)', wrap(async (req, res) => {
  const a = await db.get(`${SELECT} WHERE a.id = ?`, Number(req.params.id));
  if (!a) throw notFound('الموعد غير موجود');
  res.json(a);
}));

router.post('/', canWrite(), wrap(async (req, res) => {
  const data = await normalize(req.body);
  const clash = await db.get(`
    SELECT id FROM appointments WHERE date=? AND time=? AND status IN ('scheduled','confirmed') LIMIT 1
  `, data.date, data.time);
  if (clash) throw conflict(`يوجد موعد مسجل بالفعل في ${data.date} ${data.time} — اختر وقتاً آخر`);
  const newId = await db.insert(`
    INSERT INTO appointments (patient_id, date, time, duration_min, visit_type, status, room, notes, mode, created_by)
    VALUES (@patient_id, @date, @time, @duration_min, @visit_type, @status, @room, @notes, @mode, @created_by)
  `, { ...data, created_by: req.user.id });
  await audit({ userId: req.user.id, action: 'appointment.create', entity: 'appointments', entityId: newId });
  await notifyAppt({ ...data, id: newId }, 'appointment_booked', req.user.id);
  res.status(201).json(await db.get(`${SELECT} WHERE a.id = ?`, newId));
}));

router.put('/:id(\\d+)', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.get(`SELECT * FROM appointments WHERE id=?`, id);
  if (!existing) throw notFound('الموعد غير موجود');
  const data = await normalize(req.body, existing);
  await db.run(`
    UPDATE appointments SET patient_id=@patient_id, date=@date, time=@time, duration_min=@duration_min,
      visit_type=@visit_type, status=@status, room=@room, notes=@notes, mode=@mode WHERE id=@id
  `, { ...data, id });
  await audit({ userId: req.user.id, action: 'appointment.update', entity: 'appointments', entityId: id });
  const wasActive = ACTIVE.includes(existing.status);
  const slotFreed = wasActive && (!ACTIVE.includes(data.status) ? data.status === 'cancelled' : (data.date !== existing.date || data.time !== existing.time));
  const waitlist = slotFreed ? await freed(req, existing) : null;
  if (ACTIVE.includes(data.status) && (data.date !== existing.date || data.time !== existing.time || data.patient_id !== existing.patient_id)) {
    await notifyAppt({ ...data, id }, data.patient_id !== existing.patient_id ? 'appointment_booked' : 'appointment_moved', req.user.id);
  }
  res.json({ ...(await db.get(`${SELECT} WHERE a.id = ?`, id)), waitlist });
}));

/** تغيير الحالة فقط (زر سريع في جدول اليوم) */
router.post('/:id(\\d+)/status', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || '');
  if (!STATUSES.includes(status)) throw badRequest('حالة غير معروفة');
  const existing = await db.get(`SELECT * FROM appointments WHERE id=?`, id);
  if (!existing) throw notFound('الموعد غير موجود');
  await db.tx(async () => {
    await db.run(`UPDATE appointments SET status=? WHERE id=?`, status, id);
    // إذا الزيارة تمت، ننشئ زيارة تلقائياً إن لم تكن موجودة في نفس اليوم
    if (status === 'done' && !(await db.get(`SELECT id FROM visits WHERE patient_id=? AND visit_date=?`, existing.patient_id, existing.date))) {
      const visitId = await db.insert(`INSERT INTO visits (patient_id, visit_date, visit_type, reason, created_by) VALUES (?,?,?,?,?)`,
        existing.patient_id, existing.date, existing.visit_type, `مُسجلة تلقائياً من الموعد رقم ${id}`, req.user.id);
      await audit({ userId: req.user.id, action: 'visit.auto_create', entity: 'visits', entityId: visitId });
    }
    await audit({ userId: req.user.id, action: 'appointment.status', entity: 'appointments', entityId: id, detail: { status } });
  });
  const waitlist = status === 'cancelled' && ACTIVE.includes(existing.status) ? await freed(req, existing) : null;
  res.json({ ...(await db.get(`${SELECT} WHERE a.id = ?`, id)), waitlist });
}));

router.delete('/:id(\\d+)', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.get(`SELECT * FROM appointments WHERE id=?`, id);
  if (!existing) throw notFound();
  await db.run(`DELETE FROM appointments WHERE id=?`, id);
  await audit({ userId: req.user.id, action: 'appointment.delete', entity: 'appointments', entityId: id });
  const waitlist = ACTIVE.includes(existing.status) ? await freed(req, existing) : null;
  res.json({ deleted: true, id, waitlist });
}));
