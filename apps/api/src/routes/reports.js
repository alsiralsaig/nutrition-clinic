// التقارير: جاهزة للطباعة وPDF (الطباعة تُنسّق في الواجهة) + تصدير CSV
import { Router } from 'express';
import { db, getSettings } from '../db.js';
import { badRequest, notFound, wrap, isDate, todayISO } from '../lib.js';

export const router = Router();

/** تقرير كامل للمريض: بيانات + زيارات + قياسات + خطة + مواعيد + مدفوعات */
router.get('/patient/:id(\\d+)', wrap((req, res) => {
  const id = Number(req.params.id);
  const patient = db.prepare(`
    SELECT p.*, (p.first_name || ' ' || p.last_name) AS full_name FROM patients p WHERE p.id = ?
  `).get(id);
  if (!patient) throw notFound('المريض غير موجود');
  const measurements = db.prepare(`
    SELECT * FROM measurements WHERE patient_id=? ORDER BY measured_on, id
  `).all(id);
  const report = {
    generated_at: new Date().toISOString(),
    clinic: getSettings(),
    patient,
    measurements,
    visits: db.prepare(`SELECT * FROM visits WHERE patient_id=? ORDER BY visit_date, id`).all(id),
    plans: db.prepare(`SELECT * FROM diet_plans WHERE patient_id=? ORDER BY id DESC`).all(id)
      .map((p) => ({ ...p, meals: db.prepare(`SELECT * FROM diet_meals WHERE plan_id=? ORDER BY position,id`).all(p.id) })),
    appointments: db.prepare(`SELECT * FROM appointments WHERE patient_id=? ORDER BY date DESC, time DESC`).all(id),
    payments: db.prepare(`SELECT * FROM payments WHERE patient_id=? ORDER BY paid_on DESC, id DESC`).all(id),
    totals: {
      paid: db.prepare(`SELECT COALESCE(ROUND(SUM(amount),2),0) t FROM payments WHERE patient_id=? AND voided=0`).get(id).t,
      visits: db.prepare(`SELECT COUNT(*) n FROM visits WHERE patient_id=?`).get(id).n,
      weight_change: measurements.length >= 2
        ? Math.round((measurements.at(-1).weight_kg - measurements[0].weight_kg) * 10) / 10 : null,
    },
  };
  res.json(report);
}));

/** تقرير تطور الوزن لمريض أو لكل المرضى في فترة */
router.get('/weight-progress/:id(\\d+)', wrap((req, res) => {
  const id = Number(req.params.id);
  const rows = db.prepare(`
    SELECT measured_on, weight_kg, bmi, waist_cm, hip_cm, chest_cm, body_fat_pct
    FROM measurements WHERE patient_id=? AND weight_kg IS NOT NULL ORDER BY measured_on, id
  `).all(id);
  if (!rows.length) throw notFound('لا توجد قياسات لهذا المريض');
  const start = rows[0], last = rows.at(-1);
  res.json({
    patient: db.prepare(`SELECT id, file_no, (first_name||' '||last_name) AS full_name, height_cm, start_weight, goal_weight, gender, birth_date FROM patients WHERE id=?`).get(id),
    rows: rows.map((r, i) => ({
      ...r,
      seq: i + 1,
      loss_vs_start: Math.round((start.weight_kg - r.weight_kg) * 10) / 10,
      loss_vs_prev: i === 0 ? 0 : Math.round((rows[i - 1].weight_kg - r.weight_kg) * 10) / 10,
      weeks_since_start: Math.round((new Date(r.measured_on) - new Date(start.measured_on)) / (7 * 864e5)),
    })),
    summary: {
      start_weight: start.weight_kg,
      current_weight: last.weight_kg,
      total_loss: Math.round((start.weight_kg - last.weight_kg) * 10) / 10,
      waist_change: start.waist_cm != null && last.waist_cm != null ? Math.round((start.waist_cm - last.waist_cm) * 10) / 10 : null,
      fat_change: start.body_fat_pct != null && last.body_fat_pct != null ? Math.round((start.body_fat_pct - last.body_fat_pct) * 10) / 10 : null,
      measurements: rows.length,
      first_date: start.measured_on,
      last_date: last.measured_on,
    },
  });
}));

/** تقرير الزيارات */
router.get('/visits', wrap((req, res) => {
  const from = isDate(String(req.query.from || '')) ? req.query.from : '0000-01-01';
  const to = isDate(String(req.query.to || '')) ? req.query.to : todayISO();
  const rows = db.prepare(`
    SELECT v.visit_date AS date, v.visit_type, p.id AS patient_id, p.file_no,
           (p.first_name||' '||p.last_name) AS patient_name, u.full_name AS staff_name,
           (SELECT COUNT(*) FROM measurements m WHERE m.visit_id=v.id) AS has_meas
    FROM visits v JOIN patients p ON p.id=v.patient_id LEFT JOIN users u ON u.id=v.created_by
    WHERE v.visit_date BETWEEN ? AND ? ORDER BY v.visit_date DESC, v.id DESC LIMIT 2000
  `).all(from, to);
  const byType = {};
  for (const r of rows) byType[r.visit_type] = (byType[r.visit_type] || 0) + 1;
  const byMonth = {};
  for (const r of rows) { const m = r.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + 1; }
  res.json({
    from, to, count: rows.length, rows,
    by_type: byType,
    by_month: Object.entries(byMonth).map(([month, n]) => ({ month, n })).sort((a, b) => a.month.localeCompare(b.month)),
    unique_patients: new Set(rows.map((r) => r.patient_id)).size,
  });
}));

