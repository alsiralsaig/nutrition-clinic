import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, useLoader } from '../app-context.jsx';
import { api } from '../api.js';
import { AppointmentForm } from '../components/Forms.jsx';
import { Badge, Card, Confirm, Empty, ErrorBox, Icon, Input, Select, Spinner, Stat, Table } from '../components/ui.jsx';
import { APPT_STATUS, VISIT_TYPES, addDays, fmt, longDate, shortDate, todayISO } from '../format.js';

const STATUS_KEYS = ['scheduled', 'confirmed', 'done', 'cancelled', 'no_show'];

export default function Appointments() {
  const { run, canWrite } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(params.get('date') || todayISO());
  const [mode, setMode] = useState('day');
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [filter, setFilter] = useState({ status: '', q: '' });

  useEffect(() => { if (params.get('new') === '1') { setModal('new'); params.delete('new'); setParams(params, { replace: true }); } }, []); // eslint-disable-line

  const { data, loading, error, reload } = useLoader(async () => {
    if (mode === 'day') return { kind: 'day', ...(await api.get(`/appointments/today?date=${date}`)) };
    const from = addDays(date, -3), to = addDays(date, 10);
    const qs = new URLSearchParams({ from, to, ...(filter.status ? { status: filter.status } : {}), ...(filter.q ? { q: filter.q } : {}) });
    return { kind: 'range', items: (await api.get(`/appointments?${qs}`)).items };
  }, [date, mode, filter.status, filter.q]);

  const items = data?.items || [];
  const week = useMemo(() => {
    if (data?.kind !== 'range') return {};
    const by = {};
    for (const a of items) (by[a.date] ||= []).push(a);
    return by;
  }, [data]);

  const set = async (id, status) => {
    await run(() => api.post(`/appointments/${id}/status`, { status }), { ok: `الحالة الآن: ${APPT_STATUS[status].label}` }).then(reload).catch(() => {});
  };

  const slots = useMemo(() => {
    const from = 9, to = 21;
    return Array.from({ length: (to - from) * 2 }, (_, i) => `${String(from + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  }, []);

  const counts = useMemo(() => STATUS_KEYS.reduce((acc, k) => ({ ...acc, [k]: items.filter((i) => i.status === k).length }), {}), [items]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {STATUS_KEYS.map((k) => (
          <Stat key={k} label={APPT_STATUS[k].label} value={fmt(counts[k], 0)}
            hint={mode === 'day' ? longDate(date) : 'خلال 14 يوماً'}
            tone={k === 'done' ? 'ink' : k === 'cancelled' || k === 'no_show' ? 'clay' : k === 'confirmed' ? 'leaf' : k === 'scheduled' ? 'brand' : 'sun'}
            icon={<Icon.cal />} />
        ))}
      </div>

      <Card title={mode === 'day' ? 'جدول اليوم' : 'عرض الأسبوعين'} subtitle={data?.kind === 'day' ? data?.total + ' موعد' : `${items.length} موعد`} icon={<Icon.cal />}
        actions={
          <>
            <div className="flex items-center gap-1 rounded-xl border border-line bg-sand p-1">
              {[['day', 'اليوم'], ['range', 'الأسبوع']].map(([k, l]) => (
                <button key={k} onClick={() => setMode(k)} className={`rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition ${mode === k ? 'bg-surface text-brand-700 shadow-card' : 'text-ink/50'}`}>{l}</button>
              ))}
            </div>
            <div className="ltr:flex-row-reverse flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
              <button className="btn-ghost btn-sm !border-0 !px-2" onClick={() => setDate((d) => addDays(d, mode === 'day' ? 1 : 7))} title="اليوم التالي"><Icon.chev /></button>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} className="!border-0 !px-2 !py-1 !text-[12.5px]" />
              <button className="btn-ghost btn-sm !border-0 !px-2" onClick={() => setDate((d) => addDays(d, mode === 'day' ? -1 : -7))} title="اليوم السابق"><Icon.chev className="rotate-180" /></button>
              <button className="btn-soft btn-sm" onClick={() => setDate(todayISO())}>اليوم</button>
            </div>
            {canWrite && <button className="btn-primary btn-sm" onClick={() => { setEditing(null); setModal('new'); }}><Icon.plus /> موعد جديد</button>}
          </>
        }>

        {mode === 'range' && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} placeholder="كل الحالات" className="!w-40 !py-2 !text-[12.5px]">
              {STATUS_KEYS.map((k) => <option key={k} value={k}>{APPT_STATUS[k].label}</option>)}
            </Select>
            <Input value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="بحث بالمريض أو الملف…" className="!w-60 !py-2 !text-[12.5px]" />
          </div>
        )}

        {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} retry={reload} /> : mode === 'day' ? (
          items.length === 0 ? (
            <Empty icon="🗓️" title="لا مواعيد في هذا اليوم" message={longDate(date)}
              action={canWrite ? <button className="btn-primary" onClick={() => { setEditing(null); setModal('new'); }}><Icon.plus /> تسجيل موعد</button> : null} />
          ) : (
            <div className="grid gap-2">
              {slots.filter((t) => items.some((a) => a.time === t) || (t >= '09:00' && t <= '20:00')).map((t) => {
                const at = items.filter((a) => a.time === t);
                return (
                  <div key={t} className={`grid items-stretch gap-3 rounded-xl border p-2.5 transition sm:grid-cols-[64px_1fr] ${at.length ? 'border-brand-200 bg-brand-50/40' : 'border-line/60 bg-surface'}`}>
                    <div className="flex flex-col items-center justify-center rounded-lg bg-surface py-1.5 text-center shadow-card">
                      <span className="tnum text-[13px] font-extrabold text-ink">{t}</span>
                      {!!at.length && <span className="text-[9.5px] font-bold text-brand-600">{at.length} موعد</span>}
                    </div>
                    <div className="grid gap-2">
                      {at.length === 0 && canWrite && (
                        <button onClick={() => { setEditing({ time: t, date }); setModal('new'); }}
                          className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-[12px] font-bold text-ink/35 transition hover:border-brand-400 hover:text-brand-700">
                          <Icon.plus /> حجز شاغر في {t}
                        </button>
                      )}
                      {at.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
                          <button onClick={() => nav(`/patients/${a.patient_id}`)} className="min-w-0 flex-1 text-start">
                            <p className="truncate text-[13.5px] font-extrabold hover:text-brand-700">{a.patient_name}</p>
                            <p className="truncate text-[11.5px] font-bold text-ink/45 tnum">{a.file_no} · {a.phone || 'بدون هاتف'} · {a.duration_min} دقيقة</p>
                            {a.notes && <p className="mt-1 truncate text-[11.5px] text-ink/55">{a.notes}</p>}
                          </button>
                          <Badge tone={VISIT_TYPES[a.visit_type]?.color}>{VISIT_TYPES[a.visit_type]?.label}</Badge>
                          <Badge tone={APPT_STATUS[a.status]?.color}>{APPT_STATUS[a.status]?.label}</Badge>
                          {canWrite && (
                            <div className="flex gap-1">
                              {a.status === 'scheduled' && <button className="btn-soft btn-sm !px-2" title="تأكيد" onClick={() => set(a.id, 'confirmed')}><Icon.check /></button>}
                              {a.status !== 'done' && <button className="btn-ghost btn-sm !px-2" title="تمت الزيارة" onClick={() => set(a.id, 'done')}><Icon.clock /></button>}
                              {a.status !== 'cancelled' && <button className="btn-danger btn-sm !px-2" title="ملغي" onClick={() => set(a.id, 'cancelled')}><Icon.close /></button>}
                              <button className="btn-ghost btn-sm !px-2" title="تعديل" onClick={() => { setEditing(a); setModal('edit'); }}><Icon.pencil /></button>
                              <button className="btn-danger btn-sm !px-2" title="حذف" onClick={() => setConfirm({ id: a.id, text: 'حذف هذا الموعد نهائياً؟' })}><Icon.trash /></button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          items.length === 0 ? <Empty icon="🗓️" title="لا مواعيد في هذه الفترة" /> : (
            Object.entries(week).map(([d, list]) => (
              <div key={d} className="mb-3">
                <p className="mb-1.5 flex items-center gap-2 text-[12.5px] font-extrabold text-ink/60">
                  {longDate(d)} <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700 tnum">{list.length}</span>
                </p>
                <Table head={['الوقت', 'المريض', 'الملف', 'النوع', 'الحالة', 'مدة', '']}>
                  {list.sort((a, b) => a.time.localeCompare(b.time)).map((a) => (
                    <tr key={a.id} className="group">
                      <td className="tnum font-extrabold">{a.time}</td>
                      <td><button onClick={() => nav(`/patients/${a.patient_id}`)} className="font-bold hover:text-brand-700">{a.patient_name}</button></td>
                      <td className="tnum text-brand-700">{a.file_no}</td>
                      <td><Badge tone={VISIT_TYPES[a.visit_type]?.color}>{VISIT_TYPES[a.visit_type]?.label}</Badge></td>
                      <td>
                        <Select value={a.status} disabled={!canWrite} onChange={(e) => set(a.id, e.target.value)} className="!w-28 !py-1 !text-[12px]">
                          {STATUS_KEYS.map((k) => <option key={k} value={k}>{APPT_STATUS[k].label}</option>)}
                        </Select>
                      </td>
                      <td className="tnum text-ink/55">{a.duration_min}د</td>
                      <td className="row-actions">
                        {canWrite && <button className="btn-ghost btn-sm !px-2" onClick={() => { setEditing(a); setModal('edit'); }}><Icon.pencil /></button>}
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            ))
          )
        )}
      </Card>

      <AppointmentForm open={!!modal} patient={editing?.patient_id ? { id: editing.patient_id, full_name: editing.patient_name, file_no: editing.file_no } : null}
        appointment={editing?.id ? editing : null} defaultDate={editing?.time ? date : date}
        onClose={() => { setModal(null); setEditing(null); }} onSaved={() => { setDate(data?.kind === 'day' ? date : date); reload(); }} />

      <Confirm open={!!confirm} title="حذف موعد" message={confirm?.text || ''} onCancel={() => setConfirm(null)}
        onConfirm={() => run(() => api.del(`/appointments/${confirm.id}`), { ok: 'تم الحذف' }).then(() => { setConfirm(null); reload(); }).catch(() => {})} />
    </div>
  );
}
