// التقارير: جاهزة للطباعة وPDF (الطباعة تُنسّق في الواجهة) + تصدير CSV
import { Router } from 'express';
import { db, getSettings, getSetting } from '../db.js';
import { badRequest, notFound, wrap, isDate, todayISO } from '../lib.js';
import { adherenceSeries, bandsSummary, goalDirection, pearson } from '../adherence.js';

export const router = Router();

/** تقرير كامل للمريض: بيانات + زيارات + قياسات + خطة + مواعيد + مدفوعات */
router.get('/patient/:id(\\d+)', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const patient = await db.get(`
    SELECT p.*, (p.first_name || ' ' || p.last_name) AS full_name FROM patients p WHERE p.id = ?
  `, id);
  if (!patient) throw notFound('المريض غير موجود');
  const measurements = await db.all(`
    SELECT * FROM measurements WHERE patient_id=? ORDER BY measured_on, id
  `, id);
  const planRows = await db.all(`SELECT * FROM diet_plans WHERE patient_id=? ORDER BY id DESC`, id);
  const meals = planRows.length
    ? await db.all(`SELECT * FROM diet_meals WHERE plan_id = ANY(?::int[]) ORDER BY position, id`, planRows.map((p) => p.id))
    : [];
  const visits = await db.all(`SELECT * FROM visits WHERE patient_id=? ORDER BY visit_date, id`, id);
  const report = {
    generated_at: new Date().toISOString(),
    clinic: await getSettings(),
    patient,
    measurements,
    visits,
    plans: planRows.map((p) => ({ ...p, meals: meals.filter((m) => m.plan_id === p.id) })),
    appointments: await db.all(`SELECT * FROM appointments WHERE patient_id=? ORDER BY date DESC, time DESC`, id),
    payments: await db.all(`SELECT * FROM payments WHERE patient_id=? ORDER BY paid_on DESC, id DESC`, id),
    totals: {
      paid: (await db.get(`SELECT COALESCE(ROUND(SUM(amount)::numeric,2),0) t FROM payments WHERE patient_id=? AND voided=0`, id)).t,
      visits: visits.length,
      weight_change: measurements.length >= 2
        ? Math.round((measurements.at(-1).weight_kg - measurements[0].weight_kg) * 10) / 10 : null,
    },
  };
  res.json(report);
}));

