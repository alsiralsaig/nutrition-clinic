import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, useLoader } from '../app-context.jsx';
import { api } from '../api.js';
import PatientForm from '../components/PatientForm.jsx';
import { AppointmentForm, MeasurementForm, PaymentForm, PlanEditor } from '../components/Forms.jsx';
import { AdherenceWeightChart, PatientProgressChart } from '../components/Charts.jsx';
import {
  ACTIVITY_LEVELS, AdherenceModal, AdherencePill, DAYS, GeneratorModal, ShoppingListModal, VoiceNoteButton,
  WaIcon, WhatsAppModal, appendText, useDaySelector,
} from '../components/Smart.jsx';
import { PatientReportDoc, PlanDoc, WeightReportDoc } from '../components/PrintDocs.jsx';
import { PrintSheet } from '../components/ui.jsx';
import { HabitsCard, PortalAccessCard } from '../components/Care.jsx';
import { Badge, Card, Confirm, Empty, ErrorBox, Icon, MacroBar, Modal, Row, Spinner, Table, Textarea } from '../components/ui.jsx';
import {
  APPT_STATUS, GENDERS, PATIENT_STATUS, VISIT_TYPES, bmiTone, fmt, initials,
  longDate, money, relativeDays, shortDate,
} from '../format.js';

const TONE = { good: 'text-leaf-600', warn: 'text-sun-600', bad: 'text-clay-600', muted: 'text-ink/40' };
const SECTIONS = [
  ['overview', 'نظرة'], ['habits', 'العادات والبوابة'], ['profile', 'البيانات'], ['measurements', 'القياسات'], ['plan', 'البرنامج الغذائي'],
  ['visits', 'الزيارات'], ['appointments', 'المواعيد'], ['payments', 'المدفوعات'], ['notes', 'الملاحظات'],
];

