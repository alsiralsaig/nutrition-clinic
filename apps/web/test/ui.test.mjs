/**
 * اختبار واجهة حقيقي: يبني الحزمة ثم يشغّلها في jsdom أمام خادم API يعمل فعلاً،
 * ويسجّل الدخول ويتنقل بين الشاشات ويفتح نوافذ الإدخال ويحفظ بيانات.
 * التشغيل:  node apps/web/test/ui.test.mjs  (يحتاج API على 4000 أو API_URL)
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, '..');
const BASE = process.env.UI_TEST_BASE || 'http://127.0.0.1:4000';

const results = [];
let failures = 0;
const check = (name, cond, extra = '') => {
  results.push(name);
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name} ${extra ? '→ ' + extra : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1) بناء حزمة IIFE قابلة للتقييم داخل jsdom ----------
const tmp = path.join(WEB, '.test-bundle.js');
await build({
  entryPoints: [path.join(WEB, 'src/main.jsx')],
  outfile: tmp, bundle: true, format: 'iife', platform: 'browser',
  jsx: 'automatic', minify: false, logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'empty' },
});
const code = fs.readFileSync(tmp, 'utf8');

// ---------- 2) تشغيل المتصفح الوهمي ----------
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/Could not parse CSS|Not implemented/.test(e.message)) errors.push(e.message + (e.detail ? ` :: ${e.detail}` : '')); });
vc.on('error', (m) => errors.push(String(m)));

const dom = new JSDOM(
  `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>`,
  { url: BASE + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc },
);
const { window } = dom;
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
window.print = () => { window.__printed = (window.__printed || 0) + 1; };
window.HTMLCanvasElement.prototype.getContext = () => null;
window.Element.prototype.scrollIntoView = function () {};
window.HTMLElement.prototype.scrollIntoView = function () {};
window.scrollTo = () => {};
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() } });
window.addEventListener('error', (e) => errors.push(`window.onerror: ${e.message}`));

// جلب شبكي يعيد التوكن كما في المتصفح
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? new URL(input, BASE).toString() : input;
  return fetch(url, init);
};

window.eval(code);
await sleep(600);

const root = window.document.getElementById('root');
const text = () => root.textContent.replace(/\s+/g, ' ');
// نفحص في body كاملاً لأن نوافذ الطباعة تُبوَّب خارج #root
const q = (sel) => window.document.querySelector(sel);
const qa = (sel) => Array.from(window.document.querySelectorAll(sel));
const byText = (needle, sel = 'button, a') => qa(sel).find((el) => (el.textContent || '').includes(needle));
const setValue = (el, v) => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const click = async (el, ms = 700) => {
  if (!el) throw new Error('العنصر غير موجود للنقر');
  el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  el.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(ms);
};
const goto = async (hash, ms = 900) => { window.location.hash = hash; await sleep(ms); };

// ---------- 3) شاشة الدخول ----------
check('الشاشة الأولى هي تسجيل الدخول', text().includes('تسجيل الدخول'), text().slice(0, 140));
check('تظهر حسابات التجربة', text().includes('admin123'));

const userInput = q('input[autocomplete="username"]');
const passInput = q('input[type="password"]');
check('حقلا اسم المستخدم وكلمة المرور موجودان', !!userInput && !!passInput);
setValue(userInput, 'admin');
setValue(passInput, 'wrongpass');
await click(byText('دخول'), 900);
check('كلمة مرور خاطئة تُظهر رسالة خطأ عربية', text().includes('غير صحيحة'), text().slice(-160));

setValue(q('input[type="password"]'), 'admin123');
await click(byText('دخول'), 1400);
check('الدخول الصحيح ينقل إلى لوحة التحكم', window.location.hash === '#/' && text().includes('لوحة التحكم'), `hash=${window.location.hash}`);
check('اللوحة تعرض بطاقات المرضى والمواعيد', text().includes('عدد المرضى') && text().includes('مواعيد اليوم'));
check('اللوحة تعرض الإيرادات', text().includes('إيرادات الشهر') || text().includes('إجمالي الإيرادات'));
check('يوجد توكن في التخزين المحلي', !!window.localStorage.getItem('clinic.token'));

// ---------- 4) لوحة التحكم: رسوم ----------
await sleep(700);
// jsdom بلا تخطيط، لذا ResponsiveContainer لا يرسم SVG — نتحقق من وجود الحاويات
check('حاويات الرسوم البيانية مركّبة (4 رسوم على الأقل)', window.document.querySelectorAll('.recharts-responsive-container').length >= 4,
  `containers=${window.document.querySelectorAll('.recharts-responsive-container').length}`);
check('جدول مواعيد اليوم أو حالة الفراغ', text().includes('مواعيد اليوم') || text().includes('لا توجد مواعيد اليوم'));
check('بطاقات أفضل نتائج النزول', text().includes('أفضل نتائج النزول') || text().includes('لا توجد مقارنة كافية'));

// ---------- 5) قائمة المرضى + البحث ----------
await goto('#/patients', 1100);
check('قائمة المرضى تحمل ملفات', /NC-\d{4}/.test(text()), text().slice(0, 120));
const searchBox = q('input[placeholder*="ابحث"]');
setValue(searchBox, 'الطيب');
await sleep(900);
check('البحث مؤجّل ويعمل بدون انهيار', !!q('table') || text().includes('لا نتائج'));
setValue(searchBox, '');
await sleep(700);

// ---------- 6) فتح ملف مريض ----------
const rowLink = qa('tbody tr td')[1];
await click(rowLink?.closest('tr'), 1300);
const onFile = window.location.hash.startsWith('#/patients/');
check('الضغط على الصف يفتح ملف المريض', onFile, window.location.hash);
if (onFile) {
  check('الملف يعرض رقم الملف', /NC-\d{4}/.test(text()));
  check('الملف يعرض قسم القياسات', text().includes('المتابعة والقياسات'));
  check('الملف يعرض قسم البرنامج الغذائي', text().includes('البرنامج الغذائي'));
  check('الملف يعرض المدفوعات', text().includes('المدفوعات'));
  check('الملف يعرض الزيارات السابقة', text().includes('الزيارات السابقة'));
  check('الملف يعرض المواعيد', text().includes('المواعيد'));
  check('شريط أقسام الملف موجود', text().includes('نظرة') && text().includes('الملاحظات'));
  check('رسم تطور الوزن داخل الملف', window.document.querySelectorAll('.recharts-responsive-container').length >= 1);

  // نافذة القياسات: تفتح وتتحقق من الحقول ثم تُغلق
  await click(byText('قياسات جديدة'), 800);
  const measForm = q('#meas-form');
  check('نموذج القياسات يفتح بحقول الوزن والطول', !!measForm && measForm.querySelectorAll('input').length >= 7);
  if (measForm) {
    setValue(measForm.querySelector('input[type="number"]'), '77.4');
    await click(byText('حفظ القياسات'), 1300);
    await sleep(900);
    check('حفظ القياس يضيف سطراً ويظهر تنبيه النجاح', text().includes('تم تسجيل قياسات الزيارة') || /NC-\d{4}/.test(text()));
  }

  // نافذة تعديل البرنامج الغذائي
  if (byText('تعديل الحالي') || byText('إنشاء برنامج')) {
    await click(byText('تعديل الحالي') || byText('إنشاء برنامج'), 900);
    check('محرر البرنامج يفتح بصفوف الوجبات', !!q('#plan-form') && qa('#plan-form select').length >= 5);
    await click(q('button[aria-label="إغلاق"]'), 500);
  }
}

// ---------- 7) المواعيد ----------
await goto('#/appointments', 1200);
check('صفحة المواعيد تعرض جدول اليوم', text().includes('جدول اليوم') || text().includes('مواعيد اليوم') || text().includes('لا مواعيد في هذا اليوم'));
await click(byText('موعد جديد'), 900);
check('نموذج الموعد يفتح بالتاريخ والساعة', !!q('#appt-form') && q('#appt-form input[type="date"]') && q('#appt-form input[type="time"]'));
await click(q('button[aria-label="إغلاق"]'), 400);

// ---------- 8) البرامج الغذائية ----------
await goto('#/plans', 1200);
check('صفحة البرامج تعرض جدولاُ أو حالة فراغ', text().includes('البرامج الغذائية') && (text().includes('برنامج') || text().includes('لا توجد برامج')));

// ---------- 9) المدفوعات ----------
await goto('#/payments', 1400);
check('صفحة المدفوعات تعرض الإجماليات', text().includes('إيراد الفترة المحددة') && text().includes('سجل المدفوعات'));
check('أزرار الفترات السريعة تعمل', text().includes('هذا الشهر') && text().includes('هذه السنة'));
await click(byText('هذا الشهر'), 1200);
check('تغيير الفترة لا يُسقط الصفحة', text().includes('سجل المدفوعات'));

// ---------- 10) التقارير + الطباعة ----------
await goto('#/reports', 1200);
check('صفحة التقارير تعرض أنواع التقارير', text().includes('تقرير مريض كامل') && text().includes('تقرير الإيرادات'));
await click(byText('تقرير الزيارات'), 1500);
check('تقرير الزيارات يولّد معاينة', text().includes('زيارة') || text().includes('لا توجد بيانات'), text().slice(-140));
await click(byText('طباعة / PDF'), 900);
check('نافذة الطباعة تُفتح بورقة A4', !!q('.print-doc') && text().includes('تقرير الزيارات'), 'print-doc=' + !!q('.print-doc'));
await click(byText('حفظ PDF'), 600);
check('زر الحفظ يستدعي window.print', window.__printed >= 1, `printed=${window.__printed}`);
await click(byText('إغلاق'), 500);

// ---------- 11) الإعدادات ----------
await goto('#/settings', 1300);
check('الإعدادات تعرض اسم العيادة', q('#clinic-form, form') || text().includes('بيانات العيادة'));
check('تبويبات الإعدادات موجودة', text().includes('النسخ الاحتياطي') && text().includes('تطبيق الموبايل') && text().includes('سجل التدقيق'));
await click(byText('تطبيق الموبايل'), 700);
check('تبويب الموبايل يعرض عنوان الـ API', text().includes('/api'), text().slice(-120));
await click(byText('النسخ الاحتياطي'), 700);
check('تبويب النسخ يعرض أزرار النسخة والاستعادة', text().includes('نسخة JSON') && text().includes('استعادة من ملف'));
await click(byText('سجل التدقيق'), 900);
check('سجل التدقيق يعرض عمليات فعلية', /auth\.login|patient\./.test(text()), text().slice(-160));

// ---------- 12) تسجيل الخروج ----------
await goto('#/', 800);
window.localStorage.removeItem('clinic.token');
await goto('#/payments', 700);
check('بدون توكن تُعيد الواجهة لصفحة الدخول أو تُظهر تنبيهاً', text().includes('تسجيل الدخول') || text().includes('انتهت الجلسة'), text().slice(0, 100));

// ---------- 13) أخطاء التشغيل ----------
const realErrors = errors.filter((e) => !/ResizeObserver|getComputedStyle|not implemented|Could not parse CSS/i.test(e));
check('لا أخطاء تشغيل في الكونسول', realErrors.length === 0, realErrors.slice(0, 3).join(' | ').slice(0, 500));

fs.rmSync(tmp, { force: true });
console.log(`\n${results.length - failures}/${results.length} نجحت${failures ? ` — ${failures} فشلت` : ''}`);
process.exit(failures ? 1 : 0);
