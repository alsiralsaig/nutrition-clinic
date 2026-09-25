import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useLoader } from '../app-context.jsx';
import { api } from '../api.js';
import { PaymentForm } from '../components/Forms.jsx';
import { RevenueReportDoc } from '../components/PrintDocs.jsx';
import { RevenueChart } from '../components/Charts.jsx';
import { Badge, Card, Confirm, Empty, ErrorBox, Icon, Input, PrintSheet, Select, Spinner, Stat, Table } from '../components/ui.jsx';
import { PAY_METHODS, fmt, money, shortDate, todayISO } from '../format.js';

const METHODS = Object.keys(PAY_METHODS);

export default function Payments() {
  const { run, canWrite, user } = useApp();
  const nav = useNavigate();
  const [range, setRange] = useState({ from: `${todayISO().slice(0, 7)}-01`, to: todayISO() });
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [printData, setPrintData] = useState(null);
  const [clinic, setClinic] = useState({});

  useEffect(() => { api.get('/settings').then((r) => setClinic(r.settings || {})).catch(() => {}); }, []);

  const { data, loading, error, reload } = useLoader(async () => {
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    if (method) qs.set('method', method);
    if (q.trim()) qs.set('q', q.trim());
    const [list, summary, report] = await Promise.all([
      api.get(`/payments?${qs}`), api.get('/payments/summary?months=12'), api.get(`/reports/revenue?${qs}`),
    ]);
    return { list, summary, report };
  }, [range.from, range.to, method, q]);

  const rows = data?.list?.items || [];
  const currency = data?.list?.currency || 'SDG';

  if (loading && !data) return <Spinner label="جارٍ تحميل المدفوعات…" />;
  if (error) return <ErrorBox error={error} retry={reload} />;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="إيراد الفترة المحددة" value={money(data.report.gross, currency).split(' ')[0]} unit={currency}
          hint={`${data.report.count} عملية · ملغي ${data.report.voided_count}`} icon={<Icon.wallet />} tone="brand" />
        <Stat label="متوسط العملية" value={money(data.report.average, currency).split(' ')[0]} unit={currency}
          hint="لمرضى العيادة جميعاً" icon={<Icon.chart />} tone="leaf" />
        <Stat label="إيراد اليوم" value={money(data.summary.today.t, currency).split(' ')[0]} unit={currency}
          hint={`${data.summary.today.n} دفعة`} icon={<Icon.clock />} tone="sun" />
        <Stat label="إيراد الشهر الحالي" value={money(data.summary.month.t, currency).split(' ')[0]} unit={currency}
          hint={`${data.summary.month.n} دفعة`} icon={<Icon.check />} tone="ink" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card title="الإيرادات الشهرية" subtitle="آخر 12 شهراً" icon={<Icon.chart />}>
          {data.summary.monthly.length ? <RevenueChart data={data.summary.monthly} currency={currency} height={260} /> : <Empty title="لا مدفوعات بعد" />}
        </Card>
        <Card title="أعلى الخدمات إيراداً" icon={<Icon.wallet />}>
          {data.summary.byService.length ? (
            <ul className="grid gap-2">
              {data.summary.byService.slice(0, 6).map((s) => {
                const max = Math.max(...data.summary.byService.map((x) => x.total));
                return (
                  <li key={s.service}>
                    <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                      <span className="font-bold">{s.service}</span>
                      <span className="tnum font-extrabold text-brand-700">{money(s.total, currency)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(4, (s.total / max) * 100)}%` }} />
                    </div>
                    <p className="muted mt-0.5 tnum">{s.n} عملية</p>
                  </li>
                );
              })}
            </ul>
          ) : <Empty title="لا توجد خدمات مسعّرة بعد" />}
        </Card>
      </div>

      <Card title="سجل المدفوعات" subtitle={`${rows.length} دفعة · الإجمالي ${money(data.list.total, currency)}`} icon={<Icon.wallet />}
        actions={
          <>
            {canWrite && <button className="btn-ghost btn-sm" onClick={() => { setEditing(null); setModal('new'); }}><Icon.plus /> دفعة</button>}
            <button className="btn-ghost btn-sm" onClick={() => api.download('/reports/export/payments', `payments-${todayISO()}.csv`)}><Icon.download /> CSV</button>
            <button className="btn-soft btn-sm" onClick={() => setPrintData(data.report)}><Icon.print /> تقرير الإيرادات</button>
          </>
        } pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line/70 bg-sand/40 px-4 py-3 sm:px-5">
          <label className="flex items-center gap-2 text-[12px] font-bold text-ink/55">
            من
            <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="!w-36 !py-1.5 !text-[12.5px]" />
          </label>
          <label className="flex items-center gap-2 text-[12px] font-bold text-ink/55">
            إلى
            <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="!w-36 !py-1.5 !text-[12.5px]" />
          </label>
          <Select value={method} onChange={(e) => setMethod(e.target.value)} placeholder="كل الطرق" className="!w-36 !py-1.5 !text-[12.5px]">
            {METHODS.map((m) => <option key={m} value={m}>{PAY_METHODS[m]}</option>)}
          </Select>
          <div className="relative min-w-[200px] flex-1">
            <Icon.search className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-brand-600" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="مريض، ملف، خدمة، أو رقم فاتورة…" className="!py-1.5 !text-[12.5px] ps-8" />
          </div>
          <div className="flex gap-1">
            {[['هذا الشهر', `${todayISO().slice(0, 7)}-01`, todayISO()], ['آخر 30 يوم', null, todayISO()], ['هذه السنة', `${todayISO().slice(0, 4)}-01-01`, todayISO()], ['الكل', '0000-01-01', '9999-12-31']].map(([label, f, t]) => (
              <button key={label} onClick={() => setRange({ from: f || (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })(), to: t })}
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11.5px] font-bold text-ink/60 transition hover:border-brand-300 hover:text-brand-700">{label}</button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? <Empty icon="💳" title="لا مدفوعات في هذه الفترة" message="غيّر الفترة أو سجّل دفعة جديدة." /> : (
          <Table head={['التاريخ', 'المريض', 'الخدمة', 'المبلغ', 'الطريقة', 'الفاتورة', 'موظف', '']}>
            {rows.map((x) => (
              <tr key={x.id} className={`group ${x.voided ? 'opacity-45' : ''}`}>
                <td className="whitespace-nowrap font-bold">{shortDate(x.paid_on)}</td>
                <td><button onClick={() => nav(`/patients/${x.patient_id}`)} className="text-start">
                  <span className="block text-[13px] font-extrabold hover:text-brand-700">{x.patient_name}</span>
                  <span className="block text-[11px] font-bold text-ink/45 tnum">{x.file_no}</span>
                </button></td>
                <td>{x.service}</td>
                <td className="tnum whitespace-nowrap font-extrabold text-brand-700">{money(x.amount, x.currency)}</td>
                <td><Badge tone="info">{PAY_METHODS[x.method] || x.method}</Badge></td>
                <td className="tnum text-[12px] text-ink/55">{x.invoice_no || '—'}</td>
                <td className="text-[12px] text-ink/55">{x.staff_name || '—'}</td>
                <td className="row-actions">
                  {canWrite && !x.voided && (
                    <div className="flex gap-1">
                      <button className="btn-ghost btn-sm !px-2" title="تعديل" onClick={() => { setEditing(x); setModal('edit'); }}><Icon.pencil /></button>
                      <button className="btn-danger btn-sm !px-2" title="إلغاء الدفعة" onClick={() => setConfirm({ ...x, act: 'void' })}><Icon.close /></button>
                    </div>
                  )}
                  {user.role === 'admin' && (
                    <button className="btn-danger btn-sm !px-2" title="حذف نهائي" onClick={() => setConfirm({ ...x, act: 'del' })}><Icon.trash /></button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <PaymentForm open={!!modal} payment={editing} onClose={() => { setModal(null); setEditing(null); }} onSaved={reload} />

      <Confirm open={!!confirm} title={confirm?.act === 'del' ? 'حذف نهائي لدفعة' : 'إلغاء دفعة'} onCancel={() => setConfirm(null)}
        message={confirm?.act === 'del'
          ? `سيُحذف سجل الدفعة (${money(confirm?.amount, currency)}) نهائياً دون أثر في السجل.`
          : `سيُلغى احتساب دفعة «${confirm?.service}» بقيمة ${money(confirm?.amount, currency)} من الإيرادات، ويبى السجل واضحاً لمن عدّله.`}
        confirmText={confirm?.act === 'del' ? 'حذف' : 'إلغاء الدفعة'}
        onConfirm={() => run(
          () => confirm.act === 'del' ? api.del(`/payments/${confirm.id}`) : api.post(`/payments/${confirm.id}/void`),
          { ok: confirm.act === 'del' ? 'تم الحذف' : 'تم إلغاء الدفعة' },
        ).then(() => { setConfirm(null); reload(); }).catch(() => {})} />

      <PrintSheet open={!!printData} onClose={() => setPrintData(null)} title="تقرير الإيرادات">
        {printData && <RevenueReportDoc data={printData} clinic={clinic} />}
      </PrintSheet>
    </div>
  );
}
