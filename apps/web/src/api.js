// عميل REST موحّد — نفس الدوال يستعملها تطبيق الموبايل منطقياً (JWT + JSON)
import { currentLang } from './i18n.js';

const TOKEN_KEY = 'clinic.token';

/**
 * في الواجهة الإنجليزية: تسميات الخادم الثابتة (تصنيف BMI، فئات قائمة التسوق، نصائح المولّد…)
 * تُترجم من القاموس. البيانات المُدخلة (أسماء، وجبات، ملاحظات) لا تُلمس.
 */
const LABEL_KEY = /(label|category|advice|warnings|level_name)$/;
function translateLabels(v, key = '') {
  if (Array.isArray(v)) return v.map((x) => translateLabels(x, key));
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) v[k] = translateLabels(v[k], k);
    return v;
  }
  return typeof v === 'string' && LABEL_KEY.test(key) ? __t(v) : v;
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function request(method, path, body, { raw = false } = {}) {
  const token = tokenStore.get();
  const res = await fetch(path.startsWith('/') ? `/api${path}` : path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    tokenStore.clear();
    window.dispatchEvent(new CustomEvent('clinic:signed-out'));
    throw new ApiError('انتهت الجلسة — سجّل الدخول من جديد', 401);
  }
  if (raw) return res;
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text }; }
  if (!res.ok) throw new ApiError(payload?.error ? __t(payload.error) : `خطأ ${res.status}`, res.status, payload);
  return currentLang() === 'en' ? translateLabels(payload) : payload;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  put: (p, b) => request('PUT', p, b ?? {}),
  del: (p) => request('DELETE', p),
  /** ينزّل ملفاً (CSV/نسخة احتياطية) مع التوكن في الـ query لأن المتصفح لا يرسل الهيدر في التنزيل */
  async download(path, filename) {
    const token = tokenStore.get();
    const url = `/api${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) throw new ApiError('تعذّر تنزيل الملف', res.status);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
};

/** شريط تقدّم بسيط للتنزيلات الكبيرة */
export async function saveBackupJson() {
  const data = await api.get('/backup');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `clinic-backup-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return Object.values(data.tables).reduce((s, t) => s + t.length, 0);
}

export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      try { resolve(JSON.parse(String(fr.result))); }
      catch { reject(new ApiError('الملف ليس JSON صالحاً لنسخة احتياطية')); }
    };
    fr.onerror = () => reject(new ApiError('تعذّرت قراءة الملف'));
    fr.readAsText(file);
  });
}

// ================= بوابة المريض =================
// توكن مستقل عن توكن الموظف: يمكن فتح البوابة على هاتف المريض دون أي صلاحية على بيانات العيادة.
const PORTAL_KEY = 'clinic.portal';
export const portalToken = {
  get: () => localStorage.getItem(PORTAL_KEY) || '',
  set: (t) => localStorage.setItem(PORTAL_KEY, t),
  clear: () => {
    localStorage.removeItem(PORTAL_KEY);
    // نسخة البيانات المخزّنة للعرض دون اتصال تُمسح مع الخروج
    try { navigator.serviceWorker?.controller?.postMessage({ type: 'portal-logout' }); } catch { /* تجاهل */ }
  },
};

async function portalRequest(method, path, body) {
  const token = portalToken.get();
  const res = await fetch(`/api/portal${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text }; }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    portalToken.clear();
    window.dispatchEvent(new CustomEvent('clinic:portal-signed-out', { detail: payload?.error }));
  }
  if (!res.ok) throw new ApiError(payload?.error ? __t(payload.error) : `خطأ ${res.status}`, res.status, payload);
  if (res.headers.get('x-offline') && payload && typeof payload === 'object') payload._offline = true; // من نسخة عامل الخدمة
  return currentLang() === 'en' ? translateLabels(payload) : payload;
}

export const portalApi = {
  get: (p) => portalRequest('GET', p),
  post: (p, b) => portalRequest('POST', p, b ?? {}),
  put: (p, b) => portalRequest('PUT', p, b ?? {}),
  del: (p) => portalRequest('DELETE', p),
};

/** يستخرج رمز الدخول من نص QR (رابط البوابة الكامل أو الرمز وحده) */
export function tokenFromQr(text) {
  const s = String(text || '').trim();
  const m = s.match(/[?&]t=([A-Za-z0-9_-]{20,64})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,64}$/.test(s) ? s : null;
}
