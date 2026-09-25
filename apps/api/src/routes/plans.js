// البرامج الغذائية: خطة + وجبات، المجاميع محسوبة، ونسخة من خطة سابقة
import { Router } from 'express';
import { db, audit, NOW } from '../db.js';
import { badRequest, notFound, str, requiredStr, wrap, sumMacros, isDate, toNum, todayISO } from '../lib.js';
import { getSetting } from '../db.js';
import { ACTIVITY, GOALS, DAYS, ageFrom, inferGoal, computeTargets, generateWeeklyPlan, defaultAdvice, buildShoppingList, shoppingListText } from '../nutrition.js';
import { canWrite } from '../auth.js';

export const router = Router();

const MEAL_TEMPLATE = [
  { slot: 'الفطور', slot_time: '08:00' },
  { slot: 'سناك صباحي', slot_time: '11:00' },
  { slot: 'الغداء', slot_time: '14:00' },
  { slot: 'سناك عصري', slot_time: '17:00' },
  { slot: 'العشاء', slot_time: '20:00' },
];

function mealRow(m, i) {
  const slot = requiredStr(m.slot, `اسم الوجبة #${i + 1}`, 80);
  return {
    slot,
    slot_time: /^\d{1,2}:\d{2}$/.test(String(m.slot_time || '')) ? String(m.slot_time).slice(-5) : null,
    title: str(m.title, 200) || slot,   // عنوان الوجبة اختياري — يُستعمل اسم الوقت بديلاً
    items: str(m.items, 2000),
    portions: str(m.portions, 1000),
    kcal: toNum(m.kcal),
    protein_g: toNum(m.protein_g),
    carbs_g: toNum(m.carbs_g),
    fat_g: toNum(m.fat_g),
    position: Number.isFinite(Number(m.position)) ? Number(m.position) : i,
    // خطة أسبوعية: 0=السبت … 6=الجمعة، وبدونه = كل يوم
    day_of_week: m.day_of_week === null || m.day_of_week === undefined || m.day_of_week === ''
      ? null
      : (Number.isInteger(Number(m.day_of_week)) && Number(m.day_of_week) >= 0 && Number(m.day_of_week) <= 6
        ? Number(m.day_of_week)
        : (() => { throw badRequest(`يوم الوجبة #${i + 1} غير صالح (0–6)`); })()),
  };
}

const INSERT_MEAL = `
  INSERT INTO diet_meals (plan_id, slot, slot_time, title, items, portions, kcal, protein_g, carbs_g, fat_g, position, day_of_week)
  VALUES (@plan_id, @slot, @slot_time, @title, @items, @portions, @kcal, @protein_g, @carbs_g, @fat_g, @position, @day_of_week)`;
const MEAL_ORDER = 'ORDER BY day_of_week NULLS FIRST, position, id';

async function loadPlan(id) {
  const plan = await db.get(`SELECT * FROM diet_plans WHERE id = ?`, id);
  if (!plan) throw notFound('البرنامج الغذائي غير موجود');
  const meals = await db.all(`SELECT * FROM diet_meals WHERE plan_id = ? ${MEAL_ORDER}`, id);
  return { ...plan, meals, totals: sumMacros(meals), ...weeklyInfo(meals) };
}

/** الخطة الأسبوعية: المجاميع اليومية تخص يوماً واحداً لا مجموع الأسبوع */
function weeklyInfo(meals) {
  const weekly = meals.some((m) => m.day_of_week !== null && m.day_of_week !== undefined);
  if (!weekly) return { weekly: false };
  const every = meals.filter((m) => m.day_of_week === null);
  const by_day = DAYS.map((name, d) => {
    const t = sumMacros([...every, ...meals.filter((m) => m.day_of_week === d)]);
    return { day: d, name, ...t };
  }).filter((x) => meals.some((m) => m.day_of_week === x.day) || every.length);
  const avg = (k) => Math.round(by_day.reduce((s, d) => s + (d[k] || 0), 0) / (by_day.length || 1));
  return { weekly: true, by_day, daily_average: { kcal: avg('kcal'), protein_g: avg('protein_g'), carbs_g: avg('carbs_g'), fat_g: avg('fat_g') } };
}

async function patientBasics(patientId) {
  const p = await db.get(`SELECT * FROM patients WHERE id=?`, patientId);
  if (!p) throw badRequest('رقم المريض غير موجود');
  const m = await db.get(`SELECT weight_kg, height_cm FROM measurements WHERE patient_id=? AND weight_kg IS NOT NULL
                          ORDER BY measured_on DESC, id DESC LIMIT 1`, patientId);
  return { p, weight: m?.weight_kg ?? p.start_weight, height: m?.height_cm ?? p.height_cm };
}

