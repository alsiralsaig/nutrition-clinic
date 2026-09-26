// ============================================================
//  محرك التغذية: حساب السعرات + توليد خطة أسبوعية + قائمة تسوق
//  دوال نقية بلا قاعدة بيانات (سهلة الاختبار، ويستعملها تطبيق الموبايل عبر الـ API)
// ============================================================

/** معاملات النشاط القياسية (Harris-Benedict / FAO) */
export const ACTIVITY = {
  sedentary:   { factor: 1.2,   label: 'خامل (بلا رياضة تقريباً)' },
  light:       { factor: 1.375, label: 'نشاط خفيف (1–3 أيام أسبوعياً)' },
  moderate:    { factor: 1.55,  label: 'نشاط متوسط (3–5 أيام)' },
  active:      { factor: 1.725, label: 'نشيط (6–7 أيام)' },
  very_active: { factor: 1.9,   label: 'نشيط جداً (عمل بدني أو تمرين مرتين يومياً)' },
};

export const GOALS = {
  lose:     { label: 'إنقاص الوزن', delta: -500, split: { p: 0.30, c: 0.40, f: 0.30 } },
  maintain: { label: 'تثبيت الوزن', delta: 0,    split: { p: 0.25, c: 0.50, f: 0.25 } },
  gain:     { label: 'زيادة الوزن', delta: 350,  split: { p: 0.25, c: 0.50, f: 0.25 } },
};

/** 0 = السبت … 6 = الجمعة (بداية الأسبوع في السودان) */
export const DAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
/** رقم اليوم بنظامنا من تاريخ ISO (YYYY-MM-DD) */
export function dayIndex(iso) {
  const js = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0=الأحد
  return (js + 1) % 7;                                   // السبت=0
}

const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;

export function ageFrom(birthDate, today = new Date()) {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const b = new Date(`${birthDate}T00:00:00Z`);
  let a = today.getUTCFullYear() - b.getUTCFullYear();
  const m = today.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < b.getUTCDate())) a -= 1;
  return a >= 0 && a < 130 ? a : null;
}

/** معادلة Mifflin-St Jeor — الأدق للبالغين في الممارسة السريرية */
export function bmr({ weight, height, age, gender }) {
  const base = 10 * weight + 6.25 * height - 5 * age;
  return gender === 'male' ? base + 5 : base - 161;
}

/** يستنتج الهدف من الوزن المستهدف أو من نص الهدف الغذائي */
export function inferGoal({ goal, goalWeight, weight, goalText }) {
  if (goal && GOALS[goal]) return goal;
  if (goalWeight && weight) {
    if (goalWeight < weight - 1) return 'lose';
    if (goalWeight > weight + 1) return 'gain';
    return 'maintain';
  }
  const t = String(goalText || '');
  if (/إنقاص|تخسيس|نزول|خفض|تنحيف/.test(t)) return 'lose';
  if (/زيادة|تسمين|بناء/.test(t)) return 'gain';
  return 'maintain';
}

/**
 * يحسب الاحتياج اليومي والماكرو.
 * حد أدنى آمن: 1200 سعرة للنساء و1500 للرجال (لا خطة أقل من ذلك دون إشراف طبي خاص).
 */
