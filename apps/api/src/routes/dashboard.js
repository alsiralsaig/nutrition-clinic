// لوحة التحكم: بطاقات إحصائية + رسوم بيانية
import { Router } from 'express';
import { db, getSettings } from '../db.js';
import { wrap, todayISO } from '../lib.js';
import { calcBMI, bmiCategory } from '../lib.js';

export const router = Router();

router.get('/summary', wrap((req, res) => {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const today = todayISO();

  const patients = one(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='inactive' THEN 1 ELSE 0 END) AS inactive,
      SUM(CASE WHEN status='archived' THEN 1 ELSE 0 END) AS archived
      FROM patients`);

  const newThisMonth = one(`SELECT COUNT(*) AS n FROM patients WHERE substr(created_at,1,7)=substr(?,1,7)`, today).n;

  const appointments = one(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status IN ('scheduled','confirmed') THEN 1 ELSE 0 END) AS pending
    FROM appointments WHERE date = ?`, today);

  const revenueToday = one(`SELECT COALESCE(ROUND(SUM(amount),2),0) AS t, COUNT(*) AS n FROM payments WHERE voided=0 AND paid_on=?`, today);
  const revenueMonth = one(`SELECT COALESCE(ROUND(SUM(amount),2),0) AS t, COUNT(*) AS n FROM payments WHERE voided=0 AND substr(paid_on,1,7)=substr(?,1,7)`, today);
  const revenueTotal = one(`SELECT COALESCE(ROUND(SUM(amount),2),0) AS t, COUNT(*) AS n FROM payments WHERE voided=0`);

  const followUp = one(`
    SELECT
      (SELECT COUNT(DISTINCT patient_id) FROM measurements WHERE measured_on >= date('now','-30 days')) AS measured_30d,
      (SELECT COUNT(*) FROM measurements) AS measurements_total,
      (SELECT COUNT(*) FROM visits WHERE visit_date >= date('now','-30 days')) AS visits_30d,
      (SELECT COUNT(*) FROM diet_plans WHERE status='active') AS active_plans,
      (SELECT COUNT(*) FROM patients p WHERE p.status='active'
        AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.patient_id=p.id AND m.measured_on >= date('now','-60 days'))) AS overdue_60d
  `);

  const avgWeightLoss = one(`
    WITH s AS (
      SELECT patient_id,
             FIRST_VALUE(weight_kg) OVER (PARTITION BY patient_id ORDER BY measured_on, id) AS first_w,
             LAST_VALUE(weight_kg) OVER (PARTITION BY patient_id ORDER BY measured_on, id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_w,
             COUNT(*) OVER (PARTITION BY patient_id) AS n,
             ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY measured_on DESC, id DESC) AS rn
      FROM measurements WHERE weight_kg IS NOT NULL
    )
    SELECT ROUND(AVG(first_w - last_w),2) AS avg_lost, COUNT(*) AS pts
    FROM s WHERE rn = 1 AND n >= 2
  `);

  res.json({
    patients: { ...patients, new_this_month: newThisMonth },
    appointments: {
      today: appointments.total ?? 0,
      done: appointments.done ?? 0,
      pending: appointments.pending ?? 0,
    },
    revenue: {
      today: revenueToday.t, today_count: revenueToday.n,
      month: revenueMonth.t, month_count: revenueMonth.n,
      total: revenueTotal.t, total_count: revenueTotal.n,
      currency: getSettings()['clinic.currency'] || 'SDG',
    },
    followUp: {
      ...followUp,
      avg_weight_loss_kg: avgWeightLoss.avg_lost ?? null,
      tracked_patients: avgWeightLoss.pts ?? 0,
    },
  });
}));

/** تطور الوزن عبر كل المرضى (متوسط) + توزيع الفئات */
router.get('/charts', wrap((req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 12, 3), 24);

  const revenueSeries = db.prepare(`
    SELECT substr(paid_on,1,7) AS month, ROUND(SUM(amount),2) AS total, COUNT(*) AS n
    FROM payments WHERE voided=0 GROUP BY month ORDER BY month DESC LIMIT ?
  `).all(months).reverse();

  const patientGrowth = db.prepare(`
    SELECT substr(created_at,1,7) AS month, COUNT(*) AS new_patients
    FROM patients GROUP BY month ORDER BY month DESC LIMIT ?
  `).all(months).reverse();

  const cumulative = [];
  let acc = 0;
  for (const row of patientGrowth) { acc += row.new_patients; cumulative.push({ ...row, total_patients: acc }); }

  const measurementsSeries = db.prepare(`
    SELECT substr(measured_on,1,7) AS month,
           ROUND(AVG(weight_kg),1) AS avg_weight,
           ROUND(AVG(bmi),1) AS avg_bmi,
           ROUND(AVG(body_fat_pct),1) AS avg_fat,
           COUNT(*) AS n
    FROM measurements WHERE weight_kg IS NOT NULL AND measured_on >= date('now', ?)
    GROUP BY month ORDER BY month
  `).all(`-${months * 31} day`);

  const bmiDistribution = db.prepare(`
    WITH last AS (
      SELECT m.patient_id, m.bmi, ROW_NUMBER() OVER (PARTITION BY m.patient_id ORDER BY m.measured_on DESC, m.id DESC) rn
      FROM measurements m WHERE m.bmi IS NOT NULL
    )
    SELECT bmi, COUNT(*) AS n FROM last WHERE rn = 1 GROUP BY bmi
  `).all();
  const buckets = {};
  for (const r of bmiDistribution) {
    const label = bmiCategory(r.bmi)?.label ?? 'غير محدد';
    buckets[label] = (buckets[label] || 0) + r.n;
  }

  const weightProgressTop = db.prepare(`
    WITH s AS (
      SELECT patient_id,
             FIRST_VALUE(weight_kg) OVER (PARTITION BY patient_id ORDER BY measured_on, id) AS first_w,
             LAST_VALUE(weight_kg) OVER (PARTITION BY patient_id ORDER BY measured_on, id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_w,
             COUNT(*) OVER (PARTITION BY patient_id) AS n,
             ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY measured_on DESC, id DESC) AS rn
      FROM measurements WHERE weight_kg IS NOT NULL
    )
    SELECT p.id, p.file_no, (p.first_name || ' ' || p.last_name) AS name,
           s.first_w, s.last_w, ROUND(s.first_w - s.last_w,1) AS lost, s.n AS visits
    FROM s JOIN patients p ON p.id = s.patient_id
    WHERE s.rn = 1 AND s.n >= 2
    ORDER BY lost DESC LIMIT 8
  `).all();

  const weekdays = db.prepare(`
    SELECT CAST(strftime('%w', date) AS INTEGER) AS dow, COUNT(*) AS n
    FROM appointments WHERE status NOT IN ('cancelled','no_show') GROUP BY dow ORDER BY dow
  `).all();
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
router.get('/today', wrap((req, res) => {
  const items = db.prepare(`
    SELECT a.id, a.time, a.duration_min, a.visit_type, a.status, a.patient_id,
           (p.first_name || ' ' || p.last_name) AS patient_name, p.file_no, p.phone
    FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.date = ? ORDER BY a.time
  `).all(todayISO());
  res.json({ date: todayISO(), items });
}));
