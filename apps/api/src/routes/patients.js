// إدارة المرضى: CRUD + بحث سريع + ملف المريض الشامل في صفحة واحدة
import { Router } from 'express';
import { withTotals } from './plans.js';
import { db, nextFileNo, audit, NOW } from '../db.js';
import {
  badRequest, conflict, notFound, pick, str, requiredStr, wrap,
  calcBMI, bmiCategory, idealWeight, ageFromBirthDate, sumMacros, isDate, toNum, todayISO,
} from '../lib.js';
import { adherenceSeries, goalDirection } from '../adherence.js';
import { canWrite } from '../auth.js';

export const router = Router();

const PATIENT_FIELDS = [
  'first_name', 'last_name', 'phone', 'birth_date', 'gender', 'height_cm',
  'start_weight', 'goal_weight', 'goal', 'notes', 'status',
  'activity_level', 'reminders_opt_in', 'daily_reminder',
  'chronic_conditions', 'allergies', 'medications', 'forbidden_foods', 'blood_type',
];
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

/** التحقق من مدخلات المريض + حساب الحقول المشتقة في السيرفر */
function normalizePatient(input, { partial = false } = {}) {
  const p = pick(input, PATIENT_FIELDS);
  if (!partial || p.first_name !== undefined) p.first_name = requiredStr(p.first_name, 'الاسم', 120);
  if (!partial || p.last_name !== undefined) p.last_name = requiredStr(p.last_name, 'اللقب', 120);
  p.phone = str(p.phone, 40);
  p.gender = p.gender === 'male' || p.gender === 'female' ? p.gender : null;
  if (p.birth_date != null && p.birth_date !== '') {
    if (!isDate(String(p.birth_date))) throw badRequest('تاريخ الميلاد يجب أن يكون بصيغة YYYY-MM-DD');
    p.birth_date = String(p.birth_date);
  } else p.birth_date = null;
  for (const k of ['height_cm', 'start_weight', 'goal_weight']) {
    const v = toNum(p[k]);
    if (v !== null && (v <= 0 || v > 500)) throw badRequest(`قيمة «${k}» غير منطقية`);
    p[k] = v;
  }
  p.goal = str(p.goal, 500);
  p.notes = str(p.notes, 4000);
  for (const k of ['chronic_conditions', 'allergies', 'medications', 'forbidden_foods']) p[k] = str(p[k], 1000);
  p.blood_type = BLOOD_TYPES.includes(String(p.blood_type || '').toUpperCase()) ? String(p.blood_type).toUpperCase() : null;
  p.status = ['active', 'inactive', 'archived'].includes(p.status) ? p.status : 'active';
  p.activity_level = ACTIVITY_LEVELS.includes(p.activity_level) ? p.activity_level : null;
  p.reminders_opt_in = p.reminders_opt_in === undefined ? 1 : flag(p.reminders_opt_in);
  p.daily_reminder = flag(p.daily_reminder);
  // تحديث جزئي: الحقول غير المرسلة لا تُمسّ (كان إرسال «الملاحظات» وحدها يمسح الهاتف وغيره)
  if (partial) for (const k of PATIENT_FIELDS) if (input[k] === undefined) delete p[k];
  return p;
}

/** حقول إضافية محسوبة تُعرض ولا تُقبل من العميل */
function decorate(row) {
  if (!row) return row;
  const age = ageFromBirthDate(row.birth_date);
  const bmi = calcBMI(row.start_weight ?? row.last_weight, row.height_cm);
  const targetBmi = calcBMI(row.goal_weight, row.height_cm);
  return {
    ...row,
    full_name: `${row.first_name} ${row.last_name}`.trim(),
    age,
    start_bmi: bmi,
    start_bmi_category: bmiCategory(bmi)?.label ?? null,
    target_bmi: targetBmi,
    target_bmi_category: bmiCategory(targetBmi)?.label ?? null,
    ideal_weight: idealWeight(row.height_cm, row.gender),
    to_lose: row.start_weight != null && row.goal_weight != null
      ? Math.round((row.start_weight - row.goal_weight) * 10) / 10 : null,
  };
}

