/**
 * بوابة المريض (Mobile-first) — نفس التطبيق، مسار منفصل #/portal بلا صلاحيات موظفين.
 *  /portal/login?t=…  دخول تلقائي من رمز QR (أو مسح من داخل البوابة، أو رقم الملف + الرمز)
 *  /portal            اليوم · خطتي · تقدّمي · مواعيدي
 *  /portal/call       الانضمام للاستشارة المرئية
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { portalApi, portalToken, tokenFromQr } from '../api.js';
import { ThemeToggle } from '../theme.jsx';
import { LangToggle, Toasts } from '../components/Layout.jsx';
import { QrScanner } from '../components/Qr.jsx';
import { VideoCall, mediaSupported } from '../components/VideoCall.jsx';
import { HabitChart, PortalWeightChart } from '../components/Charts.jsx';
import { ACTIVITY_LABELS, TIME_PREFS, WL_DAYS } from '../components/Care.jsx';
import { DAYS } from '../components/Smart.jsx';
import { Badge, Icon, Spinner } from '../components/ui.jsx';
import { APPT_STATUS, VISIT_TYPES, addDays, fmt, longDate, shortDate, todayISO } from '../format.js';
import {
  canPromptInstall, currentSubscription, isStandalone, onPwaChange, platform, promptInstall, pushPermission, pushSupported,
  subscribePush, unsubscribePush,
} from '../pwa.js';

const ACT_ICONS = { walk: '🚶', run: '🏃', gym: '🏋️', cycling: '🚴', swim: '🏊', sport: '⚽', home: '🧘', other: '✨' };

/* ------------------------------------------------------------ الغلاف */
export default function Portal() {
  return (
    <div className="min-h-screen bg-sand text-ink" data-portal-app>
      <Toasts />
      <Routes>
        <Route path="login" element={<PortalLogin />} />
        <Route path="call" element={<RequireToken><PortalCall /></RequireToken>} />
        <Route path="*" element={<RequireToken><PortalHome /></RequireToken>} />
      </Routes>
    </div>
  );
}

function RequireToken({ children }) {
  const loc = useLocation();
  const [has, setHas] = useState(!!portalToken.get());
  useEffect(() => {
    const out = () => setHas(false);
    window.addEventListener('clinic:portal-signed-out', out);
    return () => window.removeEventListener('clinic:portal-signed-out', out);
  }, []);
  if (!has) return <Navigate to="/portal/login" replace state={{ from: loc.pathname, expired: true }} />;
  return children;
}

