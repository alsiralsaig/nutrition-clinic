// المواعيد: تسجيل، حالة، جدول اليوم، وتنبيهات
import { Router } from 'express';
import { db, audit } from '../db.js';
import { badRequest, conflict, notFound, str, wrap, isDate, isTime, todayISO } from '../lib.js';
import { canWrite } from '../auth.js';

export const router = Router();

const TYPES = ['initial', 'followup', 'consult', 'plan_update', 'lab_review'];
const STATUSES = ['scheduled', 'confirmed', 'done', 'cancelled', 'no_show'];

function normalize(body, existing = {}) {
  const out = {
    patient_id: Number(body.patient_id ?? existing.patient_id),
    date: body.date !== undefined ? String(body.date) : existing.date,
    time: body.time !== undefined ? String(body.time) : existing.time,
    duration_min: Number(body.duration_min ?? existing.duration_min ?? 30),
    visit_type: TYPES.includes(body.visit_type) ? body.visit_type : (existing.visit_type ?? 'followup'),
    status: STATUSES.includes(body.status) ? body.status : (existing.status ?? 'scheduled'),
    room: body.room !== undefined ? str(body.room, 60) : (existing.room ?? null),
    notes: body.notes !== undefined ? str(body.notes, 1000) : (existing.notes ?? null),
  };
  if (!out.patient_id) throw badRequest('patient_id مطلوب');
  if (!isDate(out.date)) throw badRequest('التاريخ مطلوب بصيغة YYYY-MM-DD');
  if (!isTime(out.time)) throw badRequest('الساعة مطلوبة بصيغة HH:MM');
  if (!Number.isFinite(out.duration_min) || out.duration_min < 5 || out.duration_min > 240)
    throw badRequest('مدة الموعد يجب أن تكون بين 5 و 240 دقيقة');
  if (!db.prepare(`SELECT id FROM patients WHERE id=?`).get(out.patient_id))
    throw badRequest('رقم المريض غير موجود');
  return out;
}

const SELECT = `
  SELECT a.*, p.first_name, p.last_name, p.file_no, p.phone, p.status AS patient_status,
         (p.first_name || ' ' || p.last_name) AS patient_name,
         u.full_name AS staff_name
  FROM appointments a JOIN patients p ON p.id = a.patient_id
  LEFT JOIN users u ON u.id = a.created_by`;

router.get('/today', wrap((req, res) => {
  const date = isDate(String(req.query.date || '')) ? req.query.date : todayISO();
  const items = db.prepare(`${SELECT} WHERE a.date = ? ORDER BY a.time`).all(date);
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

router.get('/', wrap((req, res) => {
  const where = [];
  const params = {};
  if (req.query.patient_id) { where.push(`a.patient_id = @patient_id`); params.patient_id = Number(req.query.patient_id); }
  if (isDate(String(req.query.from || ''))) { where.push(`a.date >= @from`); params.from = req.query.from; }
  if (isDate(String(req.query.to || ''))) { where.push(`a.date <= @to`); params.to = req.query.to; }
  if (STATUSES.includes(String(req.query.status || ''))) { where.push(`a.status = @status`); params.status = req.query.status; }
  if (req.query.q) { where.push(`(p.first_name LIKE @q OR p.last_name LIKE @q OR p.file_no LIKE @q OR IFNULL(p.phone,'') LIKE @q)`); params.q = `%${req.query.q}%`; }
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const dir = String(req.query.dir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const items = db.prepare(`
    ${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.date ${dir}, a.time ${dir} LIMIT @limit
  `).all({ ...params, limit });
  res.json({ items, count: items.length });
}));

router.get('/upcoming', wrap((req, res) => {
  const items = db.prepare(`
    ${SELECT} WHERE a.date >= @today AND a.status IN ('scheduled','confirmed')
    ORDER BY a.date, a.time LIMIT 30
  `).all({ today: todayISO() });
  res.json({ items });
}));

router.post('/', canWrite(), wrap((req, res) => {
  const data = normalize(req.body);
  const clash = db.prepare(`
    SELECT id FROM appointments WHERE date=? AND time=? AND status IN ('scheduled','confirmed') LIMIT 1
  `).get(data.date, data.time);
  if (clash) throw conflict(`يوجد موعد مسجل بالفعل في ${data.date} ${data.time} — اختر وقتاً آخر`);
  const info = db.prepare(`
    INSERT INTO appointments (patient_id, date, time, duration_min, visit_type, status, room, notes, created_by)
    VALUES (@patient_id, @date, @time, @duration_min, @visit_type, @status, @room, @notes, @created_by)
  `).run({ ...data, created_by: req.user.id });
  audit({ userId: req.user.id, action: 'appointment.create', entity: 'appointments', entityId: info.lastInsertRowid });
  res.status(201).json(db.prepare(`${SELECT} WHERE a.id = ?`).get(info.lastInsertRowid));
}));

router.put('/:id(\\d+)', canWrite(), wrap((req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM appointments WHERE id=?`).get(id);
  if (!existing) throw notFound('الموعد غير موجود');
  const data = normalize(req.body, existing);
  db.prepare(`
    UPDATE appointments SET patient_id=@patient_id, date=@date, time=@time, duration_min=@duration_min,
      visit_type=@visit_type, status=@status, room=@room, notes=@notes WHERE id=@id
  `).run({ ...data, id });
  audit({ userId: req.user.id, action: 'appointment.update', entity: 'appointments', entityId: id });
  res.json(db.prepare(`${SELECT} WHERE a.id = ?`).get(id));
}));

/** تغيير الحالة فقط (زر سريع في جدول اليوم) */
router.post('/:id(\\d+)/status', canWrite(), wrap((req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || '');
  if (!STATUSES.includes(status)) throw badRequest('حالة غير معروفة');
  const existing = db.prepare(`SELECT * FROM appointments WHERE id=?`).get(id);
  if (!existing) throw notFound('الموعد غير موجود');
  db.prepare(`UPDATE appointments SET status=? WHERE id=?`).run(status, id);
  // إذا الزيارة تمت، ننشئ زيارة تلقائياً إن لم تكن موجودة في نفس اليوم
  if (status === 'done' && !db.prepare(`SELECT id FROM visits WHERE patient_id=? AND visit_date=?`).get(existing.patient_id, existing.date)) {
    const v = db.prepare(`INSERT INTO visits (patient_id, visit_date, visit_type, reason, created_by) VALUES (?,?,?,?,?)`)
      .run(existing.patient_id, existing.date, existing.visit_type, `مُسجلة تلقائياً من الموعد رقم ${id}`, req.user.id);
    audit({ userId: req.user.id, action: 'visit.auto_create', entity: 'visits', entityId: v.lastInsertRowid });
  }
  audit({ userId: req.user.id, action: 'appointment.status', entity: 'appointments', entityId: id, detail: { status } });
  res.json(db.prepare(`${SELECT} WHERE a.id = ?`).get(id));
}));

router.delete('/:id(\\d+)', canWrite(), wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare(`SELECT id FROM appointments WHERE id=?`).get(id)) throw notFound();
  db.prepare(`DELETE FROM appointments WHERE id=?`).run(id);
  audit({ userId: req.user.id, action: 'appointment.delete', entity: 'appointments', entityId: id });
  res.json({ deleted: true, id });
}));
