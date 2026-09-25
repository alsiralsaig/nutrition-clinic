// أدوات مشتركة: تحقق من المدخلات، حسابات (BMI، الماكروز)، تنسيق التواريخ
export const BMI_CATEGORY = [
  { max: 18.5, key: 'underweight', label: 'نقص في الوزن' },
  { max: 25, key: 'normal', label: 'وزن طبيعي' },
  { max: 30, key: 'overweight', label: 'زيادة في الوزن' },
  { max: 35, key: 'obese1', label: 'سمنة درجة أولى' },
  { max: 40, key: 'obese2', label: 'سمنة درجة ثانية' },
  { max: Infinity, key: 'obese3', label: 'سمنة مفرطة' },
];

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 2) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

export const toNum = num;
export const toRound = round;
export { round };

/** BMI محسوب في السيرفر فقط — لا يقبله النظام من العميل */
export function calcBMI(weightKg, heightCm) {
  const w = num(weightKg);
  const h = num(heightCm);
  if (!w || !h || h < 50 || h > 260 || w < 20 || w > 400) return null;
  return round(w / (h / 100) ** 2, 1);
}

export function bmiCategory(bmi) {
  if (bmi === null || bmi === undefined) return null;
  return BMI_CATEGORY.find((c) => bmi < c.max) || null;
}

/** الوزنIdeal التقريبي (Devine) للمساعدة في وضع الهدف */
export function idealWeight(heightCm, gender) {
  const h = num(heightCm);
  if (!h) return null;
  const over152 = Math.max(0, (h - 152.4) / 2.54);
  const base = gender === 'female' ? 45.5 : 50;
  return round(base + over152 * (gender === 'female' ? 2.3 : 2.3), 1);
}

/** نسبة الخصر إلى الورك و مؤشرخطر مركزي بسيط */
export function waistHip(waist, hip) {
  const w = num(waist);
  const h = num(hip);
  if (!w || !h) return null;
  return round(w / h, 2);
}

export function sumMacros(meals = []) {
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const m of meals) {
    t.kcal += num(m.kcal) || 0;
    t.protein_g += num(m.protein_g) || 0;
    t.carbs_g += num(m.carbs_g) || 0;
    t.fat_g += num(m.fat_g) || 0;
  }
  return {
    kcal: round(t.kcal, 0),
    protein_g: round(t.protein_g, 1),
    carbs_g: round(t.carbs_g, 1),
    fat_g: round(t.fat_g, 1),
  };
}

/** احتياج تقريبي: Mifflin-St Jeor × معامل النشاط */
export function estimateEnergy({ weightKg, heightCm, age, gender, activity = 1.375 }) {
  const w = num(weightKg), h = num(heightCm), a = num(age);
  if (!w || !h || !a) return null;
  const base = 10 * w + 6.25 * h - 5 * a + (gender === 'male' ? 5 : -161);
  return round(base * activity, 0);
}

export function ageFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const dm = now.getMonth() - b.getMonth();
  if (dm < 0 || (dm === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** تنظيف كائن: يترك المفاتيح المعلومة فقط */
export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj || {}, k)) out[k] = obj[k];
  return out;
}

export function str(v, max = 4000) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function requiredStr(v, field, max = 4000) {
  const s = str(v, max);
  if (!s) throw badRequest(`حقل «${field}» مطلوب`);
  return s;
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (m, d) => new HttpError(400, m, d);
export const notFound = (m = 'العنصر المطلوب غير موجود') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);
export const forbidden = (m = 'لا تملك صلاحية لهذا الإجراء') => new HttpError(403, m);

export function wrap(handler) {
  return (req, res, next) => {
    try {
      const r = handler(req, res, next);
      if (r && typeof r.then === 'function') r.catch(next);
    } catch (e) { next(e); }
  };
}
