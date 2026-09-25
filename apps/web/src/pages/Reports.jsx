import React, { useEffect, useState } from 'react';
import { useApp, useLoader } from '../app-context.jsx';
import { api } from '../api.js';
import { PatientReportDoc, VisitsReportDoc, RevenueReportDoc, WeightReportDoc } from '../components/PrintDocs.jsx';
import { Badge, Card, Empty, ErrorBox, Icon, Input, PrintSheet, Select, Spinner, Table } from '../components/ui.jsx';
import { fmt, money, shortDate, todayISO } from '../format.js';

const KINDS = [
  { key: 'patient', label: 'تقرير مريض كامل', icon: Icon.users, needsPatient: true },
  { key: 'weight', label: 'تقرير تطور الوزن', icon: Icon.scale, needsPatient: true },
  { key: 'visits', label: 'تقرير الزيارات', icon: Icon.clock },
  { key: 'revenue', label: 'تقرير الإيرادات', icon: Icon.wallet },
  { key: 'audit', label: 'سجل التدقيق', icon: Icon.shield },
];
const EXPORTS = [
  ['patients', 'قائمة المرضى', Icon.users],
  ['measurements', 'كل القياسات', Icon.scale],
  ['payments', 'المدفوعات', Icon.wallet],
  ['appointments', 'المواعيد', Icon.cal],
];

