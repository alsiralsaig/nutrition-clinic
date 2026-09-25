import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp, useLoader } from '../app-context.jsx';
import { api, readBackupFile, saveBackupJson } from '../api.js';
import { PortalSettingsCard } from '../components/Care.jsx';
import { PinSetup } from '../components/ScreenLock.jsx';
import { Badge, Card, Confirm, Field, Icon, Input, Modal, Select, Spinner, Table, Textarea, Toggle } from '../components/ui.jsx';
import { ROLES, dateTime } from '../format.js';
import { WaIcon } from '../components/Smart.jsx';
import { useTheme } from '../theme.jsx';
import { currentLang, setLang } from '../i18n.js';

export default function Settings() {
  const { run, user, toast, setUser } = useApp();
  const isAdmin = user?.role === 'admin';
  // القدوم من لافتة «كلمة المرور الافتراضية» يفتح نافذة تغييرها مباشرة
  const wantsPw = !!useLocation().state?.changePassword;
  const [pinOpen, setPinOpen] = useState(false);
  const [tab, setTab] = useState(wantsPw ? 'security' : 'clinic');
  const [restoring, setRestoring] = useState(null);
  const [pwOpen, setPwOpen] = useState(wantsPw ? { self: true } : false);
  const fileRef = useRef(null);

  const { data, loading, error, reload } = useLoader(async () => {
    const [settings, users, audit, health] = await Promise.all([
      api.get('/settings'),
      isAdmin ? api.get('/auth/users').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      api.get('/reports/audit?limit=40'),
      api.get('/health').catch(() => null),
    ]);
    return { settings: settings.settings || {}, users: users.items || [], audit: audit.items || [], health };
  }, [isAdmin]);

  if (loading && !data) return <Spinner label="جارٍ تحميل الإعدادات…" />;
  if (error) return <ErrorBoxWrap error={error} retry={reload} />;

  const TABS = [
    ['clinic', 'بيانات العيادة', Icon.gear],
    ['security', 'المستخدمون والصلاحيات', Icon.shield],
    ['backup', 'النسخ الاحتياطي', Icon.db],
    ['messaging', 'واتساب والتذكيرات', WaIcon],
    ['appearance', 'المظهر واللغة', Icon.dash],
    ['mobile', 'تطبيق الموبايل', Icon.phone],
    ['audit', 'سجل التدقيق', Icon.clock],
  ];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
        {TABS.map(([k, l, Ic]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-[12.5px] font-bold transition ${tab === k ? 'bg-brand-700 text-white shadow-card' : 'text-ink/55 hover:bg-brand-50 hover:text-brand-700'}`}>
            <Ic /> {l}
          </button>
        ))}
      </div>

      {tab === 'clinic' && <ClinicTab data={data} isAdmin={isAdmin} reload={reload} />}

      {tab === 'security' && (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Card title="حسابات الموظفين" subtitle={isAdmin ? 'أضف وغيّر الصلاحيات وكلمات المرور' : 'العرض فقط — التعديل للمدير'} icon={<Icon.users />}
            actions={isAdmin && <button className="btn-primary btn-sm" onClick={() => setPwOpen('new-user')}><Icon.plus /> مستخدم</button>} pad={false}>
            <Table head={['المستخدم', 'الاسم', 'الدور', 'الحالة', 'آخر دخول', '']}>
              {data.users.map((u) => (
                <tr key={u.id} className="group">
                  <td className="font-extrabold">{u.username}{u.id === user.id && <Badge tone="info" className="ms-2">أنت</Badge>}</td>
                  <td>{u.full_name}</td>
                  <td><Badge tone={u.role === 'admin' ? 'good' : u.role === 'staff' ? 'info' : 'warn'}>{ROLES[u.role]}</Badge></td>
                  <td>{u.active ? <Badge tone="good">نشط</Badge> : <Badge tone="bad">موقوف</Badge>}</td>
                  <td className="text-[12px] text-ink/55">{u.last_login_at ? dateTime(u.last_login_at + 'Z') : 'لم يدخل بعد'}</td>
                  <td className="row-actions">
                    {isAdmin && (
                      <div className="flex gap-1">
                        <button className="btn-ghost btn-sm !px-2" onClick={() => setPwOpen(u)}><Icon.pencil /></button>
                        {u.id !== user.id && <button className="btn-danger btn-sm !px-2" onClick={() => run(() => api.del(`/auth/users/${u.id}`), { ok: 'تم حذف المستخدم' }).then(reload).catch(() => {})}><Icon.trash /></button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!data.users.length && <tr><td colSpan={6} className="py-8 text-center text-[13px] text-ink/50">لا صلاحية لعرض المستخدمين — سجل الدخول بحساب admin.</td></tr>}
            </Table>
          </Card>

          <Card title="حماية النظام" subtitle="ما يفعله النظام تلقائياً" icon={<Icon.shield />}>
            <ul className="grid gap-2.5">
              {[
                ['كل مسارات البيانات خلف JWT', 'لا تُقرأ أو تُكتب أي معلومة بدون توكن صالح (12 ساعة).'],
                ['الحقول المشتقة محصّنة', 'BMI ونسب الماكرو والإيرادات تُحسب في الخادم؛ أي قيمة يرسلها العميل تُتجاهل.'],
                ['أدوار واضحة', 'المدير يدير كل شيء، الأخصائي يعدّل البيانات، المشاهدة للقراءة فقط.'],
                ['إلغاء بدل حذف المال', 'الدفعة تُلغى ولا تُمحى، ليبقى الأثر المالي قابلاً للتدقيق.'],
                ['سجل تدقيق كامل', 'كل عملية إنشاء/تعديل/حذف تُسجَّل باسم المستخدم وتاريخه.'],
                ['نسخة أمان قبل الاستعادة', 'قبل أي استعادة تُحفظ نسخة من الحالة الحالية على الخادم.'],
                ['حماية الأرشيف الطبي', 'غير المدير لا يحذف ملف مريض — يُؤرشف فقط.'],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-2.5 rounded-xl border border-line bg-sand/50 p-3">
                  <Icon.check className="mt-0.5 shrink-0 text-leaf-600" />
                  <div><p className="text-[12.5px] font-extrabold">{t}</p><p className="muted mt-0.5">{d}</p></div>
                </li>
              ))}
            </ul>
            <button className="btn-ghost mt-3 w-full" onClick={() => setPwOpen({ self: true })}><Icon.shield /> تغيير كلمتي السرية</button>
            <button className="btn-ghost mt-2 w-full" onClick={() => setPinOpen(true)} data-pin-settings>🔒 رمز قفل الشاشة والقفل التلقائي</button>
            <PinSetup open={pinOpen} onClose={() => setPinOpen(false)} />
          </Card>
        </div>
      )}

      {tab === 'backup' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="نسخ احتياطي" subtitle="يُنصح به يومياً قبل أي تعديل كبير" icon={<Icon.db />}>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <button className="btn-primary" onClick={() => run(() => saveBackupJson(), { ok: 'تم تنزيل نسخة JSON' }).catch(() => {})}><Icon.download /> نسخة JSON</button>
              <button className="btn-ghost" onClick={() => api.download('/backup/file', `clinic-backup-${new Date().toISOString().slice(0, 10)}.json`).catch((e) => toast(e.message, 'bad'))}><Icon.db /> تنزيل ملف النسخة</button>
              <button className="btn-ghost" onClick={() => run(() => api.post('/maintenance/vacuum'), { ok: 'تم فحص سلامة البيانات وتحديث فهارس القاعدة' }).catch(() => {})}><Icon.refresh /> فحص السلامة</button>
              <button className="btn-danger" onClick={() => fileRef.current?.click()}><Icon.upload /> استعادة من ملف</button>
            </div>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try { setRestoring(await readBackupFile(f)); }
                catch (err) { toast(err.message, 'bad'); }
              }} />
            <div className="mt-4 rounded-xl border border-line bg-sand/60 p-3 text-[12.5px] leading-6">
              <p className="font-extrabold">حالة قاعدة البيانات</p>
              <p className="muted mt-1">
                المحرك: <Badge tone={data.health?.mode === 'demo-ephemeral' ? 'warn' : 'good'}>{data.health?.engine === 'postgres' ? 'PostgreSQL (Neon) — دائم' : data.health?.mode === 'demo-ephemeral' ? 'تجريبي — يُمسح' : 'PostgreSQL مدمج (محلي)'}</Badge>
              </p>
              <p className="muted mt-1">المكان: <span dir="ltr" className="tnum">{data.health?.db || '—'}</span></p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(data.health?.counts || {}).map(([k, v]) => <Badge key={k} tone="info">{k}: {v}</Badge>)}
              </div>
            </div>
            <p className="muted mt-3">النسخة JSON تحتوي كل الجداول (المرضى، القياسات، البرامج، المواعيد، المدفوعات، المستخدمون، الإعدادات، سجل التدقيق) — يمكن إعادة إدخالها في أي نظام جديد.</p>
          </Card>

          <Card title="ما يجب فعله بالنسخة" icon={<Icon.shield />}>
            <ol className="grid gap-2 text-[13px] leading-6">
              {[
                'احفظ الملف في مجلد خاص على جهاز العيادة + نسخة على سحابة.',
                'سمّ الملف بالتاريخ: clinic-backup-2026-09-25.json',
                'قبل أي ترقية أو تعديل في قاعدة البيانات: نسخة جديدة إلزامية.',
                'اختبر الاستعادة شهرياً على جهاز غير المستخدم للتأكد من صلاحيتها.',
                'لا تفتح الاستعادة إلا بحساب المدير — الطلب يرفض كلمة مرور خاطئة.',
              ].map((s, i) => (
                <li key={i} className="flex gap-2.5 rounded-lg bg-sand/50 p-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-700 text-[12px] font-extrabold text-white tnum">{i + 1}</span>
                  <span className="font-bold text-ink/70">{s}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}

      {tab === 'mobile' && <MobileTab />}
      {tab === 'messaging' && <MessagingTab data={data} isAdmin={isAdmin} reload={reload} />}
      {tab === 'appearance' && <AppearanceTab />}

      {tab === 'audit' && (
        <Card title="سجل التدقيق" subtitle="آخر 40 عملية على النظام" icon={<Icon.clock />} pad={false}>
          <Table head={['التاريخ', 'المستخدم', 'العملية', 'الجدول', 'المعرّف', 'تفاصيل']}>
            {data.audit.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap text-[12px]">{dateTime(a.created_at + 'Z')}</td>
                <td className="font-bold">{a.username || '—'}</td>
                <td><Badge tone={a.action.includes('delete') ? 'bad' : a.action.includes('create') ? 'good' : 'info'}>{a.action}</Badge></td>
                <td className="text-[12px] text-ink/55">{a.entity}</td>
                <td className="tnum text-[12px] text-ink/55">{a.entity_id ?? '—'}</td>
                <td className="max-w-[340px] truncate text-[11.5px] text-ink/45" title={a.detail || ''}>{a.detail || ''}</td>
              </tr>
            ))}
            {!data.audit.length && <tr><td colSpan={6} className="py-8 text-center text-[13px] text-ink/50">السجل فارغ.</td></tr>}
          </Table>
        </Card>
      )}

      {pwOpen && <UserModal state={pwOpen} onClose={() => setPwOpen(false)} reload={reload} isAdmin={isAdmin} me={user} />}

      <Confirm open={!!restoring} title="تأكيد الاستعادة" onCancel={() => setRestoring(null)}
        confirmText="استعادة الآن"
        message={restoring ? (
          <>
            سيُستبدل محتوى الجداول التالية: <b>{Object.keys(restoring.tables || {}).join('، ')}</b>.
            <p className="mt-2 rounded-lg bg-sand p-2.5 text-[12px]">
              السجلات الواردة: {Object.entries(restoring.tables || {}).reduce((s, [, v]) => s + (Array.isArray(v) ? v.length : 0), 0)}.
              سيُحفظ ملف أمان للحالة الحالية على الخادم قبل التنفيذ.
            </p>
          </>
        ) : ''}
        onConfirm={async () => {
          await run(() => api.post('/restore', restoring), { ok: 'تمت الاستعادة بنجاح' }).then(reload).catch(() => {});
          setRestoring(null);
        }} />
    </div>
  );
}

function ErrorBoxWrap({ error, retry }) {
  return <Card><p className="text-[13px] font-bold text-clay-600">تعذّر تحميل الإعدادات: {error.message}</p><button className="btn-ghost btn-sm mt-2" onClick={retry}>إعادة المحاولة</button></Card>;
}

/* ------------------ تبويب بيانات العيادة ------------------ */
function ClinicTab({ data, isAdmin, reload }) {
  const { run } = useApp();
  const [form, setForm] = useState({
    'clinic.name': '', 'clinic.phone': '', 'clinic.address': '', 'clinic.currency': 'SDG',
    'clinic.weekend': 'Friday', 'clinic.printFooter': '',
  });
  const [workday, setWorkday] = useState({ from: '09:00', to: '20:00' });

  useEffect(() => {
    setForm((f) => Object.fromEntries(Object.keys(f).map((k) => [k, data.settings[k] ?? f[k]])));
    try { setWorkday(typeof data.settings['clinic.workday'] === 'string' ? JSON.parse(data.settings['clinic.workday']) : (data.settings['clinic.workday'] || workday)); } catch { /* ignore */ }
  }, [data]); // eslint-disable-line

  const dirty = Object.entries(form).some(([k, v]) => (data.settings[k] ?? '') !== v);
  const save = () => run(() => api.put('/settings', { ...form, 'clinic.workday': workday }), { ok: 'تم حفظ إعدادات العيادة' }).then(reload).catch(() => {});

  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <Card title="بيانات العيادة" subtitle="تظهر في ترويسة التقارير المطبوعة والفواتير" icon={<Icon.gear />}
        actions={isAdmin && <button className="btn-primary btn-sm" onClick={save} disabled={!dirty}><Icon.check /> حفظ</button>}>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="اسم العيادة" className="sm:col-span-2"><Input value={form['clinic.name']} disabled={!isAdmin} onChange={(e) => setForm({ ...form, 'clinic.name': e.target.value })} /></Field>
          <Field label="الهاتف"><Input value={form['clinic.phone']} disabled={!isAdmin} onChange={(e) => setForm({ ...form, 'clinic.phone': e.target.value })} dir="ltr" /></Field>
          <Field label="العملة"><Select value={form['clinic.currency']} disabled={!isAdmin} onChange={(e) => setForm({ ...form, 'clinic.currency': e.target.value })}>
            {['SDG', 'EGP', 'SAR', 'AED', 'USD'].map((c) => <option key={c}>{c}</option>)}
          </Select></Field>
          <Field label="العنوان" className="sm:col-span-2"><Input value={form['clinic.address']} disabled={!isAdmin} onChange={(e) => setForm({ ...form, 'clinic.address': e.target.value })} /></Field>
          <Field label="يوم العطلة"><Select value={form['clinic.weekend']} disabled={!isAdmin} onChange={(e) => setForm({ ...form, 'clinic.weekend': e.target.value })}>
            {['Saturday', 'Sunday', 'Friday', 'Thursday'].map((d) => <option key={d}>{d}</option>)}
          </Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="بداية الدوام"><Input type="time" step="900" value={workday.from} disabled={!isAdmin} onChange={(e) => setWorkday({ ...workday, from: e.target.value })} /></Field>
            <Field label="نهاية الدوام"><Input type="time" step="900" value={workday.to} disabled={!isAdmin} onChange={(e) => setWorkday({ ...workday, to: e.target.value })} /></Field>
          </div>
          <Field label="نص تذييل التقارير" className="sm:col-span-2">
            <Textarea value={form['clinic.printFooter']} disabled={!isAdmin} onChange={(e) => setForm({ ...form, 'clinic.printFooter': e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card title="قواعد محاسبية مطبّقة" subtitle="لماذا الأرقام في النظام أصح من جدول يدوي" icon={<Icon.chart />}>
        <ul className="grid gap-2.5">
          {[
            ['BMI', 'الوزن ÷ (الطول بالمتر)² — يتحدث مع كل قياس ويُخزَّن معه.'],
            ['تصنيف الفئة', 'نقص < 18.5 · طبيعي < 25 · زيادة < 30 · سمنة ١/٢/مفرطة بعده.'],
            ['نسبة الخصر/الورك', 'الخصر ÷ الورك، تُحسب لحظياً وتظهر في ملف المريض.'],
            ['مجاميع البرنامج', 'السعرات والماكرو = مجموع الوجبات، والهدف يُقارن به ويُلوَّن عند الانحراف 8٪.'],
            ['الإيرادات', 'مجموع المدفوعات غير الملغاة فقط؛ الإلغاء لا يُنقص السجل التاريخي.'],
            ['رقم الملف', 'NC-0001 وتالٍ، يُمنع التكرار بقيد فريد في القاعدة.'],
          ].map(([t, d]) => (
            <li key={t} className="rounded-xl border border-line bg-sand/50 p-3">
              <p className="text-[12.5px] font-extrabold text-brand-700">{t}</p>
              <p className="muted mt-0.5 leading-6">{d}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ------------------ إنشاء/تعديل مستخدم ------------------ */
function UserModal({ state, onClose, reload, isAdmin, me }) {
  const { run, toast } = useApp();
  const isNew = state === 'new-user';
  const self = !isNew && state?.self;
  const [form, setForm] = useState({
    username: state?.username || '',
    full_name: state?.full_name || (self ? (me?.full_name || '') : ''),
    role: state?.role || 'staff',
    active: state?.active ?? true,
    password: '',
    current_password: '',
  });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (self) {
      if (!form.current_password) { toast('أدخل كلمة المرور الحالية', 'bad'); return; }
      if (form.password.length < 8) { toast('كلمة المرور الجديدة 8 أحرف على الأقل', 'bad'); return; }
      setBusy(true);
      try {
        await run(() => api.post('/auth/change-password', { current_password: form.current_password, new_password: form.password }), { ok: 'تم تغيير كلمة المرور' });
        window.dispatchEvent(new Event('clinic:password-changed'));
        onClose();
      } catch { /* تنبيه ظاهر */ } finally { setBusy(false); }
      return;
    }
    if (isNew) {
      if (!/^[a-zA-Z0-9._-]{3,60}$/.test(form.username.trim())) { toast('اسم المستخدم: 3–60 حرفاً إنجليزياً', 'bad'); return; }
      if (form.password.length < 8) { toast('كلمة المرور 8 أحرف على الأقل', 'bad'); return; }
    } else if (form.password && form.password.length < 8) {
      toast('كلمة المرور الجديدة قصيرة', 'bad'); return;
    }
    setBusy(true);
    try {
      if (isNew) {
        await run(() => api.post('/auth/users', {
          username: form.username.trim(), full_name: form.full_name.trim(), role: form.role, password: form.password,
        }), { ok: 'تم إنشاء المستخدم' });
      } else {
        const body = { full_name: form.full_name.trim(), role: form.role, active: !!form.active };
        if (form.password) body.password = form.password;
        await run(() => api.put(`/auth/users/${state.id}`, body), { ok: 'تم التحديث' });
      }
      onClose();
      reload();
    } catch { /* تنبيه ظاهر */ } finally { setBusy(false); }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  return (
    <Modal open onClose={onClose} size="sm" icon={<Icon.shield />}
      title={self ? 'تغيير كلمة المرور' : isNew ? 'مستخدم جديد' : `تعديل ${state?.username || ''}`}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button form="user-form" className="btn-primary" disabled={busy}>{busy ? 'جارٍ…' : 'حفظ'}</button></>}>
      <form id="user-form" onSubmit={submit} className="grid gap-3.5">
        {self ? (
          <>
            <Field label="كلمة المرور الحالية"><Input type="password" autoFocus value={form.current_password} onChange={set('current_password')} /></Field>
            <Field label="كلمة المرور الجديدة" hint="8 أحرف على الأقل"><Input type="password" value={form.password} onChange={set('password')} /></Field>
          </>
        ) : (
          <>
            {isNew && <Field label="اسم المستخدم" hint="أحرف إنجليزية وأرقام ونقاط، 3–60 خانة"><Input autoFocus value={form.username} onChange={set('username')} dir="ltr" /></Field>}
            <Field label="الاسم الكامل"><Input value={form.full_name} onChange={set('full_name')} /></Field>
            {isAdmin && (
              <Field label="الدور"><Select value={form.role} onChange={set('role')}>
                <option value="admin">مدير النظام — كل الصلاحيات</option>
                <option value="staff">أخصائي — قراءة وكتابة بلا إدارة مستخدمين</option>
                <option value="viewer">مشاهدة فقط — للاستقبال والتقارير</option>
              </Select></Field>
            )}
            <Field label={isNew ? 'كلمة المرور' : 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)'} hint={isNew ? '8 أحرف على الأقل' : undefined}>
              <Input type="text" value={form.password} onChange={set('password')} placeholder="••••••••" dir="ltr" />
            </Field>
            {!isNew && isAdmin && <Toggle checked={form.active} onChange={set('active')} label="الحساب نشط" />}
          </>
        )}
      </form>
    </Modal>
  );
}

/* ------------------ تبويب تطبيق الموبايل ------------------ */
function MobileTab() {
  const { toast } = useApp();
  const origin = window.location.origin;
  const steps = [
    ['نفس قاعدة البيانات', 'تطبيق المريض (Flutter أو React Native) يستدعي نفس REST API — لا نسخة ثانية من البيانات ولا مزامنة يدوية.'],
    ['نقطة دخول واحدة للمريض', 'GET /api/patients/{id}/profile يرجّع البيانات والبرنامج الغذائي والمواعيد والقياسات والمدفوعات في طلب واحد.'],
    ['دخول بالهاتف أو كود', 'المصادقة JWT؛ لإتاحة تسجيل ذاتي للمرضى يُضاف عمود access_code على جدول المرضى وقراءة بمعرّف المريض نفسه.'],
    ['توثيق آلي', 'ملف openapi.json متاح على /api/openapi.json (و/on /openapi.json عند التشغيل المحلي) ويولّد كود الشبكة في التطبيق تلقائياً (OpenAPI Generator).'],
    ['نفس الحسابات', 'BMI والماكرو والإيرادات تُحسب في الخادم، فلا يختلف الرقم بين الموقع والتطبيق.'],
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
      <Card title="جاهز للربط بتطبيق Android/iPhone" subtitle="العقد (contract) نفسها التي يستعملها هذا الموقع" icon={<Icon.phone />}>
        <div className="grid gap-2.5">
          {steps.map(([t, d], i) => (
            <div key={t} className="flex gap-3 rounded-xl border border-line bg-sand/50 p-3.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-700 text-[12px] font-extrabold text-white tnum">{i + 1}</span>
              <div><p className="text-[13px] font-extrabold">{t}</p><p className="muted mt-0.5 leading-6">{d}</p></div>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-4">
        <Card title="عنوان الخادم" icon={<Icon.db />}>
          <p className="muted">اكتبه في إعداد التطبيق (مع HTTPS في الإنتاج):</p>
          <code className="mt-2 block break-all rounded-xl bg-[#1c2b2a] px-3 py-2.5 text-[12px] font-bold text-white" dir="ltr">{origin}/api</code>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(`${origin}/api`).then(() => toast('تم نسخ عنوان الـ API', 'good')).catch(() => toast('انسخ العنوان يدوياً', 'warn'))}><Icon.copy /> نسخ</button>
            <a className="btn-soft btn-sm" href="/api/openapi.json" target="_blank" rel="noreferrer"><Icon.pdf /> openapi.json</a>
          </div>
        </Card>
        <Card title="خطوات التفعيل للمريض" icon={<Icon.check />}>
          <ol className="grid gap-2 text-[12.5px] leading-6">
            {[
              'انشر الخادم على عنوان ثابت (VPS أو استضافة) مع HTTPS.',
              'فعّل تسجيل دخول مريض: POST /api/auth/login ينشئ توكن — يُقترح مسار /api/patient/login بنفس الاستجابة.',
              'أضف إشعارات (FCM/APNs) عند اعتماد موعد أو تحديث برنامج غذائي.',
              'عرض التطبيق: /patients/{id}/profile + /diet-plans/{id} + /appointments?patient_id=.',
            ].map((t, i) => (
              <li key={i} className="flex gap-2.5 rounded-lg bg-sand/50 p-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-brand-100 text-[11px] font-extrabold text-brand-800 tnum">{i + 1}</span>
                <span className="font-bold text-ink/70">{t}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

/* ------------------ واتساب والتذكيرات ------------------ */
const KIND_LABEL = { appointment_reminder: 'تذكير موعد', daily_reminder: 'تذكير يومي', plan: 'خطة', shopping_list: 'قائمة تسوق', custom: 'رسالة', test: 'تجربة' };
const STATUS_TONE = { sent: ['أُرسلت', 'good'], link: ['رابط wa.me', 'info'], failed: ['فشلت', 'bad'], skipped: ['تخطّي', 'warn'] };

function MessagingTab({ data, isAdmin, reload }) {
  const { run, toast } = useApp();
  const [status, setStatus] = useState(null);
  const [log, setLog] = useState([]);
  const [phone, setPhone] = useState('');
  const [cc, setCc] = useState('249');
  const [flags, setFlags] = useState({ appt: true, daily: true });
  const [lastRun, setLastRun] = useState(null);

  const load = () => {
    api.get('/whatsapp/status').then((r) => { setStatus(r); setCc(r.country_code || '249'); setLastRun(r.cron_last_run); }).catch(() => {});
    api.get('/whatsapp/log?limit=60').then((r) => setLog(r.items || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    setFlags({ appt: data.settings['clinic.reminders_enabled'] !== false, daily: data.settings['clinic.daily_reminder_enabled'] !== false });
  }, [data]);

  const saveSettings = (patch) => run(() => api.put('/settings', patch), { ok: 'تم الحفظ' }).then(() => { reload(); load(); }).catch(() => {});
  const test = () => run(() => api.post('/whatsapp/test', { phone })).then((r) => {
    if (r.status === 'link' && r.link) { window.open(r.link, '_blank'); toast('بدون مفاتيح API: فُتح wa.me للتجربة', 'info'); }
    else toast(r.status === 'sent' ? 'أُرسلت الرسالة التجريبية ✓' : (r.error || r.status), r.status === 'sent' ? 'good' : 'warn');
    load();
  }).catch(() => load());
  const runNow = () => run(() => api.post('/cron/daily/run', {}), { ok: 'نُفّذت مهمة التذكيرات' }).then((r) => { setLastRun(r); load(); }).catch(() => {});

  const counts = (o) => (o ? `أُرسل ${o.sent} · روابط ${o.link} · فشل ${o.failed}${o.skipped ? ` · تخطّي ${o.skipped}` : ''}` : '—');

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
      <div className="grid content-start gap-4">
        <Card title="حالة الربط مع WhatsApp Cloud API" icon={<WaIcon />}
          actions={status && <Badge tone={status.configured ? (status.dry_run ? 'warn' : 'good') : 'info'}>{status.configured ? (status.dry_run ? 'وضع تجريبي' : 'مربوط — إرسال آلي') : 'غير مربوط — روابط wa.me'}</Badge>}>
          {!status ? <Spinner /> : (
            <div className="grid gap-3">
              <dl className="grid gap-x-6 sm:grid-cols-2">
                {[['المزوّد', status.provider], ['رقم الإرسال (Phone ID)', status.phone_id || '—'], ['قالب تذكير الموعد', status.templates?.appointment || '— (نص حر)'], ['قالب التذكير اليومي', status.templates?.daily || '— (نص حر)'], ['لغة القوالب', status.templates?.lang || '—']].map(([l, v]) => (
                  <div key={l} className="flex items-baseline justify-between gap-3 border-b border-dashed border-line/80 py-2"><dt className="text-[12.5px] font-bold text-ink/55">{l}</dt><dd className="text-[13px] font-bold" dir="ltr">{v}</dd></div>
                ))}
              </dl>
              {!status.configured && (
                <div className="rounded-xl border border-dashed border-brand-300 bg-brand-50/60 p-3 text-[12.5px] font-bold leading-6 text-brand-800">
                  للإرسال الآلي أضف في Vercel ← Settings ← Environment Variables:
                  <code className="mx-1 rounded bg-surface px-1.5" dir="ltr">WHATSAPP_TOKEN</code> و
                  <code className="mx-1 rounded bg-surface px-1.5" dir="ltr">WHATSAPP_PHONE_ID</code>
                  (من Meta for Developers ← WhatsApp)، ثم أعد النشر. وحتى ذلك الحين تعمل كل أزرار الإرسال عبر روابط wa.me.
                </div>
              )}
              {isAdmin && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="رقم لتجربة الإرسال" className="min-w-[200px] flex-1"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0912345678" dir="ltr" inputMode="tel" /></Field>
                  <button className="btn bg-[#1f9d55] text-white hover:bg-[#188247]" disabled={!phone.trim()} onClick={test}><WaIcon /> رسالة تجريبية</button>
                </div>
              )}
            </div>
          )}
        </Card>

        <PortalSettingsCard settings={data.settings} isAdmin={isAdmin} onSaved={reload} />

        <Card title="التذكيرات التلقائية" subtitle="مهمة يومية على Vercel Cron الساعة 7:00 صباحاً بتوقيت الخرطوم (05:00 UTC)" icon={<Icon.clock />}
          actions={isAdmin && <button className="btn-soft btn-sm" onClick={runNow}><Icon.refresh /> تشغيل الآن</button>}>
          <div className="grid gap-3">
            <div className="grid gap-2.5">
              <Toggle checked={flags.appt} onChange={(v) => { setFlags((f) => ({ ...f, appt: v })); if (isAdmin) saveSettings({ 'clinic.reminders_enabled': v }); }} label="تذكير المرضى بمواعيد اليوم وغداً (مرة لكل موعد)" />
              <Toggle checked={flags.daily} onChange={(v) => { setFlags((f) => ({ ...f, daily: v })); if (isAdmin) saveSettings({ 'clinic.daily_reminder_enabled': v }); }} label="تذكير يومي بوجبات الخطة (للمشتركين من ملف المريض)" />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="رمز الدولة لأرقام الهواتف المحلية" hint="السودان 249 · مصر 20 · السعودية 966" className="w-56">
                <Input value={cc} onChange={(e) => setCc(e.target.value.replace(/\D/g, ''))} dir="ltr" disabled={!isAdmin} />
              </Field>
              {isAdmin && cc !== (status?.country_code || '249') && <button className="btn-primary btn-sm mb-1" onClick={() => saveSettings({ 'clinic.country_code': cc })}><Icon.check /> حفظ</button>}
            </div>
            <div className="rounded-xl border border-line bg-sand/60 p-3 text-[12.5px]">
              <p className="font-extrabold text-ink/70">آخر تشغيل</p>
              {lastRun ? (
                <div className="mt-1 grid gap-0.5 font-bold text-ink/60">
                  <p className="tnum">{lastRun.date} · {lastRun.source === 'manual' ? 'يدوي' : 'تلقائي'} · {lastRun.finished_at ? dateTime(lastRun.finished_at) : ''}</p>
                  <p>المواعيد: <span className="tnum">{counts(lastRun.appointment_reminders)}</span></p>
                  <p>اليومي: <span className="tnum">{counts(lastRun.daily_reminders)}</span></p>
                </div>
              ) : <p className="muted mt-1">لم تُشغَّل بعد.</p>}
              <p className="muted mt-2 leading-6">بدون مفاتيح API لا يمكن الإرسال في الخلفية؛ تظهر التذكيرات في جرس التنبيهات 🔔 مع زر «إرسال التذكير» بضغطة.</p>
            </div>
          </div>
        </Card>
      </div>

      <Card title="سجل الرسائل" subtitle="آخر 60 رسالة" icon={<Icon.clock />} pad={false}
        actions={<button className="btn-ghost btn-sm" onClick={load}><Icon.refresh /></button>}>
        {log.length === 0 ? <p className="p-8 text-center text-[13px] font-bold text-ink/45">لا رسائل بعد.</p> : (
          <Table head={['الوقت', 'المريض', 'النوع', 'الحالة', 'الرقم']}>
            {log.map((m) => (
              <tr key={m.id} title={m.error || m.body || ''}>
                <td className="whitespace-nowrap text-[12px] tnum">{dateTime(m.created_at + 'Z')}</td>
                <td className="font-bold">{m.first_name ? `${m.first_name} ${m.last_name}` : '—'}</td>
                <td className="text-[12.5px]">{KIND_LABEL[m.kind] || m.kind}</td>
                <td><Badge tone={STATUS_TONE[m.status]?.[1]}>{STATUS_TONE[m.status]?.[0] || m.status}</Badge>{m.error && <p className="mt-0.5 max-w-[200px] truncate text-[11px] text-clay-600">{m.error}</p>}</td>
                <td className="tnum text-[12px] text-ink/55" dir="ltr">{m.to_phone || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

/* ------------------ المظهر واللغة ------------------ */
function AppearanceTab() {
  const { mode, setMode } = useTheme();
  const lang = currentLang();
  const opt = (active) => `flex flex-1 flex-col items-center gap-2 rounded-xl border p-4 text-[13px] font-extrabold transition ${active ? 'border-brand-400 bg-brand-50 text-brand-800 shadow-card' : 'border-line bg-surface text-ink/60 hover:border-brand-300'}`;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="الوضع" subtitle="يُحفظ على هذا الجهاز · الطباعة دائماً بالألوان الفاتحة" icon={<Icon.dash />}>
        <div className="flex gap-2">
          {[['light', 'فاتح', '☀️'], ['dark', 'داكن', '🌙'], ['system', 'حسب الجهاز', '💻']].map(([k, l, e]) => (
            <button key={k} className={opt(mode === k)} onClick={() => setMode(k)} data-theme-opt={k}><span className="text-[22px]">{e}</span>{l}</button>
          ))}
        </div>
      </Card>
      <Card title="اللغة" subtitle="تبديل اللغة يعيد تحميل الصفحة" icon={<Icon.users />}>
        <div className="flex gap-2">
          {[['ar', 'العربية', 'ع'], ['en', 'English', 'EN']].map(([k, l, e]) => (
            <button key={k} className={opt(lang === k)} onClick={() => lang !== k && setLang(k)}><span className="text-[20px]">{e}</span>{l}</button>
          ))}
        </div>
        <p className="muted mt-3">البيانات المُدخلة (الأسماء، الوجبات، الملاحظات) تبقى كما كُتبت؛ تتغير الواجهة والتقارير.</p>
      </Card>
    </div>
  );
}
