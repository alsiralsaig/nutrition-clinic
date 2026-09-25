// لوحة التحكم: بطاقات إحصائية + رسوم بيانية
import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { wrap, todayISO } from '../lib.js';
import { calcBMI, bmiCategory } from '../lib.js';

export const router = Router();

/** تاريخ قبل n يوم بصيغة YYYY-MM-DD (يُحسب في JS كي تبقى الاستعلامات بسيطة) */
const daysAgoISO = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return todayISO(d); };

router.get('/summary', wrap(async (req, res) => {
  const one = (sql, ...a) => db.get(sql, ...a);
  const today = todayISO();

  const patients = await one(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='inactive' THEN 1 ELSE 0 END) AS inactive,
      SUM(CASE WHEN status='archived' THEN 1 ELSE 0 END) AS archived
      FROM patients`);

  const newThisMonth = (await one(`SELECT COUNT(*) AS n FROM patients WHERE substr(created_at,1,7)=?`, today.slice(0, 7))).n;

  const appointments = await one(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status IN ('scheduled','confirmed') THEN 1 ELSE 0 END) AS pending
    FROM appointments WHERE date = ?`, today);

  const revenueToday = await one(`SELECT COALESCE(ROUND(SUM(amount)::numeric,2),0) AS t, COUNT(*) AS n FROM payments WHERE voided=0 AND paid_on=?`, today);
  const revenueMonth = await one(`SELECT COALESCE(ROUND(SUM(amount)::numeric,2),0) AS t, COUNT(*) AS n FROM payments WHERE voided=0 AND substr(paid_on,1,7)=?`, today.slice(0, 7));
  const revenueTotal = await one(`SELECT COALESCE(ROUND(SUM(amount)::numeric,2),0) AS t, COUNT(*) AS n FROM payments WHERE voided=0`);

  const followUp = await one(`
    SELECT
      (SELECT COUNT(DISTINCT patient_id) FROM measurements WHERE measured_on >= @d30) AS measured_30d,
      (SELECT COUNT(*) FROM measurements) AS measurements_total,
      (SELECT COUNT(*) FROM visits WHERE visit_date >= @d30) AS visits_30d,
      (SELECT COUNT(*) FROM diet_plans WHERE status='active') AS active_plans,
      (SELECT COUNT(*) FROM patients p WHERE p.status='active'
        AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.patient_id=p.id AND m.measured_on >= @d60)) AS overdue_60d
  `, { d30: daysAgoISO(30), d60: daysAgoISO(60) });

  const avgWeightLoss = await one(`
    WITH s AS (
      SELECT patient_id,
             FIRST_VALUE(weight_kg) OVER (PARTITION BY patient_id ORDER BY measured_on, id) AS first_w,
             LAST_VALUE(weight_kg) OVER (PARTITION BY patient_id ORDER BY measured_on, id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_w,
             COUNT(*) OVER (PARTITION BY patient_id) AS n,
             ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY measured_on DESC, id DESC) AS rn
      FROM measurements WHERE weight_kg IS NOT NULL
    )
    SELECT ROUND(AVG(first_w - last_w)::numeric,2) AS avg_lost, COUNT(*) AS pts
    FROM s WHERE rn = 1 AND n >= 2
  `);

  res.json({
    patients: {
      total: patients.total, active: patients.active ?? 0, inactive: patients.inactive ?? 0,
      archived: patients.archived ?? 0, new_this_month: newThisMonth,
    },
    appointments: {
      today: appointments.total ?? 0,
      done: appointments.done ?? 0,
      pending: appointments.pending ?? 0,
    },
    revenue: {
      today: revenueToday.t, today_count: revenueToday.n,
      month: revenueMonth.t, month_count: revenueMonth.n,
      total: revenueTotal.t, total_count: revenueTotal.n,
      currency: await getSetting('clinic.currency', 'SDG'),
    },
    followUp: {
      ...followUp,
      avg_weight_loss_kg: avgWeightLoss.avg_lost ?? null,
      tracked_patients: avgWeightLoss.pts ?? 0,
    },
  });
}));