export default function Reports() {
  const { run, user } = useApp();
  const [kind, setKind] = useState('patient');
  const [patientId, setPatientId] = useState('');
  const [range, setRange] = useState({ from: '0000-01-01', to: todayISO() });
  const [doc, setDoc] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [clinic, setClinic] = useState({});

  useEffect(() => { api.get('/settings').then((r) => setClinic(r.settings || {})).catch(() => {}); }, []);

  const { data: patients } = useLoader(() => api.get('/patients?limit=500&sort=name'), []);
  const meta = KINDS.find((k) => k.key === kind);
  const { loading, reload } = useLoader(async () => {
    let url = '/reports/visits?from=' + range.from + '&to=' + range.to;
    if (kind === 'patient') url = `/reports/patient/${patientId}`;
    else if (kind === 'weight') url = `/reports/weight-progress/${patientId}`;
    else if (kind === 'revenue') url = `/reports/revenue?from=${range.from}&to=${range.to}`;
    else if (kind === 'audit') url = '/reports/audit?limit=200';
    if (meta?.needsPatient && !patientId) return null;
    const r = await api.get(url);
    setDoc(r);
    return r;
  }, [kind, patientId, range.from, range.to]);

  const ready = !meta?.needsPatient || !!patientId;

  return (
    <div className="grid gap-4">
      <Card title="التقارير" subtitle="اختر التقرير وحدّد الفترة — معاينة جاهزة للطباعة أو الحفظ PDF" icon={<Icon.chart />}>
        <div className="grid gap-3 lg:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
          {KINDS.map((k) => (
            <button key={k.key} onClick={() => { setKind(k.key); setDoc(null); }}
              className={`flex items-start gap-3 rounded-xl border p-3 text-start transition ${kind === k.key ? 'border-brand-400 bg-brand-50 shadow-card' : 'border-line bg-white hover:border-brand-300'}`}>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[15px] ${kind === k.key ? 'bg-brand-700 text-white' : 'bg-sand text-ink/50'}`}>{k.icon ? <k.icon /> : null}</span>
              <span>
                <span className="block text-[13px] font-extrabold">{k.label}</span>
                <span className="block text-[11.5px] font-bold text-ink/45">{k.needsPatient ? 'لمريض محدد' : 'على مستوى العيادة'}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          {meta?.needsPatient && (
            <label className="min-w-[240px] flex-1">
              <span className="label">المريض</span>
              <Select value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="— اختر مريضاً —">
                {(patients?.items || []).map((p) => <option key={p.id} value={p.id}>{p.file_no} · {p.full_name}</option>)}
              </Select>
            </label>
          )}
          {!meta?.needsPatient && (
            <>
              <label><span className="label">من</span><Input type="date" value={range.from === '0000-01-01' ? '' : range.from} onChange={(e) => setRange({ ...range, from: e.target.value || '0000-01-01' })} /></label>
              <label><span className="label">إلى</span><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
              <div className="flex gap-1 pb-1">
                {[['هذا الشهر', `${todayISO().slice(0, 7)}-01`], ['هذه السنة', `${todayISO().slice(0, 4)}-01-01`], ['الكل', '0000-01-01']].map(([l, f]) => (
                  <button key={l} onClick={() => setRange({ from: f, to: todayISO() })} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11.5px] font-bold text-ink/60 hover:border-brand-300 hover:text-brand-700">{l}</button>
                ))}
              </div>
            </>
          )}
          <div className="ms-auto flex gap-2 pb-0.5">
            <button className="btn-ghost" onClick={reload} disabled={!ready}><Icon.refresh /> توليد التقرير</button>
            <button className="btn-primary" disabled={!doc} onClick={() => setPrinting(true)}><Icon.print /> طباعة / PDF</button>
          </div>
        </div>
      </Card>

      {/* ===== معاينة ===== */}
      {loading && !doc ? <Card><Spinner /></Card> : !ready ? (
        <Card><Empty icon="🧾" title="اختر مريضاً لعرض التقرير" message="بعض التقارير خاصة بمريض واحد وتحتاج تحديد الملف أولاً." /></Card>
      ) : !doc ? <Card><Empty title="لا توجد بيانات في هذه الفترة" /></Card> : (
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <Card title={meta.label} subtitle="معاينة مبسطة — الورقة الكاملة في نافذة الطباعة" icon={<Icon.chart />}>
            <ReportPreview kind={kind} doc={doc} />
          </Card>
          <div className="grid gap-4">
            <Card title="تصدير Excel / CSV" subtitle="ملفات بترميز UTF-8 تفتح مباشرة في Excel بالعربية" icon={<Icon.download />}>
              <div className="grid gap-2">
                {EXPORTS.map(([key, label, Ic]) => (
                  <button key={key} onClick={() => run(() => api.download(`/reports/export/${key}`, `${key}-${todayISO()}.csv`), { ok: 'تم تنزيل الملف' }).catch(() => {})}
                    className="flex items-center gap-3 rounded-xl border border-line bg-white p-3 text-start transition hover:border-brand-300 hover:bg-brand-50">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700"><Ic /></span>
                    <span className="flex-1 text-[13px] font-extrabold">{label}</span>
                    <Icon.download className="text-ink/40" />
                  </button>
                ))}
              </div>
            </Card>
            <Card title="خيارات الورقة" icon={<Icon.print />}>
              <ul className="muted grid gap-1.5 text-[12.5px]">
                <li>• مقاس A4 مع هوامش 12 مم، رؤوس الأعمدة تتكرر في كل صفحة.</li>
                <li>• الترويسة تحمل اسم العيادة والهاتف والتاريخ تلقائياً.</li>
                <li>• «حفظ PDF» من نافذة الطباعة في المتصفح ← الوجهة: حفظ كـ PDF.</li>
                <li>• التذييل يحتوي خانة توقيع وختم العيادة.</li>
              </ul>
            </Card>
          </div>
        </div>
      )}

      <PrintSheet open={printing} onClose={() => setPrinting(false)} title={meta.label}>
        {kind === 'patient' && <PatientReportDoc report={{ ...doc, clinic }} />}
        {kind === 'weight' && <WeightReportDoc data={doc} patient={doc.patient} clinic={clinic} />}
        {kind === 'visits' && <VisitsReportDoc data={doc} clinic={clinic} />}
        {kind === 'revenue' && <RevenueReportDoc data={doc} clinic={clinic} />}
        {kind === 'audit' && <AuditDoc doc={doc} clinic={clinic} user={user} />}
      </PrintSheet>
    </div>
  );
}

function ReportPreview({ kind, doc }) {
  if (kind === 'patient') {
    return (
      <div className="grid gap-3">
        <div className="rounded-xl border border-line bg-sand/60 p-3">
          <p className="text-[15px] font-extrabold">{doc.patient.first_name} {doc.patient.last_name}</p>
          <p className="muted">{doc.patient.file_no} · {doc.patient.phone || 'بدون هاتف'} · {doc.patient.gender === 'female' ? 'أنثى' : 'ذكر'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[['زيارات', doc.totals.visits], ['مدفوع', money(doc.totals.paid, 'SDG')],
              ['تغير الوزن', doc.totals.weight_change == null ? '—' : `${fmt(doc.totals.weight_change)} كغ`],
              ['قياسات', doc.measurements.length]].map(([l, v]) => (
              <span key={l} className="rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-bold shadow-card">{l}: <b className="tnum text-brand-700">{v}</b></span>
            ))}
          </div>
        </div>
        {doc.measurements.length > 0 && (
          <Table head={['التاريخ', 'الوزن', 'BMI', 'الخصر', 'الدهون %']}>
            {doc.measurements.map((m) => (
              <tr key={m.id}><td>{shortDate(m.measured_on)}</td><td className="tnum">{fmt(m.weight_kg)}</td><td className="tnum">{fmt(m.bmi)}</td><td className="tnum">{fmt(m.waist_cm)}</td><td className="tnum">{fmt(m.body_fat_pct)}</td></tr>
            ))}
          </Table>
        )}
      </div>
    );
  }
  if (kind === 'weight') {
    return (
      <div className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-4">
          {[['البداية', `${fmt(doc.summary.start_weight)} كغ`], ['الحالي', `${fmt(doc.summary.current_weight)} كغ`],
            ['النزول', `${fmt(doc.summary.total_loss)} كغ`], ['تغير الخصر', `${fmt(doc.summary.waist_change)} سم`]].map(([l, v]) => (
            <div key={l} className="rounded-xl border border-line bg-sand/60 p-3"><p className="muted">{l}</p><p className="kpi-num mt-1 text-[18px]">{v}</p></div>
          ))}
        </div>
        <Table head={['#', 'التاريخ', 'الوزن', 'من البداية', 'عن السابق', 'أسابيع']}>
          {doc.rows.map((r) => (
            <tr key={r.seq}><td className="tnum">{r.seq}</td><td>{shortDate(r.measured_on)}</td><td className="tnum font-bold">{fmt(r.weight_kg)}</td>
              <td className="tnum text-leaf-600">{fmt(r.loss_vs_start)}</td><td className="tnum">{fmt(r.loss_vs_prev)}</td><td className="tnum text-ink/50">{r.weeks_since_start}</td></tr>
          ))}
        </Table>
      </div>
    );
  }
  if (kind === 'visits') {
    return (
      <div className="grid gap-3">
        <p className="muted">{doc.count} زيارة لـ {doc.unique_patients} مريضاً</p>
        <div className="flex flex-wrap gap-2">{Object.entries(doc.by_type).map(([k, v]) => <Badge key={k} tone="info">{k}: {v}</Badge>)}</div>
        <Table head={['التاريخ', 'المريض', 'الملف', 'النوع', 'قياسات؟']}><>
          {doc.rows.slice(0, 40).map((r, i) => (
            <tr key={i}><td>{shortDate(r.date)}</td><td className="font-bold">{r.patient_name}</td><td className="tnum">{r.file_no}</td>
              <td>{r.visit_type}</td><td>{r.has_meas ? <Badge tone="good">نعم</Badge> : <Badge tone="warn">لا</Badge>}</td></tr>
          ))}</>
        </Table>
      </div>
    );
  }
  if (kind === 'revenue') {
    return (
      <div className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-4">
          {[['الإيراد', money(doc.gross, doc.currency)], ['عمليات', doc.count], ['المتوسط', money(doc.average, doc.currency)], ['ملغاة', doc.voided_count]].map(([l, v]) => (
            <div key={l} className="rounded-xl border border-line bg-sand/60 p-3"><p className="muted">{l}</p><p className="kpi-num mt-1 text-[18px]">{v}</p></div>
          ))}
        </div>
        <Table head={['الخدمة', 'الإيراد', 'العدد']}>
          <>{doc.by_service.map((s) => <tr key={s.key}><td className="font-bold">{s.key}</td><td className="tnum text-brand-700">{money(s.total, doc.currency)}</td><td className="tnum">{s.n}</td></tr>)}</>
        </Table>
      </div>
    );
  }
  return (
    <Table head={['التاريخ', 'المستخدم', 'العملية', 'الجدول', 'البيانات']}>
      <>{doc.items.slice(0, 60).map((a) => (
        <tr key={a.id}><td className="whitespace-nowrap text-[12px]">{a.created_at}</td><td className="font-bold">{a.username || '—'}</td>
          <td><Badge tone="info">{a.action}</Badge></td><td className="text-[12px] text-ink/55">{a.entity}#{a.entity_id ?? ''}</td>
          <td className="max-w-[260px] truncate text-[11.5px] text-ink/50">{a.detail || ''}</td></tr>
      ))}</>
    </Table>
  );
}

function AuditDoc({ doc, clinic, user }) {
  return (
    <article dir="rtl">
      <div className="mb-4 border-b-2 border-black pb-3">
        <p className="text-[15px] font-extrabold">{clinic['clinic.name'] || 'عيادة التغذية'} — سجل التدقيق</p>
        <p className="text-[11px]">أُخرج بواسطة {user?.full_name} في {new Date().toLocaleString('ar-EG-u-nu-latn')}</p>
      </div>
      <table>
        <thead><tr>{['التاريخ', 'المستخدم', 'العملية', 'الجدول', 'المعرّف', 'التفاصيل'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{doc.items.slice(0, 200).map((a) => (
          <tr key={a.id}><td>{a.created_at}</td><td>{a.username || '—'}</td><td>{a.action}</td><td>{a.entity}</td><td>{a.entity_id ?? '—'}</td><td>{a.detail || ''}</td></tr>
        ))}</tbody>
      </table>
    </article>
  );
}
