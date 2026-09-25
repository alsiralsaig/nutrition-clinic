import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { Icon, Input } from '../components/ui.jsx';

const HIGHLIGHTS = [
  ['ملف مريض متكامل', 'بيانات، زيارات، قياسات، برنامج غذائي، مدفوعات في صفحة واحدة'],
  ['رسوم متابعة حيّة', 'تتبع الوزن و BMI ومحيطات الجسم عبر كل زيارة'],
  ['خطط غذائية قابلة للطباعة', 'محرر وجبات مع حساب السعرات والماكرو تلقائياً'],
  ['صلاحيات ونسخ احتياطي', 'أدوار للمستخدمين + نسخة احتياطية بضغطة زر'],
];

export default function Login() {
  const { user, login, toast } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ username: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { document.title = 'تسجيل الدخول — عيادة التغذية'; }, []);
  if (user) return <Navigate to={loc.state?.from || '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const u = await login(form.username.trim(), form.password);
      toast(`أهلاً ${u.full_name} 👋`, 'good');
      nav(loc.state?.from || '/', { replace: true });
    } catch (ex) {
      setErr(ex.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* لوحة التعريف */}
      <div className="relative hidden flex-col justify-between overflow-hidden brand-gradient-br p-10 text-white lg:flex">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute bottom-[-6rem] right-[-4rem] h-80 w-80 rounded-full bg-leaf-500/25 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-2xl backdrop-blur">🥗</span>
          <div>
            <p className="text-[17px] font-extrabold">عيادة التغذية</p>
            <p className="text-[12px] font-bold text-white/60">نظام تنظيم العمل للمرضى والمواعيد</p>
          </div>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-[30px] leading-[1.35] font-extrabold">
            إدارة العيادة كاملة<br />من شاشة واحدة هادئة.
          </h2>
          <div className="mt-8 grid gap-3">
            {HIGHLIGHTS.map(([t, s]) => (
              <div key={t} className="flex gap-3 rounded-2xl bg-white/10 p-3.5 backdrop-blur">
                <Icon.check className="mt-0.5 text-leaf-100" />
                <div>
                  <p className="text-[13.5px] font-extrabold">{t}</p>
                  <p className="text-[12px] font-medium text-white/70">{s}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-[11.5px] font-bold text-white/45">
          البيانات محفوظة على خادم العيادة · جاهزة للربط بتطبيق المريض لاحقاً
        </p>
      </div>

      {/* نموذج الدخول */}
      <div className="flex items-center justify-center bg-sand p-5">
        <form onSubmit={submit} className="card card-pad w-full max-w-[400px] p-6 sm:p-8">
          <div className="mb-6 text-center lg:hidden">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-2xl">🥗</span>
            <p className="mt-2 text-[16px] font-extrabold">نظام عيادة التغذية</p>
          </div>
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
                <Input type={show ? 'text' : 'password'} autoComplete="current-password" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" className="pe-11" />
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
            {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Icon.shield />}
            {busy ? 'جارٍ التحقق…' : 'دخول'}
          </button>

          <div className="mt-5 rounded-xl border border-dashed border-line bg-sand p-3 text-[11.5px] leading-6 text-ink/55">
            <p className="mb-1 font-extrabold text-ink/70">حسابات التجربة:</p>
            {[['admin', 'admin123', 'مدير — كل الصلاحيات'], ['doctor', 'doctor123', 'أخصائي — تعديل دون إدارة المستخدمين'], ['reception', 'reception123', 'مشاهدة فقط']].map(([u, p, d]) => (
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