export function computeTargets({ weight, height, age, gender, activity = 'light', goal = 'maintain', targetKcal }) {
  if (!(weight > 20 && weight < 400)) throw new Error('الوزن الحالي مطلوب (بين 20 و400 كغ)');
  if (!(height > 90 && height < 250)) throw new Error('الطول مطلوب (بين 90 و250 سم)');
  const a = age ?? 30;
  const g = gender === 'male' ? 'male' : 'female';
  const act = ACTIVITY[activity] ? activity : 'light';
  const gl = GOALS[goal] ? goal : 'maintain';
  const b = bmr({ weight, height, age: a, gender: g });
  const tdee = b * ACTIVITY[act].factor;
  const floor = g === 'male' ? 1500 : 1200;
  let kcal = Number(targetKcal) > 0 ? Number(targetKcal) : tdee + GOALS[gl].delta;
  const clamped = kcal < floor;
  kcal = Math.max(floor, Math.round(kcal / 50) * 50);
  const s = GOALS[gl].split;
  // البروتين لا يقل عن 1.2 غ/كغ في خطط الإنقاص (حفاظاً على الكتلة العضلية)
  let protein = (kcal * s.p) / 4;
  if (gl === 'lose') protein = Math.max(protein, 1.2 * Math.min(weight, 120));
  const fat = (kcal * s.f) / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  // الألياف: 14 غ لكل 1000 سعرة (توصية IOM) بين 25 و38 غ · الماء: 35 مل/كغ بين 1.5 و4 لتر (+500 للنشيطين)
  const fiber = Math.min(38, Math.max(25, Math.round((kcal / 1000) * 14)));
  const water = Math.min(4000, Math.max(1500, Math.round((weight * 35 + (['active', 'very_active'].includes(act) ? 500 : 0)) / 250) * 250));
  return {
    bmr: r0(b), tdee: r0(tdee), kcal, protein_g: r0(protein), carbs_g: r0(carbs), fat_g: r0(fat),
    fiber_g: fiber, water_ml: water,
    age: a, gender: g, activity: act, activity_factor: ACTIVITY[act].factor, goal: gl,
    floor_applied: clamped, weekly_change_kg: r1(((kcal - tdee) * 7) / 7700),
  };
}

// ---------- مكتبة الأطعمة (قيم لكل وحدة أساس) ----------
// unit: غ/مل تُقاس لكل 100، والوحدات المعدودة لكل 1. fixed = خضار «حرّة» لا تُضاعف.
export const CATEGORIES = {
  protein: 'اللحوم والأسماك والبيض',
  dairy: 'الألبان',
  legumes: 'البقوليات',
  grains: 'الخبز والحبوب والنشويات',
  veg: 'الخضار',
  fruit: 'الفواكه',
  fats: 'الزيوت والمكسرات',
  other: 'أخرى',
};

const F = (name, unit, kcal, p, c, f, cat, step, fixed = false) => ({ name, unit, per: unit === 'غ' || unit === 'مل' ? 100 : 1, kcal, p, c, f, cat, step, fixed });
export const FOODS = {
  oats: F('شوفان', 'غ', 389, 16.9, 66, 6.9, 'grains', 10),
  bread: F('خبز أسمر', 'شريحة', 75, 3.5, 13, 1, 'grains', 1),
  kisra: F('كسرة', 'قطعة', 90, 2.5, 19, 0.5, 'grains', 1),
  rice: F('أرز مطبوخ', 'غ', 130, 2.7, 28, 0.3, 'grains', 25),
  pasta: F('مكرونة مطبوخة', 'غ', 157, 5.8, 31, 0.9, 'grains', 25),
  potato: F('بطاطس مسلوقة', 'غ', 87, 1.9, 20, 0.1, 'grains', 25),
  foul: F('فول مدمس', 'غ', 110, 7.6, 19.6, 0.4, 'legumes', 25),
  lentils: F('عدس مطبوخ', 'غ', 116, 9, 20, 0.4, 'legumes', 25),
  chickpeas: F('حمص مسلوق', 'غ', 164, 8.9, 27, 2.6, 'legumes', 25),
  chicken: F('صدر دجاج', 'غ', 165, 31, 0, 3.6, 'protein', 10),
  fish: F('سمك بلطي', 'غ', 128, 26, 0, 2.7, 'protein', 10),
  beef: F('لحم بقري قليل الدهن', 'غ', 217, 26, 0, 12, 'protein', 10),
  tuna: F('تونة بالماء', 'غ', 116, 26, 0, 1, 'protein', 10),
  egg: F('بيض', 'حبة', 78, 6.3, 0.6, 5.3, 'protein', 1),
  cottage: F('جبن قريش', 'غ', 98, 11, 3.4, 4.3, 'dairy', 10),
  yogurt: F('زبادي قليل الدسم', 'غ', 63, 5.3, 7, 1.6, 'dairy', 25),
  milk: F('حليب قليل الدسم', 'مل', 42, 3.4, 5, 1, 'dairy', 50),
  dates: F('تمر', 'حبة', 23, 0.2, 6, 0, 'fruit', 1),
  banana: F('موز', 'حبة', 105, 1.3, 27, 0.4, 'fruit', 1),
  apple: F('تفاح', 'حبة', 95, 0.5, 25, 0.3, 'fruit', 1),
  guava: F('جوافة', 'حبة', 37, 1.4, 8, 0.5, 'fruit', 1),
  orange: F('برتقال', 'حبة', 62, 1.2, 15, 0.2, 'fruit', 1),
  mango: F('مانجو', 'غ', 60, 0.8, 15, 0.4, 'fruit', 50),
  cucumber: F('خيار', 'غ', 15, 0.7, 3.6, 0.1, 'veg', 50, true),
  tomato: F('طماطم', 'غ', 18, 0.9, 3.9, 0.2, 'veg', 50, true),
  greens: F('خس وجرجير', 'غ', 20, 1.5, 3, 0.3, 'veg', 25, true),
  mixed_veg: F('خضار مشكلة', 'غ', 65, 2.6, 13, 0.3, 'veg', 50, true),
  okra: F('بامية', 'غ', 33, 1.9, 7, 0.2, 'veg', 50, true),
  molokhia: F('ملوخية', 'غ', 34, 4.7, 6, 0.3, 'veg', 50, true),
  carrot: F('جزر', 'غ', 41, 0.9, 10, 0.2, 'veg', 50, true),
  olive_oil: F('زيت زيتون', 'ملعقة صغيرة', 40, 0, 0, 4.5, 'fats', 1),
  tahini: F('طحينة', 'ملعقة كبيرة', 89, 2.6, 3.2, 8, 'fats', 1),
  peanut: F('فول سوداني', 'غ', 567, 25.8, 16, 49, 'fats', 5),
  almonds: F('لوز', 'غ', 579, 21, 22, 50, 'fats', 5),
  honey: F('عسل', 'ملعقة صغيرة', 21, 0, 5.7, 0, 'other', 1),
};

