import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { Icon, Input } from '../components/ui.jsx';
import { canPromptInstall, isStandalone, onPwaChange, platform, promptInstall } from '../pwa.js';

export default function Login() {
  const { user, login, toast } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ username: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [, refreshPwa] = useState(0);
  const os = platform();
  const installed = isStandalone();

  useEffect(() => onPwaChange(() => refreshPwa((n) => n + 1)), []);
  useEffect(() => { document.title = 'تسجيل الدخول — عيادة التغذية'; }, []);

  if (user) return <Navigate to={loc.state?.from || '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
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
            <label className="block">
              <span className="label">اسم المستخدم</span>
              <Input autoFocus autoComplete="username" value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="admin" />
            </label>

            <label className="block">
              <span className="label">كلمة المرور</span>
              <div className="relative">
                <Input type={show ? 'text' : 'password'} autoComplete="current-password"
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

          <button className="btn-primary mt-6 w-full" disabled={busy || !form.username || !form.password}>
            {busy
              ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              : <Icon.shield />}
            {busy ? 'جارٍ التحقق…' : 'دخول'}
          </button>

          <div className="mt-5 rounded-xl border border-dashed border-line bg-sand p-3 text-[11.5px] leading-6 text-ink/55">
            <p className="mb-1 font-extrabold text-ink/70">حسابات التجربة:</p>
            {[
              ['admin', 'admin123', 'مدير — كل الصلاحيات'],
              ['doctor', 'doctor123', 'أخصائي — تعديل دون إدارة المستخدمين'],
              ['reception', 'reception123', 'مشاهدة فقط'],
            ].map(([u, p, d]) => (
              <button type="button" key={u} onClick={() => setForm({ username: u, password: p })}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-start hover:bg-surface">
                <span className="tnum font-bold">{u} / {p}</span>
                <span>{d}</span>
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
