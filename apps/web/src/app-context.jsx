import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from './api.js';

// سياق عام واحد: المستخدم + التنبيهات + حالة التحميل
const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

let toastSeq = 0;

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(0);

  const toast = useCallback((message, tone = 'info', ttl = 4200) => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, message: String(message), tone }]);
    if (ttl) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
    return id;
  }, []);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const run = useCallback(async (fn, { ok = '', err = true } = {}) => {
    setBusy((b) => b + 1);
    try {
      const out = await fn();
      if (ok) toast(ok, 'good');
      return out;
    } catch (e) {
      if (err) toast(e.message || 'حدث خطأ غير متوقع', 'bad', 6000);
      throw e;
    } finally {
      setBusy((b) => b - 1);
    }
  }, [toast]);

  // استعادة الجلسة عند الفتح + الاستماع لانتهاء الجلسة في أي طلب
  useEffect(() => {
    const onSignedOut = () => { setUser(null); toast('انتهت الجلسة، سجّل الدخول مرة أخرى', 'warn'); };
    window.addEventListener('clinic:signed-out', onSignedOut);
    (async () => {
      if (tokenStore.get()) {
        try { const r = await api.get('/auth/me'); setUser(r.user); }
        catch { tokenStore.clear(); }
      }
      setReady(true);
    })();
    return () => window.removeEventListener('clinic:signed-out', onSignedOut);
  }, [toast]);

  const login = useCallback(async (username, password) => {
    const r = await api.post('/auth/login', { username, password });
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, setUser, ready, login, logout, toast, toasts, dismissToast, run, busy, canWrite: user?.role !== 'viewer' }),
    [user, ready, login, logout, toast, toasts, dismissToast, run, busy],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** هوك بيانات: جلب + تحمّل + إعادة جلب */
export function useLoader(loader, deps = [], { immediate = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = React.useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    if (!immediate && nonce === 0) return;
    setLoading(true);
    Promise.resolve()
      .then(() => loaderRef.current())
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload: useCallback(() => setNonce((n) => n + 1), []) };
}
