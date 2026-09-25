// عميل REST موحّد — نفس الدوال يستعملها تطبيق الموبايل منطقياً (JWT + JSON)
const TOKEN_KEY = 'clinic.token';

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
  if (!res.ok) throw new ApiError(payload?.error || `خطأ ${res.status}`, res.status, payload);
  return payload;
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
