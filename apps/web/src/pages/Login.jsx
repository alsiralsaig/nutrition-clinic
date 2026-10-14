import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { api } from '../api.js';
import { Icon, Input } from '../components/ui.jsx';
import { canPromptInstall, isStandalone, onPwaChange, platform, promptInstall } from '../pwa.js';

export default function Login() {
  const { user, login, toast } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [mode, setMode] = useState('phone'); // phone = رقم التلفون و PIN (الافتراضي) · username = الاسم وكلمة المرور
  const [form, setForm] = useState({ username: '', password: '' });
  const digits = (v) => v.replace(/[\u0660-\u0669]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\u06F0-\u06F9]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [recovery, setRecovery] = useState(null); // null = جارٍ التحقق · true/false
  const [fp, setFp] = useState({ username: 'admin', code: '', password: '', confirm: '' });
  const [fpBusy, setFpBusy] = useState(false);
  const [, refreshPwa] = useState(0);
  const os = platform();
  const installed = isStandalone();

  useEffect(() => onPwaChange(() => refreshPwa((n) => n + 1)), []);
  useEffect(() => { document.title = 'تسجيل الدخول — عيادة التغذية'; }, []);

  // هل «نسيت كلمة المرور» مفعّلة على الخادم؟ (متغيّر ADMIN_RECOVERY_CODE)
  useEffect(() => {
    api.get('/health').then((h) => setRecovery(!!h?.recovery_enabled)).catch(() => setRecovery(false));
  }, []);

  if (user) return <Navigate to={loc.state?.from || '/'} replace />;

  const submitForgot = async (e) => {
    e.preventDefault();
    setErr('');
    if (fp.password.length < 8) { setErr('كلمة المرور الجديدة 8 أحرف على الأقل'); return; }
    if (fp.password !== fp.confirm) { setErr('كلمتا المرور غير متطابقتين'); return; }
    setFpBusy(true);
    try {
      await api.post('/auth/reset-password', {
        username: fp.username.trim() || 'admin', code: fp.code.trim(), new_password: fp.password,
      });
      const u = await login(fp.username.trim() || 'admin', fp.password);
      toast(`تم تعيين كلمة المرور — أهلاً ${u.full_name} 👋`, 'good', 6000);
      nav(loc.state?.from || '/', { replace: true });
    } catch (ex) {
      setErr(ex?.message || 'تعذّرت إعادة التعيين');
    } finally { setFpBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (mode === 'phone') {
        const phone = form.username.trim();
        if (digits(phone).length < 9) { setErr('أدخل رقم تلفون صحيح — مثال: 0913009060'); setBusy(false); return; }
        if (!/^\d{4,6}$/.test(digits(form.password))) { setErr('رمز الدخول: من 4 إلى 6 أرقام'); setBusy(false); return; }
      }
      const u = await login(form.username.trim(), form.password);
      toast(`أهلاً ${u.full_name} 👋`, 'good');
      nav(loc.state?.from || '/', { replace: true });
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (canPromptInstall()) {
      const accepted = await promptInstall();
      if (accepted) toast('تم تثبيت التطبيق ✓ — افتحه من الشاشة الرئيسية', 'good', 6000);
      else setShowInstallHelp(true);
    } else {
      setShowInstallHelp((v) => !v);
    }
  };

  const bannerUrl = 'https://gzkuoczegwcszdoqisjn.supabase.co/storage/v1/object/public/bucket/clinic-banner.png';
  const logoUrl = 'https://gzkuoczegwcszdoqisjn.supabase.co/storage/v1/object/public/bucket/clinic-logo.png';

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* بانر الكمبيوتر */}
      <div className="relative hidden items-center justify-center overflow-hidden bg-white p-6 lg:flex">
        <img src={bannerUrl} alt="تغذيتك — إدارة عيادات التغذية، صحة أفضل لحياة أجمل"
          className="max-h-[min(92vh,900px)] w-full rounded-[2rem] object-contain shadow-[0_18px_60px_rgba(15,99,96,0.12)]" />
      </div>

      {/* نموذج الدخول */}
      <div className="flex items-center justify-center bg-sand p-5">
        <form onSubmit={submit} className="card card-pad w-full max-w-[400px] p-6 sm:p-8">
          {/* يظهر البانر والشعار على الهاتف */}
          <div className="mb-5 text-center lg:hidden">
            <img src={bannerUrl} alt="تغذيتك — إدارة عيادات التغذية، صحة أفضل لحياة أجمل"
              className="mx-auto mb-3 max-h-[300px] w-full max-w-[340px] rounded-2xl object-contain" />
            <img src={logoUrl} alt="شعار تغذيتك"
              className="mx-auto h-16 w-16 rounded-2xl object-contain" />
            <p className="mt-2 text-[16px] font-extrabold">نظام عيادة التغذية</p>
            <p className="mt-0.5 text-[12px] font-bold text-ink/50">تسجيل الدخول برقم التلفون</p>
          </div>

          {!installed && (
            <div className="mb-5">
              <button type="button" onClick={install} className="btn-soft w-full !py-2.5" data-install>
                {canPromptInstall()
                  ? '⬇️ تثبيت التطبيق على الشاشة الرئيسية'
                  : '📲 كيف أثبّت التطبيق على الشاشة الرئيسية؟'}
              </button>

              {showInstallHelp && (
                <ol className="mt-2 grid list-decimal gap-1 rounded-xl bg-sand p-3 ps-7 text-[12px] font-bold leading-6 text-ink/70"
                  data-install-steps={os}>
                  {os === 'ios' ? (
                    <>
                      <li>افتح الموقع في متصفح Safari على iPhone أو iPad.</li>
                      <li>اضغط زر المشاركة (مربع وسهم للأعلى ⬆️) أسفل الشاشة.</li>
                      <li>اختر «إضافة إلى الشاشة الرئيسية» ثم اضغط «إضافة».</li>
                    </>
                  ) : os === 'android' ? (
                    <>
                      <li>افتح الموقع في Chrome.</li>
                      <li>اضغط قائمة ⋮ ثم «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</li>
                    </>
                  ) : (
                    <>
                      <li>افتح قائمة المتصفح.</li>
                      <li>اختر «تثبيت التطبيق» أو «Install app».</li>
                    </>
                  )}
                </ol>
              )}
            </div>
          )}

          {installed && (
            <p className="mb-4 text-center text-[12px] font-extrabold text-brand-700">
              ✓ التطبيق مثبت على هذا الجهاز
            </p>
          )}

          <h1 className="text-[21px] font-extrabold">تسجيل الدخول</h1>
          <p className="muted mt-1">أدخل اسم المستخدم وكلمة المرور الخاصين بالموظف.</p>

          <div className="mt-6 grid gap-4">
            {mode === 'phone' ? (
              <>
                <label className="block">
                  <span className="label">رقم التلفون</span>
                  <Input autoFocus inputMode="tel" autoComplete="tel" dir="ltr" className="text-left" value={form.username}
                    onChange={(e) => setForm({ ...form, username: digits(e.target.value).slice(0, 13) })} placeholder="09XXXXXXXX" />
                </label>
                <label className="block">
                  <span className="label">رمز الدخول (PIN)</span>
                  <Input inputMode="numeric" autoComplete="off" type="password" dir="ltr" className="text-left tracking-[0.4em]" value={form.password}
                    onChange={(e) => setForm({ ...form, password: digits(e.target.value).slice(0, 6) })} placeholder="••••" />
                </label>
                <p className="text-[12px] font-bold text-ink/55">ادخل برقم تلفونك ورمز الدخول الذي يخصك.</p>
              </>
            ) : (
              <label className="block">
                <span className="label">اسم المستخدم</span>
                <Input autoFocus autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="admin" />
              </label>
            )}

            <label className={`block ${mode === 'phone' ? 'hidden' : ''}`}>
              <span className="label">كلمة المرور</span>
              <div className="relative">
                <Input type={show ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••" className="pe-11" />
                <button type="button" onClick={() => setShow((s) => !s)}
                  className="absolute inset-y-0 end-2 my-auto h-7 rounded-md px-2 text-[11.5px] font-extrabold text-brand-700 hover:bg-brand-50">
                  {show ? 'إخفاء' : 'إظهار'}
                </button>
              </div>
            </label>
          </div>

          {err && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-clay-100 bg-clay-50 px-3 py-2.5 text-[12.5px] font-bold text-clay-600">
              <Icon.alert className="mt-0.5" /> {err}
            </p>
          )}

          <button type="button" onClick={() => { setErr(''); setMode(mode === 'phone' ? 'username' : 'phone'); }}
            className="mt-3 text-[12px] font-extrabold text-clay-600 underline underline-offset-4 hover:text-clay-800 w-full">
            {mode === 'phone' ? 'الدخول باسم المستخدم وكلمة المرور بدلاً من ذلك' : 'الدخول برقم التلفون و PIN بدلاً من ذلك'}
          </button>
          <button className="btn-primary mt-6 w-full" disabled={busy || !form.username || !form.password}>
            {busy
              ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              : <Icon.shield />}
            {busy ? 'جارٍ التحقق…' : 'دخول'}
          </button>

          {!forgot && (
            <div className="mt-3 text-center">
              <button type="button" onClick={() => setForgot(true)}
                className="text-[12.5px] font-extrabold text-brand-700 underline-offset-2 hover:underline" data-forgot-link>
                نسيت كلمة المرور؟
              </button>
            </div>
          )}

          {forgot && (
            <form onSubmit={submitForgot} className="mt-4 grid gap-3 rounded-xl border border-brand-100 bg-brand-50/60 p-3.5" data-forgot-panel>
              <p className="text-[12.5px] font-extrabold text-brand-800">نسيت كلمة المرور؟</p>

              {recovery === false ? (
                <ol className="grid list-decimal gap-1 rounded-xl bg-surface p-3 ps-6 text-[12px] font-bold leading-6 text-ink/70">
                  <li>افتح المشروع في <span className="tnum">Vercel</span>.</li>
                  <li><span className="font-extrabold">Settings → Environment Variables</span>.</li>
                  <li>أضف <span className="tnum" dir="ltr">ADMIN_RECOVERY_CODE</span> بقيمة سرية تحتفظ بها أنت فقط.</li>
                  <li>أعد النشر <span className="tnum">Redeploy</span>، ثم ارجع لهذه الشاشة.</li>
                </ol>
              ) : (
                <>
                  <label className="block">
                    <span className="label">اسم المستخدم</span>
                    <Input dir="ltr" autoComplete="username" value={fp.username}
                      onChange={(e) => setFp({ ...fp, username: e.target.value })} placeholder="admin" />
                  </label>
                  <label className="block">
                    <span className="label">رمز الاستعادة (ADMIN_RECOVERY_CODE)</span>
                    <Input dir="ltr" value={fp.code} onChange={(e) => setFp({ ...fp, code: e.target.value })}
                      placeholder="••••••••" autoComplete="one-time-code" />
                  </label>
                  <label className="block">
                    <span className="label">كلمة المرور الجديدة</span>
                    <Input type="password" autoComplete="new-password" value={fp.password}
                      onChange={(e) => setFp({ ...fp, password: e.target.value })} placeholder="8 أحرف على الأقل" />
                  </label>
                  <label className="block">
                    <span className="label">تأكيد كلمة المرور</span>
                    <Input type="password" autoComplete="new-password" value={fp.confirm}
                      onChange={(e) => setFp({ ...fp, confirm: e.target.value })} placeholder="أعد كتابتها" />
                  </label>
                  <button className="btn-primary !py-2.5" disabled={fpBusy || !fp.code || !fp.password || !fp.confirm}>
                    {fpBusy ? 'جارٍ التعيين…' : 'تعيين كلمة المرور والدخول'}
                  </button>
                </>
              )}

              <button type="button" className="btn-ghost btn-sm" onClick={() => { setForgot(false); setErr(''); }}>
                رجوع لتسجيل الدخول
              </button>
            </form>
          )}
        </form>
      </div>
    </div>
  );
}