/** تقرير الإيرادات */
router.get('/revenue', wrap((req, res) => {
  const from = isDate(String(req.query.from || '')) ? req.query.from : '0000-01-01';
  const to = isDate(String(req.query.to || '')) ? req.query.to : todayISO();
  const rows = db.prepare(`
    SELECT pa.paid_on AS date, pa.service, pa.method, pa.amount, pa.voided, pa.invoice_no,
           p.id AS patient_id, p.file_no, (p.first_name||' '||p.last_name) AS patient_name,
           u.full_name AS staff_name
    FROM payments pa JOIN patients p ON p.id=pa.patient_id LEFT JOIN users u ON u.id=pa.recorded_by
    WHERE pa.paid_on BETWEEN ? AND ? ORDER BY pa.paid_on DESC, pa.id DESC LIMIT 5000
  `).all(from, to);
  const valid = rows.filter((r) => !r.voided);
  const group = (key) => Object.entries(valid.reduce((acc, r) => {
    const k = r[key] || 'غير محدد';
    acc[k] = acc[k] || { key: k, total: 0, n: 0 };
    acc[k].total = Math.round((acc[k].total + r.amount) * 100) / 100;
    acc[k].n += 1;
    return acc;
  }, {})).map(([, v]) => v).sort((a, b) => b.total - a.total);
  const byMonth = Object.entries(valid.reduce((acc, r) => {
    const k = r.date.slice(0, 7);
    acc[k] = (acc[k] || 0) + r.amount;
    return acc;
  }, {})).map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 })).sort((a, b) => a.month.localeCompare(b.month));
  res.json({
    from, to, currency: getSettings()['clinic.currency'] || 'SDG',
    gross: Math.round(valid.reduce((s, r) => s + r.amount, 0) * 100) / 100,
    voided_count: rows.length - valid.length,
    count: valid.length,
    average: valid.length ? Math.round((valid.reduce((s, r) => s + r.amount, 0) / valid.length) * 100) / 100 : 0,
    rows, by_service: group('service'), by_method: group('method'), by_month: byMonth,
    top_patients: Object.entries(valid.reduce((acc, r) => {
      acc[r.patient_name] = (acc[r.patient_name] || 0) + r.amount;
      return acc;
    }, {})).map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 })).sort((a, b) => b.total - a.total).slice(0, 10),
  });
}));

/** سجل التدقيق — من عدّل ماذا */
router.get('/audit', wrap((req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = db.prepare(`
    SELECT al.*, u.username, u.full_name FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.id DESC LIMIT ?
  `).all(limit);
  res.json({ items: rows });
}));

/** تصدير CSV (يتوافق مع Excel، بترميز UTF-8 BOM للعربية) */
const EXPORTS = {
  patients: `SELECT file_no AS 'رقم الملف', first_name AS 'الاسم', last_name AS 'اللقب', phone AS 'الهاتف',
      birth_date AS 'تاريخ الميلاد', gender AS 'الجنس', height_cm AS 'الطول', start_weight AS 'وزن البداية',
      goal_weight AS 'الهدف', status AS 'الحالة', created_at AS 'تاريخ التسجيل' FROM patients ORDER BY id`,
  measurements: `SELECT p.file_no AS 'رقم الملف', (p.first_name||' '||p.last_name) AS 'المريض',
      m.measured_on AS 'التاريخ', m.weight_kg AS 'الوزن', m.bmi AS 'BMI', m.waist_cm AS 'الخصر',
      m.hip_cm AS 'الورك', m.chest_cm AS 'الصدر', m.body_fat_pct AS 'نسبة الدهون'
      FROM measurements m JOIN patients p ON p.id=m.patient_id ORDER BY m.measured_on DESC`,
  payments: `SELECT p.file_no AS 'رقم الملف', (p.first_name||' '||p.last_name) AS 'المريض', pa.paid_on AS 'التاريخ',
      pa.service AS 'الخدمة', pa.amount AS 'المبلغ', pa.method AS 'الطريقة', pa.invoice_no AS 'الفاتورة',
      pa.voided AS 'ملغي'
      FROM payments pa JOIN patients p ON p.id=pa.patient_id ORDER BY pa.paid_on DESC`,
  appointments: `SELECT a.date AS 'التاريخ', a.time AS 'الوقت', p.file_no AS 'رقم الملف',
      (p.first_name||' '||p.last_name) AS 'المريض', a.visit_type AS 'النوع', a.status AS 'الحالة', a.duration_min AS 'المدة'
      FROM appointments a JOIN patients p ON p.id=a.patient_id ORDER BY a.date DESC, a.time DESC`,
};

export function toCsv(rows) {
  if (!rows.length) return '\uFEFFلا توجد بيانات\n';
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = Object.keys(rows[0]);
  return '\uFEFF' + [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\r\n');
}

router.get('/export/:kind', wrap((req, res) => {
  const sql = EXPORTS[String(req.params.kind)];
  if (!sql) throw badRequest('نوع تصدير غير معروف. المتاح: ' + Object.keys(EXPORTS).join(', '));
  const rows = db.prepare(sql).all();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.kind}-${todayISO()}.csv"`);
  res.send(toCsv(rows));
}));
