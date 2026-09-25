// المدفوعات والإيرادات
import { Router } from 'express';
import { db, audit, getSettings } from '../db.js';
import { badRequest, notFound, str, wrap, isDate, toNum, todayISO } from '../lib.js';
import { canWrite, adminOnly } from '../auth.js';

export const router = Router();

const METHODS = ['cash', 'card', 'bank_transfer', 'mobile_wallet', 'instalment'];

const SELECT = `
  SELECT pa.*, (p.first_name || ' ' || p.last_name) AS patient_name, p.file_no, p.phone,
         u.full_name AS staff_name
  FROM payments pa JOIN patients p ON p.id = pa.patient_id
  LEFT JOIN users u ON u.id = pa.recorded_by`;

function normalize(body, existing = {}) {
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
  if (!db.prepare(`SELECT id FROM patients WHERE id=?`).get(out.patient_id)) throw badRequest('رقم المريض غير موجود');
  return out;
}

router.get('/', wrap((req, res) => {
  const where = [];
  const params = {};
  if (req.query.patient_id) { where.push(`pa.patient_id = @patient_id`); params.patient_id = Number(req.query.patient_id); }
  if (isDate(String(req.query.from || ''))) { where.push(`pa.paid_on >= @from`); params.from = req.query.from; }
  if (isDate(String(req.query.to || ''))) { where.push(`pa.paid_on <= @to`); params.to = req.query.to; }
  if (METHODS.includes(String(req.query.method || ''))) { where.push(`pa.method = @method`); params.method = req.query.method; }
  if (req.query.q) {
    where.push(`(p.first_name LIKE @q OR p.last_name LIKE @q OR p.file_no LIKE @q OR pa.service LIKE @q OR IFNULL(pa.invoice_no,'') LIKE @q)`);
    params.q = `%${req.query.q}%`;
  }
  const items = db.prepare(`
    ${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY pa.paid_on DESC, pa.id DESC LIMIT 500
  `).all(params);
  const valid = items.filter((i) => !i.voided);
  res.json({
    items,
    total: Math.round(valid.reduce((s, i) => s + i.amount, 0) * 100) / 100,
    count: items.length,
    currency: getSettings()['clinic.currency'] || 'SDG',
  });
}));

/** ملخص الإيرادات: شهري + حسب الخدمة + حسب الطريقة */
router.get('/summary', wrap((req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 36);
  const monthly = db.prepare(`
    SELECT substr(paid_on,1,7) AS month, ROUND(SUM(amount),2) AS total, COUNT(*) AS payments
    FROM payments WHERE voided = 0 GROUP BY month ORDER BY month DESC LIMIT ?
  `).all(months).reverse();
  const byService = db.prepare(`
    SELECT service, ROUND(SUM(amount),2) AS total, COUNT(*) AS n
    FROM payments WHERE voided = 0 GROUP BY service ORDER BY total DESC LIMIT 12
  `).all();
  const byMethod = db.prepare(`
    SELECT method, ROUND(SUM(amount),2) AS total, COUNT(*) AS n
    FROM payments WHERE voided = 0 GROUP BY method ORDER BY total DESC
  `).all();
  const today = db.prepare(`SELECT COALESCE(ROUND(SUM(amount),2),0) AS t, COUNT(*) AS n FROM payments WHERE voided=0 AND paid_on=?`).get(todayISO());
  const month = db.prepare(`SELECT COALESCE(ROUND(SUM(amount),2),0) AS t, COUNT(*) AS n FROM payments WHERE voided=0 AND substr(paid_on,1,7)=substr(?,1,7)`).get(todayISO());
  res.json({ monthly, byService, byMethod, today, month, currency: getSettings()['clinic.currency'] || 'SDG' });
}));

router.post('/', canWrite(), wrap((req, res) => {
  const data = normalize(req.body);
  const info = db.prepare(`
    INSERT INTO payments (patient_id, appointment_id, paid_on, service, amount, currency, method, invoice_no, note, recorded_by)
    VALUES (@patient_id, @appointment_id, @paid_on, @service, @amount, @currency, @method, @invoice_no, @note, @recorded_by)
  `).run({ ...data, currency: getSettings()['clinic.currency'] || 'SDG', recorded_by: req.user.id });
  audit({ userId: req.user.id, action: 'payment.create', entity: 'payments', entityId: info.lastInsertRowid, detail: { amount: data.amount } });
  res.status(201).json(db.prepare(`${SELECT} WHERE pa.id = ?`).get(info.lastInsertRowid));
}));

router.put('/:id(\\d+)', canWrite(), wrap((req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM payments WHERE id=?`).get(id);
  if (!existing) throw notFound('الدفع غير موجود');
  const data = normalize(req.body, existing);
  db.prepare(`
    UPDATE payments SET patient_id=@patient_id, appointment_id=@appointment_id, paid_on=@paid_on,
      service=@service, amount=@amount, method=@method, invoice_no=@invoice_no, note=@note WHERE id=@id
  `).run({ ...data, id });
  audit({ userId: req.user.id, action: 'payment.update', entity: 'payments', entityId: id });
  res.json(db.prepare(`${SELECT} WHERE pa.id = ?`).get(id));
}));

/** إلغاء بدل الحذف: الإيراد يبقى شفافاً ولا يُمحى أثره */
router.post('/:id(\\d+)/void', canWrite(), wrap((req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM payments WHERE id=?`).get(id);
  if (!existing) throw notFound('الدفع غير موجود');
  db.prepare(`UPDATE payments SET voided = 1, note = IFNULL(note,'') || ' — أُلغي بتاريخ ' || date('now') WHERE id=?`).run(id);
  audit({ userId: req.user.id, action: 'payment.void', entity: 'payments', entityId: id });
  res.json(db.prepare(`${SELECT} WHERE pa.id = ?`).get(id));
}));

router.delete('/:id(\\d+)', adminOnly(), wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare(`SELECT id FROM payments WHERE id=?`).get(id)) throw notFound();
  db.prepare(`DELETE FROM payments WHERE id=?`).run(id);
  audit({ userId: req.user.id, action: 'payment.delete', entity: 'payments', entityId: id });
  res.json({ deleted: true, id });
}));