// الألياف (غ) لكل وحدة أساس (100 غ/مل أو الحبة) — قيم USDA تقريبية
export const FIBER = {
  oats: 10.6, bread: 1.9, kisra: 1.5, rice: 0.4, pasta: 1.8, potato: 1.8, foul: 5.4, lentils: 7.9, chickpeas: 7.6,
  chicken: 0, fish: 0, beef: 0, tuna: 0, egg: 0, cottage: 0, yogurt: 0, milk: 0,
  dates: 0.7, banana: 3.1, apple: 4.4, guava: 3, orange: 3.1, mango: 1.6,
  cucumber: 0.5, tomato: 1.2, greens: 1.8, mixed_veg: 4, okra: 3.2, molokhia: 2, carrot: 2.8,
  olive_oil: 0, tahini: 1.4, peanut: 8.5, almonds: 12.5, honey: 0,
};

// ---------- قوالب الوجبات (كميات أساس تُكيَّف مع السعرات المستهدفة) ----------
export const SLOTS = [
  { key: 'breakfast', slot: 'الفطور', time: '08:00', share: 0.25 },
  { key: 'snack', slot: 'سناك صباحي', time: '11:00', share: 0.10 },
  { key: 'lunch', slot: 'الغداء', time: '14:00', share: 0.35 },
  { key: 'snack', slot: 'سناك عصري', time: '17:00', share: 0.10 },
  { key: 'dinner', slot: 'العشاء', time: '20:00', share: 0.20 },
];