router.get('/', wrap(async (req, res) => {
  const pid = req.query.patient_id ? Number(req.query.patient_id) : null;
  const rows = await db.all(`
    SELECT dp.*, p.first_name, p.last_name, p.file_no,
      (SELECT COUNT(*) FROM diet_meals m WHERE m.plan_id = dp.id) AS meals_count,
      (SELECT COALESCE(SUM(m.kcal),0) FROM diet_meals m WHERE m.plan_id = dp.id) AS kcal_total
    FROM diet_plans dp JOIN patients p ON p.id = dp.patient_id
    ${pid ? 'WHERE dp.patient_id = ?' : ''}
    ORDER BY dp.id DESC LIMIT 500
  `, ...(pid ? [pid] : []));
  res.json({ items: rows });
}));

router.get('/meal-template', wrap((req, res) => res.json({ items: MEAL_TEMPLATE })));

// ---------- توليد خطة أسبوعية ذكية ----------
// الاحتياج بمعادلة Mifflin-St Jeor × معامل النشاط ± هدف الوزن، ثم 7 أيام × 5 وجبات من مكتبة أطعمة محلية
// تُكيَّف كمياتها على سعرات كل وجبة. save=false → معاينة فقط، save=true → تُحفظ كمسودة.
router.post('/generate', canWrite(), wrap(async (req, res) => {
  const b = req.body || {};
  const patientId = Number(b.patient_id);
  if (!patientId) throw badRequest('patient_id مطلوب');
  const { p, weight: w0, height: h0 } = await patientBasics(patientId);
  const weight = toNum(b.weight_kg) ?? w0;
  const height = toNum(b.height_cm) ?? h0;
  const activity = ACTIVITY[b.activity_level] ? b.activity_level : (p.activity_level || 'light');
  const goal = inferGoal({ goal: b.goal, goalWeight: p.goal_weight, weight, goalText: p.goal });
  let targets;
  try {
    targets = computeTargets({ weight, height, age: ageFrom(p.birth_date), gender: p.gender, activity, goal, targetKcal: toNum(b.target_kcal) });
  } catch (e) { throw badRequest(e.message + ' — أضف قياساً أو عدّل بيانات المريض'); }
  const days = Math.max(1, Math.min(7, Number(b.days) || 7));
  const { meals, by_day } = generateWeeklyPlan(targets, { days, seed: Number(b.seed) || 0 });
  const title = str(b.title, 160) || `خطة أسبوعية ${GOALS[goal].label} — ${targets.kcal} سعرة`;
  const advice = defaultAdvice(targets);
  const warnings = [];
  if (!p.gender) warnings.push('الجنس غير محدد — حُسب كأنثى');
  if (!p.birth_date) warnings.push('تاريخ الميلاد غير مسجل — افتُرض العمر 30 سنة');
  if (!b.save) {
    return res.json({ preview: true, patient_id: patientId, title, targets, by_day, meals, advice, warnings,
      activity_levels: Object.entries(ACTIVITY).map(([k, v]) => ({ key: k, ...v })), goals: Object.entries(GOALS).map(([k, v]) => ({ key: k, label: v.label })) });
  }
  const newId = await db.tx(async () => {
    const planId = await db.insert(`
      INSERT INTO diet_plans (patient_id, title, start_date, target_kcal, target_protein_g, target_carbs_g,
        target_fat_g, advice, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    patientId, title, isDate(String(b.start_date || '')) ? b.start_date : todayISO(), targets.kcal, targets.protein_g,
    targets.carbs_g, targets.fat_g, advice, req.user.id);
    for (const m of meals) await db.run(INSERT_MEAL, { ...m, plan_id: planId });
    if (b.activity_level && ACTIVITY[b.activity_level] && p.activity_level !== b.activity_level) {
      await db.run(`UPDATE patients SET activity_level=?, updated_at=${NOW} WHERE id=?`, b.activity_level, patientId);
    }
    return planId;
  });
  await audit({ userId: req.user.id, action: 'plan.generate', entity: 'diet_plans', entityId: newId, detail: { kcal: targets.kcal, goal, activity } });
  res.status(201).json({ ...(await loadPlan(newId)), targets, warnings });
}));

// ---------- قائمة التسوق من الخطة ----------
router.get('/:id(\\d+)/shopping-list', wrap(async (req, res) => {
  const plan = await loadPlan(Number(req.params.id));
  const days = Math.max(1, Math.min(31, Number(req.query.days) || 7));
  const p = await db.get(`SELECT id, first_name, last_name, phone FROM patients WHERE id=?`, plan.patient_id);
  const groups = buildShoppingList(plan.meals, { days });
  const clinicName = await getSetting('clinic.name', '');
  const text = shoppingListText({ patientName: `${p.first_name} ${p.last_name}`, planTitle: plan.title, days, groups, clinicName });
  res.json({ plan_id: plan.id, plan_title: plan.title, patient: p, days, groups, items_count: groups.reduce((s, g) => s + g.items.length, 0), text });
}));

router.get('/:id(\\d+)', wrap(async (req, res) => res.json(await loadPlan(Number(req.params.id)))));

router.post('/', canWrite(), wrap(async (req, res) => {
  const patientId = Number(req.body.patient_id);
  if (!patientId) throw badRequest('patient_id مطلوب');
  if (!(await db.get(`SELECT id FROM patients WHERE id=?`, patientId))) throw badRequest('رقم المريض غير موجود');
  const meals = Array.isArray(req.body.meals) ? req.body.meals.map(mealRow) : [];
  const title = requiredStr(req.body.title, 'عنوان البرنامج', 160);
  const newId = await db.tx(async () => {
    const planId = await db.insert(`
      INSERT INTO diet_plans (patient_id, title, start_date, end_date, target_kcal, target_protein_g,
        target_carbs_g, target_fat_g, advice, status, created_by)
      VALUES (@patient_id, @title, @start_date, @end_date, @target_kcal, @target_protein_g,
        @target_carbs_g, @target_fat_g, @advice, @status, @created_by)
    `, {
      patient_id: patientId,
      title,
      start_date: isDate(String(req.body.start_date || '')) ? req.body.start_date : null,
      end_date: isDate(String(req.body.end_date || '')) ? req.body.end_date : null,
      target_kcal: toNum(req.body.target_kcal),
      target_protein_g: toNum(req.body.target_protein_g),
      target_carbs_g: toNum(req.body.target_carbs_g),
      target_fat_g: toNum(req.body.target_fat_g),
      advice: str(req.body.advice, 4000),
      status: ['draft', 'active', 'archived'].includes(req.body.status) ? req.body.status : 'draft',
      created_by: req.user.id,
    });
    for (const m of meals) await db.run(INSERT_MEAL, { ...m, plan_id: planId });
    return planId;
  });
  await audit({ userId: req.user.id, action: 'plan.create', entity: 'diet_plans', entityId: newId });
  res.status(201).json(await loadPlan(newId));
}));

// تعديل الخطة + استبدال الوجبات بالكامل (أبسط وأأمن للمحرر)
router.put('/:id(\\d+)', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const plan = await db.get(`SELECT * FROM diet_plans WHERE id=?`, id);
  if (!plan) throw notFound('البرنامج الغذائي غير موجود');
  const newMeals = Array.isArray(req.body.meals) ? req.body.meals.map(mealRow) : null; // تحقق قبل أي كتابة
  const title = requiredStr(req.body.title ?? plan.title, 'عنوان البرنامج', 160);
  await db.tx(async () => {
    await db.run(`
      UPDATE diet_plans SET title=@title, start_date=@start_date, end_date=@end_date,
        target_kcal=@target_kcal, target_protein_g=@target_protein_g, target_carbs_g=@target_carbs_g,
        target_fat_g=@target_fat_g, advice=@advice, status=@status, updated_at=${NOW}
      WHERE id=@id
    `, {
      id,
      title,
      start_date: req.body.start_date !== undefined ? (isDate(String(req.body.start_date)) ? req.body.start_date : null) : plan.start_date,
      end_date: req.body.end_date !== undefined ? (isDate(String(req.body.end_date)) ? req.body.end_date : null) : plan.end_date,
      target_kcal: req.body.target_kcal !== undefined ? toNum(req.body.target_kcal) : plan.target_kcal,
      target_protein_g: req.body.target_protein_g !== undefined ? toNum(req.body.target_protein_g) : plan.target_protein_g,
      target_carbs_g: req.body.target_carbs_g !== undefined ? toNum(req.body.target_carbs_g) : plan.target_carbs_g,
      target_fat_g: req.body.target_fat_g !== undefined ? toNum(req.body.target_fat_g) : plan.target_fat_g,
      advice: req.body.advice !== undefined ? str(req.body.advice, 4000) : plan.advice,
      status: ['draft', 'active', 'archived'].includes(req.body.status) ? req.body.status : plan.status,
    });
    if (newMeals) {
      await db.run(`DELETE FROM diet_meals WHERE plan_id=?`, id);
      for (const m of newMeals) await db.run(INSERT_MEAL, { ...m, plan_id: id });
    }
  });
  await audit({ userId: req.user.id, action: 'plan.update', entity: 'diet_plans', entityId: id });
  res.json(await loadPlan(id));
}));

// تفعيل خطة (واحدة نشطة فقط لكل مريض)
router.post('/:id(\\d+)/activate', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const plan = await db.get(`SELECT * FROM diet_plans WHERE id=?`, id);
  if (!plan) throw notFound('البرنامج الغذائي غير موجود');
  await db.tx(async () => {
    await db.run(`UPDATE diet_plans SET status='archived' WHERE patient_id=? AND status='active' AND id<>?`, plan.patient_id, id);
    await db.run(`UPDATE diet_plans SET status='active', updated_at=${NOW} WHERE id=?`, id);
  });
  await audit({ userId: req.user.id, action: 'plan.activate', entity: 'diet_plans', entityId: id });
  res.json(await loadPlan(id));
}));

// تكرار خطة لمريض آخر أو لنفس المريض
router.post('/:id(\\d+)/duplicate', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const plan = await db.get(`SELECT * FROM diet_plans WHERE id=?`, id);
  if (!plan) throw notFound('البرنامج الغذائي غير موجود');
  const targetPatient = Number(req.body.patient_id) || plan.patient_id;
  if (!(await db.get(`SELECT id FROM patients WHERE id=?`, targetPatient))) throw badRequest('رقم المريض غير موجود');
  const meals = await db.all(`SELECT * FROM diet_meals WHERE plan_id=? ${MEAL_ORDER}`, id);
  const newId = await db.tx(async () => {
    const planId = await db.insert(`
      INSERT INTO diet_plans (patient_id, title, start_date, end_date, target_kcal, target_protein_g,
        target_carbs_g, target_fat_g, advice, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
    `,
      targetPatient,
      `${plan.title} — نسخة`, plan.start_date, plan.end_date, plan.target_kcal, plan.target_protein_g,
      plan.target_carbs_g, plan.target_fat_g, plan.advice, req.user.id,
    );
    for (const m of meals) await db.run(INSERT_MEAL, { ...m, plan_id: planId });
    return planId;
  });
  await audit({ userId: req.user.id, action: 'plan.duplicate', entity: 'diet_plans', entityId: newId, detail: { from: id } });
  res.status(201).json(await loadPlan(newId));
}));

router.delete('/:id(\\d+)', canWrite(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await db.get(`SELECT id FROM diet_plans WHERE id=?`, id))) throw notFound();
  await db.run(`DELETE FROM diet_plans WHERE id=?`, id);
  await audit({ userId: req.user.id, action: 'plan.delete', entity: 'diet_plans', entityId: id });
  res.json({ deleted: true, id });
}));

// حاسبة بدائل سريعة داخل المحرر (ثوابت غذائية مبسطة)
const FOODS = {
  'خبز أسمر شريحة': { g: 30, kcal: 75, p: 3.5, c: 13, f: 1 },
  'أرز مطبوخ كوب': { g: 158, kcal: 205, p: 4.3, c: 45, f: 0.4 },
  'مكرونة مطبوخة كوب': { g: 140, kcal: 220, p: 8, c: 43, f: 1.3 },
  'عدس مطبوخ كوب': { g: 198, kcal: 230, p: 18, c: 40, f: 0.8 },
  'فول مدمس كوب': { g: 260, kcal: 220, p: 13, c: 38, f: 1.5 },
  'صدر دجاج مشوي 100غ': { g: 100, kcal: 165, p: 31, c: 0, f: 3.6 },
  'سمك مشوي 100غ': { g: 100, kcal: 130, p: 26, c: 0, f: 3 },
  'لحم أحمر 100غ': { g: 100, kcal: 250, p: 26, c: 0, f: 15 },
  'بيضة مسلوقة': { g: 50, kcal: 78, p: 6.3, c: 0.6, f: 5.3 },
  'زبادي طبيعي كوب': { g: 245, kcal: 145, p: 8.5, c: 11, f: 8 },
  'جبن قريش 100غ': { g: 100, kcal: 98, p: 11, c: 3.4, f: 4.2 },
  'خضار ورقية كوب': { g: 30, kcal: 10, p: 1, c: 2, f: 0.1 },
  'فاكهة حبة وسط': { g: 150, kcal: 75, p: 0.5, c: 19, f: 0.2 },
  'زيت زيتون ملعقة': { g: 14, kcal: 119, p: 0, c: 0, f: 13.5 },
  'مكسرات 30غ': { g: 30, kcal: 173, p: 5, c: 6, f: 15 },
};
router.get('/foods/lookup', wrap((req, res) => {
  const q = String(req.query.q || '').trim();
  const items = Object.entries(FOODS)
    .filter(([k]) => !q || k.includes(q))
    .map(([name, v]) => ({ name, ...v }));
  res.json({ items });
}));