/** تقرير تطور الوزن لمريض أو لكل المرضى في فترة */
router.get('/weight-progress/:id(\\d+)', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.all(`
    SELECT measured_on, weight_kg, bmi, waist_cm, hip_cm, chest_cm, body_fat_pct
    FROM measurements WHERE patient_id=? AND weight_kg IS NOT NULL ORDER BY measured_on, id
  `, id);
  if (!rows.length) throw notFound('لا توجد قياسات لهذا المريض');
  const start = rows[0], last = rows.at(-1);
  res.json({
    patient: await db.get(`SELECT id, file_no, (first_name||' '||last_name) AS full_name, height_cm, start_weight, goal_weight, gender, birth_date FROM patients WHERE id=?`, id),
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
router.get('/visits', wrap(async (req, res) => {
  const from = isDate(String(req.query.from || '')) ? req.query.from : '0000-01-01';
  const to = isDate(String(req.query.to || '')) ? req.query.to : todayISO();
  const rows = await db.all(`
    SELECT v.visit_date AS date, v.visit_type, p.id AS patient_id, p.file_no,
           (p.first_name||' '||p.last_name) AS patient_name, u.full_name AS staff_name,
           (SELECT COUNT(*) FROM measurements m WHERE m.visit_id=v.id) AS has_meas
    FROM visits v JOIN patients p ON p.id=v.patient_id LEFT JOIN users u ON u.id=v.created_by
    WHERE v.visit_date BETWEEN ? AND ? ORDER BY v.visit_date DESC, v.id DESC LIMIT 2000
  `, from, to);
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
router.get('/revenue', wrap(async (req, res) => {
  const from = isDate(String(req.query.from || '')) ? req.query.from : '0000-01-01';
  const to = isDate(String(req.query.to || '')) ? req.query.to : todayISO();
  const rows = await db.all(`
    SELECT pa.paid_on AS date, pa.service, pa.method, pa.amount, pa.voided, pa.invoice_no,
           p.id AS patient_id, p.file_no, (p.first_name||' '||p.last_name) AS patient_name,
           u.full_name AS staff_name
    FROM payments pa JOIN patients p ON p.id=pa.patient_id LEFT JOIN users u ON u.id=pa.recorded_by
    WHERE pa.paid_on BETWEEN ? AND ? ORDER BY pa.paid_on DESC, pa.id DESC LIMIT 5000
  `, from, to);
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
  // شهر × خدمة (أعمدة مكدّسة): [{ month, total, 'استشارة': 1200, ... }]
  const services = group('service').map((x) => x.key);
  const byMonthService = byMonth.map(({ month, total }) => {
    const row = { month, total };
    for (const sv of services) row[sv] = 0;
    for (const r of valid) if (r.date.slice(0, 7) === month) row[r.service || 'غير محدد'] = Math.round((row[r.service || 'غير محدد'] + r.amount) * 100) / 100;
    return row;
  });
  res.json({
    services, by_month_service: byMonthService,
    from, to, currency: await getSetting('clinic.currency', 'SDG'),
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
router.get('/audit', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = await db.all(`
    SELECT al.*, u.username, u.full_name FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.id DESC LIMIT ?
  `, limit);
  res.json({ items: rows });
}));

/** الالتزام مقابل نزول الوزن — على مستوى العيادة (كل زيارة فيها تقييم = نقطة) */
router.get('/adherence', wrap(async (req, res) => {
  const from = isDate(String(req.query.from || '')) ? req.query.from : '0000-01-01';
  const to = isDate(String(req.query.to || '')) ? req.query.to : '9999-12-31';
  const visits = await db.all(`SELECT v.*, p.first_name, p.last_name, p.file_no, p.start_weight, p.goal_weight FROM visits v JOIN patients p ON p.id=v.patient_id
                               WHERE v.adherence IS NOT NULL ORDER BY v.patient_id, v.visit_date, v.id`);
  const pids = [...new Set(visits.map((v) => v.patient_id))];
  const meas = pids.length ? await db.all(`SELECT * FROM measurements WHERE patient_id = ANY(?::int[]) ORDER BY measured_on, id`, pids) : [];
  const points = [];
  const perPatient = [];
  for (const pid of pids) {
    const vs = visits.filter((v) => v.patient_id === pid);
    const dir = goalDirection(vs[0]);
    const s1 = adherenceSeries(vs, meas.filter((m) => m.patient_id === pid), dir);
    const inRange = s1.points.filter((pt) => pt.date >= from && pt.date <= to);
    if (!inRange.length) continue;
    const name = `${vs[0].first_name} ${vs[0].last_name}`;
    for (const pt of inRange) points.push({ ...pt, patient_id: pid, patient_name: name, file_no: vs[0].file_no, goal: dir === 1 ? 'lose' : 'gain' });
    const withLoss = inRange.filter((x) => x.weekly_progress_kg !== null);
    perPatient.push({
      patient_id: pid, patient_name: name, file_no: vs[0].file_no, visits: inRange.length,
      avg_adherence: Math.round(inRange.reduce((t, x) => t + x.adherence, 0) / inRange.length),
      goal: dir === 1 ? 'lose' : 'gain',
      avg_weekly_progress_kg: withLoss.length ? Math.round((withLoss.reduce((t, x) => t + x.weekly_progress_kg, 0) / withLoss.length) * 100) / 100 : null,
      total_loss_kg: inRange.at(-1).total_loss_kg,
    });
  }
  const paired = points.filter((x) => x.weekly_progress_kg !== null);
  res.json({
    from, to, points, patients: perPatient.sort((x, y) => y.avg_adherence - x.avg_adherence),
    bands: bandsSummary(points),
    correlation: pearson(paired.map((x) => x.adherence), paired.map((x) => x.weekly_progress_kg)),
    average_adherence: points.length ? Math.round(points.reduce((t, x) => t + x.adherence, 0) / points.length) : null,
    rated_visits: points.length,
  });
}));

/** تصدير CSV (يتوافق مع Excel، بترميز UTF-8 BOM للعربية). ?from&to للتصفية بالتاريخ، ?lang=en لعناوين إنجليزية */
const EXPORTS = {
  patients: { sql: `SELECT file_no AS "رقم الملف", first_name AS "الاسم", last_name AS "اللقب", phone AS "الهاتف",
      birth_date AS "تاريخ الميلاد", gender AS "الجنس", height_cm AS "الطول", start_weight AS "وزن البداية",
      goal_weight AS "الهدف", activity_level AS "مستوى النشاط", status AS "الحالة", created_at AS "تاريخ التسجيل"
      FROM patients WHERE substr(created_at,1,10) BETWEEN @from AND @to ORDER BY id` },
  measurements: { sql: `SELECT p.file_no AS "رقم الملف", (p.first_name||' '||p.last_name) AS "المريض",
      m.measured_on AS "التاريخ", m.weight_kg AS "الوزن", m.bmi AS "BMI", m.waist_cm AS "الخصر",
      m.hip_cm AS "الورك", m.chest_cm AS "الصدر", m.body_fat_pct AS "نسبة الدهون"
      FROM measurements m JOIN patients p ON p.id=m.patient_id WHERE m.measured_on BETWEEN @from AND @to ORDER BY m.measured_on DESC` },
  payments: { sql: `SELECT p.file_no AS "رقم الملف", (p.first_name||' '||p.last_name) AS "المريض", pa.paid_on AS "التاريخ",
      pa.service AS "الخدمة", pa.amount AS "المبلغ", pa.currency AS "العملة", pa.method AS "الطريقة", pa.invoice_no AS "الفاتورة",
      pa.voided AS "ملغي"
      FROM payments pa JOIN patients p ON p.id=pa.patient_id WHERE pa.paid_on BETWEEN @from AND @to ORDER BY pa.paid_on DESC` },
  appointments: { sql: `SELECT a.date AS "التاريخ", a.time AS "الوقت", p.file_no AS "رقم الملف",
      (p.first_name||' '||p.last_name) AS "المريض", a.visit_type AS "النوع", a.status AS "الحالة", a.duration_min AS "المدة",
      a.reminded_at AS "أُرسل التذكير"
      FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.date BETWEEN @from AND @to ORDER BY a.date DESC, a.time DESC` },
  visits: { sql: `SELECT v.visit_date AS "التاريخ", p.file_no AS "رقم الملف", (p.first_name||' '||p.last_name) AS "المريض",
      v.visit_type AS "النوع", v.reason AS "السبب", v.adherence AS "الالتزام %", v.adherence_notes AS "ملاحظات الالتزام",
      (SELECT m.weight_kg FROM measurements m WHERE m.visit_id=v.id ORDER BY m.id DESC LIMIT 1) AS "الوزن"
      FROM visits v JOIN patients p ON p.id=v.patient_id WHERE v.visit_date BETWEEN @from AND @to ORDER BY v.visit_date DESC` },
  meals: { sql: `SELECT p.file_no AS "رقم الملف", (p.first_name||' '||p.last_name) AS "المريض", dp.title AS "الخطة", dp.status AS "حالة الخطة",
      CASE m.day_of_week WHEN 0 THEN 'السبت' WHEN 1 THEN 'الأحد' WHEN 2 THEN 'الإثنين' WHEN 3 THEN 'الثلاثاء'
        WHEN 4 THEN 'الأربعاء' WHEN 5 THEN 'الخميس' WHEN 6 THEN 'الجمعة' ELSE 'كل يوم' END AS "اليوم",
      m.slot AS "الوجبة", m.slot_time AS "الوقت", m.title AS "العنوان", replace(m.items, chr(10), ' | ') AS "المكونات",
      m.kcal AS "السعرات", m.protein_g AS "بروتين", m.carbs_g AS "كربوهيدرات", m.fat_g AS "دهون"
      FROM diet_meals m JOIN diet_plans dp ON dp.id=m.plan_id JOIN patients p ON p.id=dp.patient_id
      WHERE substr(dp.created_at,1,10) BETWEEN @from AND @to
      ORDER BY dp.id DESC, m.day_of_week NULLS FIRST, m.position` },
  messages: { sql: `SELECT ml.created_at AS "الوقت", p.file_no AS "رقم الملف", (p.first_name||' '||p.last_name) AS "المريض",
      ml.channel AS "القناة", ml.kind AS "النوع", ml.to_phone AS "الرقم", ml.status AS "الحالة", ml.error AS "الخطأ"
      FROM message_log ml LEFT JOIN patients p ON p.id=ml.patient_id
      WHERE substr(ml.created_at,1,10) BETWEEN @from AND @to ORDER BY ml.id DESC` },
};

/** عناوين الأعمدة بالإنجليزية (?lang=en) */
const EN_HEADERS = {
  'رقم الملف': 'File No', 'الاسم': 'First name', 'اللقب': 'Last name', 'الهاتف': 'Phone', 'تاريخ الميلاد': 'Birth date',
  'الجنس': 'Gender', 'الطول': 'Height (cm)', 'وزن البداية': 'Start weight', 'الهدف': 'Goal weight', 'مستوى النشاط': 'Activity level',
  'الحالة': 'Status', 'تاريخ التسجيل': 'Registered at', 'المريض': 'Patient', 'التاريخ': 'Date', 'الوزن': 'Weight (kg)',
  'الخصر': 'Waist (cm)', 'الورك': 'Hip (cm)', 'الصدر': 'Chest (cm)', 'نسبة الدهون': 'Body fat %', 'الخدمة': 'Service',
  'المبلغ': 'Amount', 'العملة': 'Currency', 'الطريقة': 'Method', 'الفاتورة': 'Invoice', 'ملغي': 'Voided', 'الوقت': 'Time',
  'النوع': 'Type', 'القناة': 'Channel', 'المدة': 'Duration (min)', 'أُرسل التذكير': 'Reminder sent at', 'السبب': 'Reason', 'الالتزام %': 'Adherence %',
  'ملاحظات الالتزام': 'Adherence notes', 'الخطة': 'Plan', 'حالة الخطة': 'Plan status', 'اليوم': 'Day', 'الوجبة': 'Meal',
  'العنوان': 'Title', 'المكونات': 'Items', 'السعرات': 'kcal', 'بروتين': 'Protein (g)', 'كربوهيدرات': 'Carbs (g)', 'دهون': 'Fat (g)',
  'الرقم': 'Phone', 'الخطأ': 'Error', 'BMI': 'BMI',
};

export function toCsv(rows, lang = 'ar') {
  if (!rows.length) return '\uFEFF' + (lang === 'en' ? 'No data' : 'لا توجد بيانات') + '\n';
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = Object.keys(rows[0]);
  return '\uFEFF' + [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\r\n');
}

router.get('/export/:kind', wrap(async (req, res) => {
  const kind = String(req.params.kind);
  const def = Object.prototype.hasOwnProperty.call(EXPORTS, kind) ? EXPORTS[kind] : null;
  if (!def) throw badRequest('نوع تصدير غير معروف. المتاح: ' + Object.keys(EXPORTS).join(', '));
  const from = isDate(String(req.query.from || '')) ? req.query.from : '0000-01-01';
  const to = isDate(String(req.query.to || '')) ? req.query.to : '9999-12-31';
  const lang = req.query.lang === 'en' ? 'en' : 'ar';
  let rows = await db.all(def.sql, { from, to });
  if (lang === 'en') rows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [EN_HEADERS[k] || k, v])));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}-${todayISO()}.csv"`);
  res.send(toCsv(rows, lang));
}));

/** تقرير الإيرادات كـ CSV (نفس فترة شاشة التقرير) */
router.get('/revenue.csv', wrap(async (req, res) => {
  const from = isDate(String(req.query.from || '')) ? req.query.from : '0000-01-01';
  const to = isDate(String(req.query.to || '')) ? req.query.to : '9999-12-31';
  const lang = req.query.lang === 'en' ? 'en' : 'ar';
  let rows = await db.all(EXPORTS.payments.sql, { from, to });
  if (lang === 'en') rows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [EN_HEADERS[k] || k, v])));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="revenue-${from}-${to}.csv"`);
  res.send(toCsv(rows, lang));
}));