// ---------- قائمة + بحث سريع ----------
router.get('/', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = ['active', 'inactive', 'archived'].includes(req.query.status) ? req.query.status : null;
  const where = [];
  const params = {};
  if (q) {
    where.push(`(p.first_name ILIKE @q OR p.last_name ILIKE @q OR (p.first_name || ' ' || p.last_name) ILIKE @q
                 OR p.file_no ILIKE @q OR COALESCE(p.phone,'') ILIKE @q)`);
    params.q = `%${q}%`;
  }
  if (status) { where.push(`p.status = @status`); params.status = status; }

  const sortMap = {
    file_no: 'p.file_no',
    name: 'lower(p.last_name)',
    created: 'p.created_at',
  };
  const sort = sortMap[String(req.query.sort || 'created')] || sortMap.created;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await db.get(`SELECT COUNT(*) AS n FROM patients p ${whereSql}`, params)).n;

  const rows = await db.all(`
    SELECT p.*,
           v.visit_date AS last_visit,
           m.weight_kg  AS last_weight,
           m.bmi        AS last_bmi,
           COALESCE(f.paid_total, 0) AS paid_total,
           (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id AND a.status='scheduled') AS upcoming_count
    FROM patients p
    LEFT JOIN visits v ON v.id = (SELECT id FROM visits x WHERE x.patient_id = p.id ORDER BY visit_date DESC LIMIT 1)
    LEFT JOIN measurements m ON m.id = (SELECT id FROM measurements y WHERE y.patient_id = p.id ORDER BY measured_on DESC, id DESC LIMIT 1)
    LEFT JOIN patient_financials f ON f.patient_id = p.id
    ${whereSql}
    ORDER BY ${sort} DESC, p.id DESC
    LIMIT @limit OFFSET @offset
  `, { ...params, limit, offset });

  res.json({
    total,
    limit,
    offset,
    items: rows.map((r) => ({
      ...decorate(r),
      last_bmi_category: bmiCategory(r.last_bmi)?.label ?? null,
    })),
  });
}));

// ---------- إنشاء ----------
router.post('/', canWrite(), wrap(async (req, res) => {
  const p = normalizePatient(req.body);
  // رقم الملف + الإدخال في معاملة واحدة مع قفل كي لا يأخذ مريضان نفس الرقم في نفس اللحظة
  const fileNo = { value: null };
  const newId = await db.tx(async () => {
    await db.get(`SELECT pg_advisory_xact_lock(724302)`);
    fileNo.value = await nextFileNo();
    return db.insert(`
    INSERT INTO patients (file_no, first_name, last_name, phone, birth_date, gender, height_cm,
                          start_weight, goal_weight, goal, notes, status, activity_level,
                          reminders_opt_in, daily_reminder, created_by,
                          chronic_conditions, allergies, medications, forbidden_foods, blood_type)
    VALUES (@file_no, @first_name, @last_name, @phone, @birth_date, @gender, @height_cm,
            @start_weight, @goal_weight, @goal, @notes, @status, @activity_level,
            @reminders_opt_in, @daily_reminder, @created_by,
            @chronic_conditions, @allergies, @medications, @forbidden_foods, @blood_type)
  `, { ...p, file_no: fileNo.value, created_by: req.user.id });
  });
  await audit({ userId: req.user.id, action: 'patient.create', entity: 'patients', entityId: newId, detail: { file_no: fileNo.value } });
  res.status(201).json(await getPatient(newId));
}));

// ---------- ملف المريض الشامل (صفحة واحدة) ----------
async function getPatient(id) {
  const row = await db.get(`
    SELECT p.*,
           v.visit_date AS last_visit,
           m.weight_kg AS last_weight, m.bmi AS last_bmi, m.measured_on AS last_measured_on
    FROM patients p
    LEFT JOIN visits v ON v.id = (SELECT id FROM visits x WHERE x.patient_id = p.id ORDER BY visit_date DESC LIMIT 1)
    LEFT JOIN measurements m ON m.id = (SELECT id FROM measurements y WHERE y.patient_id = p.id ORDER BY measured_on DESC, id DESC LIMIT 1)
    WHERE p.id = ?
  `, id);
  if (!row) throw notFound('المريض غير موجود');
  return decorate(row);
}