export const MEALS = {
  breakfast: [
    ['فول بزيت الزيتون مع سلطة', [['foul', 150], ['olive_oil', 1], ['bread', 2], ['tomato', 50], ['cucumber', 50]]],
    ['شوفان بالحليب والموز', [['oats', 50], ['milk', 200], ['banana', 1], ['almonds', 10]]],
    ['بيض وجبن قريش', [['egg', 2], ['cottage', 50], ['bread', 2], ['cucumber', 100]]],
    ['بليلة حمص بزيت الزيتون', [['chickpeas', 150], ['olive_oil', 1], ['bread', 1], ['tomato', 50]]],
    ['زبادي بالشوفان والتمر', [['yogurt', 200], ['oats', 30], ['dates', 3]]],
  ],
  snack: [
    ['تفاحة ولوز', [['apple', 1], ['almonds', 10]]],
    ['زبادي بالعسل', [['yogurt', 150], ['honey', 1]]],
    ['تمر وحليب', [['dates', 3], ['milk', 150]]],
    ['جوافة وفول سوداني', [['guava', 2], ['peanut', 15]]],
    ['جزر وخيار بالطحينة', [['carrot', 100], ['cucumber', 100], ['tahini', 1]]],
    ['برتقال', [['orange', 2]]],
    ['مانجو', [['mango', 150]]],
  ],
  lunch: [
    ['دجاج مشوي مع أرز وسلطة', [['chicken', 120], ['rice', 150], ['greens', 100], ['olive_oil', 1]]],
    ['سمك مشوي مع بطاطس وخضار', [['fish', 150], ['potato', 150], ['mixed_veg', 150], ['olive_oil', 1]]],
    ['ملوخية بالدجاج مع كسرة', [['molokhia', 200], ['chicken', 100], ['kisra', 2]]],
    ['بامية باللحم مع أرز', [['okra', 200], ['beef', 100], ['rice', 120]]],
    ['عدس مطبوخ بالخضار', [['lentils', 200], ['mixed_veg', 100], ['bread', 1]]],
    ['مكرونة بالتونة والطماطم', [['pasta', 150], ['tuna', 100], ['tomato', 100], ['olive_oil', 1]]],
  ],
  dinner: [
    ['زبادي بالخيار مع خبز', [['yogurt', 200], ['cucumber', 100], ['bread', 1]]],
    ['سلطة تونة', [['tuna', 80], ['greens', 100], ['bread', 1], ['olive_oil', 1]]],
    ['بيض مسلوق مع خضار سوتيه', [['egg', 2], ['mixed_veg', 150]]],
    ['فول بالطماطم', [['foul', 120], ['tomato', 100], ['olive_oil', 1]]],
    ['جبن قريش مع خبز وطماطم', [['cottage', 100], ['bread', 1], ['tomato', 50]]],
    ['شوربة عدس', [['lentils', 200], ['carrot', 50]]],
  ],
};

const nutr = (key, qty) => {
  const f = FOODS[key];
  const k = qty / f.per;
  return { kcal: f.kcal * k, p: f.p * k, c: f.c * k, f: f.f * k, fb: (FIBER[key] || 0) * k };
};
const roundQty = (key, q) => {
  const f = FOODS[key];
  const r = Math.round(q / f.step) * f.step;
  return Math.max(f.step, r);
};
export const fmtQty = (key, q) => `${FOODS[key].name} — ${q} ${FOODS[key].unit}`;

/** يكيّف كميات قالب وجبة على سعرات مستهدفة (الخضار الحرة ثابتة) */
export function scaleMeal(ingredients, targetKcal) {
  const base = ingredients.map(([k, q]) => ({ k, q, ...nutr(k, q) }));
  const fixed = base.filter((x) => FOODS[x.k].fixed).reduce((s, x) => s + x.kcal, 0);
  const scalable = base.filter((x) => !FOODS[x.k].fixed).reduce((s, x) => s + x.kcal, 0);
  const factor = scalable > 0 ? Math.min(3.5, Math.max(0.45, (targetKcal - fixed) / scalable)) : 1;
  const items = ingredients.map(([k, q]) => {
    const qty = FOODS[k].fixed ? q : roundQty(k, q * factor);
    return { key: k, qty, ...nutr(k, qty) };
  });
  const tot = items.reduce((s, x) => ({ kcal: s.kcal + x.kcal, p: s.p + x.p, c: s.c + x.c, f: s.f + x.f, fb: s.fb + x.fb }), { kcal: 0, p: 0, c: 0, f: 0, fb: 0 });
  return { items, kcal: r0(tot.kcal), protein_g: r1(tot.p), carbs_g: r1(tot.c), fat_g: r1(tot.f), fiber_g: r1(tot.fb) };
}

/**
 * خطة أسبوعية: 7 أيام × 5 وجبات، تدوير القوالب كي لا تتكرر الوجبة نفسها في يومين متتاليين.
 * seed يغيّر نقطة البداية (زر «اقتراح آخر» في الواجهة).
 */