/** شريط تقدم الهدف الغذائي */
function GoalBar({ start, current, goal }) {
  if (start == null || current == null || goal == null || start === goal) return null;
  const span = Math.abs(start - goal) || 1;
  const done = Math.abs(start - current);
  const pct = Math.max(0, Math.min(100, Math.round((done / span) * 100)));
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-[11.5px] font-extrabold">
        <span className="text-ink/50">قطعته من الهدف: <span className="tnum text-brand-700">{pct}%</span></span>
        <span className="tnum text-ink/45">{fmt(start)} ← {fmt(current)} → {fmt(goal)} كغ</span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-sand">
        <div className="h-full rounded-full rtl:bg-gradient-to-l ltr:bg-gradient-to-r from-brand-500 to-brand-700 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function PatientFile() {
  const { id } = useParams();
  const nav = useNavigate();
  const { run, canWrite, user } = useApp();
  const { data, loading, error, reload } = useLoader(() => api.get(`/patients/${id}/profile`), [id]);
  const [clinic, setClinic] = useState({});
  const [sheet, setSheet] = useState(null); // 'report' | 'plan' | 'weight'
  const [sheetData, setSheetData] = useState(null);
  const [modal, setModal] = useState(null); // patient | measurement | appointment | payment | plan
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [chartKeys, setChartKeys] = useState(['weight_kg', 'bmi']);
  const [noteDraft, setNoteDraft] = useState('');
  const [wa, setWa] = useState(null); // { kind, refId }
  const [gen, setGen] = useState(false);
  const [shop, setShop] = useState(null); // plan
  const [adhVisit, setAdhVisit] = useState(null);

  useEffect(() => { api.get('/settings').then((r) => setClinic(r.settings || {})).catch(() => {}); }, []);
  useEffect(() => { if (data) setNoteDraft(data.patient.notes || ''); }, [data]);

  const p = data?.patient;
  const stats = data?.stats;
  const lastM = data?.measurements.at(-1);
  const firstM = data?.measurements[0];

  const openDoc = async (kind) => {
    setSheet(kind);
    setSheetData(null);
    try {
      if (kind === 'report') setSheetData(await api.get(`/reports/patient/${id}`));
      if (kind === 'weight') setSheetData(await api.get(`/reports/weight-progress/${id}`));
      if (kind === 'plan') setSheetData(data.active_plan || data.plans[0]);
    } catch (e) { setSheet(null); setSheetData(null); }
  };

  const del = async (kind, targetId) => {
    await run(() => api.del(`/${kind}/${targetId}`), { ok: 'تم الحذف' }).then(reload).catch(() => {});
  };

  if (loading && !data) return <Spinner label="جارٍ فتح ملف المريض…" />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!p) return <Empty title="الملف غير موجود" action={<button className="btn-primary" onClick={() => nav('/patients')}>عودة للمرضى</button>} />;

  const scrollTo = (k) => {
    document.getElementById(`sec-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="grid gap-4">
      {/* ================= الترويسة ================= */}
      <Card className="overflow-visible">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl brand-gradient-br text-[20px] font-extrabold text-white shadow-card">
              {initials(p)}
            </span>
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-[20px] font-extrabold leading-tight">
                {p.full_name}
                <Badge tone={PATIENT_STATUS[p.status]?.color}>{PATIENT_STATUS[p.status]?.label}</Badge>
                {p.next_appointment && <Badge tone="info">الموعد القادم {shortDate(p.next_appointment.date)} {p.next_appointment.time}</Badge>}
              </h2>
              <p className="muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="tnum font-extrabold text-brand-700">{p.file_no}</span>
                {p.phone && <a href={`tel:${p.phone}`} className="flex items-center gap-1 hover:text-brand-700" dir="ltr"><Icon.phone /> {p.phone}</a>}
                <span>{GENDERS[p.gender] || '—'}</span>
                {p.age != null && <span>{p.age} سنة</span>}
                {p.last_visit && <span>آخر زيارة {longDate(p.last_visit)}</span>}
                <span>مسجَّل {shortDate(p.created_at?.slice(0, 10))}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {canWrite && <button className="btn-ghost btn-sm" onClick={() => { setEditing(null); setModal('patient'); }}><Icon.pencil /> تعديل</button>}
            {canWrite && <button className="btn-ghost btn-sm" onClick={() => { setEditing(null); setModal('measurement'); }}><Icon.scale /> قياسات جديدة</button>}
            {canWrite && <button className="btn-ghost btn-sm" onClick={() => { setEditing(null); setModal('appointment'); }}><Icon.cal /> موعد</button>}
            {canWrite && <button className="btn-ghost btn-sm" onClick={() => { setEditing(null); setModal('payment'); }}><Icon.wallet /> دفعة</button>}
            {canWrite && <button className="btn-ghost btn-sm text-[#1f9d55]" onClick={() => setWa({ kind: 'custom' })}><WaIcon /> واتساب</button>}
            <button className="btn-soft btn-sm" onClick={() => openDoc('report')}><Icon.print /> تقرير المريض</button>
          </div>
        </div>

        {/* مؤشرات سريعة */}
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { t: 'الوزن الحالي', v: lastM?.weight_kg ?? p.start_weight, u: 'كغ', d: firstM && lastM && firstM.id !== lastM.id ? fmt(lastM.weight_kg - firstM.weight_kg) : null },
            { t: 'الهدف', v: p.goal_weight, u: 'كغ', d: p.to_lose ? `متبقٍ ${fmt(p.to_lose)}` : null },
            { t: 'BMI', v: lastM?.bmi, u: lastM?.bmi_category || '', tone: bmiTone(lastM?.bmi) },
            { t: 'محيط الخصر', v: lastM?.waist_cm, u: 'سم' },
            { t: 'إجمالي المسدد', v: data.financials.paid_total, u: 'ج.س', d: `${data.financials.payments_count} دفعة` },
          ].map((b) => (
            <div key={b.t} className="rounded-xl border border-line bg-sand/70 p-3">
              <p className="text-[11.5px] font-bold text-ink/55">{b.t}</p>
              <p className="mt-1 flex items-baseline gap-1">
                <span className={`tnum text-[20px] font-extrabold ${TONE[b.tone] || ''}`}>{fmt(b.v)}</span>
                <span className="text-[10.5px] font-bold text-ink/45">{b.u}</span>
              </p>
              {b.d != null && <p className={`tnum mt-0.5 text-[11px] font-extrabold ${String(b.d).startsWith('-') ? TONE.good : TONE.muted}`}>{String(b.d).startsWith('-') ? '▼ ' : ''}{b.d}</p>}
            </div>
          ))}
        </div>
        <GoalBar start={p.start_weight ?? firstM?.weight_kg} current={lastM?.weight_kg ?? p.start_weight} goal={p.goal_weight} />
      </Card>

      {/* شريط التنقل داخل الملف */}
      <nav className="no-print sticky top-[52px] z-20 -mx-1 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface/85 p-1 backdrop-blur no-scrollbar">
        {SECTIONS.map(([k, l]) => (
          <button key={k} onClick={() => scrollTo(k)}
            className="whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-bold text-ink/55 transition hover:bg-brand-50 hover:text-brand-700">
            {l}
            {k === 'visits' && <span className="tnum ms-1 text-[11px] text-ink/35">{stats.visits_count}</span>}
            {k === 'measurements' && <span className="tnum ms-1 text-[11px] text-ink/35">{stats.measurements_count}</span>}
            {k === 'appointments' && <span className="tnum ms-1 text-[11px] text-ink/35">{data.appointments.length}</span>}
          </button>
        ))}
      </nav>

      {/* ================= نظرة عامة ================= */}
      <div id="sec-overview" className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title="تطور الوزن والقياسات" subtitle={`${stats.measurements_count} قياساً عبر ${stats.weeks_followed} أسبوعاً`} icon={<Icon.chart />}
          actions={
            <div className="flex flex-wrap gap-1">
              {[['weight_kg', 'الوزن'], ['bmi', 'BMI'], ['waist_cm', 'الخصر'], ['body_fat_pct', 'الدهون']].map(([k, l]) => (
                <button key={k} onClick={() => setChartKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))}
                  className={`rounded-lg px-2 py-1 text-[11.5px] font-bold transition ${chartKeys.includes(k) ? 'bg-brand-700 text-white' : 'bg-sand text-ink/50 hover:bg-brand-50'}`}>{l}</button>
              ))}
              {data.measurements.length > 1 && <button className="btn-ghost btn-sm !py-1" onClick={() => openDoc('weight')}><Icon.pdf /> تقرير</button>}
            </div>
          }>
          {data.weight_series.length ? (
            <PatientProgressChart series={data.weight_series} show={chartKeys} height={270} />
          ) : <Empty icon="⚖️" title="لا قياسات بعد" message="سجّل أول زيارة لبدء رسم تطور الوزن."
            action={canWrite ? <button className="btn-primary btn-sm" onClick={() => { setEditing(null); setModal('measurement'); }}><Icon.plus /> قياسات جديدة</button> : null} />}
        </Card>

        <div className="grid gap-4">
          <Card title="ملخص المتابعة" icon={<Icon.scale />}>
            <dl className="grid gap-0">
              <Row label="عدد الزيارات" value={fmt(stats.visits_count, 0)} mono />
              <Row label="عدد القياسات" value={fmt(stats.measurements_count, 0)} mono />
              <Row label="أسابيع المتابعة" value={fmt(stats.weeks_followed, 0)} mono />
              <Row label="البرامج الغذائية" value={`${stats.plans_count} (النشط: ${data.active_plan ? 1 : 0})`} mono />
              <Row label="النزول المحقق" value={stats.weight_lost ? `${fmt(stats.weight_lost)} كغ` : '—'} mono />
              <Row label="متوسط الدفعة" value={money(data.financials.avg_payment, 'SDG')} mono />
            </dl>
          </Card>
          <Card title="أقرب المواعيد" icon={<Icon.cal />} pad={false}>
            {data.next_appointment ? (
              <div className="p-4">
                <p className="text-[15px] font-extrabold">{longDate(data.next_appointment.date)}</p>
                <p className="muted mt-1">{data.next_appointment.time} · {VISIT_TYPES[data.next_appointment.visit_type]?.label} · {data.next_appointment.duration_min} دقيقة</p>
                <div className="mt-3 flex gap-2">
                  {canWrite && <button className="btn-soft btn-sm" onClick={() => { setEditing(data.next_appointment); setModal('appointment'); }}>تعديل</button>}
                  {canWrite && <button className="btn-ghost btn-sm" onClick={() => run(() => api.post(`/appointments/${data.next_appointment.id}/status`, { status: 'confirmed' }), { ok: 'تم تأكيد الحضور' }).then(reload).catch(() => {})}>تأكيد</button>}
                </div>
              </div>
            ) : <Empty icon="🗓️" title="لا موعد قادم" message={canWrite ? 'احجز له موعد المتابعة القادم.' : undefined}
              action={canWrite ? <button className="btn-primary btn-sm" onClick={() => { setEditing(null); setModal('appointment'); }}><Icon.plus /> حجز موعد</button> : null} />}
          </Card>
        </div>
      </div>

      {/* ================= الالتزام مقابل الوزن ================= */}
      <Card title="الالتزام بالخطة وتغيّر الوزن" icon={<Icon.flame />}
        subtitle={data.adherence?.points?.length ? `متوسط الالتزام ${data.adherence.average_adherence}% · آخر تقييم ${data.adherence.last_adherence}%${data.adherence.correlation != null ? ` · الارتباط r = ${data.adherence.correlation}` : ''}` : 'قيّم الالتزام في كل زيارة متابعة لترى أثره على الوزن'}>
        {data.adherence?.points?.length ? (
          <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
            <AdherenceWeightChart points={data.adherence.points} />
            <div className="grid content-start gap-2">
              {data.adherence.points.slice(-5).reverse().map((pt) => (
                <div key={pt.visit_id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-sand/50 px-3 py-2">
                  <span className="text-[12.5px] font-extrabold">{shortDate(pt.date)}</span>
                  <AdherencePill value={pt.adherence} />
                  <span className={`tnum text-[12px] font-extrabold ${pt.weekly_progress_kg > 0 ? 'text-leaf-600' : pt.weekly_progress_kg < 0 ? 'text-clay-600' : 'text-ink/40'}`}>
                    {pt.weekly_progress_kg == null ? '—' : `${pt.weekly_progress_kg > 0 ? '▲' : '▼'} ${fmt(Math.abs(pt.weekly_progress_kg), 2)} كغ/أسبوع`}
                  </span>
                </div>
              ))}
              <p className="muted">▲ تقدّم نحو الهدف · ▼ عكس الهدف. التقدّم الأسبوعي = تغيّر الوزن منذ القياس السابق ÷ عدد الأيام × 7.</p>
            </div>
          </div>
        ) : (
          <Empty icon="📈" title="لا تقييمات التزام بعد"
            message="عند تسجيل قياسات زيارة متابعة، حرّك منزلق «الالتزام بالخطة» (0–100%). أو قيّم زيارة سابقة من جدول الزيارات." />
        )}
      </Card>

      {/* ================= العادات اليومية + البوابة ================= */}
      <div id="sec-habits" className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <HabitsCard patient={p} canWrite={canWrite} />
        <PortalAccessCard patient={p} canWrite={canWrite} />
      </div>

      {/* ================= البيانات ================= */}
      <div id="sec-profile" className="grid gap-4 lg:grid-cols-2">
        <Card title="بيانات المريض" icon={<Icon.users />}
          actions={canWrite && <button className="btn-ghost btn-sm" onClick={() => { setEditing(p); setModal('patient'); }}><Icon.pencil /> تعديل</button>}>
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <Row label="الاسم الكامل" value={p.full_name} />
            <Row label="رقم الملف" value={<span className="tnum text-brand-700">{p.file_no}</span>} />
            <Row label="الهاتف" value={<span dir="ltr">{p.phone || '—'}</span>} />
            <Row label="تاريخ الميلاد" value={p.birth_date ? `${shortDate(p.birth_date)}${p.age != null ? ` (${p.age} سنة)` : ''}` : '—'} />
            <Row label="الجنس" value={GENDERS[p.gender] || '—'} />
            <Row label="الطول" value={p.height_cm ? `${fmt(p.height_cm)} سم` : '—'} mono />
            <Row label="وزن البداية" value={p.start_weight ? `${fmt(p.start_weight)} كغ` : '—'} mono />
            <Row label="الوزن المستهدف" value={p.goal_weight ? `${fmt(p.goal_weight)} كغ` : '—'} mono />
            <Row label="BMI البداية" value={p.start_bmi ? `${fmt(p.start_bmi)} · ${p.start_bmi_category}` : '—'} mono />
            <Row label="الوزن المثالي تقديري" value={p.ideal_weight ? `${fmt(p.ideal_weight)} كغ` : '—'} mono />
            <Row label="مستوى النشاط" value={ACTIVITY_LEVELS[p.activity_level] || '—'} />
            <Row label="تذكيرات واتساب" value={`${p.reminders_opt_in === false || p.reminders_opt_in === 0 ? 'المواعيد: لا' : 'المواعيد: نعم'} · ${p.daily_reminder ? 'يومي: نعم' : 'يومي: لا'}`} />
            <Row label="تاريخ التسجيل" value={shortDate(p.created_at?.slice(0, 10))} />
            <Row label="آخر تحديث" value={shortDate(p.updated_at?.slice(0, 10))} />
          </dl>
          {p.goal && (
            <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50 p-3">
              <p className="text-[11.5px] font-extrabold text-brand-700">الهدف الغذائي</p>
              <p className="mt-1 text-[13px] font-bold leading-6 text-brand-800">{p.goal}</p>
            </div>
          )}
        </Card>

        {/* ================= الملاحظات ================= */}
        <div id="sec-notes" className="contents">
        <Card title="ملاحظات العيادة" icon={<Icon.pencil />}
          subtitle={canWrite ? 'تُحفظ مباشرة في ملف المريض' : undefined}
          actions={canWrite && (
            <>
              <VoiceNoteButton onText={(t) => setNoteDraft((d) => appendText(d, t))} />
              <button className="btn-ghost btn-sm" onClick={() => setNoteDraft(p.notes || '')} disabled={noteDraft === (p.notes || '')}>تراجع</button>
              <button className="btn-primary btn-sm" disabled={noteDraft === (p.notes || '')}
                onClick={() => run(() => api.put(`/patients/${p.id}`, { notes: noteDraft }), { ok: 'تم حفظ الملاحظات' }).then(reload).catch(() => {})}>حفظ</button>
            </>
          )}>
          <div>
            {canWrite ? (
              <>
              <Textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                className="min-h-[190px] leading-7" placeholder="حالة طبية، أدوية، حساسية، التزام، خطة التواصل… (أو استعمل الإملاء الصوتي 🎙️)" />
              {noteDraft !== (p.notes || '') && <p className="mt-1.5 text-[11.5px] font-bold text-sun-600">تعديلات غير محفوظة — اضغط «حفظ».</p>}
              </>
            ) : (
              <p className="whitespace-pre-line text-[13px] leading-7 text-ink/75">{p.notes || 'لا ملاحظات مسجّلة.'}</p>
            )}
          </div>
        </Card>
        </div>
      </div>

      {/* ================= القياسات ================= */}
      <div id="sec-measurements">
        <Card title="المتابعة والقياسات" subtitle="تُسجَّل في كل زيارة — BMI ونسبة الخصر/الورك تُحسب آلياً" icon={<Icon.scale />}
          actions={canWrite && <button className="btn-primary btn-sm" onClick={() => { setEditing(null); setModal('measurement'); }}><Icon.plus /> قياسات جديدة</button>}
          pad={false}>
          {data.measurements.length === 0 ? <Empty icon="⚖️" title="لا قياسات مسجّلة" /> : (
            <Table head={['التاريخ', 'الوزن', 'التغير', 'BMI', 'الفئة', 'الخصر', 'الصدر', 'الورك', 'خصر/ورك', 'الدهون %', 'ملاحظات', '']}>
              {[...data.measurements].reverse().map((m, i, arr) => {
                const prev = arr[i + 1];
                const delta = prev?.weight_kg != null && m.weight_kg != null ? Math.round((m.weight_kg - prev.weight_kg) * 10) / 10 : null;
                return (
                  <tr key={m.id} className="group">
                    <td className="whitespace-nowrap font-extrabold">{shortDate(m.measured_on)}</td>
                    <td className="tnum font-extrabold">{fmt(m.weight_kg)} <span className="text-[10.5px] font-bold text-ink/40">كغ</span></td>
                    <td className="tnum">{delta == null ? '—' : <span className={delta < 0 ? 'font-extrabold text-leaf-600' : delta > 0 ? 'font-extrabold text-clay-600' : 'text-ink/40'}>{delta > 0 ? '+' : ''}{fmt(delta)}</span>}</td>
                    <td className={`tnum font-extrabold ${TONE[bmiTone(m.bmi)] || ''}`}>{fmt(m.bmi)}</td>
                    <td className="text-[11.5px] font-bold text-ink/50">{m.bmi_category || '—'}</td>
                    <td className="tnum">{fmt(m.waist_cm)}</td>
                    <td className="tnum">{fmt(m.chest_cm)}</td>
                    <td className="tnum">{fmt(m.hip_cm)}</td>
                    <td className="tnum text-ink/55">{fmt(m.waist_hip_ratio)}</td>
                    <td className="tnum">{fmt(m.body_fat_pct)}</td>
                    <td className="max-w-[240px]"><p className="truncate text-[12px] text-ink/60" title={m.notes || ''}>{m.notes || '—'}</p></td>
                    <td className="row-actions">
                      {canWrite && (
                        <div className="flex gap-1">
                          <button title="تعديل" className="btn-ghost btn-sm !px-2" onClick={() => { setEditing(m); setModal('measurement'); }}><Icon.pencil /></button>
                          <button title="حذف" className="btn-danger btn-sm !px-2" onClick={() => setConfirm({ kind: 'measurements', id: m.id, text: 'حذف قياسات هذه الزيارة؟' })}><Icon.trash /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>

      {/* ================= البرنامج الغذائي ================= */}
      <div id="sec-plan">
        <Card title="البرنامج الغذائي" subtitle={data.active_plan ? `الحالي: ${data.active_plan.title}` : 'لا توجد خطة معتمدة بعد'} icon={<Icon.meal />}
          actions={canWrite && (
            <>
              <button className="btn-soft btn-sm" onClick={() => setGen(true)}><Icon.flame /> توليد خطة أسبوعية</button>
              {(data.active_plan || data.plans[0]) && <button className="btn-ghost btn-sm" onClick={() => setShop(data.active_plan || data.plans[0])}><Icon.download /> قائمة التسوق</button>}
              {data.active_plan && <button className="btn-ghost btn-sm text-[#1f9d55]" onClick={() => setWa({ kind: 'plan', refId: data.active_plan.id })}><WaIcon /> إرسال الخطة</button>}
              {data.active_plan && <button className="btn-ghost btn-sm" onClick={() => openDoc('plan')}><Icon.print /> طباعة / PDF</button>}
              <button className="btn-primary btn-sm" onClick={() => { setEditing(data.active_plan || data.plans[0] || null); setModal('plan'); }}>
                <Icon.pencil /> {data.active_plan ? 'تعديل الحالي' : 'إنشاء برنامج'}
              </button>
            </>
          )}>
          {data.plans.length === 0 ? (
            <Empty icon="🍽️" title="لا برنامج غذائي" message={canWrite ? 'أنشئ خطة غذائية بوجباتها وسعراتها — المريض يستلمها مطبوعة أو من تطبيق الموبايل.' : 'لم تُعتمد أي خطة بعد.'}
              action={canWrite ? <div className="flex flex-wrap justify-center gap-2"><button className="btn-primary btn-sm" onClick={() => setGen(true)}><Icon.flame /> توليد خطة أسبوعية ذكية</button><button className="btn-ghost btn-sm" onClick={() => { setEditing(null); setModal('plan'); }}><Icon.plus /> برنامج يدوي</button></div> : null} />
          ) : (
            <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
              <PlanView plan={data.active_plan || data.plans[0]} />
              <div className="grid gap-2">
                <p className="text-[12px] font-extrabold text-ink/50">كل البرامج ({data.plans.length})</p>
                {data.plans.map((pl) => (
                  <div key={pl.id} className={`rounded-xl border p-3 ${pl.status === 'active' ? 'border-brand-300 bg-brand-50' : 'border-line bg-sand/60'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-extrabold">{pl.title}</p>
                        <p className="muted tnum">{pl.start_date ? shortDate(pl.start_date) : '—'} · {fmt(pl.totals?.kcal, 0)} سعرة · {pl.meals_count} وجبة</p>
                      </div>
                      <Badge tone={pl.status === 'active' ? 'good' : pl.status === 'draft' ? 'warn' : 'ink'}>
                        {pl.status === 'active' ? 'حالي' : pl.status === 'draft' ? 'مسودة' : 'مؤرشف'}
                      </Badge>
                    </div>
                    {canWrite && pl.status !== 'active' && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button className="btn-soft btn-sm !py-1" onClick={() => run(() => api.post(`/diet-plans/${pl.id}/activate`, {}), { ok: 'تم اعتماد البرنامج' }).then(reload).catch(() => {})}><Icon.check /> اعتماد</button>
                        <button className="btn-ghost btn-sm !py-1" onClick={() => { setEditing(pl); setModal('plan'); }}><Icon.pencil /> تعديل</button>
                        <button className="btn-ghost btn-sm !py-1" onClick={() => run(() => api.post(`/diet-plans/${pl.id}/duplicate`, {}), { ok: 'تم نسخ البرنامج' }).then(reload).catch(() => {})}><Icon.copy /> نسخة</button>
                        <button className="btn-danger btn-sm !py-1" onClick={() => setConfirm({ kind: 'diet-plans', id: pl.id, text: `حذف «${pl.title}» وكل وجباته؟` })}><Icon.trash /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {data.active_plan && <div className="lg:col-span-2"><MacroBar totals={data.active_plan.totals} target={data.active_plan.target_kcal} /></div>}
            </div>
          )}
        </Card>
      </div>

      {/* ================= الزيارات ================= */}
      <div id="sec-visits">
        <Card title="الزيارات السابقة" subtitle={`${stats.visits_count} زيارة مسجّلة`} icon={<Icon.clock />} pad={false}>
          {data.visits.length === 0 ? <Empty icon="📋" title="لا زيارات" /> : (
            <Table head={['#', 'التاريخ', 'النوع', 'السبب', 'الالتزام', 'القياسات', 'سجّلها']}>
              {data.visits.map((v, i) => (
                <tr key={v.id} className="group">
                  <td className="tnum text-ink/45">{data.visits.length - i}</td>
                  <td className="whitespace-nowrap font-extrabold">{shortDate(v.visit_date)}</td>
                  <td><Badge tone={VISIT_TYPES[v.visit_type]?.color}>{VISIT_TYPES[v.visit_type]?.label || v.visit_type}</Badge></td>
                  <td className="text-[12.5px] text-ink/70">{v.reason || '—'}</td>
                  <td>
                    {canWrite ? (
                      <button className="rounded-lg transition hover:ring-2 hover:ring-brand-200" title={v.adherence_notes || 'تقييم الالتزام'} onClick={() => setAdhVisit(v)}>
                        {v.adherence == null ? <span className="rounded-lg border border-dashed border-line px-2 py-0.5 text-[11.5px] font-bold text-ink/45">+ تقييم</span> : <AdherencePill value={v.adherence} />}
                      </button>
                    ) : <AdherencePill value={v.adherence} />}
                  </td>
                  <td>{v.has_measurements ? <Badge tone="good"><Icon.check /> مسجلة</Badge> : (canWrite
                    ? <button className="btn-soft btn-sm !py-1" onClick={() => { setEditing({ createFor: v }); setModal('measurement'); }}>إدخال قياسات</button>
                    : <Badge tone="warn">فارغة</Badge>)}</td>
                  <td className="text-[12px] text-ink/50">{v.staff_name || '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* ================= المواعيد ================= */}
      <div id="sec-appointments">
        <Card title="المواعيد" icon={<Icon.cal />} pad={false}
          actions={canWrite && <button className="btn-ghost btn-sm" onClick={() => { setEditing(null); setModal('appointment'); }}><Icon.plus /> موعد جديد</button>}>
          {data.appointments.length === 0 ? <Empty icon="🗓️" title="لا مواعيد" /> : (
            <Table head={['التاريخ', 'الوقت', 'النوع', 'الحالة', 'مدة', 'ملاحظات', '']}>
              {data.appointments.map((a) => {
                const rel = relativeDays(a.date);
                return (
                  <tr key={a.id} className="group">
                    <td className="whitespace-nowrap font-extrabold">{shortDate(a.date)}
                      <span className={`ms-1.5 text-[11px] font-extrabold ${TONE[rel.tone === 'good' ? 'good' : rel.tone === 'warn' ? 'warn' : rel.tone === 'bad' ? 'bad' : 'muted']}`}>{rel.text}</span>
                    </td>
                    <td className="tnum">{a.time}</td>
                    <td className="text-[12.5px]">{VISIT_TYPES[a.visit_type]?.label || a.visit_type}</td>
                    <td><Badge tone={APPT_STATUS[a.status]?.color}>{APPT_STATUS[a.status]?.label}</Badge>
                      {a.reminded_at && <span className="ms-1 text-[10.5px] font-bold text-leaf-600" title={a.reminded_at}>✓ ذُكّر</span>}</td>
                    <td className="tnum text-ink/55">{a.duration_min}د</td>
                    <td className="max-w-[220px]"><p className="truncate text-[12px] text-ink/60">{a.notes || '—'}</p></td>
                    <td className="row-actions">
                      {canWrite && (
                        <div className="flex gap-1">
                          {['scheduled', 'confirmed'].includes(a.status) && <button className="btn-ghost btn-sm !px-2 text-[#1f9d55]" title="تذكير واتساب" onClick={() => setWa({ kind: 'appointment_reminder', refId: a.id })}><WaIcon /></button>}
                          <button className="btn-ghost btn-sm !px-2" title="تعديل" onClick={() => { setEditing(a); setModal('appointment'); }}><Icon.pencil /></button>
                          {a.status !== 'done' && <button className="btn-soft btn-sm !px-2" title="تمت" onClick={() => run(() => api.post(`/appointments/${a.id}/status`, { status: 'done' }), { ok: 'تم تسجيل الزيارة' }).then(reload).catch(() => {})}><Icon.check /></button>}
                          <button className="btn-danger btn-sm !px-2" title="حذف" onClick={() => setConfirm({ kind: 'appointments', id: a.id, text: 'حذف هذا الموعد؟' })}><Icon.trash /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>

      {/* ================= المدفوعات ================= */}
      <div id="sec-payments">
        <Card title={`المدفوعات · الإجمالي ${money(data.financials.paid_total, 'SDG')}`} icon={<Icon.wallet />} pad={false}
          actions={canWrite && <button className="btn-ghost btn-sm" onClick={() => { setEditing(null); setModal('payment'); }}><Icon.plus /> دفعة جديدة</button>}>
          {data.payments.length === 0 ? <Empty icon="💳" title="لا مدفوعات مسجّلة" /> : (
            <Table head={['التاريخ', 'الخدمة', 'المبلغ', 'الطريقة', 'الفاتورة', 'موظف', '']}>
              {data.payments.map((x) => (
                <tr key={x.id} className={`group ${x.voided ? 'opacity-45' : ''}`}>
                  <td className="whitespace-nowrap">{shortDate(x.paid_on)}</td>
                  <td className="font-bold">{x.service}</td>
                  <td className="tnum font-extrabold">{money(x.amount, x.currency)}</td>
                  <td className="text-[12.5px]">{({ cash: 'نقدي', card: 'بطاقة', bank_transfer: 'تحويل بنكي', mobile_wallet: 'محفظة هاتف', instalment: 'تقسيط' })[x.method]}</td>
                  <td className="tnum text-[12px] text-ink/55">{x.invoice_no || '—'}</td>
                  <td className="text-[12px] text-ink/55">{x.staff_name || '—'}</td>
                  <td className="row-actions">
                    {canWrite && !x.voided && (
                      <div className="flex gap-1">
                        <button className="btn-ghost btn-sm !px-2" title="تعديل" onClick={() => { setEditing(x); setModal('payment'); }}><Icon.pencil /></button>
                        <button className="btn-danger btn-sm !px-2" title="إلغاء الدفعة" onClick={() => setConfirm({ kind: 'payments', id: x.id, text: 'إلغاء هذه الدفعة؟ ستُستثنى من الإيرادات مع بقاء الأثر في السجل.', action: 'void' })}><Icon.close /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* ================= النوافذ ================= */}
      <PatientForm open={modal === 'patient'} patient={editing} onClose={() => { setModal(null); setEditing(null); }}
        onSaved={(saved) => (editing ? reload() : nav(`/patients/${saved.id}`))} />
      <MeasurementForm open={modal === 'measurement'} patient={p} measurement={editing?.id ? editing : null}
        visitId={editing?.createFor?.id} defaultDate={editing?.createFor?.visit_date}
        onClose={() => { setModal(null); setEditing(null); }} onSaved={reload} />
      <AppointmentForm open={modal === 'appointment'} patient={p} appointment={editing}
        onClose={() => { setModal(null); setEditing(null); }} onSaved={reload} />
      <PaymentForm open={modal === 'payment'} patient={p} payment={editing}
        onClose={() => { setModal(null); setEditing(null); }} onSaved={reload} />
      <PlanEditor open={modal === 'plan'} patient={p} plan={editing}
        onClose={() => { setModal(null); setEditing(null); }} onSaved={reload} />

      <GeneratorModal open={gen} onClose={() => setGen(false)} patient={p} onSaved={reload} />
      <ShoppingListModal open={!!shop} onClose={() => setShop(null)} plan={shop} patient={p} clinic={clinic} />
      <WhatsAppModal open={!!wa} onClose={() => { setWa(null); reload(); }} patient={p} initialKind={wa?.kind || 'custom'} refId={wa?.refId || null} appointments={data.appointments} />
      <AdherenceModal open={!!adhVisit} visit={adhVisit} onClose={() => setAdhVisit(null)} onSaved={reload} />

      <Confirm open={!!confirm} onCancel={() => setConfirm(null)} busy={false}
        title="تأكيد العملية" message={confirm?.text || ''}
        confirmText={confirm?.action === 'void' ? 'إلغاء الدفعة' : 'تأكيد الحذف'}
        onConfirm={async () => {
          const { kind, id: tid, action } = confirm;
          const url = `/${kind}/${tid}`;
          await run(() => (action === 'void' ? api.post(`${url}/void`) : api.del(url)), { ok: action === 'void' ? 'تم إلغاء الدفعة' : 'تم' })
            .then(() => { setConfirm(null); reload(); }).catch(() => {});
        }} />

      {/* ===== أوراق الطباعة ===== */}
      <PrintSheet open={!!sheet} onClose={() => { setSheet(null); setSheetData(null); }} title={sheet === 'report' ? 'تقرير المريض' : sheet === 'plan' ? 'البرنامج الغذائي' : 'تقرير تطور الوزن'}>
        {!sheetData ? <Spinner label="جارٍ تجهيز الورقة…" /> : sheet === 'report' ? <PatientReportDoc report={{ ...sheetData, clinic }} />
          : sheet === 'weight' ? <WeightReportDoc data={sheetData} patient={p} clinic={clinic} />
          : <PlanDoc plan={sheetData} patient={p} clinic={clinic} measurements={data.measurements} />}
      </PrintSheet>
    </div>
  );
}

/* عرض الوجبات داخل الملف */
function PlanView({ plan }) {
  const sel = useDaySelector(plan);
  if (!plan) return null;
  return (
    <div className="grid gap-2.5">
      {sel.weekly && (
        <div className="flex gap-1 overflow-x-auto no-scrollbar" data-day-tabs>
          {sel.days.map((d) => {
            const t = plan.by_day?.find((x) => x.day === d.day);
            return (
              <button key={d.day} onClick={() => sel.setDay(d.day)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-center text-[12px] font-bold transition ${sel.day === d.day ? 'bg-brand-700 text-white' : 'bg-sand text-ink/60 hover:bg-brand-50'}`}>
                {d.name}{t && <span className="tnum block text-[10.5px] opacity-75">{fmt(t.kcal, 0)}</span>}
              </button>
            );
          })}
        </div>
      )}
      {sel.weekly && plan.daily_average && <p className="muted tnum">متوسط اليوم: {fmt(plan.daily_average.kcal, 0)} سعرة · ب {plan.daily_average.protein_g} · ك {plan.daily_average.carbs_g} · د {plan.daily_average.fat_g} غ</p>}
      {sel.meals.map((m) => (
        <div key={m.id} className="flex items-start gap-3 rounded-xl border border-line bg-sand/50 p-3">
          <span className="grid h-10 w-14 shrink-0 place-items-center rounded-lg bg-surface text-center shadow-card">
            <span>
              <span className="block text-[11px] font-extrabold text-brand-700">{__t(m.slot)}</span>
              <span className="tnum block text-[10px] font-bold text-ink/40">{m.slot_time || ''}</span>
            </span>
          </span>
          <div className="min-w-0 flex-1">
            {m.title && m.title !== m.items && <p className="text-[13px] font-extrabold">{m.title}</p>}
            <p className="text-[12.5px] leading-6 text-ink/70">{m.items || '—'}</p>
            {m.portions && <p className="muted mt-0.5">الكمية: {m.portions}</p>}
          </div>
          <div className="tnum shrink-0 text-end text-[11.5px] font-bold text-ink/55">
            <p className="text-[14px] font-extrabold text-brand-700">{fmt(m.kcal, 0)}<span className="text-[10px]"> سعرة</span></p>
            <p>ب {fmt(m.protein_g)} · ك {fmt(m.carbs_g)} · د {fmt(m.fat_g)}</p>
          </div>
        </div>
      ))}
      {plan.advice && (
        <div className="rounded-xl border border-dashed border-sun-500/40 bg-sun-50 p-3">
          <p className="text-[11.5px] font-extrabold text-sun-600">تعليمات الأخصائية</p>
          <p className="mt-1 text-[12.5px] font-bold leading-6 text-ink/75">{plan.advice}</p>
        </div>
      )}
    </div>
  );
}