/** تطور الوزن عبر كل المرضى (متوسط) + توزيع الفئات */
router.get('/charts', wrap(async (req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 12, 3), 24);

  const revenueSeries = (await db.all(`
    SELECT substr(paid_on,1,7) AS month, ROUND(SUM(amount)::numeric,2) AS total, COUNT(*) AS n
    FROM payments WHERE voided=0 GROUP BY month ORDER BY month DESC LIMIT ?
  `, months)).reverse();

  const patientGrowth = (await db.all(`
    SELECT substr(created_at,1,7) AS month, COUNT(*) AS new_patients
    FROM patients GROUP BY month ORDER BY month DESC LIMIT ?
  `, months)).reverse();

  const cumulative = [];
  let acc = 0;
  for (const row of patientGrowth) { acc += row.new_patients; cumulative.push({ ...row, total_patients: acc }); }

  const measurementsSeries = await db.all(`
    SELECT substr(measured_on,1,7) AS month,
           ROUND(AVG(weight_kg)::numeric,1) AS avg_weight,
           ROUND(AVG(bmi)::numeric,1) AS avg_bmi,
           ROUND(AVG(body_fat_pct)::numeric,1) AS avg_fat,
           COUNT(*) AS n
    FROM measurements WHERE weight_kg IS NOT NULL AND measured_on >= ?
    GROUP BY month ORDER BY month
  `, daysAgoISO(months * 31));

  const bmiDistribution = await db.all(`
    WITH last AS (
      SELECT m.patient_id, m.bmi, ROW_NUMBER() OVER (PARTITION BY m.patient_id ORDER BY m.measured_on DESC, m.id DESC) rn
      FROM measurements m WHERE m.bmi IS NOT NULL
    )
    SELECT bmi, COUNT(*) AS n FROM last WHERE rn = 1 GROUP BY bmi
  `);
  const buckets = {};
  for (const r of bmiDistribution) {
    const label = bmiCategory(r.bmi)?.label ?? 'غير محدد';
    buckets[label] = (buckets[label] || 0) + r.n;
  }

  const weightProgressTop = await db.all(`
    WITH s AS (
      SELECT patient_id,
             FIRST_VALUE(weight_kg) OVER (PARTITION BY patient_id ORDER BY measured_on, id) AS first_w,
             LAST_VALUE(weight_kg) OVER (PARTITION BY patient_id ORDER BY measured_on, id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_w,
             COUNT(*) OVER (PARTITION BY patient_id) AS n,
             ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY measured_on DESC, id DESC) AS rn
      FROM measurements WHERE weight_kg IS NOT NULL
    )
    SELECT p.id, p.file_no, (p.first_name || ' ' || p.last_name) AS name,
           s.first_w, s.last_w, ROUND((s.first_w - s.last_w)::numeric,1) AS lost, s.n AS visits
    FROM s JOIN patients p ON p.id = s.patient_id
    WHERE s.rn = 1 AND s.n >= 2
    ORDER BY lost DESC LIMIT 8
  `);

  const weekdays = await db.all(`
    SELECT EXTRACT(DOW FROM date::date)::int AS dow, COUNT(*) AS n
    FROM appointments WHERE status NOT IN ('cancelled','no_show') GROUP BY dow ORDER BY dow
  `);
  const dowNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  res.json({
    revenue: revenueSeries,
    patientGrowth: cumulative,
    measurements: measurementsSeries,
    bmiDistribution: Object.entries(buckets).map(([label, n]) => ({ label, n })),
    weightProgressTop,
    weekdays: dowNames.map((label, i) => ({ label, n: weekdays.find((w) => w.dow === i)?.n ?? 0 })),
  });
}));

/** جدول اليوم للمواعيد داخل اللوحة */
router.get('/today', wrap(async (req, res) => {
  const items = await db.all(`
    SELECT a.id, a.time, a.duration_min, a.visit_type, a.status, a.patient_id,
           (p.first_name || ' ' || p.last_name) AS patient_name, p.file_no, p.phone
    FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.date = ? ORDER BY a.time
  `, todayISO());
  res.json({ date: todayISO(), items });
}));
