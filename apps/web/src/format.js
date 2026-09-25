// تسميات عربية وتنسيق أرقام وتواريخ — مصدر واحد للاتساق في كل الشاشات
export const VISIT_TYPES = {
  initial: { label: 'أولى', color: 'bg-brand-100 text-brand-800' },
  followup: { label: 'متابعة', color: 'bg-leaf-100 text-leaf-600' },
  consult: { label: 'استشارة', color: 'bg-sun-100 text-sun-600' },
  plan_update: { label: 'تحديث برنامج', color: 'bg-sun-100 text-sun-600' },
  lab_review: { label: 'قراءة تحليل', color: 'bg-clay-100 text-clay-600' },
};

export const APPT_STATUS = {
  scheduled: { label: 'مجدول', color: 'bg-brand-100 text-brand-800', dot: '#229a92' },
  confirmed: { label: 'مؤكد', color: 'bg-leaf-100 text-leaf-600', dot: '#5aa843' },
  done: { label: 'تمت', color: 'bg-ink/10 text-ink/70', dot: '#1c2b2a' },
  cancelled: { label: 'ملغي', color: 'bg-clay-100 text-clay-600', dot: '#c9604a' },
  no_show: { label: 'لم يحضر', color: 'bg-sun-100 text-sun-600', dot: '#d69a19' },
};

export const PAY_METHODS = {
  cash: 'نقدي',
  card: 'بطاقة',
  bank_transfer: 'تحويل بنكي',
  mobile_wallet: 'محفظة هاتف',
  instalment: 'تقسيط',
};

export const PATIENT_STATUS = {
  active: { label: 'نشط', color: 'bg-leaf-100 text-leaf-600' },
  inactive: { label: 'متوقف', color: 'bg-sun-100 text-sun-600' },
  archived: { label: 'مؤرشف', color: 'bg-ink/10 text-ink/60' },
};

export const ROLES = {
  admin: 'مدير النظام',
  staff: 'أخصائي',
  viewer: 'مشاهدة فقط',
};

export const GENDERS = { male: 'ذكر', female: 'أنثى' };

export const MEAL_SLOTS = ['الفطور', 'سناك صباحي', 'الغداء', 'سناك عصري', 'العشاء', 'قبل التمرين', 'بعد التمرين'];

export const fmt = (n, d = 1) =>
  n === null || n === undefined || n === '' || Number.isNaN(Number(n))
    ? '—'
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });

export const money = (n, currency = '') =>
  `${fmt(n, 2)}${currency ? ` ${CURRENCY_AR[currency] || currency}` : ''}`;

export const CURRENCY_AR = { SDG: 'ج.س', EGP: 'ج.م', SAR: 'ر.س', AED: 'د.إ', USD: '$' };

const AR_DATE = new Intl.DateTimeFormat('ar-u-nu-latn-ca-gregory', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const AR_SHORT = new Intl.DateTimeFormat('ar-u-nu-latn-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' });
const AR_MONTH = new Intl.DateTimeFormat('ar-u-nu-latn-ca-gregory', { month: 'long', year: 'numeric' });

export const todayISO = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const addDays = (isoDate, n) => {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const parse = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00') : null);

export const longDate = (iso) => {
  const d = parse(iso);
  return d && !Number.isNaN(d.getTime()) ? AR_DATE.format(d) : '—';
};
export const shortDate = (iso) => {
  const d = parse(iso);
  return d && !Number.isNaN(d.getTime()) ? AR_SHORT.format(d) : '—';
};
export const monthLabel = (ym) => {
  const d = new Date(`${ym}-01T00:00:00`);
  return Number.isNaN(d.getTime()) ? ym : AR_MONTH.format(d);
};
export const dateTime = (s) => {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(s);
  return `${AR_SHORT.format(d)} — ${d.toLocaleTimeString('ar-EG-hijri', { hour: '2-digit', minute: '2-digit', numberingSystem: 'latn' })}`;
};
export const relativeDays = (iso) => {
  const d = parse(iso);
  if (!d) return { text: 'لا يوجد', tone: 'muted' };
  const diff = Math.round((d - new Date(todayISO() + 'T00:00:00')) / 864e5);
  if (diff === 0) return { text: 'اليوم', tone: 'good' };
  if (diff === 1) return { text: 'غداً', tone: 'good' };
  if (diff === -1) return { text: 'أمس', tone: 'warn' };
  if (diff > 1) return { text: `بعد ${diff} يوم`, tone: 'muted' };
  return { text: `قبل ${Math.abs(diff)} يوم`, tone: diff < -14 ? 'bad' : 'warn' };
};

export const bmiTone = (bmi) => {
  if (bmi == null) return 'muted';
  if (bmi < 18.5) return 'warn';
  if (bmi < 25) return 'good';
  if (bmi < 30) return 'warn';
  return 'bad';
};

export const initials = (p) => `${(p?.first_name || '')[0] || ''}${(p?.last_name || '')[0] || ''}`.trim() || '؟';

export const MEAL_FALLBACK_TIME = {
  'الفطور': '08:00', 'سناك صباحي': '11:00', 'الغداء': '14:00', 'سناك عصري': '17:00', 'العشاء': '20:00',
};