/* ------------------------------------------------------------ الدخول */
function PortalLogin() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation();
  const t = params.get('t');
  const [mode, setMode] = useState(t ? 'auto' : 'choose'); // auto | choose | scan | code
  const [err, setErr] = useState(loc.state?.expired ? 'انتهت الجلسة — امسح رمزك من جديد' : '');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ file_no: '', code: '' });
  const tried = useRef(false);

  const done = (r) => {
    portalToken.set(r.token);
    nav('/portal', { replace: true });
  };
  const loginQr = useCallback(async (token) => {
    setBusy(true); setErr('');
    try { done(await portalApi.post('/auth/qr', { token })); }
    catch (e) { setErr(e.message); setMode('choose'); }
    finally { setBusy(false); }
  }, []); // eslint-disable-line

  useEffect(() => {
    if (t && !tried.current) { tried.current = true; loginQr(t); }
    else if (!t && portalToken.get()) nav('/portal', { replace: true });
  }, [t]); // eslint-disable-line

  const submitCode = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { done(await portalApi.post('/auth/code', f)); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };
  const onScan = (text) => {
    const tok = tokenFromQr(text);
    if (!tok) { setErr('هذا ليس رمز بوابة العيادة'); setMode('choose'); return; }
    loginQr(tok);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-8 pt-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-600 text-[22px] text-white shadow-card">🥗</span>
          <div>
            <p className="text-[18px] font-extrabold">بوابتي الصحية</p>
            <p className="text-[12px] font-bold text-ink/50">خطتك · مواعيدك · عاداتك اليومية</p>
          </div>
        </div>
        <div className="flex gap-1"><LangToggle /><ThemeToggle /></div>
      </div>

      {mode === 'auto' || (busy && mode !== 'code') ? (
        <div className="grid flex-1 place-items-center"><Spinner label="جارٍ فتح ملفك…" /></div>
      ) : (
        <div className="grid gap-4">
          {err && <p className="rounded-xl border border-clay-500/30 bg-clay-50 px-3 py-2.5 text-[13px] font-bold text-clay-600" role="alert" data-portal-error>{err}</p>}
          {mode === 'scan' ? (
            <div className="grid gap-3 rounded-2xl bg-surface p-4 shadow-card">
              <p className="text-center text-[14px] font-extrabold">وجّه الكاميرا نحو رمز QR في بطاقتك</p>
              <QrScanner onResult={onScan} />
              <button className="btn-ghost" onClick={() => setMode('choose')}>رجوع</button>
            </div>
          ) : mode === 'code' ? (
            <form onSubmit={submitCode} className="grid gap-3 rounded-2xl bg-surface p-4 shadow-card">
              <p className="text-[14px] font-extrabold">الدخول برقم الملف والرمز</p>
              <label className="grid gap-1 text-[12.5px] font-bold text-ink/60">رقم الملف
                <input className="input text-[16px]" dir="ltr" inputMode="text" autoComplete="username" value={f.file_no} onChange={(e) => setF({ ...f, file_no: e.target.value })} placeholder="NC-0001" required />
              </label>
              <label className="grid gap-1 text-[12.5px] font-bold text-ink/60">الرمز (من بطاقتك أو رسالة واتساب)
                <input className="input text-[16px] tracking-widest" dir="ltr" autoComplete="one-time-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="XXXX-XXXX" required />
              </label>
              <button className="btn-primary !py-3 text-[15px]" disabled={busy}>{busy ? 'جارٍ الدخول…' : 'دخول'}</button>
              <button type="button" className="btn-ghost" onClick={() => setMode('choose')}>رجوع</button>
            </form>
          ) : (
            <>
              <button className="flex items-center gap-4 rounded-2xl bg-brand-600 p-5 text-start text-white shadow-pop transition active:scale-[.98]" onClick={() => setMode('scan')} data-portal-scan>
                <span className="grid h-14 w-14 place-items-center rounded-xl bg-white/15 text-[28px]">📷</span>
                <span><span className="block text-[16px] font-extrabold">مسح رمز QR</span><span className="text-[12.5px] font-bold text-white/75">الرمز المطبوع على بطاقتك من العيادة</span></span>
              </button>
              <button className="flex items-center gap-4 rounded-2xl bg-surface p-5 text-start shadow-card transition active:scale-[.98]" onClick={() => setMode('code')} data-portal-code-login>
                <span className="grid h-14 w-14 place-items-center rounded-xl bg-brand-50 text-[28px]">🔢</span>
                <span><span className="block text-[16px] font-extrabold">رقم الملف + الرمز</span><span className="text-[12.5px] font-bold text-ink/50">إن لم تعمل الكاميرا</span></span>
              </button>
              <p className="px-2 text-center text-[12px] leading-6 text-ink/45">ليس لديك رمز؟ اطلبه من العيادة — يصلك بواتساب أو مطبوعاً. البوابة لا تحتاج كلمة مرور.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ الرئيسية */
const TABS = [['today', 'اليوم', '☀️'], ['plan', 'خطتي', '🍽️'], ['progress', 'تقدّمي', '📈'], ['appointments', 'مواعيدي', '🗓️']];

function PortalHome() {
  const { toast } = useApp();
  const nav = useNavigate();
  const { tab } = useParamsTab();
  const [me, setMe] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try { setMe(await portalApi.get('/me')); setErr(null); }
    catch (e) { if (e.status !== 401) setErr(e); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // تحديث خفيف: عروض قائمة الانتظار ودعوات المكالمات تظهر خلال ثوانٍ
  useEffect(() => {
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15000);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  // تنبيه اهتزاز/صوت عند وصول مكالمة جديدة
  const lastCall = useRef(null);
  useEffect(() => {
    const id = me?.call?.id || null;
    if (id && id !== lastCall.current) { navigator.vibrate?.([200, 100, 200]); }
    lastCall.current = id;
  }, [me?.call?.id]);

  const logout = () => { portalToken.clear(); nav('/portal/login', { replace: true }); };

  if (!me) return err ? (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div><p className="mb-3 font-bold text-ink/60">{err.message}</p><button className="btn-primary" onClick={load}>إعادة المحاولة</button></div>
    </div>
  ) : <div className="grid min-h-screen place-items-center"><Spinner label="جارٍ تحميل ملفك…" /></div>;

  const p = me.patient;
  return (
    <div className="portal-safe mx-auto max-w-md">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-extrabold" data-portal-name>{`مرحباً ${p.first_name} 👋`}</p>
          <p className="truncate text-[11.5px] font-bold text-ink/45">{me.clinic.name} · <span className="tnum" dir="ltr">{p.file_no}</span></p>
        </div>
        <div className="flex items-center gap-1">
          <LangToggle /><ThemeToggle />
          <button className="btn-ghost btn-sm !px-2" onClick={logout} title="خروج" aria-label="خروج"><Icon.logout /></button>
        </div>
      </header>

      <div className="grid gap-3 px-4 pt-4">
        {me._offline && <p className="rounded-xl bg-[#fbf3df] px-3 py-2 text-center text-[12.5px] font-bold text-[#7a5a12] dark:bg-[#2a2415] dark:text-[#e7b54a]" data-portal-offline>📴 لا يوجد اتصال — تعرض آخر نسخة محفوظة من ملفك</p>}
        {me.call && <CallBanner call={me.call} onJoin={() => nav('/portal/call')} />}
        {me.offers?.length > 0 && <OffersBanner offers={me.offers} onDone={load} toast={toast} />}
        {tab === 'today' && <TodayTab me={me} reload={load} toast={toast} />}
        {tab === 'plan' && <PlanTab me={me} />}
        {tab === 'progress' && <ProgressTab me={me} />}
        {tab === 'appointments' && <AppointmentsTab me={me} reload={load} toast={toast} />}
      </div>

      <nav className="portal-nav fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map(([k, l, ic]) => (
            <button key={k} onClick={() => nav(k === 'today' ? '/portal' : `/portal/${k}`)} data-portal-tab={k}
              className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11.5px] font-extrabold transition ${tab === k ? 'text-brand-700' : 'text-ink/45'}`}>
              <span className={`text-[20px] transition ${tab === k ? 'scale-110' : 'grayscale-[60%] opacity-70'}`}>{ic}</span>{l}
              {k === 'appointments' && me.offers?.length > 0 && <span className="absolute top-1.5 start-[58%] h-2.5 w-2.5 rounded-full bg-clay-500" />}
              {tab === k && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-brand-600" />}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
function useParamsTab() {
  const loc = useLocation();
  const seg = loc.pathname.split('/')[2] || 'today';
  return { tab: TABS.some(([k]) => k === seg) ? seg : 'today' };
}

function CallBanner({ call, onJoin }) {
  return (
    <button onClick={onJoin} data-portal-call-banner
      className="flex items-center gap-3 rounded-2xl bg-brand-600 p-4 text-start text-white shadow-pop active:scale-[.98]">
      <span className="call-ripple relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/20 text-[24px] text-white/40"><span className="relative text-white">🎥</span></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-extrabold">{`${call.doctor_name || __t('الأخصائي')} بانتظارك في الاستشارة المرئية`}</span>
        <span className="text-[12px] font-bold text-white/75">اضغط للانضمام الآن</span>
      </span>
      <span className="rounded-xl bg-white px-3 py-2 text-[13px] font-extrabold text-brand-700">انضم</span>
    </button>
  );
}

function OffersBanner({ offers, onDone, toast }) {
  const [busy, setBusy] = useState(0);
  const act = async (o, kind) => {
    setBusy(o.id);
    try {
      await portalApi.post(`/offers/${o.id}/${kind}`);
      toast(kind === 'accept' ? `تم حجز موعدك: ${shortDate(o.slot_date)} الساعة ${o.slot_time} ✓` : 'شكراً — سنعرض عليك موعداً آخر لاحقاً', kind === 'accept' ? 'good' : 'info', 6000);
    } catch (e) { toast(e.message, 'bad', 6000); }
    finally { setBusy(0); onDone(); }
  };
  return (
    <div className="grid gap-2" data-portal-offers={offers.length}>
      {offers.map((o) => (
        <div key={o.id} className="rounded-2xl border-2 border-[#e7b54a] bg-[#fbf3df] p-4 dark:bg-[#2a2415]">
          <p className="text-[14px] font-extrabold">🔔 توفّر موعد أقرب!</p>
          <p className="mt-1 text-[13px] font-bold tnum">{`${longDate(o.slot_date)} · الساعة ${o.slot_time}`}{o.mode === 'video' ? ' · 🎥 مرئية' : ''}</p>
          <p className="mt-0.5 text-[11.5px] font-bold text-ink/50">{`أول من يؤكد يحصل عليه · العرض صالح حتى ${String(o.expires_at).slice(11)}`}</p>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary flex-1 !py-2.5" disabled={!!busy} onClick={() => act(o, 'accept')} data-offer-accept>{busy === o.id ? '…' : 'احجزه لي'}</button>
            <button className="btn-ghost !py-2.5" disabled={!!busy} onClick={() => act(o, 'decline')}>لا يناسبني</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ اليوم: العادات */
function Ring({ value = 0, target = 1, color = '#229a92', children, size = 132 }) {
  const pct = Math.max(0, Math.min(1, (value || 0) / (target || 1)));
  const r = 52; const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeOpacity=".1" strokeWidth="11" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset .5s ease' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

function TodayTab({ me, reload, toast }) {
  const today = me.now?.date || todayISO();
  const [day, setDay] = useState(today);
  const [sum, setSum] = useState(me.habits);
  const [log, setLog] = useState(null);
  const [saving, setSaving] = useState(false);
  const tg = sum.targets;

  useEffect(() => { setSum(me.habits); }, [me.habits]);
  useEffect(() => {
    const r = (sum.series || []).find((s) => s.date === day) || { date: day };
    setLog({ water_ml: r.water_ml ?? 0, sleep_hours: r.sleep_hours ?? null, activity_min: r.activity_min ?? null, activity_type: r.activity_type ?? null, steps: r.steps ?? null });
  }, [day, sum]);

  const save = async (body, okMsg) => {
    setSaving(true);
    try {
      const r = await portalApi.put(`/habits/${day}`, body);
      setLog((l) => ({ ...l, ...r.log }));
      // حدّث السلسلة محلياً دون إعادة تحميل الصفحة كاملة
      setSum((s) => ({ ...s, summary: r.summary, series: s.series.map((x) => (x.date === day ? { ...x, ...r.log } : x)) }));
      if (okMsg) toast(okMsg, 'good', 2200);
    } catch (e) { toast(e.message, 'bad'); }
    finally { setSaving(false); }
  };

  if (!log) return null;
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const s = sum.summary;
  const next = me.appointments.upcoming[0];

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between rounded-2xl bg-surface p-3.5 shadow-card">
        <div>
          <p className="text-[12px] font-bold text-ink/50">سلسلة الأيام</p>
          <p className="text-[22px] font-extrabold tnum" data-portal-streak>{`🔥 ${s.streak} يوماً`}</p>
        </div>
        <div className="text-end">
          <p className="text-[12px] font-bold text-ink/50">التزامك بالأهداف (14 يوماً)</p>
          <p className="text-[22px] font-extrabold tnum text-brand-700">{s.habit_score == null ? '—' : `${s.habit_score}%`}</p>
        </div>
      </div>

      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {days7.map((d) => {
          const r = sum.series.find((x) => x.date === d);
          const any = r && (r.water_ml != null || r.sleep_hours != null || r.activity_min != null);
          return (
            <button key={d} onClick={() => setDay(d)} className={`flex min-w-[46px] flex-col items-center rounded-xl px-2 py-1.5 text-[11px] font-bold ${day === d ? 'bg-brand-600 text-white' : 'bg-surface text-ink/55 shadow-card'}`}>
              {d === today ? 'اليوم' : DAYS[(new Date(`${d}T12:00:00`).getDay() + 1) % 7].slice(0, 3)}
              <span className="tnum text-[13px] font-extrabold">{d.slice(8)}</span>
              <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${any ? (day === d ? 'bg-white' : 'bg-brand-500') : 'bg-transparent'}`} />
            </button>
          );
        })}
      </div>

      {/* الماء */}
      <section className="rounded-2xl bg-surface p-4 shadow-card" data-habit="water">
        <div className="flex items-center gap-4">
          <Ring value={log.water_ml} target={tg.water_ml} color="#3a9fd8">
            <div><p className="text-[22px] font-extrabold tnum" data-water-ml>{fmt((log.water_ml || 0) / 1000, 2)}</p><p className="text-[11px] font-bold text-ink/45">{`من ${fmt(tg.water_ml / 1000, 1)} لتر`}</p></div>
          </Ring>
          <div className="grid flex-1 gap-2">
            <p className="text-[15px] font-extrabold">💧 الماء</p>
            <p className="text-[12px] font-bold text-ink/50">{`${Math.round((log.water_ml || 0) / 250)} أكواب · الهدف ${Math.round(tg.water_ml / 250)}`}</p>
            <div className="grid grid-cols-2 gap-1.5">
              <button className="btn-primary !py-2.5 text-[13px]" disabled={saving} onClick={() => save({ add_water_ml: 250 }, '+ كوب ماء 💧')} data-add-water>+ كوب 250</button>
              <button className="btn-soft !py-2.5 text-[13px]" disabled={saving} onClick={() => save({ add_water_ml: 500 }, '+ زجاجة 💧')}>+ 500 مل</button>
            </div>
            {log.water_ml > 0 && <button className="text-start text-[11.5px] font-bold text-ink/40 underline" disabled={saving} onClick={() => save({ add_water_ml: -250 })}>تراجع عن كوب</button>}
          </div>
        </div>
      </section>

      {/* النوم */}
      <section className="rounded-2xl bg-surface p-4 shadow-card" data-habit="sleep">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[15px] font-extrabold">😴 النوم الليلة الماضية</p>
          <span className={`text-[12px] font-extrabold ${log.sleep_hours >= tg.sleep_hours ? 'text-brand-700' : 'text-ink/45'}`}>{`الهدف ${fmt(tg.sleep_hours, 1)} س`}</span>
        </div>
        <div className="flex items-center justify-center gap-4">
          <button className="grid h-12 w-12 place-items-center rounded-full bg-sand text-[22px] font-extrabold" disabled={saving} onClick={() => save({ sleep_hours: Math.max(0, (log.sleep_hours ?? 7) - 0.5) })} aria-label="أقل">−</button>
          <p className="min-w-[110px] text-center"><span className="text-[34px] font-extrabold tnum" data-sleep-h>{log.sleep_hours == null ? '—' : fmt(log.sleep_hours, 1)}</span><span className="block text-[12px] font-bold text-ink/45">ساعات</span></p>
          <button className="grid h-12 w-12 place-items-center rounded-full bg-sand text-[22px] font-extrabold" disabled={saving} onClick={() => save({ sleep_hours: Math.min(24, (log.sleep_hours ?? 7) + 0.5) })} aria-label="أكثر">+</button>
        </div>
        <div className="mt-3 flex justify-center gap-1.5">
          {[5, 6, 7, 8, 9].map((h) => (
            <button key={h} disabled={saving} onClick={() => save({ sleep_hours: h }, 'تم تسجيل النوم')} className={`rounded-lg px-3 py-1.5 text-[12.5px] font-extrabold tnum ${log.sleep_hours === h ? 'bg-[#e7b54a] text-[#1c2b2a]' : 'bg-sand text-ink/60'}`}>{h}</button>
          ))}
        </div>
      </section>

      {/* النشاط */}
      <section className="rounded-2xl bg-surface p-4 shadow-card" data-habit="activity">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[15px] font-extrabold">🏃 النشاط البدني</p>
          <span className={`text-[12px] font-extrabold tnum ${log.activity_min >= tg.activity_min ? 'text-brand-700' : 'text-ink/45'}`}>{`${log.activity_min ?? 0} / ${tg.activity_min} د`}</span>
        </div>
        <div className="no-scrollbar -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1">
          {(me.activity_types || Object.keys(ACTIVITY_LABELS)).map((k) => (
            <button key={k} disabled={saving} onClick={() => save({ activity_type: k })} className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-bold ${log.activity_type === k ? 'bg-[#5aa843] text-white' : 'bg-sand text-ink/60'}`}>
              {ACT_ICONS[k]} {ACTIVITY_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {[10, 20, 30, 45, 60].map((m) => (
            <button key={m} disabled={saving} onClick={() => save({ activity_min: m, ...(log.activity_type ? {} : { activity_type: 'walk' }) }, 'تم تسجيل النشاط 💪')}
              className={`rounded-xl py-2.5 text-[13px] font-extrabold tnum ${log.activity_min === m ? 'bg-[#5aa843] text-white' : 'bg-sand text-ink/65'}`}>{m}د</button>
          ))}
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <NumField label="دقائق أخرى" value={log.activity_min} onCommit={(v) => save({ activity_min: v })} step={5} />
          <NumField label="الخطوات" value={log.steps} onCommit={(v) => save({ steps: v })} step={500} />
        </div>
      </section>

      {next && (
        <section className="flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-card">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-[20px]">{next.mode === 'video' ? '🎥' : '🗓️'}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold text-ink/50">موعدك القادم</p>
            <p className="truncate text-[14px] font-extrabold">{longDate(next.date)} · <span className="tnum">{next.time}</span></p>
          </div>
        </section>
      )}
      <AppCard me={me} toast={toast} />
      <p className="pb-2 text-center text-[11px] font-bold text-ink/35">تُحفظ تلقائياً وتظهر لأخصائي التغذية في ملفك</p>
    </div>
  );
}

/* ------------------------------------------------------------ التطبيق على الجوال: التثبيت + الإشعارات */
function AppCard({ me, toast }) {
  const os = platform();
  const standalone = isStandalone();
  const [, force] = useState(0);
  const [sub, setSub] = useState(null); // اشتراك هذا الجهاز
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const supported = pushSupported();
  const synced = useRef(false);

  useEffect(() => onPwaChange(() => force((n) => n + 1)), []);
  useEffect(() => {
    if (!supported) return;
    currentSubscription().then(async (s) => {
      setSub(s);
      // أعد ربط اشتراك الجهاز بالمريض الحالي (بعد إعادة الدخول أو تغيّر الخادم) — مرة لكل تحميل
      if (s && !synced.current) { synced.current = true; await portalApi.post('/push/subscribe', { subscription: s.toJSON(), platform: os }).catch(() => {}); }
    });
  }, [supported]);

  const enable = async () => {
    setBusy(true);
    try {
      const { public_key: key } = await portalApi.get('/push/key');
      const json = await subscribePush(key);
      await portalApi.post('/push/subscribe', { subscription: json, platform: os });
      setSub(await currentSubscription());
      const t = await portalApi.post('/push/test');
      toast(t.sent ? 'تم تفعيل الإشعارات — وصلك إشعار تجريبي ✓' : 'تم التفعيل ✓', 'good', 5000);
    } catch (e) { toast(e.message, 'bad', 7000); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try {
      const endpoint = await unsubscribePush();
      if (endpoint) await portalApi.post('/push/unsubscribe', { endpoint });
      setSub(null);
      toast('أُوقفت الإشعارات على هذا الجهاز', 'info');
    } catch (e) { toast(e.message, 'bad'); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { const t = await portalApi.post('/push/test'); toast(t.sent ? 'أُرسل إشعار تجريبي ✓' : 'لم يصل — أعد تفعيل الإشعارات', t.sent ? 'good' : 'warn'); }
    catch (e) { toast(e.message, 'bad'); }
    finally { setBusy(false); }
  };
  const install = async () => { if (await promptInstall()) toast('تم تثبيت التطبيق ✓ — افتحه من الشاشة الرئيسية', 'good', 6000); };

  const denied = pushPermission() === 'denied';
  let pushBody;
  if (sub) {
    pushBody = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-[12.5px] font-extrabold text-brand-700" data-push-state="on">🔔 الإشعارات مفعّلة على هذا الجهاز</span>
        <button className="btn-ghost btn-sm" disabled={busy} onClick={test}>تجربة</button>
        <button className="btn-ghost btn-sm text-ink/50" disabled={busy} onClick={disable}>إيقاف</button>
      </div>
    );
  } else if (supported && !denied) {
    pushBody = (
      <button className="btn-primary w-full !py-2.5" disabled={busy} onClick={enable} data-push-enable>{busy ? '…' : '🔔 فعّل الإشعارات'}</button>
    );
  } else {
    pushBody = (
      <p className="rounded-xl bg-sand/70 p-2.5 text-[12px] font-bold leading-6 text-ink/60" data-push-state="unsupported">
        {denied ? 'الإشعارات محظورة لهذا الموقع — فعّلها من إعدادات الجوال ثم أعد فتح التطبيق.'
          : os === 'ios' && !standalone ? 'على iPhone تعمل الإشعارات بعد تثبيت التطبيق على الشاشة الرئيسية (iOS 16.4 أو أحدث).'
            : 'هذا المتصفح لا يدعم الإشعارات — جرّب Chrome أو Safari.'}
      </p>
    );
  }

  return (
    <section className="grid gap-3 rounded-2xl bg-surface p-4 shadow-card" data-portal-app-card data-standalone={standalone ? '1' : '0'}>
      <div className="flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold">📲 تطبيقك على الجوال</p>
          <p className="text-[12px] font-bold text-ink/50">تذكير بالمواعيد، عروض المواعيد الأقرب، ودعوة الاستشارة المرئية فوراً</p>
        </div>
      </div>

      {standalone ? (
        <p className="text-[12.5px] font-bold text-brand-700">✓ أنت تستخدم التطبيق المثبّت</p>
      ) : canPromptInstall() ? (
        <button className="btn-soft w-full !py-2.5" onClick={install} data-install>⬇️ ثبّت التطبيق على الشاشة الرئيسية</button>
      ) : (
        <div className="grid gap-2">
          <button className="btn-soft w-full !py-2.5" onClick={() => setShowSteps((v) => !v)} data-install-steps-toggle>⬇️ كيف أثبّت التطبيق؟</button>
          {showSteps && (os === 'ios' ? (
            <ol className="grid list-decimal gap-1 rounded-xl bg-sand/70 p-3 ps-7 text-[12.5px] font-bold leading-6" data-install-steps="ios">
              <li>افتح هذه الصفحة في Safari.</li>
              <li>اضغط زر المشاركة (المربع والسهم ⬆️) أسفل الشاشة.</li>
              <li>اختر «إضافة إلى الشاشة الرئيسية» ثم «إضافة».</li>
              <li>{`افتح التطبيق من أيقونته وسجّل الدخول مرة واحدة: رقم الملف ${me.patient.file_no} والرمز (أو امسح رمز QR).`}</li>
              <li>فعّل الإشعارات من داخل التطبيق.</li>
            </ol>
          ) : (
            <ol className="grid list-decimal gap-1 rounded-xl bg-sand/70 p-3 ps-7 text-[12.5px] font-bold leading-6" data-install-steps="android">
              <li>افتح هذه الصفحة في Chrome.</li>
              <li>اضغط قائمة المتصفح ⋮ أعلى الشاشة.</li>
              <li>اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</li>
            </ol>
          ))}
        </div>
      )}

      {pushBody}
    </section>
  );
}

function NumField({ label, value, onCommit, step = 1 }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  const commit = () => { const n = v === '' ? null : Number(v); if (n !== (value ?? null) && (n === null || Number.isFinite(n))) onCommit(n); };
  return (
    <label className="grid gap-1 text-[11.5px] font-bold text-ink/50">{label}
      <input type="number" inputMode="numeric" min="0" step={step} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className="input !py-2 text-[15px] tnum" />
    </label>
  );
}

/* ------------------------------------------------------------ خطتي */
function PlanTab({ me }) {
  const plan = me.plan;
  const [d, setD] = useState(plan?.today_index ?? 0);
  if (!plan) return <EmptyCard icon="🍽️" title="لا توجد خطة غذائية بعد" text="ستظهر خطتك هنا فور اعتمادها من أخصائي التغذية." />;
  const weekly = plan.meals.some((m) => m.day_of_week != null);
  const meals = plan.meals.filter((m) => !weekly || m.day_of_week == null || m.day_of_week === d);
  const kcal = meals.reduce((a, m) => a + (Number(m.kcal) || 0), 0);
  const fiber = meals.reduce((a, m) => a + (Number(m.fiber_g) || 0), 0);
  return (
    <div className="grid gap-3" data-portal-plan>
      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <p className="text-[16px] font-extrabold">{plan.title}</p>
        <p className="mt-0.5 text-[12.5px] font-bold text-ink/50">{plan.target_kcal ? `الهدف ${fmt(plan.target_kcal, 0)} سعرة/يوم` : ''}{kcal ? ` · هذا اليوم ${fmt(kcal, 0)} سعرة` : ''}</p>
        {(plan.target_water_ml || plan.target_fiber_g) && (
          <div className="mt-2.5 grid grid-cols-2 gap-2" data-portal-plan-targets>
            {plan.target_water_ml ? (
              <div className="rounded-xl bg-brand-50 px-3 py-2">
                <p className="text-[11px] font-bold text-brand-700/70">💧 الماء يومياً</p>
                <p className="tnum text-[15px] font-extrabold text-brand-800">{`${fmt(plan.target_water_ml / 1000)} لتر`}</p>
                <p className="tnum text-[10.5px] font-bold text-ink/45">{`≈ ${Math.round(plan.target_water_ml / 250)} كوب`}</p>
              </div>
            ) : <span />}
            {plan.target_fiber_g ? (
              <div className="rounded-xl bg-leaf-50 px-3 py-2">
                <p className="text-[11px] font-bold text-leaf-600/80">🌾 الألياف يومياً</p>
                <p className="tnum text-[15px] font-extrabold text-leaf-600">{`${fmt(plan.target_fiber_g, 0)} غ`}</p>
                {fiber > 0 && <p className="tnum text-[10.5px] font-bold text-ink/45">{`في وجبات هذا اليوم ${fmt(fiber, 0)} غ`}</p>}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {weekly && (
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {DAYS.map((l, i) => (
            <button key={l} onClick={() => setD(i)} className={`shrink-0 rounded-xl px-3 py-2 text-[12.5px] font-extrabold ${d === i ? 'bg-brand-600 text-white' : 'bg-surface text-ink/55 shadow-card'}`}>
              {l}{i === plan.today_index && <span className="ms-1 text-[10px]">•</span>}
            </button>
          ))}
        </div>
      )}
      {meals.length === 0 ? <EmptyCard icon="🥗" title="لا وجبات لهذا اليوم" /> : meals.map((m) => (
        <div key={m.id} className="rounded-2xl bg-surface p-4 shadow-card">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[14.5px] font-extrabold">{__t(m.slot)}{m.slot_time && <span className="tnum ms-2 text-[11.5px] font-bold text-ink/40">{m.slot_time}</span>}</p>
            {m.kcal ? <Badge tone="brand">{fmt(m.kcal, 0)} سعرة</Badge> : null}
          </div>
          {m.title && <p className="text-[13.5px] font-bold">{m.title}</p>}
          {m.items && <p className="mt-1 whitespace-pre-line text-[13px] leading-7 text-ink/70">{m.items}</p>}
          {m.portions && <p className="mt-1 text-[12px] font-bold text-ink/45">{`الكمية: ${m.portions}`}</p>}
        </div>
      ))}
      {plan.instructions && <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-4 text-[13px] leading-7"><p className="mb-1 font-extrabold">📝 تعليمات الأخصائي</p><p className="whitespace-pre-line">{plan.instructions}</p></div>}
    </div>
  );
}

/* ------------------------------------------------------------ تقدّمي */
function ProgressTab({ me }) {
  const pr = me.progress;
  const [hab, setHab] = useState(me.habits);
  const [days, setDays] = useState(14);
  useEffect(() => { if (days === 14) setHab(me.habits); else portalApi.get(`/habits?days=${days}`).then(setHab).catch(() => {}); }, [days, me.habits]);
  const lost = pr.start_weight != null && pr.current_weight != null ? pr.start_weight - pr.current_weight : null;
  const goalPct = pr.start_weight && pr.goal_weight && pr.current_weight && pr.start_weight !== pr.goal_weight
    ? Math.max(0, Math.min(100, Math.round(((pr.start_weight - pr.current_weight) / (pr.start_weight - pr.goal_weight)) * 100))) : null;
  return (
    <div className="grid gap-3" data-portal-progress>
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="الوزن الحالي" value={pr.current_weight != null ? fmt(pr.current_weight, 1) : '—'} unit="كغ" />
        <MiniStat label={lost != null && lost < 0 ? 'زيادة' : 'التغيّر'} value={lost != null ? fmt(Math.abs(lost), 1) : '—'} unit="كغ" tone="brand" />
        <MiniStat label="BMI" value={pr.bmi != null ? fmt(pr.bmi, 1) : '—'} unit={pr.bmi_category || ''} />
      </div>
      {goalPct != null && (
        <div className="rounded-2xl bg-surface p-4 shadow-card">
          <div className="mb-2 flex justify-between text-[12.5px] font-extrabold"><span>{`نحو هدفك (${fmt(pr.goal_weight, 1)} كغ)`}</span><span className="tnum text-brand-700">{goalPct}%</span></div>
          <div className="h-3 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-gradient-to-l from-brand-500 to-[#5aa843] transition-all" style={{ width: `${goalPct}%` }} /></div>
        </div>
      )}
      <div className="rounded-2xl bg-surface p-3 shadow-card">
        <p className="mb-1 px-1 text-[13px] font-extrabold">⚖️ الوزن عبر الزيارات</p>
        {pr.series.length > 1 ? <PortalWeightChart series={pr.series} goal={pr.goal_weight} /> : <p className="p-4 text-center text-[12.5px] text-ink/45">يظهر المنحنى بعد قياسين على الأقل</p>}
      </div>
      <div className="flex items-center justify-between px-1">
        <p className="text-[14px] font-extrabold">عاداتي</p>
        <div className="flex gap-1 rounded-xl bg-surface p-1 shadow-card">
          {[14, 30].map((d) => <button key={d} onClick={() => setDays(d)} className={`rounded-lg px-2.5 py-1 text-[12px] font-bold ${days === d ? 'bg-brand-600 text-white' : 'text-ink/50'}`}>{d} يوماً</button>)}
        </div>
      </div>
      {[['water_ml', '💧 الماء (مل)', 'water_hit_pct'], ['sleep_hours', '😴 النوم (ساعات)', 'sleep_hit_pct'], ['activity_min', '🏃 النشاط (دقائق)', 'activity_hit_pct']].map(([k, l, hk]) => (
        <div key={k} className="rounded-2xl bg-surface p-3 shadow-card">
          <p className="mb-1 flex justify-between px-1 text-[12.5px] font-extrabold"><span>{l}</span><span className="text-brand-700">{`حققت الهدف ${hab.summary[hk] ?? 0}% من الأيام`}</span></p>
          <HabitChart series={hab.series} metric={k} target={hab.targets[k]} height={140} />
        </div>
      ))}
    </div>
  );
}
const MiniStat = ({ label, value, unit, tone }) => (
  <div className={`rounded-2xl p-3 text-center shadow-card ${tone === 'brand' ? 'bg-brand-600 text-white' : 'bg-surface'}`}>
    <p className={`text-[11px] font-bold ${tone === 'brand' ? 'text-white/75' : 'text-ink/50'}`}>{label}</p>
    <p className="text-[20px] font-extrabold tnum">{value}</p>
    <p className={`truncate text-[10.5px] font-bold ${tone === 'brand' ? 'text-white/70' : 'text-ink/40'}`}>{unit}</p>
  </div>
);
const EmptyCard = ({ icon, title, text }) => (
  <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
    <p className="text-[34px]">{icon}</p><p className="mt-2 text-[14.5px] font-extrabold">{title}</p>{text && <p className="mt-1 text-[12.5px] text-ink/50">{text}</p>}
  </div>
);

/* ------------------------------------------------------------ مواعيدي + قائمة الانتظار */
function AppointmentsTab({ me, reload, toast }) {
  const [wlOpen, setWlOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ date_from: todayISO(), date_to: addDays(todayISO(), 14), days: [], time_pref: 'any', mode: 'in_person', note: '' });
  const entry = me.waitlist?.[0];
  const now = `${me.now.date} ${me.now.time}`;

  const cancel = async (a) => {
    if (!window.confirm(__t('إلغاء هذا الموعد؟ سيُعرض على مرضى آخرين في قائمة الانتظار.'))) return;
    try { await portalApi.post(`/appointments/${a.id}/cancel`); toast('أُلغي الموعد', 'good'); reload(); }
    catch (e) { toast(e.message, 'bad', 6000); }
  };
  const join = async () => {
    setBusy(true);
    try {
      await portalApi.post('/waitlist', { ...f, date_to: f.date_to || null });
      toast('تمت إضافتك لقائمة الانتظار — سنرسل لك فور توفر موعد 🔔', 'good', 6000);
      setWlOpen(false); reload();
    } catch (e) { toast(e.message, 'bad', 6000); }
    finally { setBusy(false); }
  };
  const leave = async () => {
    if (!window.confirm(__t('الخروج من قائمة الانتظار؟'))) return;
    try { await portalApi.del('/waitlist'); toast('خرجت من قائمة الانتظار', 'info'); reload(); } catch (e) { toast(e.message, 'bad'); }
  };
  const hoursTo = (a) => (new Date(`${a.date}T${a.time}:00Z`) - new Date(`${now.replace(' ', 'T')}:00Z`)) / 36e5;

  return (
    <div className="grid gap-3" data-portal-appointments>
      <p className="px-1 text-[14px] font-extrabold">المواعيد القادمة</p>
      {me.appointments.upcoming.length === 0 ? <EmptyCard icon="🗓️" title="لا مواعيد قادمة" text="تواصل مع العيادة للحجز، أو انضم لقائمة الانتظار بالأسفل." /> : me.appointments.upcoming.map((a) => (
        <div key={a.id} className="rounded-2xl bg-surface p-4 shadow-card">
          <div className="flex items-start gap-3">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-50 text-center leading-tight">
              <span className="text-[18px] font-extrabold tnum text-brand-700">{a.date.slice(8)}</span>
              <span className="text-[10px] font-bold text-brand-700/70">{a.date.slice(5, 7)}/{a.date.slice(2, 4)}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-extrabold">{longDate(a.date)}</p>
              <p className="text-[12.5px] font-bold text-ink/55 tnum">{`${a.time} · ${a.duration_min} دقيقة · ${VISIT_TYPES[a.visit_type]?.label || ''}`}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge tone={APPT_STATUS[a.status]?.color}>{APPT_STATUS[a.status]?.label}</Badge>
                {a.mode === 'video' && <Badge tone="brand">🎥 استشارة مرئية</Badge>}
              </div>
            </div>
          </div>
          {hoursTo(a) >= 3 && <button className="mt-3 w-full rounded-xl border border-line py-2 text-[12.5px] font-bold text-clay-600" onClick={() => cancel(a)} data-portal-cancel>إلغاء الموعد</button>}
        </div>
      ))}

      <div className="rounded-2xl border border-brand-200 bg-surface p-4 shadow-card" data-portal-waitlist={entry ? 'waiting' : 'none'}>
        <p className="text-[14.5px] font-extrabold">🕰️ قائمة الانتظار</p>
        {entry ? (
          <>
            <p className="mt-1 text-[13px] font-bold text-ink/65" data-wl-position={entry.position}>{`أنت رقم ${entry.position} في القائمة. عند إلغاء أي موعد يناسبك نرسل لك فوراً.`}</p>
            <p className="mt-1 text-[12px] font-bold text-ink/45">{entry.date_from ? shortDate(entry.date_from) : 'الآن'} → {entry.date_to ? shortDate(entry.date_to) : 'مفتوح'} · {TIME_PREFS[entry.time_pref]}{entry.mode === 'video' ? ' · 🎥' : ''}</p>
            <button className="mt-3 w-full rounded-xl border border-line py-2 text-[12.5px] font-bold text-ink/55" onClick={leave}>الخروج من القائمة</button>
          </>
        ) : !wlOpen ? (
          <>
            <p className="mt-1 text-[12.5px] font-bold text-ink/55">تريد موعداً أقرب؟ سجّل رغبتك، وعند إلغاء أي موعد يناسبك يصلك إشعار بواتساب وهنا في البوابة.</p>
            <button className="btn-primary mt-3 w-full !py-2.5" onClick={() => setWlOpen(true)} data-portal-waitlist-open>اطلب موعداً أقرب</button>
          </>
        ) : (
          <div className="mt-3 grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[11.5px] font-bold text-ink/50">من<input type="date" className="input !py-2" min={todayISO()} value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} /></label>
              <label className="grid gap-1 text-[11.5px] font-bold text-ink/50">إلى<input type="date" className="input !py-2" min={f.date_from} value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} /></label>
            </div>
            <div>
              <p className="mb-1 text-[11.5px] font-bold text-ink/50">الأيام المناسبة (اتركها فارغة = أي يوم)</p>
              <div className="flex flex-wrap gap-1.5">
                {WL_DAYS.map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setF((x) => ({ ...x, days: x.days.includes(v) ? x.days.filter((y) => y !== v) : [...x.days, v] }))}
                    className={`rounded-lg px-2.5 py-1.5 text-[12px] font-bold ${f.days.includes(v) ? 'bg-brand-600 text-white' : 'bg-sand text-ink/60'}`}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[11.5px] font-bold text-ink/50">الوقت</p>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(TIME_PREFS).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setF({ ...f, time_pref: k })} className={`rounded-lg px-2 py-2 text-[12px] font-bold ${f.time_pref === k ? 'bg-brand-600 text-white' : 'bg-sand text-ink/60'}`}>{l}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[['in_person', '🏥 حضوري'], ['video', '🎥 مرئية']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setF({ ...f, mode: k })} className={`rounded-lg py-2 text-[12.5px] font-bold ${f.mode === k ? 'bg-brand-600 text-white' : 'bg-sand text-ink/60'}`}>{l}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="btn-primary flex-1 !py-2.5" disabled={busy} onClick={join} data-portal-waitlist-submit>{busy ? '…' : 'انضم للقائمة'}</button>
              <button className="btn-ghost !py-2.5" onClick={() => setWlOpen(false)}>إلغاء</button>
            </div>
          </div>
        )}
      </div>

      {me.appointments.past.length > 0 && (
        <>
          <p className="px-1 pt-1 text-[14px] font-extrabold">السابقة</p>
          <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
            {me.appointments.past.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 border-b border-line/60 px-4 py-2.5 text-[12.5px] last:border-0">
                <span className="font-bold">{shortDate(a.date)} <span className="tnum text-ink/45">{a.time}</span></span>
                <Badge tone={APPT_STATUS[a.status]?.color}>{APPT_STATUS[a.status]?.label}</Badge>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ المكالمة */
function PortalCall() {
  const nav = useNavigate();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    portalApi.get('/calls/active').then((r) => setState({ loading: false, ...r })).catch((e) => setState({ loading: false, error: e.message }));
  }, []);
  const client = useMemo(() => (state.call ? {
    pull: (after) => portalApi.get(`/calls/${state.call.id}/signals?after=${after}`),
    signal: (kind, payload) => portalApi.post(`/calls/${state.call.id}/signal`, { kind, payload }),
    end: () => portalApi.post(`/calls/${state.call.id}/leave`),
  } : null), [state.call]);

  if (state.loading) return <div className="grid min-h-screen place-items-center"><Spinner label="جارٍ تجهيز المكالمة…" /></div>;
  if (!state.call || !mediaSupported()) {
    return (
      <div className="mx-auto grid min-h-screen max-w-md place-items-center p-6 text-center">
        <div>
          <p className="text-[40px]">{state.call ? '⚠️' : '🎥'}</p>
          <p className="mt-2 text-[15px] font-extrabold" data-portal-no-call>{state.error || (!state.call ? 'لا توجد استشارة مرئية نشطة الآن' : 'المتصفح لا يدعم المكالمات المرئية — جرّب Chrome أو Safari الحديث')}</p>
          <p className="mt-1 text-[12.5px] text-ink/50">عندما يبدأ الأخصائي المكالمة يظهر لك زر «انضم» في الصفحة الرئيسية.</p>
          <button className="btn-primary mt-4" onClick={() => nav('/portal')}>العودة للبوابة</button>
        </div>
      </div>
    );
  }
  return (
    <VideoCall role="patient" client={client} iceServers={state.ice_servers}
      title={`استشارة مع ${state.call.doctor_name || 'الأخصائي'}`} subtitle={state.call.date ? `${shortDate(state.call.date)} ${state.call.time || ''}` : ''}
      onClose={() => nav('/portal')} />
  );
}