router.get('/:id(\\d+)', wrap(async (req, res) => res.json(await getPatient(Number(req.params.id)))));

router.get('/:id(\\d+)/profile', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const patient = await getPatient(id);

  const visits = await db.all(`
    SELECT v.*, u.full_name AS staff_name,
           (SELECT COUNT(*) FROM measurements m WHERE m.visit_id = v.id) AS has_measurements
    FROM visits v LEFT JOIN users u ON u.id = v.created_by
    WHERE v.patient_id = ? ORDER BY v.visit_date DESC, v.id DESC
  `, id);

  const measurements = (await db.all(`
    SELECT m.*, u.full_name AS staff_name FROM measurements m
    LEFT JOIN users u ON u.id = m.created_by
    WHERE m.patient_id = ? ORDER BY m.measured_on ASC, m.id ASC
  `, id)).map((m) => ({
    ...m,
    bmi: calcBMI(m.weight_kg, m.height_cm ?? patient.height_cm),
    bmi_category: bmiCategory(calcBMI(m.weight_kg, m.height_cm ?? patient.height_cm))?.label ?? null,
    waist_hip_ratio: m.waist_cm && m.hip_cm ? Math.round((m.waist_cm / m.hip_cm) * 100) / 100 : null,
  }));

  const planRows = await db.all(`SELECT * FROM diet_plans WHERE patient_id = ? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id DESC`, id);
  // كل الوجبات في استعلام واحد بدل استعلام لكل خطة (أسرع بكثير على قاعدة بعيدة)
  const allMeals = planRows.length
    ? await db.all(`SELECT * FROM diet_meals WHERE plan_id = ANY(?::int[]) ORDER BY day_of_week NULLS FIRST, position, id`, planRows.map((pl) => pl.id))
    : [];
  const plans = planRows.map((pl) => {
    const meals = allMeals.filter((m) => m.plan_id === pl.id);
    return { ...withTotals(pl, meals), meals_count: meals.length };
  });

  const appointments = await db.all(`SELECT * FROM appointments WHERE patient_id = ? ORDER BY date DESC, time DESC LIMIT 200`, id);

  const payments = await db.all(`
    SELECT pa.*, u.full_name AS staff_name FROM payments pa
    LEFT JOIN users u ON u.id = pa.recorded_by
    WHERE pa.patient_id = ? ORDER BY pa.paid_on DESC, pa.id DESC
  `, id);
  const paidTotal = payments.filter((x) => !x.voided).reduce((s, x) => s + x.amount, 0);
  const visitCount = new Set(measurements.map((m) => m.visit_id ?? m.id)).size;

  // تطور الوزن مع الفروقات التراكمية
  let baseline = measurements.length ? measurements[0].weight_kg : patient.start_weight;
  const weightSeries = measurements.map((m, i) => ({
    date: m.measured_on,
    visit_no: i + 1,
    weight_kg: m.weight_kg,
    bmi: m.bmi,
    body_fat_pct: m.body_fat_pct,
    waist_cm: m.waist_cm,
    delta_vs_prev: i === 0 ? 0 : (m.weight_kg ?? 0) - (measurements[i - 1].weight_kg ?? 0),
    delta_vs_start: baseline != null && m.weight_kg != null
      ? Math.round((m.weight_kg - baseline) * 10) / 10 : null,
  }));

  const adherence = adherenceSeries(visits, measurements, goalDirection(patient));
  res.json({
    patient,
    visits,
    adherence,
    measurements,
    weight_series: weightSeries,
    plans,
    active_plan: plans.find((p) => p.status === 'active') ?? null,
    appointments,
    next_appointment: appointments
      .filter((a) => a.status === 'scheduled' || a.status === 'confirmed')
      .filter((a) => a.date >= todayISO())
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] ?? null,
    payments,
    financials: {
      paid_total: Math.round(paidTotal * 100) / 100,
      payments_count: payments.length,
      avg_payment: payments.length ? Math.round((paidTotal / payments.filter((x) => !x.voided).length || 0) * 100) / 100 : 0,
    },
    stats: {
      visits_count: visits.length,
      measurements_count: measurements.length,
      plans_count: plans.length,
      weight_lost: weightSeries.length > 1
        ? Math.round(((weightSeries[0].weight_kg ?? 0) - (weightSeries.at(-1).weight_kg ?? 0)) * 10) / 10
        : 0,
      weeks_followed: measurements.length > 1
        ? Math.max(1, Math.round((new Date(measurements.at(-1).measured_on) - new Date(measurements[0].measured_on)) / (7 * 864e5)))
        : 0,
    },
  });
}));