export function generateWeeklyPlan(targets, { days = 7, seed = 0 } = {}) {
  const meals = [];
  const n = Math.max(1, Math.min(7, days));
  for (let d = 0; d < n; d++) {
    SLOTS.forEach((s, si) => {
      const lib = MEALS[s.key];
      // السناك الصباحي والعصري من نفس المكتبة بإزاحة مختلفة
      const idx = (d + seed + si * 3) % lib.length;
      const [title, ingredients] = lib[idx];
      const m = scaleMeal(ingredients, targets.kcal * s.share);
      meals.push({
        day_of_week: d, slot: s.slot, slot_time: s.time, title,
        items: m.items.map((x) => fmtQty(x.key, x.qty)).join('\n'),
        portions: m.items.map((x) => `${x.qty} ${FOODS[x.key].unit} ${FOODS[x.key].name}`).join('، '),
        kcal: m.kcal, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, fiber_g: m.fiber_g,
        position: d * 10 + si,
      });
    });
  }
  const byDay = DAYS.slice(0, n).map((name, d) => {
    const ms = meals.filter((m) => m.day_of_week === d);
    return { day: d, name, kcal: r0(ms.reduce((s, m) => s + m.kcal, 0)), protein_g: r0(ms.reduce((s, m) => s + m.protein_g, 0)), fiber_g: r1(ms.reduce((s, m) => s + m.fiber_g, 0)) };
  });
  return { meals, by_day: byDay };
}

export function defaultAdvice(t) {
  const lines = [
    `الاحتياج اليومي المحسوب: ${t.kcal} سعرة (الأيض الأساسي ${t.bmr}، مع النشاط ${t.tdee}).`,
    t.water_ml ? `اشرب ${r1(t.water_ml / 1000)} لتر ماء يومياً (حوالي ${Math.round(t.water_ml / 250)} كوباً)، والكركديه أو الشاي بدون سكر مسموح.` : 'اشرب 8–10 أكواب ماء يومياً، والكركديه أو الشاي بدون سكر مسموح.',
    t.fiber_g ? `الألياف: ${t.fiber_g} غ يومياً على الأقل من الخضار والبقوليات والحبوب الكاملة.` : null,
    'قلّل السكر والمقليات والمشروبات الغازية، واستبدل الخبز الأبيض بالأسمر أو الكسرة.',
    'يمكن تبديل وجبة بأخرى من نفس الوقت في يوم آخر دون تغيير كبير في السعرات.',
  ];
  if (t.goal === 'lose') lines.splice(1, 0, `المتوقع: نزول حوالي ${Math.abs(t.weekly_change_kg)} كغ أسبوعياً مع الالتزام.`);
  if (t.floor_applied) lines.push('تنبيه: رُفعت السعرات إلى الحد الأدنى الآمن.');
  return lines.filter(Boolean).join('\n');
}

// ---------- قائمة التسوق ----------
const UNIT_ALIASES = [
  [/^(غ|غم|غرام|جرام|جم|g|gr|gram|grams)$/i, 'غ'],
  [/^(كغ|كيلو|كيلوغرام|kg)$/i, 'كغ'],
  [/^(مل|ml)$/i, 'مل'],
  [/^(لتر|l)$/i, 'لتر'],
  [/^(حبة|حبات|حبه|pcs?|piece)$/i, 'حبة'],
];
const normUnit = (u) => {
  const t = String(u || '').trim();
  for (const [re, v] of UNIT_ALIASES) if (re.test(t)) return v;
  return t;
};
const toNumber = (s) => Number(String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace('٫', '.').replace(',', '.'));
const QTY = '([0-9٠-٩]+(?:[.,٫][0-9٠-٩]+)?)';

/** يفكك سطر مكوّن: «صدر دجاج — 150 غ» أو «150 غ صدر دجاج» أو «2 بيض» أو «بيض» */
export function parseItem(line) {
  const s = String(line || '').replace(/[•\-–*]\s*/, '').trim();
  if (!s) return null;
  let m = s.match(new RegExp(`^(.+?)\\s*[—:–-]\\s*${QTY}\\s*(.*)$`));
  if (m) return { name: m[1].trim(), qty: toNumber(m[2]), unit: normUnit(m[3]) };
  m = s.match(new RegExp(`^${QTY}\\s*(غ|غم|غرام|جرام|جم|g|كغ|كيلو|kg|مل|ml|لتر|حبة|حبات|شريحة|شرائح|قطعة|قطع|كوب|أكواب|ملعقة كبيرة|ملعقة صغيرة|ملعقة|ملاعق)?\\s+(.+)$`, 'i'));
  if (m) return { name: m[3].trim(), qty: toNumber(m[1]), unit: normUnit(m[2] || 'حبة') };
  return { name: s, qty: null, unit: '' };
}

