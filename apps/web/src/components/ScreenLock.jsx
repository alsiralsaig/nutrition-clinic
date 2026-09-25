/**
 * قفل الشاشة السريع برمز PIN (فكرة مأخوذة من نسخة Google AI Studio):
 * عندما يبتعد الموظف عن الجهاز يقفل الشاشة بضغطة — أو تلقائياً بعد مدة خمول —
 * دون تسجيل خروج. الرمز يُحفظ مُجزّأً (hash) على هذا المتصفح فقط ولكل مستخدم رمزه.
 * القفل يبقى بعد إعادة تحميل الصفحة. نسيان الرمز = تسجيل خروج ودخول بكلمة المرور.
 * ملاحظة: هذه «ستارة خصوصية» على الجهاز؛ الحماية الحقيقية للبيانات هي كلمة المرور وتوكن الخادم.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.jsx';
import { Field, Icon, Input, Modal, Select } from './ui.jsx';

const K = {
  pin: (uid) => `clinic.pin.${uid}`,
  locked: 'clinic.locked',
  auto: (uid) => `clinic.autolock.${uid}`,
};
const EVT = 'clinic-lock-change';
const MAX_TRIES = 5;

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
};

/** تجزئة FNV-1a مع ملح المستخدم — تكفي لستارة خصوصية محلية ولا تحفظ الرمز نصاً */
function hashPin(uid, pin) {
  let h = 0x811c9dc5;
  const s = `nc-lock:${uid}:${pin}`;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export const hasPin = (uid) => !!ls.get(K.pin(uid));
export const isLocked = () => ls.get(K.locked) === '1';
export function lockNow() { ls.set(K.locked, '1'); window.dispatchEvent(new Event(EVT)); }
function unlock() { ls.del(K.locked); window.dispatchEvent(new Event(EVT)); }
const autoMinutes = (uid) => Number(ls.get(K.auto(uid)) || 0);

/** زر القفل في رأس الصفحة: يقفل فوراً، أو يطلب إنشاء رمز في أول مرة */
export function LockButton() {
  const { user } = useApp();
  const [setup, setSetup] = useState(false);
  if (!user) return null;
  return (
    <>
      <button type="button" className="btn-ghost btn-sm !px-2.5" data-lock-button
        title={hasPin(user.id) ? 'قفل الشاشة (Ctrl+L)' : 'إعداد قفل الشاشة'} aria-label="قفل الشاشة"
        onClick={() => (hasPin(user.id) ? lockNow() : setSetup(true))}>
        <LockIcon />
      </button>
      <PinSetup open={setup} onClose={() => setSetup(false)} lockAfter />
    </>
  );
}

/** نافذة إنشاء/تغيير الرمز + مدة القفل التلقائي */
export function PinSetup({ open, onClose, lockAfter = false }) {
  const { user, toast } = useApp();
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [auto, setAuto] = useState('10');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open || !user) return;
    setPin(''); setPin2(''); setErr('');
    setAuto(String(ls.get(K.auto(user.id)) ?? '10'));
  }, [open, user]);
  if (!user) return null;
  const save = (e) => {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) { setErr('الرمز من 4 إلى 6 أرقام'); return; }
    if (pin !== pin2) { setErr('الرمزان غير متطابقين'); return; }
    ls.set(K.pin(user.id), hashPin(user.id, pin));
    ls.set(K.auto(user.id), auto);
    window.dispatchEvent(new Event(EVT));
    toast('تم حفظ رمز قفل الشاشة', 'good');
    onClose();
    if (lockAfter) setTimeout(lockNow, 150);
  };
  const remove = () => {
    ls.del(K.pin(user.id)); ls.del(K.auto(user.id));
    window.dispatchEvent(new Event(EVT));
    toast('أُلغي قفل الشاشة على هذا الجهاز', 'info');
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" icon={<LockIcon />} title="قفل الشاشة السريع"
      subtitle="لإخفاء بيانات المرضى عند الابتعاد عن الجهاز — دون تسجيل خروج"
      footer={<>
        {hasPin(user.id) && <button type="button" className="btn-danger btn-sm me-auto" onClick={remove}>إلغاء القفل</button>}
        <button type="button" className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button form="pin-form" className="btn-primary" data-pin-save><Icon.check /> حفظ</button>
      </>}>
      <form id="pin-form" onSubmit={save} className="grid gap-3" data-pin-setup>
        <Field label="رمز PIN جديد (4–6 أرقام)">
          <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin}
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErr(''); }} className="text-center tracking-[.4em] tnum" data-pin-new />
        </Field>
        <Field label="أعد كتابة الرمز" error={err}>
          <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin2}
            onChange={(e) => { setPin2(e.target.value.replace(/\D/g, '')); setErr(''); }} className="text-center tracking-[.4em] tnum" data-pin-confirm />
        </Field>
        <Field label="القفل التلقائي عند عدم الاستخدام">
          <Select value={auto} onChange={(e) => setAuto(e.target.value)} data-pin-auto>
            <option value="0">بدون قفل تلقائي</option>
            {[5, 10, 15, 30].map((m) => <option key={m} value={String(m)}>{`بعد ${m} دقائق`}</option>)}
          </Select>
        </Field>
        <p className="text-[11.5px] font-bold leading-5 text-ink/50">الرمز محفوظ على هذا المتصفح فقط. إن نسيته: «تسجيل الخروج» من شاشة القفل ثم ادخل بكلمة المرور.</p>
      </form>
    </Modal>
  );
}

