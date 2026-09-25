import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, useLoader } from '../app-context.jsx';
import { api } from '../api.js';
import PatientForm from '../components/PatientForm.jsx';
import { Badge, Card, Confirm, Empty, ErrorBox, Icon, Input, Spinner, Table } from '../components/ui.jsx';
import { PATIENT_STATUS, bmiTone, fmt, initials, longDate, money, relativeDays } from '../format.js';

const TONE = { good: 'text-leaf-600', warn: 'text-sun-600', bad: 'text-clay-600', muted: 'text-ink/40' };
const REL_TONE = { good: 'text-leaf-600', muted: 'text-ink/40', warn: 'text-sun-600', bad: 'text-clay-600' };
const PAGE = 24;

export default function Patients() {
  const { run, canWrite, user, toast } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const sort = params.get('sort') || 'created';
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null); // null | 'new' | patient
  const [target, setTarget] = useState(null); // للحذف
  const [warnings, setWarnings] = useState(null);
  const [input, setInput] = useState(q);

  useEffect(() => setInput(q), [q]);
  // بحث مؤجل حتى لا نُثقل الخادم مع كل ضغطة
  useEffect(() => {
    const t = setTimeout(() => {
      if (input.trim() !== q) { setPage(0); patch({ q: input.trim() || null }); }
    }, 260);
    return () => clearTimeout(t);
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (obj) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(obj)) { if (v == null || v === '') next.delete(k); else next.set(k, v); }
    setParams(next, { replace: true });
  };

  const { data, loading, error, reload } = useLoader(async () => {
    const qs = new URLSearchParams({ q, status, sort, limit: PAGE, offset: page * PAGE });
    return api.get(`/patients?${qs}`);
  }, [q, status, sort, page]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const askDelete = async (p) => {
    setTarget(p); setWarnings(null);
    try { setWarnings(await api.get(`/patients/${p.id}/warnings`)); } catch { /* تجاهل */ }
  };
  const doDelete = async () => {
    await run(() => api.del(`/patients/${target.id}`), { ok: user.role === 'admin' ? 'تم حذف الملف نهائياً' : 'تمت أرشفة الملف' })
      .then(() => { setTarget(null); reload(); }).catch(() => {});
  };

  return (
    <div className="grid gap-4">
      <Card
        title={`ملفات المرضى${total ? ` · ${total}` : ''}`}
        subtitle="اضغط على أي مريض لفتح ملفه الشامل في صفحة واحدة"
        icon={<Icon.users />}
        actions={
          <>
            <div className="hidden items-center gap-1 rounded-xl border border-line bg-sand p-1 sm:flex">
              {[['created', 'الأحدث'], ['name', 'الاسم'], ['file_no', 'رقم الملف']].map(([k, l]) => (
                <button key={k} onClick={() => patch({ sort: k })}
                  className={`rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition ${sort === k ? 'bg-surface text-brand-700 shadow-card' : 'text-ink/50 hover:text-ink'}`}>{l}</button>
              ))}
            </div>
            {canWrite && <button className="btn-primary btn-sm" onClick={() => setEditing('new')}><Icon.plus /> مريض جديد</button>}
          </>
        }>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Icon.search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-brand-600" />
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="ابحث بالاسم أو اللقب أو رقم الملف أو الهاتف…" className="pe-3 ps-10" />
            {input && <button className="absolute end-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink/40 hover:bg-sand hover:text-clay-600" onClick={() => setInput('')}><Icon.close /></button>}
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-line bg-sand p-1">
            {[['', 'الكل'], ['active', 'نشط'], ['inactive', 'متوقف'], ['archived', 'مؤرشف']].map(([k, l]) => (
              <button key={k || 'all'} onClick={() => { patch({ status: k }); setPage(0); }}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-bold transition ${status === k ? 'bg-surface text-brand-700 shadow-card' : 'text-ink/50 hover:text-ink'}`}>{l}</button>
            ))}
          </div>
        </div>

        {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} retry={reload} /> : data.items.length === 0 ? (
          <Empty icon={q ? '🔍' : '🥗'}
            title={q ? `لا نتائج مطابقة لـ «${q}»` : 'لا يوجد مرضى بعد'}
            message={q ? 'جرّب اسماً أقصر أو رقم ملف مثل NC-0001.' : 'ابدأ بفتح أول ملف مريض — رقم الملف يُمنح تلقائياً.'}
            action={canWrite && !q ? <button className="btn-primary" onClick={() => setEditing('new')}><Icon.plus /> فتح ملف مريض</button> : null} />
        ) : (
          <>
            <div className="-mx-4 mt-3 sm:-mx-5">
              <Table head={['المريض', 'ملف', 'هاتف', 'الطول/الوزن', 'BMI', 'آخر زيارة', 'المدفوع', '']}>
                {data.items.map((p) => {
                  const rel = relativeDays(p.last_visit);
                  return (
                    <tr key={p.id} className="group cursor-pointer" onClick={() => nav(`/patients/${p.id}`)}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-[12px] font-extrabold text-brand-800">{initials(p)}</span>
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate text-[13.5px] font-extrabold group-hover:text-brand-700">
                              {p.full_name}
                              <Badge tone={PATIENT_STATUS[p.status]?.color}>{PATIENT_STATUS[p.status]?.label}</Badge>
                              {p.upcoming_count > 0 && <Badge tone="info">{p.upcoming_count} موعد قادم</Badge>}
                            </p>
                            <p className="truncate text-[11.5px] font-bold text-ink/45">{p.goal || 'لا هدف محدد بعد'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="tnum whitespace-nowrap font-extrabold text-brand-700">{p.file_no}</td>
                      <td className="tnum whitespace-nowrap" dir="ltr">{p.phone || '—'}</td>
                      <td className="tnum whitespace-nowrap text-[12.5px]">
                        {p.height_cm ? `${fmt(p.height_cm, 0)} سم` : '—'}
                        <span className="text-ink/35"> / </span>
                        {p.last_weight ? `${fmt(p.last_weight)} كغ` : '—'}
                      </td>
                      <td>
                        <span className={`tnum text-[13px] font-extrabold ${TONE[bmiTone(p.last_bmi)] || TONE.muted}`}>{fmt(p.last_bmi)}</span>
                        <span className="block text-[10.5px] font-bold text-ink/40">{p.last_bmi_category || ''}</span>
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="block text-[12.5px] font-bold">{p.last_visit ? longDate(p.last_visit).split('،')[0] : 'لم يأتِ بعد'}</span>
                        <span className={`block text-[11px] font-extrabold ${REL_TONE[rel.tone] || REL_TONE.muted}`}>{rel.text}</span>
                      </td>
                      <td className="tnum whitespace-nowrap text-[12.5px] font-bold">{p.paid_total ? money(p.paid_total, 'SDG') : '—'}</td>
                      <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          {canWrite && <button title="تعديل" className="btn-ghost btn-sm !px-2" onClick={() => setEditing(p)}><Icon.pencil /></button>}
                          {canWrite && <button title={user.role === 'admin' ? 'حذف' : 'أرشفة'} className="btn-danger btn-sm !px-2" onClick={() => askDelete(p)}><Icon.trash /></button>}
                          <button title="الملف" className="btn-ghost btn-sm !px-2" onClick={() => nav(`/patients/${p.id}`)}><Icon.chev className="rtl:rotate-180" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </div>
            {pages > 1 && (
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                <p className="muted">صفحة {page + 1} من {pages} · عرض {data.items.length} من {total}</p>
                <div className="flex gap-1.5">
                  <button className="btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>السابق</button>
                  <button className="btn-ghost btn-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>التالي</button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <PatientForm open={!!editing} patient={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />

      <Confirm open={!!target} onCancel={() => setTarget(null)} onConfirm={doDelete}
        title={`حذف ملف ${target?.full_name || ''}`}
        confirmText={user.role === 'admin' ? 'حذف نهائي' : 'أرشفة الملف'}
        message={
          <>
            {warnings ? (
              <p className="mb-2 rounded-lg bg-sand p-2.5 text-[12.5px]">
                هذا الملف مرتبط بـ: <b className="tnum">{warnings.measurements}</b> قياساً · <b className="tnum">{warnings.visits}</b> زيارة ·
                <b className="tnum"> {warnings.plans}</b> برنامجاً · <b className="tnum">{warnings.payments}</b> دفعة.
              </p>
            ) : <p className="mb-2">جارٍ فحص السجلات المرتبطة…</p>}
            {user.role === 'admin'
              ? 'الحذف النهائي سيزيل كل البيانات المرتبطة. يُفضَّل أخذ نسخة احتياطية أولاً، أو الاكتفاء بالأرشفة.'
              : 'لن يُحذف الملف نهائياً — سيتم أرشفته فقط (يستطيع المدير الحذف النهائي).'}
          </>
        } />
    </div>
  );
}