// ---------- الالتزام بالخطة مقابل نزول الوزن ----------
router.get('/:id(\\d+)/adherence', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const patient = await getPatient(id);
  const visits = await db.all(`SELECT * FROM visits WHERE patient_id = ? ORDER BY visit_date, id`, id);
  const measurements = await db.all(`SELECT * FROM measurements WHERE patient_id = ? ORDER BY measured_on, id`, id);
  res.json(adherenceSeries(visits, measurements, goalDirection(patient)));
}));

// ---------- تحديث ----------
router.put('/:id(\\d+)', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.get(`SELECT * FROM patients WHERE id = ?`, id);
  if (!existing) throw notFound('المريض غير موجود');
  const p = { ...existing, ...normalizePatient(req.body, { partial: true }) };
  await db.run(`
    UPDATE patients SET first_name=@first_name, last_name=@last_name, phone=@phone, birth_date=@birth_date,
      gender=@gender, height_cm=@height_cm, start_weight=@start_weight, goal_weight=@goal_weight,
      goal=@goal, notes=@notes, status=@status, activity_level=@activity_level,
      reminders_opt_in=@reminders_opt_in, daily_reminder=@daily_reminder,
      chronic_conditions=@chronic_conditions, allergies=@allergies, medications=@medications,
      forbidden_foods=@forbidden_foods, blood_type=@blood_type, updated_at=${NOW}
    WHERE id=@id
  `, { ...p, id });
  await audit({ userId: req.user.id, action: 'patient.update', entity: 'patients', entityId: id });
  res.json(await getPatient(id));
}));

// ---------- حذف (للمدير فقط) ----------
router.delete('/:id(\\d+)', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.get(`SELECT id, file_no FROM patients WHERE id = ?`, id);
  if (!row) throw notFound('المريض غير موجود');
  if (req.user.role !== 'admin') {
    // حذف ناعم للحماية: أرشفة بدل التدمير لغير المدير
    await db.run(`UPDATE patients SET status='archived', updated_at=${NOW} WHERE id=?`, id);
    await audit({ userId: req.user.id, action: 'patient.archive', entity: 'patients', entityId: id });
    return res.json({ archived: true, id });
  }
  await db.run(`DELETE FROM patients WHERE id = ?`, id);
  await audit({ userId: req.user.id, action: 'patient.delete', entity: 'patients', entityId: id, detail: { file_no: row.file_no } });
  res.json({ deleted: true, id });
}));

// ---------- موافقات: هل الملف مستخدم في عمليات؟ ----------
router.get('/:id(\\d+)/warnings', wrap(async (req, res) => {
  const id = Number(req.params.id);
  res.json(await db.get(`
    SELECT (SELECT COUNT(*) FROM measurements WHERE patient_id=?) AS measurements,
           (SELECT COUNT(*) FROM visits       WHERE patient_id=?) AS visits,
           (SELECT COUNT(*) FROM diet_plans   WHERE patient_id=?) AS plans,
           (SELECT COUNT(*) FROM appointments WHERE patient_id=?) AS appointments,
           (SELECT COUNT(*) FROM payments     WHERE patient_id=?) AS payments
  `, id, id, id, id, id));
}));