/** يفصل نص المكونات إلى أسطر (سطر جديد، فاصلة عربية، +) */
export function splitItems(text) {
  return String(text || '').split(/\n|،|\+|;|؛/).map((x) => x.trim()).filter(Boolean);
}

export function categoryOf(name) {
  const n = String(name);
  const known = Object.values(FOODS).find((f) => n.includes(f.name) || f.name.includes(n));
  if (known) return known.cat;
  const rules = [
    ['protein', /دجاج|لحم|سمك|تونة|بيض|كبدة|ديك|سردين|جمبري/],
    ['dairy', /حليب|لبن|زبادي|روب|جبن|جبنة|قشطة/],
    ['legumes', /فول|عدس|حمص|فاصوليا|لوبيا/],
    ['grains', /خبز|كسرة|قراصة|أرز|رز|مكرونة|شوفان|بطاطس|عصيدة|توست|دقيق/],
    ['veg', /خيار|طماطم|خس|جرجير|جزر|بامية|ملوخية|خضار|سلطة|بصل|فلفل|كوسة|باذنجان|سبانخ|بروكلي/],
    ['fruit', /تفاح|موز|برتقال|مانجو|جوافة|تمر|فاكهة|عنب|بطيخ|فراولة|ليمون/],
    ['fats', /زيت|زبدة|طحينة|لوز|سوداني|مكسرات|جوز|سمسم|أفوكادو/],
  ];
  for (const [cat, re] of rules) if (re.test(n)) return cat;
  return 'other';
}

/**
 * يجمع مكونات الخطة لعدد أيام:
 *   وجبة لها يوم محدد (خطة أسبوعية) تُحسب مرة لكل ظهور ضمن الأيام المطلوبة،
 *   ووجبة «كل يوم» (day_of_week = NULL) تُضرب في عدد الأيام.
 */
export function buildShoppingList(meals, { days = 7 } = {}) {
  const n = Math.max(1, Math.min(31, Number(days) || 7));
  const acc = new Map();
  for (const m of meals) {
    let times;
    if (m.day_of_week === null || m.day_of_week === undefined) times = n;
    else times = Math.floor(n / 7) + (m.day_of_week < n % 7 ? 1 : 0);
    if (!times) continue;
    const lines = splitItems(m.items || m.portions || m.title);
    for (const line of lines) {
      const it = parseItem(line);
      if (!it) continue;
      const key = `${it.name}|${it.qty == null ? '' : it.unit}`;
      const cur = acc.get(key) || { name: it.name, unit: it.qty == null ? '' : it.unit, qty: it.qty == null ? null : 0, times: 0 };
      if (it.qty != null) cur.qty += it.qty * times;
      cur.times += times;
      acc.set(key, cur);
    }
  }
  const pretty = (x) => {
    if (x.qty == null) return `${x.name}${x.times > 1 ? ` (${x.times} مرات)` : ''}`;
    let q = x.qty;
    let u = x.unit;
    if (u === 'غ' && q >= 1000) { q = r1(q / 1000); u = 'كغ'; }
    else if (u === 'مل' && q >= 1000) { q = r1(q / 1000); u = 'لتر'; }
    else q = r1(q);
    return `${x.name}: ${q} ${u}`.trim();
  };
  const groups = {};
  for (const x of acc.values()) {
    const cat = categoryOf(x.name);
    (groups[cat] ||= []).push({ ...x, qty: x.qty == null ? null : r1(x.qty), text: pretty(x) });
  }
  const order = Object.keys(CATEGORIES);
  return order.filter((c) => groups[c]?.length).map((c) => ({
    category: c, label: CATEGORIES[c],
    items: groups[c].sort((a, b) => a.name.localeCompare(b.name, 'ar')),
  }));
}

export function shoppingListText({ patientName, planTitle, days, groups, clinicName }) {
  const out = [`🛒 *قائمة التسوق* — ${patientName}`, `الخطة: ${planTitle} · لمدة ${days} ${days === 1 ? 'يوم' : 'أيام'}`, ''];
  for (const g of groups) {
    out.push(`*${g.label}*`);
    for (const it of g.items) out.push(`▫️ ${it.text}`);
    out.push('');
  }
  if (clinicName) out.push(`— ${clinicName}`);
  return out.join('\n').trim();
}
