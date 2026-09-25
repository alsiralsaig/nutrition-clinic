// المدفوعات والإيرادات
import { Router } from 'express';
import { db, audit, getSetting, TODAY } from '../db.js';
import { badRequest, notFound, str, wrap, isDate, toNum, todayISO } from '../lib.js';
import { canWrite, adminOnly } from '../auth.js';

export const router = Router();

const METHODS = ['cash', 'card', 'bank_transfer', 'mobile_wallet', 'instalment'];

const SELECT = `
  SELECT pa.*, (p.first_name || ' ' || p.last_name) AS patient_name, p.file_no, p.phone,
         u.full_name AS staff_name
  FROM payments pa JOIN patients p ON p.id = pa.patient_id
  LEFT JOIN users u ON u.id = pa.recorded_by`;

async function normalize(body, existing = {}) {
  const out = {
    patient_id: Number(body.patient_id ?? existing.patient_id),
    appointment_id: body.appointment_id !== undefined ? (body.appointment_id ? Number(body.appointment_id) : null) : (existing.appointment_id ?? null),
    paid_on: body.paid_on !== undefined ? String(body.paid_on) : (existing.paid_on ?? todayISO()),
    service: body.service !== undefined ? str(body.service, 160) : existing.service,
    amount: toNum(body.amount ?? existing.amount),
    method: METHODS.includes(body.method) ? body.method : (existing.method ?? 'cash'),
    invoice_no: body.invoice_no !== undefined ? str(body.invoice_no, 60) : (existing.invoice_no ?? null),
    note: body.note !== undefined ? str(body.note, 1000) : (existing.note ?? null),
  };
  if (!out.patient_id) throw badRequest('patient_id مطلوب');
  if (!isDate(out.paid_on)) throw badRequest('تاريخ الدفع مطلوب بصيغة YYYY-MM-DD');
  if (out.amount === null || out.amount <= 0) throw badRequest('المبلغ يجب أن يكون أكبر من صفر');
  if (!out.service) throw badRequest('نوع الخدمة مطلوب');
  if (!(await db.get(`SELECT id FROM patients WHERE id=?`, out.patient_id))) throw badRequest('رقم المريض غير موجود');
  return out;
}

router.get('/', wrap(async (req, res) => {
  const where = [];
  const params = {};
  if (req.query.patient_id) { where.push(`pa.patient_id = @patient_id`); params.patient_id = Number(req.query.patient_id); }
  if (isDate(String(req.query.from || ''))) { where.push(`pa.paid_on >= @from`); params.from = req.query.from; }
  if (isDate(String(req.query.to || ''))) { where.push(`pa.paid_on <= @to`); params.to = req.query.to; }
  if (METHODS.includes(String(req.query.method || ''))) { where.push(`pa.method = @method`); params.method = req.query.method; }
  if (req.query.q) {
    where.push(`(p.first_name ILIKE @q OR p.last_name ILIKE @q OR p.file_no ILIKE @q OR pa.service ILIKE @q OR COALESCE(pa.invoice_no,'') ILIKE @q)`);
    params.q = `%${req.query.q}%`;
  }
  const items = await db.all(`
    ${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY pa.paid_on DESC, pa.id DESC LIMIT 500
  `, params);
  const valid = items.filter((i) => !i.voided);
  res.json({
    items,
    total: Math.round(valid.reduce((s, i) => s + i.amount, 0) * 100) / 100,
    count: items.length,
    currency: await getSetting('clinic.currency', 'SDG'),
  });
}));

/** ملخص الإيرادات: شهري + حسب الخدمة + حسب الطريقة */
router.get('/summary', wrap(async (req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 36);
  const monthly = (await db.all(`
    SELECT substr(paid_on,1,7) AS month, ROUND(SUM(amount)::numeric,2) AS total, COUNT(*) AS payments
    FROM payments WHERE voided = 0 GROUP BY month ORDER BY month DESC LIMIT ?
  `, months)).reverse();
  const byService = await db.all(`
    SELECT service, ROUND(SUM(amount)::numeric,2) AS total, COUNT(*) AS n
    FROM payments WHERE voided = 0 GROUP BY service ORDER BY total DESC LIMIT 12
  `);
  const byMethod = await db.all(`
    SELECT method, ROUND(SUM(amount)::numeric,2) AS total, COUNT(*) AS n
    FROM payments WHERE voided = 0 GROUP BY method ORDER BY total DESC
  `);
  const t = todayISO();
  const today = await db.get(`SELECT COALESCE(ROUND(SUM(amount)::numeric,2),0) AS t, COUNT(*) AS n FROM payments WHERE voided=0 AND paid_on=?`, t);
  const month = await db.get(`SELECT COALESCE(ROUND(SUM(amount)::numeric,2),0) AS t, COUNT(*) AS n FROM payments WHERE voided=0 AND substr(paid_on,1,7)=?`, t.slice(0, 7));
  res.json({ monthly, byService, byMethod, today, month, currency: await getSetting('clinic.currency', 'SDG') });
}));

router.post('/', canWrite(), wrap(async (req, res) => {
  const data = await normalize(req.body);
  const newId = await db.insert(`
    INSERT INTO payments (patient_id, appointment_id, paid_on, service, amount, currency, method, invoice_no, note, recorded_by)
    VALUES (@patient_id, @appointment_id, @paid_on, @service, @amount, @currency, @method, @invoice_no, @note, @recorded_by)
  `, { ...data, currency: await getSetting('clinic.currency', 'SDG'), recorded_by: req.user.id });
  await audit({ userId: req.user.id, action: 'payment.create', entity: 'payments', entityId: newId, detail: { amount: data.amount } });
  res.status(201).json(await db.get(`${SELECT} WHERE pa.id = ?`, newId));
}));

router.put('/:id(\\d+)', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.get(`SELECT * FROM payments WHERE id=?`, id);
  if (!existing) throw notFound('الدفع غير موجود');
  const data = await normalize(req.body, existing);
  await db.run(`
    UPDATE payments SET patient_id=@patient_id, appointment_id=@appointment_id, paid_on=@paid_on,
      service=@service, amount=@amount, method=@method, invoice_no=@invoice_no, note=@note WHERE id=@id
  `, { ...data, id });
  await audit({ userId: req.user.id, action: 'payment.update', entity: 'payments', entityId: id });
  res.json(await db.get(`${SELECT} WHERE pa.id = ?`, id));
}));

/** إلغاء بدل الحذف: الإيراد يبقى شفافاً ولا يُمحى أثره */
router.post('/:id(\\d+)/void', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.get(`SELECT * FROM payments WHERE id=?`, id);
  if (!existing) throw notFound('الدفع غير موجود');
  if (!existing.voided) {
    await db.run(`UPDATE payments SET voided = 1, note = COALESCE(note,'') || ' — أُلغي بتاريخ ' || ${TODAY} WHERE id=?`, id);
    await audit({ userId: req.user.id, action: 'payment.void', entity: 'payments', entityId: id });
  }
  res.json(await db.get(`${SELECT} WHERE pa.id = ?`, id));
}));

router.delete('/:id(\\d+)', adminOnly(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await db.get(`SELECT id FROM payments WHERE id=?`, id))) throw notFound();
  await db.run(`DELETE FROM payments WHERE id=?`, id);
  await audit({ userId: req.user.id, action: 'payment.delete', entity: 'payments', entityId: id });
  res.json({ deleted: true, id });
}));
