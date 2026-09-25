import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, useLoader } from '../app-context.jsx';
import { api } from '../api.js';
import { PlanEditor } from '../components/Forms.jsx';
import { PlanDoc } from '../components/PrintDocs.jsx';
import { Badge, Card, Confirm, Empty, ErrorBox, Icon, Input, MacroBar, PrintSheet, Select, Spinner, Stat, Table } from '../components/ui.jsx';
import { fmt, money, shortDate } from '../format.js';

const STATUS = { active: ['حالي', 'good'], draft: ['مسودة', 'warn'], archived: ['مؤرشف', 'ink'] };

export default function Plans() {
  const { run, canWrite } = useApp();
  const nav = useNavigate();
  const { id: routePlanId } = useParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [clinic, setClinic] = useState({});

  useEffect(() => { api.get('/settings').then((r) => setClinic(r.settings || {})).catch(() => {}); }, []);

  const { data, loading, error, reload } = useLoader(async () => {
    const r = await api.get('/diet-plans');
    let items = r.items || [];
    if (status) items = items.filter((i) => i.status === status);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      items = items.filter((i) => `${i.first_name} ${i.last_name} ${i.file_no} ${i.title}`.toLowerCase().includes(s));
    }
    return { all: r.items || [], items };
  }, [q, status]);

  const loadFull = async (plan) => api.get(`/diet-plans/${plan.id}`);

  const stats = (data?.all || []).reduce((acc, p) => ({
    active: acc.active + (p.status === 'active' ? 1 : 0),
    draft: acc.draft + (p.status === 'draft' ? 1 : 0),
    avgKcal: acc.avgKcal + (p.kcal_total || 0),
    n: acc.n + 1,
  }), { active: 0, draft: 0, avgKcal: 0, n: 0 });

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="برامج مسجلة" value={fmt(stats.n, 0)} icon={<Icon.meal />} tone="brand" hint="لكل المرضى" />
        <Stat label="معتمدة حالياً" value={fmt(stats.active, 0)} icon={<Icon.check />} tone="leaf" hint="يراها المريض في التطبيق" />
        <Stat label="متوسط السعرات" value={stats.n ? fmt(stats.avgKcal / stats.n, 0) : '—'} unit="سعرة" icon={<Icon.flame />} tone="sun" hint="للبلاغات الغذائية" />
      </div>

      <Card title="البرامج الغذائية" subtitle="أنشئ وعدّل واطبع خطة أي مريض — المجموعات تُحسب من الوجبات" icon={<Icon.meal />}
        actions={
          <>
            <div className="relative">
              <Icon.search className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-brand-600" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="مريض أو ملف أو عنوان" className="!w-56 !py-2 !text-[12.5px] ps-8" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="كل الحالات" className="!w-32 !py-2 !text-[12.5px]">
              <option value="active">حالي</option><option value="draft">مسودة</option><option value="archived">مؤرشف</option>
            </Select>
          </>
        } pad={false}>
        {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} retry={reload} /> : data.items.length === 0 ? (
          <Empty icon="🍽️" title={q || status ? 'لا برامج مطابقة' : 'لا توجد برامج غذائية بعد'}
            message="افتح ملف المريض ثم أنشئ برنامجه — أو عدّل برنامجاً موجوداً من هنا." />
        ) : (
          <Table head={['المريض', 'البرنامج', 'الفترة', 'سعرات/يوم', 'وجبات', 'التوزيع', 'الحالة', '']}>
            {data.items.map((p) => (
              <tr key={p.id} className="group">
                <td>
                  <button onClick={() => nav(`/patients/${p.patient_id}`)} className="text-start">
                    <span className="block text-[13.5px] font-extrabold hover:text-brand-700">{p.first_name} {p.last_name}</span>
                    <span className="block text-[11.5px] font-bold text-ink/45 tnum">{p.file_no}</span>
                  </button>
                </td>
                <td className="max-w-[220px]"><p className="truncate font-bold">{p.title}</p></td>
                <td className="whitespace-nowrap text-[12px] text-ink/60 tnum">{p.start_date ? shortDate(p.start_date) : '—'} ← {p.end_date ? shortDate(p.end_date) : 'مفتوح'}</td>
                <td className="tnum font-extrabold text-brand-700">{fmt(p.kcal_total, 0)}</td>
                <td className="tnum text-ink/55">{p.meals_count}{p.days_count > 0 && <Badge tone="info" className="ms-1.5">أسبوعية · {p.days_count} أيام</Badge>}</td>
                <td className="w-[150px]"><PlanTotals planId={p.id} /></td>
                <td><Badge tone={STATUS[p.status]?.[1]}>{STATUS[p.status]?.[0]}</Badge></td>
                <td className="row-actions">
                  <div className="flex gap-1">
                    <button className="btn-ghost btn-sm !px-2" title="طباعة / PDF" onClick={async () => setPrinting(await loadFull(p))}><Icon.print /></button>
                    {canWrite && p.status !== 'active' && <button className="btn-soft btn-sm !px-2" title="اعتماد" onClick={() => run(() => api.post(`/diet-plans/${p.id}/activate`, {}), { ok: 'تم الاعتماد' }).then(reload).catch(() => {})}><Icon.check /></button>}
                    {canWrite && <button className="btn-ghost btn-sm !px-2" title="تعديل" onClick={() => run(() => loadFull(p)).then(setEditing).catch(() => {})}><Icon.pencil /></button>}
                    {canWrite && <button className="btn-ghost btn-sm !px-2" title="نسخ" onClick={() => run(() => api.post(`/diet-plans/${p.id}/duplicate`, {}), { ok: 'تم نسخ البرنامج' }).then(reload).catch(() => {})}><Icon.copy /></button>}
                    {canWrite && <button className="btn-danger btn-sm !px-2" title="حذف" onClick={() => setConfirm(p)}><Icon.trash /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {editing && (
        <PlanEditor open={!!editing} plan={editing} patient={{ id: editing.patient_id, full_name: `${editing.first_name} ${editing.last_name}`, file_no: editing.file_no }}
          onClose={() => setEditing(null)} onSaved={reload} />
      )}

      <Confirm open={!!confirm} title="حذف برنامج" onCancel={() => setConfirm(null)}
        message={`سيُحذف «${confirm?.title}» بكل وجباته نهائياً. للمريض: ${confirm?.first_name} ${confirm?.last_name}.`}
        onConfirm={() => run(() => api.del(`/diet-plans/${confirm.id}`), { ok: 'تم الحذف' }).then(() => { setConfirm(null); reload(); }).catch(() => {})} />

      <PrintSheet open={!!printing} onClose={() => setPrinting(null)} title="البرنامج الغذائي">
        {printing && <PlanDoc plan={printing} patient={{
          full_name: `${printing.first_name || ''} ${printing.last_name || ''}`.trim(),
          file_no: printing.file_no, height_cm: printing.height_cm,
          start_weight: printing.start_weight, goal_weight: printing.goal_weight,
        }} clinic={clinic} measurements={[]} />}
      </PrintSheet>
    </div>
  );
}

/** مجاميع الكروبروز للصف (تُجلب عند الظهور) */
function PlanTotals({ planId }) {
  const [t, setT] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`/diet-plans/${planId}`).then((p) => alive && setT(p.totals)).catch(() => {});
    return () => { alive = false; };
  }, [planId]);
  if (!t) return <div className="h-2.5 w-full animate-pulse rounded-full bg-sand" />;
  return <MacroBar totals={t} />;
}
