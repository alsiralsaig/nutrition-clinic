/**
 * الترجمة (عربي ← English) بلا تعديل يدوي لكل نص:
 * إضافة Babel في vite.config.js تلف كل نص عربي في الكود بـ __t('...')،
 * والقوالب النصية بـ __tf('... {0} ...', [قيم]). هنا نبحث عنها في قاموس en.js.
 * العربية هي المصدر؛ أي نص بلا ترجمة يظهر بالعربية (ولا ينكسر شيء).
 * تبديل اللغة يعيد تحميل الصفحة لأن بعض النصوص تُحسب مرة عند التحميل.
 */
import EN from './i18n/en.js';

const KEY = 'clinic.lang';
const read = () => { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'ar'; } catch { return 'ar'; } };
const lang = read();
const missing = new Set();

export function __t(s) {
  if (lang === 'ar' || typeof s !== 'string') return s;
  const v = EN[s];
  if (v === undefined) {
    const k = s.trim();
    if (k !== s && EN[k] !== undefined) return s.replace(k, EN[k]); // نص JSX بمسافات حوله
    missing.add(s);
    return s;
  }
  return v;
}

export function __tf(tpl, args = []) {
  const s = lang === 'ar' ? tpl : (EN[tpl] ?? (missing.add(tpl), tpl));
  return s.replace(/\{(\d+)\}/g, (_, i) => {
    const v = args[Number(i)];
    return v === null || v === undefined ? '' : String(v);
  });
}

// متاحة عالمياً لأن الإضافة تحقن الاستدعاء دون import
globalThis.__t = __t;
globalThis.__tf = __tf;

export const currentLang = () => lang;
export const isRTL = () => lang === 'ar';
/** محلية التنسيق: أرقام لاتينية في الحالتين، وتقويم ميلادي */
export const LOCALE = lang === 'en' ? 'en-GB' : 'ar-u-nu-latn-ca-gregory';
export const TIME_LOCALE = lang === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn';

export function setLang(l) {
  try { localStorage.setItem(KEY, l === 'en' ? 'en' : 'ar'); } catch { /* */ }
  window.location.reload();
}

/** للتطوير: النصوص التي ظهرت بلا ترجمة — window.__missingI18n() في الكونسول */
if (typeof window !== 'undefined') window.__missingI18n = () => [...missing];
if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
}