/** الستارة نفسها + مؤقت الخمول + اختصار Ctrl+L — تُعرض مرة واحدة داخل Layout */
export function ScreenLock() {
  const { user, logout } = useApp();
  const [locked, setLocked] = useState(() => isLocked());
  const [pin, setPin] = useState('');
  const [tries, setTries] = useState(0);
  const [err, setErr] = useState('');
  const timer = useRef(null);
  const armed = !!user && hasPin(user.id);

  useEffect(() => {
    const sync = () => setLocked(isLocked());
    window.addEventListener(EVT, sync);
    window.addEventListener('storage', sync); // تبويب آخر قفل/فتح
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener('storage', sync); };
  }, []);

  // مؤقت الخمول
  const arm = useCallback(() => {
    clearTimeout(timer.current);
    if (!user || !hasPin(user.id) || isLocked()) return;
    const m = autoMinutes(user.id);
    if (m > 0) timer.current = setTimeout(lockNow, m * 60_000);
  }, [user]);
  useEffect(() => {
    arm();
    const evs = ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'scroll', 'wheel'];
    let last = 0;
    const onAct = () => { const n = Date.now(); if (n - last > 2000) { last = n; arm(); } };
    evs.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    window.addEventListener(EVT, arm);
    return () => { clearTimeout(timer.current); evs.forEach((e) => window.removeEventListener(e, onAct)); window.removeEventListener(EVT, arm); };
  }, [arm]);

  // Ctrl/⌘ + L
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'l' || e.key === 'L') && user && hasPin(user.id)) { e.preventDefault(); lockNow(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user]);

  if (!locked || !armed) return null;

  const signOut = () => { unlock(); setTries(0); logout(); window.location.hash = '#/login'; };
  const submit = (e) => {
    e.preventDefault();
    if (hashPin(user.id, pin) === ls.get(K.pin(user.id))) {
      setPin(''); setErr(''); setTries(0); unlock();
      return;
    }
    const n = tries + 1;
    setTries(n); setPin('');
    if (n >= MAX_TRIES) { signOut(); return; }
    setErr(`رمز غير صحيح — تبقّى ${MAX_TRIES - n} محاولات قبل تسجيل الخروج`);
  };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#0b1413]/90 p-4 backdrop-blur-xl" data-screen-lock role="dialog" aria-modal="true">
      <form onSubmit={submit} className="pop-in w-full max-w-xs rounded-3xl border border-line bg-surface p-7 text-center shadow-pop">
        <span className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-brand-700"><LockIcon size={30} /></span>
        <h2 className="text-[18px] font-extrabold">الشاشة مقفلة</h2>
        <p className="mt-1 text-[12.5px] font-bold text-ink/50">{user.full_name || user.username}</p>
        <input type="password" inputMode="numeric" autoFocus maxLength={6} value={pin} data-unlock-pin
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErr(''); }} placeholder="••••" aria-label="رمز PIN"
          className="tnum mt-5 w-full rounded-xl border border-line bg-sand px-4 py-3 text-center text-[24px] font-extrabold tracking-[.5em] outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100" />
        {err && <p className="mt-2 text-[12px] font-bold text-clay-600" data-unlock-error>{err}</p>}
        <button className="btn-primary mt-4 w-full justify-center" disabled={pin.length < 4} data-unlock-submit>فتح</button>
        <button type="button" onClick={signOut} className="mt-3 text-[12px] font-bold text-ink/50 underline-offset-4 hover:text-brand-700 hover:underline">
          نسيت الرمز؟ تسجيل الخروج
        </button>
      </form>
    </div>
  );
}

function LockIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /><path d="M12 14.5v2.5" />
    </svg>
  );
}
