/**
 * المرحلة D — واجهات فريق العيادة:
 *  HabitsCard (عادات المريض اليومية) · PortalAccessCard (QR والدخول للبوابة)
 *  WaitlistPanel + WaitlistForm (قائمة الانتظار الافتراضية) · AppointmentDetails + StaffCall (الاستشارة المرئية)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useLoader } from '../app-context.jsx';
import { api } from '../api.js';
import { Badge, Card, Confirm, Empty, ErrorBox, Field, Icon, Input, Modal, PrintSheet, Row, Select, Spinner, Textarea, Toggle } from './ui.jsx';
import { HabitChart } from './Charts.jsx';
import { QrSvg } from './Qr.jsx';
import { VideoCall, mediaSupported } from './VideoCall.jsx';
import { APPT_STATUS, VISIT_TYPES, dateTime, fmt, longDate, shortDate, todayISO } from '../format.js';

// قيم الأيام كما في getUTCDay (الأحد=0) بترتيب الأسبوع المحلي (يبدأ السبت)
export const WL_DAYS = [[6, 'السبت'], [0, 'الأحد'], [1, 'الاثنين'], [2, 'الثلاثاء'], [3, 'الأربعاء'], [4, 'الخميس'], [5, 'الجمعة']];
export const TIME_PREFS = { any: 'أي وقت', morning: 'صباحاً (قبل 12)', afternoon: 'بعد الظهر (12–5)', evening: 'مساءً (بعد 5)' };
export const ACTIVITY_LABELS = { walk: 'مشي', run: 'جري', gym: 'نادٍ رياضي', cycling: 'دراجة', swim: 'سباحة', sport: 'رياضة جماعية', home: 'تمارين منزلية', other: 'أخرى' };
export const OFFER_STATUS = {
  pending: { label: 'بانتظار الرد', color: 'sun' }, accepted: { label: 'قُبل', color: 'leaf' }, declined: { label: 'رُفض', color: 'ink' },
  expired: { label: 'انتهت مهلته', color: 'ink' }, taken: { label: 'حجزه غيره', color: 'clay' },
};
const daysText = (days) => {
  if (!days) return 'كل الأيام';
  const set = String(days).split(',').map(Number);
  return WL_DAYS.filter(([v]) => set.includes(v)).map(([, l]) => l).join('، ');
};
const PLATFORM_LABEL = { android: 'Android', ios: 'iPhone', mac: 'Mac', windows: 'Windows', other: 'متصفح' };
const liters = (ml) => (ml == null ? '—' : `${fmt(ml / 1000, 2)} ل`);

/* ============================================================ العادات اليومية */
export function HabitsCard({ patient, canWrite }) {
  const { run } = useApp();
  const [days, setDays] = useState(30);
  const [editTargets, setEditTargets] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const { data, loading, error, reload } = useLoader(() => api.get(`/patients/${patient.id}/habits?days=${days}`), [patient.id, days]);
  const s = data?.summary;
  const tg = data?.targets;
  const recent = useMemo(() => (data?.series || []).filter((x) => x.water_ml != null || x.sleep_hours != null || x.activity_min != null).slice(-7).reverse(), [data]);

  return (
    <Card title="العادات اليومية" subtitle="الماء · النوم · النشاط — تُسجَّل من بوابة المريض وتظهر هنا مباشرة" icon={<span>💧</span>}
      actions={<>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-sand p-1">
          {[14, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={`rounded-lg px-2.5 py-1 text-[12px] font-bold ${days === d ? 'bg-surface text-brand-700 shadow-card' : 'text-ink/50'}`}>{d} يوماً</button>)}
        </div>
        {canWrite && <button className="btn-ghost btn-sm" onClick={() => setEditTargets(true)}><Icon.pencil /> الأهداف</button>}
        {canWrite && <button className="btn-soft btn-sm" onClick={() => setLogOpen(true)}><Icon.plus /> تسجيل يوم</button>}
      </>}>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} retry={reload} /> : (
        <div className="grid gap-4" data-habits={s?.days_logged ?? 0}>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <HabitStat label="درجة الالتزام بالعادات" value={s.habit_score == null ? '—' : `${s.habit_score}%`} hint={`سُجّل ${s.days_logged} من ${days} يوماً`} tone="brand" />
            <HabitStat label="الماء" value={liters(s.avg_water_ml)} hint={`الهدف ${liters(tg.water_ml)} · تحقق ${s.water_hit_pct ?? '—'}%`} tone="brand" />
            <HabitStat label="النوم" value={s.avg_sleep_hours == null ? '—' : `${fmt(s.avg_sleep_hours, 1)} س`} hint={`الهدف ${fmt(tg.sleep_hours, 1)} س · تحقق ${s.sleep_hit_pct ?? '—'}%`} tone="sun" />
            <HabitStat label="النشاط" value={s.avg_activity_min == null ? '—' : `${fmt(s.avg_activity_min, 0)} د`} hint={`الهدف ${tg.activity_min} د · 🔥 ${s.streak} يوم متتالٍ`} tone="leaf" />
          </div>
          {s.days_logged === 0 ? (
            <Empty icon="📱" title="لم يُسجّل المريض أي عادة بعد" message="أصدر له رمز QR من بطاقة «بوابة المريض» ليسجّل الماء والنوم والنشاط من هاتفه" />
          ) : (
            <>
              <div className="grid gap-3 lg:grid-cols-3">
                {['water_ml', 'sleep_hours', 'activity_min'].map((k) => (
                  <div key={k} className="rounded-xl border border-line p-2.5">
                    <p className="mb-1 text-[12px] font-extrabold text-ink/60">{{ water_ml: '💧 الماء (مل)', sleep_hours: '😴 النوم (ساعات)', activity_min: '🏃 النشاط (دقائق)' }[k]}</p>
                    <HabitChart series={data.series} metric={k} target={tg[k]} height={150} />
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead><tr className="text-start text-[11px] text-ink/45">
                    {['اليوم', 'الماء', 'النوم', 'النشاط', 'الخطوات', 'المصدر', 'ملاحظة'].map((h) => <th key={h} className="px-2 py-1.5 text-start font-bold">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {recent.map((r) => (
                      <tr key={r.date} className="border-t border-line/60">
                        <td className="px-2 py-1.5 font-bold">{shortDate(r.date)}</td>
                        <td className={`px-2 py-1.5 tnum ${r.water_ml >= tg.water_ml ? 'font-extrabold text-brand-700' : ''}`}>{liters(r.water_ml)}</td>
                        <td className={`px-2 py-1.5 tnum ${r.sleep_hours >= tg.sleep_hours ? 'font-extrabold text-brand-700' : ''}`}>{r.sleep_hours == null ? '—' : `${fmt(r.sleep_hours, 1)} س`}</td>
                        <td className={`px-2 py-1.5 tnum ${r.activity_min >= tg.activity_min ? 'font-extrabold text-brand-700' : ''}`}>{r.activity_min == null ? '—' : `${r.activity_min} د`}{r.activity_type ? ` · ${ACTIVITY_LABELS[r.activity_type] || ''}` : ''}</td>
                        <td className="px-2 py-1.5 tnum">{r.steps ?? '—'}</td>
                        <td className="px-2 py-1.5"><Badge tone={r.source === 'portal' ? 'brand' : 'ink'}>{r.source === 'portal' ? 'البوابة' : 'العيادة'}</Badge></td>
                        <td className="max-w-[220px] truncate px-2 py-1.5 text-ink/55">{r.note || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
      <HabitTargetsModal open={editTargets} patient={patient} targets={tg} onClose={() => setEditTargets(false)} onSaved={reload} run={run} />
      <HabitLogModal open={logOpen} patient={patient} onClose={() => setLogOpen(false)} onSaved={reload} run={run} />
    </Card>
  );
}

function HabitStat({ label, value, hint, tone }) {
  const bg = { brand: 'bg-brand-50/60', sun: 'bg-[#fbf3df] dark:bg-[#2a2415]', leaf: 'bg-[#eef6ea] dark:bg-[#18251a]' }[tone];
  return (
    <div className={`rounded-xl p-3 ${bg}`}>
      <p className="text-[11.5px] font-bold text-ink/55">{label}</p>
      <p className="tnum mt-0.5 text-[19px] font-extrabold">{value}</p>
      <p className="mt-0.5 text-[11px] font-bold text-ink/45">{hint}</p>
    </div>
  );
}

function HabitTargetsModal({ open, patient, targets, onClose, onSaved, run }) {
  const [f, setF] = useState({});
  useEffect(() => {
    if (open && targets) setF({ water_ml: targets.custom?.water_ml ? targets.water_ml : '', sleep_hours: targets.custom?.sleep_hours ? targets.sleep_hours : '', activity_min: targets.custom?.activity_min ? targets.activity_min : '' });
  }, [open, targets]);
  const save = async () => {
    const n = (v) => (v === '' || v == null ? null : Number(v));
    await run(() => api.put(`/patients/${patient.id}/habit-targets`, { water_ml: n(f.water_ml), sleep_hours: n(f.sleep_hours), activity_min: n(f.activity_min) }), { ok: 'تم حفظ الأهداف' }).then(() => { onSaved(); onClose(); }).catch(() => {});
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="أهداف العادات اليومية" subtitle="اتركها فارغة لتُحسب تلقائياً (الماء 35 مل لكل كغ)" icon={<span>🎯</span>}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save}><Icon.check /> حفظ</button></>}>
      <div className="grid gap-3">
        <Field label="الماء (مل/يوم)" hint={`التلقائي: ${targets?.water_ml ?? '—'} مل`}><Input type="number" min="500" max="6000" step="250" value={f.water_ml ?? ''} onChange={(e) => setF({ ...f, water_ml: e.target.value })} placeholder="تلقائي" /></Field>
        <Field label="النوم (ساعات/ليلة)"><Input type="number" min="4" max="12" step="0.5" value={f.sleep_hours ?? ''} onChange={(e) => setF({ ...f, sleep_hours: e.target.value })} placeholder="7.5" /></Field>
        <Field label="النشاط (دقائق/يوم)"><Input type="number" min="5" max="300" step="5" value={f.activity_min ?? ''} onChange={(e) => setF({ ...f, activity_min: e.target.value })} placeholder="30" /></Field>
      </div>
    </Modal>
  );
}

function HabitLogModal({ open, patient, onClose, onSaved, run }) {
  const [f, setF] = useState({ date: todayISO() });
  useEffect(() => { if (open) setF({ date: todayISO(), water_ml: '', sleep_hours: '', activity_min: '', activity_type: '', note: '' }); }, [open]);
  const save = async () => {
    const n = (v) => (v === '' ? undefined : Number(v));
    const body = { water_ml: n(f.water_ml), sleep_hours: n(f.sleep_hours), activity_min: n(f.activity_min), activity_type: f.activity_type || undefined, note: f.note || undefined };
    await run(() => api.put(`/patients/${patient.id}/habits/${f.date}`, body), { ok: 'تم تسجيل اليوم' }).then(() => { onSaved(); onClose(); }).catch(() => {});
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="تسجيل عادات يوم" subtitle="مثلاً ما يذكره المريض أثناء الزيارة" icon={<span>📝</span>}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save}><Icon.check /> حفظ</button></>}>
      <div className="grid gap-3">
        <Field label="اليوم"><Input type="date" max={todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="الماء مل"><Input type="number" step="250" value={f.water_ml} onChange={(e) => setF({ ...f, water_ml: e.target.value })} /></Field>
          <Field label="النوم س"><Input type="number" step="0.5" value={f.sleep_hours} onChange={(e) => setF({ ...f, sleep_hours: e.target.value })} /></Field>
          <Field label="النشاط د"><Input type="number" step="5" value={f.activity_min} onChange={(e) => setF({ ...f, activity_min: e.target.value })} /></Field>
        </div>
        <Field label="نوع النشاط"><Select value={f.activity_type} onChange={(e) => setF({ ...f, activity_type: e.target.value })} placeholder="—">
          {Object.entries(ACTIVITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select></Field>
        <Field label="ملاحظة"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/* ============================================================ بوابة المريض و QR */
export function PortalAccessCard({ patient, canWrite }) {
  const { run, toast } = useApp();
  const { data, reload } = useLoader(() => api.get(`/patients/${patient.id}/portal-access`), [patient.id]);
  const [issued, setIssued] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [print, setPrint] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [msg, setMsg] = useState({ title: 'رسالة من العيادة', body: '' });
  const devices = data?.push_devices || [];

  const sendPush = async () => {
    const r = await run(() => api.post(`/patients/${patient.id}/push`, msg)).catch(() => null);
    if (!r) return;
    if (r.sent) { toast(`وصل الإشعار إلى ${r.sent} جهاز ✓`, 'good'); setPushOpen(false); setMsg({ ...msg, body: '' }); }
    else toast('تعذّر إيصال الإشعار — ربما أُلغي من الجهاز', 'warn');
    reload();
  };

  const issue = async () => {
    const r = await run(() => api.post(`/patients/${patient.id}/portal-access`), { ok: 'تم إصدار رمز دخول جديد' }).catch(() => null);
    if (r) { setIssued(r); reload(); }
    setConfirm(null);
  };
  const sendWa = async () => {
    const r = await run(() => api.post(`/patients/${patient.id}/portal-access/send`)).catch((e) => e.payload || null);
    if (!r) return;
    setIssued(r); reload();
    if (r.message?.status === 'link' && r.message.link) { window.open(r.message.link, '_blank', 'noopener'); toast('فُتح واتساب برسالة جاهزة', 'good'); }
    else if (r.message?.status === 'sent') toast('أُرسل رابط البوابة للمريض بواتساب ✓', 'good');
    else toast('تعذّر الإرسال — انسخ الرابط يدوياً', 'warn');
  };
  const revoke = async () => {
    await run(() => api.del(`/patients/${patient.id}/portal-access`), { ok: 'أُوقف دخول المريض للبوابة' }).catch(() => {});
    setIssued(null); setConfirm(null); reload();
  };
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('تم النسخ', 'good')).catch(() => {});

  return (
    <Card title="بوابة المريض" subtitle="رمز QR شخصي يفتح ملف المريض على هاتفه مباشرة" icon={<span>📱</span>}>
      {!data ? <Spinner /> : (
        <div className="grid gap-3" data-portal={data.active ? 'active' : 'none'}>
          {issued ? (
            <div className="grid justify-items-center gap-2 rounded-xl border border-brand-200 bg-brand-50/40 p-3 text-center">
              <QrSvg text={issued.url} size={188} />
              <p className="text-[12px] font-bold text-ink/60">امسح بكاميرا الهاتف — يفتح البوابة ويسجّل الدخول تلقائياً</p>
              <div className="flex flex-wrap justify-center gap-2 text-[12.5px]">
                <span className="rounded-lg bg-surface px-2.5 py-1 font-bold shadow-card">{`رقم الملف: ${issued.file_no}`}</span>
                <span className="rounded-lg bg-surface px-2.5 py-1 font-bold shadow-card">{`الرمز: `}<b className="tnum tracking-wider" dir="ltr" data-portal-code>{issued.code}</b></span>
              </div>
              <p className="text-[11px] font-bold text-clay-600">⚠️ الرمز يظهر مرة واحدة فقط — اطبعه أو أرسله الآن</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                <button className="btn-soft btn-sm" onClick={() => setPrint(true)}><Icon.print /> طباعة البطاقة</button>
                <button className="btn-ghost btn-sm" onClick={() => copy(issued.url)}><Icon.copy /> نسخ الرابط</button>
              </div>
            </div>
          ) : data.active ? (
            <div className="grid gap-1.5 rounded-xl bg-sand/70 p-3 text-[12.5px]">
              <p className="flex items-center gap-2 font-extrabold text-brand-700"><span className="h-2 w-2 rounded-full bg-[#5aa843]" /> الوصول مفعّل</p>
              <Row label="أُصدر" value={dateTime(data.created_at)} />
              <Row label="آخر دخول" value={data.last_used_at ? dateTime(data.last_used_at) : 'لم يدخل بعد'} />
              <Row label="مرات الدخول" value={fmt(data.use_count || 0, 0)} />
              <p className="text-[11px] text-ink/45">لأسباب أمنية لا يُحفظ الرمز — أصدر رمزاً جديداً لعرض QR (يُلغي القديم).</p>
            </div>
          ) : (
            <p className="rounded-xl bg-sand/70 p-3 text-[12.5px] font-bold text-ink/55">لم يُفعَّل دخول المريض للبوابة بعد.</p>
          )}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px]" data-push-devices={devices.length}>
            <span className="font-bold">
              {devices.length
                ? <><span className="me-1">🔔</span>{`الإشعارات مفعّلة على ${devices.length} جهاز`}<span className="ms-1 text-ink/45">{`(${devices.map((d) => PLATFORM_LABEL[d.platform] || d.platform).join('، ')})`}</span></>
                : <span className="text-ink/50">🔕 لم يفعّل المريض إشعارات التطبيق بعد</span>}
            </span>
            {canWrite && devices.length > 0 && <button className="btn-soft btn-sm" onClick={() => setPushOpen(true)} data-push-open>إرسال إشعار</button>}
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-1.5">
              <button className="btn-primary btn-sm" onClick={() => (data.active ? setConfirm('issue') : issue())}><Icon.refresh /> {data.active ? 'رمز QR جديد' : 'إصدار رمز QR'}</button>
              <button className="btn-soft btn-sm" onClick={sendWa} disabled={!patient.phone} title={patient.phone ? '' : 'لا يوجد رقم هاتف'}>إرسال بواتساب</button>
              {data.active && <button className="btn-danger btn-sm" onClick={() => setConfirm('revoke')}>إيقاف الوصول</button>}
            </div>
          )}
        </div>
      )}
      <Modal open={pushOpen} onClose={() => setPushOpen(false)} title="إشعار على جوال المريض" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setPushOpen(false)}>إلغاء</button><button className="btn-primary" onClick={sendPush} disabled={!msg.body.trim()} data-push-send>إرسال</button></>}>
        <div className="grid gap-3">
          <Field label="العنوان"><Input value={msg.title} maxLength={120} onChange={(e) => setMsg({ ...msg, title: e.target.value })} /></Field>
          <Field label="النص" hint="يظهر فوراً على شاشة جوال المريض"><Textarea rows={3} value={msg.body} maxLength={400} onChange={(e) => setMsg({ ...msg, body: e.target.value })} data-push-body /></Field>
        </div>
      </Modal>
      <Confirm open={confirm === 'issue'} tone="primary" title="إصدار رمز جديد" message="سيتوقف رمز QR القديم عن العمل وتُسجَّل خروج أي جهاز دخل به. متابعة؟" confirmText="إصدار"
        onCancel={() => setConfirm(null)} onConfirm={issue} />
      <Confirm open={confirm === 'revoke'} title="إيقاف دخول البوابة" message="لن يتمكن المريض من الدخول بالرمز الحالي، وتُغلق جلساته المفتوحة." confirmText="إيقاف"
        onCancel={() => setConfirm(null)} onConfirm={revoke} />
      <PrintSheet open={print && !!issued} onClose={() => setPrint(false)} title="بطاقة دخول البوابة">
        {issued && (
          <div className="mx-auto grid max-w-[360px] justify-items-center gap-3 rounded-2xl border-2 border-dashed border-[#229a92] p-6 text-center">
            <p className="text-[18px] font-extrabold">بوابتي الصحية</p>
            <p className="text-[14px] font-bold">{patient.full_name}</p>
            <QrSvg text={issued.url} size={220} />
            <p className="text-[12px]">امسح الرمز بكاميرا هاتفك لفتح خطتك ومواعيدك وتسجيل عاداتك اليومية</p>
            <p className="text-[13px]" dir="auto">{`رقم الملف: ${issued.file_no} · الرمز: ${issued.code}`}</p>
            <p className="text-[11.5px] leading-5">📲 لتثبيته كتطبيق: افتح الرابط ثم اختر «إضافة إلى الشاشة الرئيسية» من قائمة المتصفح</p>
            <p className="text-[10.5px] opacity-70">بطاقة شخصية — لا تشاركها مع أحد</p>
          </div>
        )}
      </PrintSheet>
    </Card>
  );
}

/* ============================================================ قائمة الانتظار */
export function WaitlistForm({ open, onClose, onSaved, patient = null, entry = null }) {
  const { run } = useApp();
  const [patients, setPatients] = useState([]);
  const [f, setF] = useState({});
  useEffect(() => {
    if (!open) return;
    setF(entry ? { ...entry, days: entry.days ? String(entry.days).split(',').map(Number) : [] }
      : { patient_id: patient?.id || '', date_from: todayISO(), date_to: '', days: [], time_pref: 'any', visit_type: 'followup', mode: 'in_person', note: '' });
    if (!patient && !entry) api.get('/patients?status=active&limit=300').then((r) => setPatients(r.items || [])).catch(() => {});
  }, [open, entry, patient]);
  const toggleDay = (v) => setF((x) => ({ ...x, days: x.days.includes(v) ? x.days.filter((d) => d !== v) : [...x.days, v] }));
  const save = async () => {
    const body = { ...f, patient_id: Number(f.patient_id), date_from: f.date_from || null, date_to: f.date_to || null };
    await run(() => (entry ? api.put(`/waitlist/${entry.id}`, body) : api.post('/waitlist', body)), { ok: entry ? 'تم التحديث' : 'أُضيف لقائمة الانتظار' })
      .then(() => { onSaved?.(); onClose(); }).catch(() => {});
  };
  return (
    <Modal open={open} onClose={onClose} title={entry ? 'تعديل طلب الانتظار' : 'إضافة لقائمة الانتظار'} subtitle="عند إلغاء أي موعد مطابق يُعرض على المريض تلقائياً بواتساب" icon={<Icon.clock />}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save} disabled={!f.patient_id}><Icon.check /> حفظ</button></>}>
      <div className="grid gap-3.5">
        {!patient && !entry && (
          <Field label="المريض"><Select value={f.patient_id} onChange={(e) => setF({ ...f, patient_id: e.target.value })} placeholder="— اختر مريضاً —">
            {patients.map((p) => <option key={p.id} value={p.id}>{p.file_no} · {p.full_name}</option>)}
          </Select></Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="من تاريخ"><Input type="date" value={f.date_from || ''} onChange={(e) => setF({ ...f, date_from: e.target.value })} /></Field>
          <Field label="إلى تاريخ" hint="فارغ = مفتوح"><Input type="date" value={f.date_to || ''} onChange={(e) => setF({ ...f, date_to: e.target.value })} /></Field>
        </div>
        <Field label="الأيام المناسبة" hint="لا شيء = كل الأيام">
          <div className="flex flex-wrap gap-1.5">
            {WL_DAYS.map(([v, l]) => (
              <button type="button" key={v} onClick={() => toggleDay(v)}
                className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-bold ${f.days?.includes(v) ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-surface text-ink/60'}`}>{l}</button>
            ))}
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="الوقت المفضل"><Select value={f.time_pref} onChange={(e) => setF({ ...f, time_pref: e.target.value })}>
            {Object.entries(TIME_PREFS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select></Field>
          <Field label="نوع الزيارة"><Select value={f.visit_type} onChange={(e) => setF({ ...f, visit_type: e.target.value })}>
            {Object.entries(VISIT_TYPES).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
          </Select></Field>
          <Field label="الطريقة"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
            <option value="in_person">حضوري</option><option value="video">استشارة مرئية</option>
          </Select></Field>
        </div>
        <Field label="ملاحظة"><Textarea className="min-h-[60px]" value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function WaitlistPanel({ canWrite, highlight = false, onChanged }) {
  const { run, toast } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState('waiting');
  const [form, setForm] = useState(null);
  const [slot, setSlot] = useState({ date: todayISO(), time: '' });
  const [confirm, setConfirm] = useState(null);
  const { data, loading, error, reload } = useLoader(() => api.get(`/waitlist?status=${tab}`), [tab]);
  const pending = (data?.offers || []).filter((o) => o.status === 'pending');
  const recentOffers = (data?.offers || []).filter((o) => o.status !== 'pending').slice(-6).reverse();
  const done = () => { reload(); onChanged?.(); };

  const offerSlot = async () => {
    const r = await run(() => api.post('/waitlist/offer-slot', { date: slot.date, time: slot.time })).catch(() => null);
    if (!r) return;
    if (r.offered) toast(`عُرض الموعد على ${r.offered} من قائمة الانتظار ✓`, 'good');
    else toast({ no_match: 'لا يوجد مريض مطابق لهذا الموعد في القائمة', too_late: 'الموعد قريب جداً (أقل من 30 دقيقة)', taken: 'هذا الوقت محجوز بالفعل', disabled: 'قائمة الانتظار معطلة من الإعدادات', in_progress: 'هذا الموعد معروض بالفعل وينتظر الرد' }[r.reason] || 'لم يُعرض الموعد', 'warn');
    done();
  };

  return (
    <Card title="قائمة الانتظار الافتراضية" subtitle="المواعيد الملغاة تُعرض تلقائياً على المنتظرين المطابقين — أول من يؤكد يحجز" icon={<Icon.clock />}
      className={highlight ? 'ring-2 ring-brand-400' : ''}
      actions={<>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-sand p-1">
          {[['waiting', `منتظرون ${data?.counts?.waiting ?? ''}`], ['booked', 'حُجز لهم']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-2.5 py-1 text-[12px] font-bold ${tab === k ? 'bg-surface text-brand-700 shadow-card' : 'text-ink/50'}`}>{l}</button>
          ))}
        </div>
        {canWrite && <button className="btn-primary btn-sm" onClick={() => setForm({})}><Icon.plus /> إضافة</button>}
      </>}>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} retry={reload} /> : (
        <div className="grid gap-4" data-waitlist={data.items.length}>
          {pending.length > 0 && (
            <div className="rounded-xl border border-[#e7b54a]/60 bg-[#fbf3df]/70 p-3 dark:bg-[#2a2415]">
              <p className="mb-2 text-[12.5px] font-extrabold">{`⏳ عروض بانتظار رد المرضى (${pending.length})`}</p>
              <div className="grid gap-1.5">
                {pending.map((o) => (
                  <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2 text-[12.5px] shadow-card">
                    <b>{o.first_name} {o.last_name}</b><span className="tnum text-ink/50">{o.file_no}</span>
                    <span className="tnum font-bold">{shortDate(o.slot_date)} {o.slot_time}</span>
                    <span className="text-[11px] text-ink/45">{`ينتهي ${String(o.expires_at).slice(11)}`}</span>
                    <Badge tone={o.notify_status === 'sent' ? 'leaf' : 'ink'}>{o.notify_status === 'sent' ? 'واتساب ✓' : o.notify_status === 'link' ? 'رابط' : 'بلا إشعار'}</Badge>
                    {canWrite && <span className="ms-auto flex gap-1">
                      <button className="btn-soft btn-sm" onClick={() => run(() => api.post(`/waitlist/offers/${o.id}/accept`), { ok: 'تم الحجز للمريض ✓' }).then(done).catch(done)}>حجز له</button>
                      <button className="btn-ghost btn-sm" onClick={() => run(() => api.post(`/waitlist/offers/${o.id}/decline`), { ok: 'رُفض — يُعرض على التالي' }).then(done).catch(() => {})}>رفض</button>
                    </span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.items.length === 0 ? (
            <Empty icon="🕰️" title={tab === 'waiting' ? 'لا أحد في قائمة الانتظار' : 'لا حجوزات من القائمة بعد'} message={tab === 'waiting' ? 'يمكن للمرضى طلب موعد أقرب من بوابتهم، أو أضفهم أنت' : ''} />
          ) : (
            <div className="grid gap-2">
              {data.items.map((w) => (
                <div key={w.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
                  {tab === 'waiting' && <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-[13px] font-extrabold text-brand-700 tnum">{w.position}</span>}
                  <button className="min-w-0 flex-1 text-start" onClick={() => nav(`/patients/${w.patient_id}`)}>
                    <p className="truncate text-[13.5px] font-extrabold hover:text-brand-700">{w.first_name} {w.last_name} <span className="tnum text-[11.5px] font-bold text-ink/45">{w.file_no}</span></p>
                    <p className="truncate text-[11.5px] font-bold text-ink/50">
                      {w.date_from ? shortDate(w.date_from) : 'الآن'} → {w.date_to ? shortDate(w.date_to) : 'مفتوح'} · {daysText(w.days)} · {TIME_PREFS[w.time_pref]}
                      {w.mode === 'video' ? ' · 🎥 مرئية' : ''}
                    </p>
                    {w.note && <p className="truncate text-[11.5px] text-ink/55">{w.note}</p>}
                  </button>
                  <Badge tone={w.source === 'portal' ? 'brand' : 'ink'}>{w.source === 'portal' ? 'من البوابة' : 'من العيادة'}</Badge>
                  {Number(w.pending_offers) > 0 && <Badge tone="sun">عرض قائم</Badge>}
                  {canWrite && tab === 'waiting' && (
                    <span className="flex gap-1">
                      <button className="btn-ghost btn-sm !px-2" title="تعديل" onClick={() => setForm({ entry: w })}><Icon.pencil /></button>
                      <button className="btn-danger btn-sm !px-2" title="إزالة" onClick={() => setConfirm(w)}><Icon.trash /></button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {canWrite && tab === 'waiting' && (
            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-line p-3">
              <p className="w-full text-[12px] font-bold text-ink/55">لديك فراغ في الجدول؟ اعرضه يدوياً على المنتظرين المطابقين:</p>
              <Input type="date" min={todayISO()} value={slot.date} onChange={(e) => setSlot({ ...slot, date: e.target.value })} className="!w-40 !py-2 !text-[12.5px]" />
              <Input type="time" step="300" value={slot.time} onChange={(e) => setSlot({ ...slot, time: e.target.value })} className="!w-32 !py-2 !text-[12.5px]" />
              <button className="btn-soft btn-sm" disabled={!slot.date || !slot.time} onClick={offerSlot}>عرض الموعد</button>
            </div>
          )}

          {recentOffers.length > 0 && (
            <details className="text-[12px]">
              <summary className="cursor-pointer font-bold text-ink/55">سجل العروض الأخيرة</summary>
              <div className="mt-2 grid gap-1">
                {recentOffers.map((o) => (
                  <p key={o.id} className="flex flex-wrap items-center gap-2"><Badge tone={OFFER_STATUS[o.status]?.color}>{OFFER_STATUS[o.status]?.label}</Badge>
                    {o.first_name} {o.last_name} · <span className="tnum">{shortDate(o.slot_date)} {o.slot_time}</span></p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      <WaitlistForm open={!!form} entry={form?.entry || null} onClose={() => setForm(null)} onSaved={done} />
      <Confirm open={!!confirm} title="إزالة من قائمة الانتظار" message={`إزالة ${confirm?.first_name || ''} من القائمة؟ تُلغى عروضه القائمة.`} confirmText="إزالة"
        onCancel={() => setConfirm(null)} onConfirm={() => run(() => api.del(`/waitlist/${confirm.id}`), { ok: 'أُزيل من القائمة' }).then(() => { setConfirm(null); done(); }).catch(() => {})} />
    </Card>
  );
}

/* ============================================================ تفاصيل الموعد + المكالمة */
export function waitlistToast(toast, r) {
  const w = r?.waitlist;
  if (w?.offered) toast(`الموعد الشاغر عُرض تلقائياً على ${w.offered} من قائمة الانتظار 🔔`, 'good', 6000);
}

export function StaffCall({ call, iceServers, onClose }) {
  const client = useMemo(() => ({
    pull: (after) => api.get(`/calls/${call.id}/signals?after=${after}`),
    signal: (kind, payload) => api.post(`/calls/${call.id}/signal`, { kind, payload }),
    end: () => api.post(`/calls/${call.id}/end`),
  }), [call.id]);
  return (
    <VideoCall role="doctor" client={client} iceServers={iceServers}
      title={`استشارة مرئية — ${call.first_name || ''} ${call.last_name || ''}`.trim()} subtitle={call.file_no}
      onClose={onClose} />
  );
}

export function AppointmentDetails({ appt, open, onClose, onChanged, autoCall = false }) {
  const { run, toast, canWrite } = useApp();
  const nav = useNavigate();
  const [call, setCall] = useState(null);   // { call, ice_servers, join_url, message }
  const [inCall, setInCall] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!open) { setCall(null); setInCall(false); } }, [open]);
  useEffect(() => { if (open && autoCall && appt && canWrite) startCall(false); }, [open, autoCall, appt?.id]); // eslint-disable-line

  if (!appt) return null;
  const setStatus = async (status) => {
    const r = await run(() => api.post(`/appointments/${appt.id}/status`, { status }), { ok: `الحالة الآن: ${APPT_STATUS[status].label}` }).catch(() => null);
    if (r) { waitlistToast(toast, r); onChanged?.(); if (status === 'cancelled') onClose(); }
  };
  const setMode = async (mode) => {
    await run(() => api.put(`/appointments/${appt.id}`, { mode }), { ok: mode === 'video' ? 'أصبح الموعد استشارة مرئية' : 'أصبح الموعد حضورياً' }).then(onChanged).catch(() => {});
  };
  async function startCall(notify = true) {
    if (!mediaSupported()) { toast('المتصفح لا يدعم المكالمات المرئية أو الاتصال غير آمن (https)', 'bad'); return; }
    setBusy(true);
    try {
      const r = await run(() => api.post(`/appointments/${appt.id}/call`, { notify }));
      setCall(r); setInCall(true);
      if (notify && r.message?.status === 'link' && r.message.link) window.open(r.message.link, '_blank', 'noopener');
      else if (notify && r.message?.status === 'sent') toast('أُرسل للمريض رابط الانضمام بواتساب ✓', 'good');
      onChanged?.();
    } catch { /* toast shown */ } finally { setBusy(false); }
  }
  const isVideo = appt.mode === 'video';

  return (
    <>
      <Modal open={open && !inCall} onClose={onClose} title={appt.patient_name} subtitle={`${longDate(appt.date)} · ${appt.time} · ${appt.duration_min} دقيقة`} icon={isVideo ? <span>🎥</span> : <Icon.cal />}
        footer={<>
          <button className="btn-ghost" onClick={() => nav(`/patients/${appt.patient_id}`)}><Icon.users /> ملف المريض</button>
          {canWrite && appt.status !== 'cancelled' && appt.status !== 'done' && (
            <button className="btn-primary" onClick={() => startCall(true)} disabled={busy} data-start-call>
              <span>🎥</span> {busy ? 'جارٍ البدء…' : 'بدء استشارة مرئية'}
            </button>
          )}
        </>}>
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone={VISIT_TYPES[appt.visit_type]?.color}>{VISIT_TYPES[appt.visit_type]?.label}</Badge>
            <Badge tone={APPT_STATUS[appt.status]?.color}>{APPT_STATUS[appt.status]?.label}</Badge>
            <Badge tone={isVideo ? 'brand' : 'ink'}>{isVideo ? '🎥 استشارة مرئية' : '🏥 حضوري'}</Badge>
          </div>
          <div className="grid gap-1.5 rounded-xl bg-sand/60 p-3 text-[13px]">
            <Row label="رقم الملف" value={appt.file_no} mono />
            <Row label="الهاتف" value={appt.phone || '—'} mono />
            {appt.notes && <Row label="ملاحظات" value={appt.notes} />}
          </div>
          {canWrite && (
            <div className="grid gap-2">
              <p className="text-[12px] font-extrabold text-ink/55">طريقة الزيارة</p>
              <div className="flex gap-1 rounded-xl border border-line bg-sand p-1">
                {[['in_person', '🏥 حضوري'], ['video', '🎥 مرئية']].map(([k, l]) => (
                  <button key={k} onClick={() => !((k === 'video') === isVideo) && setMode(k)} className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-bold ${(k === 'video') === isVideo ? 'bg-surface text-brand-700 shadow-card' : 'text-ink/50'}`}>{l}</button>
                ))}
              </div>
              <p className="text-[12px] font-extrabold text-ink/55">الحالة</p>
              <div className="flex flex-wrap gap-1.5">
                {appt.status === 'scheduled' && <button className="btn-soft btn-sm" onClick={() => setStatus('confirmed')}><Icon.check /> تأكيد</button>}
                {appt.status !== 'done' && <button className="btn-ghost btn-sm" onClick={() => setStatus('done')}><Icon.clock /> تمت الزيارة</button>}
                {appt.status !== 'no_show' && appt.status !== 'done' && <button className="btn-ghost btn-sm" onClick={() => setStatus('no_show')}>لم يحضر</button>}
                {appt.status !== 'cancelled' && <button className="btn-danger btn-sm" onClick={() => setStatus('cancelled')}><Icon.close /> إلغاء (يُعرض على قائمة الانتظار)</button>}
              </div>
            </div>
          )}
          {isVideo && <p className="rounded-xl border border-brand-200 bg-brand-50/50 p-3 text-[12px] font-bold text-ink/60">
            عند البدء: يظهر للمريض زر «انضم الآن» في بوابته، ويُرسل له رابط بواتساب. الصوت والصورة مباشرة بين الجهازين (لا تمر بالخادم).
          </p>}
        </div>
      </Modal>
      {inCall && call && (
        <>
          <StaffCall call={call.call ? { ...call.call, first_name: appt.patient_name, last_name: '', file_no: appt.file_no } : call} iceServers={call.ice_servers}
            onClose={() => { setInCall(false); onChanged?.(); onClose(); }} />
          {call.join_url && (
            <div className="fixed inset-x-0 top-16 z-[71] mx-auto flex w-fit max-w-[92vw] items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11.5px] font-bold text-white backdrop-blur">
              {`رابط المريض:`} <span className="max-w-[40vw] truncate" dir="ltr">{call.join_url}</span>
              <button className="rounded-full bg-white/20 px-2 py-0.5" onClick={() => navigator.clipboard?.writeText(call.join_url).then(() => toast('تم النسخ', 'good'))}>نسخ</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ============================================================ إعدادات المرحلة D */
export function PortalSettingsCard({ settings = {}, isAdmin, onSaved }) {
  const { run } = useApp();
  const [f, setF] = useState({});
  useEffect(() => {
    setF({
      portal: settings['clinic.portal_enabled'] !== false, waitlist: settings['clinic.waitlist_enabled'] !== false,
      batch: settings['clinic.waitlist_batch'] ?? 3, minutes: settings['clinic.waitlist_offer_minutes'] ?? 120,
      pushDaily: settings['clinic.push_daily'] !== false,
    });
  }, [settings]);
  const [push, setPush] = useState(null);
  useEffect(() => { api.get('/push/status').then(setPush).catch(() => {}); }, []);
  const save = (patch) => run(() => api.put('/settings', patch), { ok: 'تم الحفظ' }).then(onSaved).catch(() => {});
  return (
    <Card title="بوابة المريض وقائمة الانتظار" subtitle="رموز QR · العادات اليومية · عرض المواعيد الملغاة تلقائياً" icon={<span>📱</span>}>
      <div className="grid gap-3" data-portal-settings>
        <Toggle checked={!!f.portal} onChange={(v) => { setF({ ...f, portal: v }); if (isAdmin) save({ 'clinic.portal_enabled': v }); }} label="تفعيل بوابة المريض (الدخول برمز QR)" />
        <Toggle checked={!!f.waitlist} onChange={(v) => { setF({ ...f, waitlist: v }); if (isAdmin) save({ 'clinic.waitlist_enabled': v }); }} label="عرض المواعيد الملغاة على قائمة الانتظار تلقائياً" />
        <Toggle checked={!!f.pushDaily} onChange={(v) => { setF({ ...f, pushDaily: v }); if (isAdmin) save({ 'clinic.push_daily': v }); }} label="إشعار صباحي على تطبيق المريض (تذكير الموعد أو أهداف اليوم)" />
        {push && (
          <div className="grid gap-1 rounded-xl border border-brand-200 bg-brand-50/40 p-3 text-[12.5px]" data-push-status={push.devices}>
            <p className="font-extrabold text-brand-700">📲 تطبيق المريض</p>
            <p className="font-bold">{`${push.patients} مريض فعّلوا الإشعارات على ${push.devices} جهاز`}</p>
            <p className="text-ink/55">رابط التثبيت:<a className="mx-1 font-bold text-brand-700 underline" href={push.app_url} target="_blank" rel="noopener noreferrer" dir="ltr">{push.app_url}</a></p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="يُعرض الموعد على" hint="عدد المرضى في كل دفعة — أول من يؤكد يحجز">
            <Select value={f.batch} disabled={!isAdmin} onChange={(e) => { const v = Number(e.target.value); setF({ ...f, batch: v }); save({ 'clinic.waitlist_batch': v }); }}>
              {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{`${n} مرضى`}</option>)}
            </Select>
          </Field>
          <Field label="مهلة الرد على العرض" hint="بعدها ينتقل العرض للتالي تلقائياً">
            <Select value={f.minutes} disabled={!isAdmin} onChange={(e) => { const v = Number(e.target.value); setF({ ...f, minutes: v }); save({ 'clinic.waitlist_offer_minutes': v }); }}>
              {[[30, '30 دقيقة'], [60, 'ساعة'], [120, 'ساعتان'], [240, '4 ساعات'], [720, '12 ساعة'], [1440, 'يوم كامل']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
        </div>
        <p className="rounded-xl bg-sand/60 p-3 text-[12px] font-bold leading-6 text-ink/55">
          الاستشارات المرئية تعمل مباشرة بين المتصفحين. إن تعذّر الاتصال على بعض شبكات الجوال أضف خادم TURN في متغيرات Vercel:
          <code className="mx-1 rounded bg-surface px-1.5" dir="ltr">TURN_URL</code><code className="mx-1 rounded bg-surface px-1.5" dir="ltr">TURN_USERNAME</code><code className="mx-1 rounded bg-surface px-1.5" dir="ltr">TURN_CREDENTIAL</code>
        </p>
      </div>
    </Card>
  );
}
