import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { api } from '../api.js';
import { Icon } from './ui.jsx';
import { ROLES, todayISO } from '../format.js';
import { NotificationBell } from './Smart.jsx';
import { ThemeToggle } from '../theme.jsx';
import { TIME_LOCALE, currentLang, setLang } from '../i18n.js';

export const NAV = [
  { to: '/', label: 'لوحة التحكم', icon: Icon.dash, end: true },
  { to: '/patients', label: 'المرضى', icon: Icon.users },
  { to: '/appointments', label: 'المواعيد', icon: Icon.cal },
  { to: '/plans', label: 'البرامج الغذائية', icon: Icon.meal },
  { to: '/payments', label: 'المدفوعات', icon: Icon.wallet },
  { to: '/reports', label: 'التقارير', icon: Icon.chart },
  { to: '/settings', label: 'الإعدادات والنسخ', icon: Icon.gear },
];

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  const tones = {
    good: 'border-leaf-500/40 bg-leaf-50 text-leaf-600',
    bad: 'border-clay-500/40 bg-clay-50 text-clay-600',
    warn: 'border-sun-500/40 bg-sun-50 text-sun-600',
    info: 'border-brand-500/30 bg-surface text-ink/75',
  };
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 top-3 z-[80] flex flex-col items-center gap-2 px-3">
      {toasts.map((t) => (
        <button key={t.id} onClick={() => dismissToast(t.id)}
          className={`pop-in pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-xl border px-3.5 py-2.5 text-start text-[13px] font-bold shadow-pop ${tones[t.tone] || tones.info}`}>
          <span className="mt-0.5">{t.tone === 'bad' ? <Icon.alert /> : t.tone === 'good' ? <Icon.check /> : <Icon.shield />}</span>
          <span className="flex-1 leading-6">{t.message}</span>
        </button>
      ))}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hidden items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] font-bold text-ink/60 lg:flex">
      <Icon.clock className="text-brand-600" />
      <span className="tnum">{now.toLocaleDateString(TIME_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      <span className="text-ink/35">·</span>
      <span className="tnum">{now.toLocaleTimeString(TIME_LOCALE, { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  );
}

export function Layout({ children }) {
  const { user, logout, busy } = useApp();
  const [clinic, setClinic] = useState('عيادة التغذية');
  const [open, setOpen] = useState(false);
  const [todayCount, setTodayCount] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [defaultPw, setDefaultPw] = useState(false);
  const [engine, setEngine] = useState(null);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    api.get('/settings').then((r) => setClinic(r.settings?.['clinic.name'] || 'عيادة التغذية')).catch(() => {});
    api.get(`/appointments/today?date=${todayISO()}`).then((r) => setTodayCount(r.total)).catch(() => {});
    api.get('/health').then((r) => { setDemoMode(r.mode === 'demo-ephemeral'); setEngine(r.engine); }).catch(() => {});
    if (user?.role === 'admin') api.get('/auth/me').then((r) => setDefaultPw(!!r.default_password)).catch(() => {});
  }, [loc.pathname]);

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const off = () => setDefaultPw(false);
    window.addEventListener('clinic:password-changed', off);
    return () => window.removeEventListener('clinic:password-changed', off);
  }, []);

  return (
    <div className="flex min-h-screen" id="app-shell">
      <Toasts />

      {/* الشريط الجانبي */}
      <aside className={`no-print fixed inset-y-0 start-0 z-50 flex w-[272px] flex-col gap-1 border-e border-line brand-gradient p-3.5 text-white transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : 'rtl:translate-x-full ltr:-translate-x-full'} lg:sticky lg:top-0 lg:h-screen lg:translate-x-0`}>
        <div className="mb-2 flex items-center gap-3 px-1.5 py-2">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 text-[22px] backdrop-blur">🥗</span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-extrabold leading-tight">{clinic}</p>
            <p className="text-[11.5px] font-bold text-white/60">نظام إدارة العيادة</p>
          </div>
          <button className="ms-auto rounded-lg p-1.5 text-white/70 hover:bg-white/10 lg:hidden" onClick={() => setOpen(false)}><Icon.close /></button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `navlink !text-white/75 hover:!bg-white/10 hover:!text-white ${isActive ? '!bg-surface !text-brand-800 shadow-pop' : ''}`}>
              <n.icon className="text-[1.25em]" />
              <span className="flex-1">{n.label}</span>
              {n.to === '/appointments' && todayCount > 0 && (
                <span className="rounded-full bg-sun-500 px-1.5 py-0.5 text-[10.5px] font-extrabold text-white tnum">{todayCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-2 rounded-2xl bg-white/10 p-3 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/20 text-[13px] font-extrabold">
              {(user?.full_name || '؟')[0]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-extrabold">{user?.full_name}</p>
              <p className="truncate text-[11px] font-bold text-white/60">{ROLES[user?.role] || user?.role}</p>
            </div>
            <button title="تسجيل الخروج" onClick={() => { logout(); nav('/login'); }}
              className="rounded-lg p-2 text-white/70 transition hover:bg-white/15 hover:text-white"><Icon.logout /></button>
          </div>
        </div>
      </aside>

      {open && <div className="no-print fixed inset-0 z-40 bg-[#0b1413]/45 lg:hidden" onClick={() => setOpen(false)} />}

      {/* المحتوى */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-sand/85 px-3 py-2.5 backdrop-blur-md sm:px-5">
          <button className="btn-ghost btn-sm lg:hidden" onClick={() => setOpen(true)} aria-label="القائمة">☰</button>
          <h1 className="truncate text-[15px] font-extrabold">
            {NAV.find((n) => (n.end ? n.to === loc.pathname : loc.pathname.startsWith(n.to)))?.label || 'لوحة التحكم'}
          </h1>
          {busy > 0 && <span className="ms-2 h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-700" />}
          <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
            <Clock />
            <QuickSearch />
            <NotificationBell />
            <ThemeToggle />
            <LangToggle />
          </div>
        </header>
        {demoMode && (
          <div className="no-print flex flex-wrap items-center justify-center gap-2 border-b border-sun-500/30 bg-sun-50 px-5 py-2 text-center text-[12px] font-bold text-sun-600">
            <Icon.alert />
            وضع تجريبي: لا توجد قاعدة بيانات مربوطة، فالبيانات المحفوظة هنا تُمسح وتُزرع بيانات العرض من جديد.
            <span className="opacity-70">للعمل الحقيقي: اربط Neon من Vercel ← Storage (README §9).</span>
          </div>
        )}
        {defaultPw && (
          <div className="no-print flex flex-wrap items-center justify-center gap-2 border-b border-rose-300/50 bg-rose-50 px-5 py-2 text-center text-[12.5px] font-bold text-rose-700">
            <Icon.shield />
            حساب المدير ما زال بكلمة المرور الافتراضية المنشورة — أي شخص يعرف الرابط يستطيع الدخول.
            <button className="btn-danger btn-sm" onClick={() => nav('/settings', { state: { changePassword: true } })}>غيّرها الآن</button>
          </div>
        )}
        <main className="flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <div className="mx-auto w-full max-w-[1420px] fade-in">{children}</div>
        </main>
        <footer className="no-print border-t border-line px-5 py-3 text-center text-[11.5px] font-bold text-ink/40">
          نظام إدارة عيادة التغذية · {engine === 'postgres' ? 'البيانات محفوظة في قاعدة PostgreSQL سحابية' : demoMode ? 'وضع تجريبي — البيانات لا تُحفظ' : 'البيانات محفوظة في قاعدة PostgreSQL على هذا الجهاز'} · إصدار 2.0
        </footer>
      </div>
    </div>
  );
}

/** بحث سريع في الرأس يقود إلى قائمة المرضى */
function QuickSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const nav = useNavigate();
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return undefined; }
    const t = setTimeout(() => {
      api.get(`/patients?q=${encodeURIComponent(q.trim())}&limit=6`).then((r) => setHits(r.items || [])).catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative w-full max-w-[300px]">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-100">
        <Icon.search className="text-brand-600" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو رقم الملف أو الهاتف…"
          className="w-full bg-transparent text-[13px] font-bold outline-none placeholder:font-normal placeholder:text-ink/35"
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { nav(`/patients?q=${encodeURIComponent(q.trim())}`); setHits([]); } }} />
      </div>
      {hits.length > 0 && (
        <div className="pop-in absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          {hits.map((h) => (
            <button key={h.id} onMouseDown={() => { nav(`/patients/${h.id}`); setQ(''); setHits([]); }}
              className="flex w-full items-center gap-3 border-b border-line/60 px-3 py-2.5 text-start last:border-0 hover:bg-brand-50">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-100 text-[11.5px] font-extrabold text-brand-800">
                {(h.first_name || '')[0]}{(h.last_name || '')[0]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-extrabold">{h.full_name}</span>
                <span className="block truncate text-[11.5px] font-bold text-ink/45 tnum">{h.file_no} · {h.phone || 'بدون هاتف'}</span>
              </span>
              <Icon.chev className="rtl:rotate-180 text-ink/30" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** تبديل اللغة (يعيد تحميل الصفحة) */
export function LangToggle() {
  const en = currentLang() === 'en';
  return (
    <button type="button" className="btn-ghost btn-sm !px-2.5 font-extrabold" onClick={() => setLang(en ? 'ar' : 'en')}
      title={en ? 'العربية' : 'English'} aria-label={en ? 'العربية' : 'English'} data-lang-toggle>
      {en ? 'ع' : 'EN'}
    </button>
  );
}
