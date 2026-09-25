import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useLoader } from '../app-context.jsx';
import { api } from '../api.js';
import { Card, Empty, ErrorBox, Icon, Spinner, Stat, Table, Badge } from '../components/ui.jsx';
import { GrowthChart, WeightTrendChart, RevenueChart, BmiPie, WeekdayChart } from '../components/Charts.jsx';
import { APPT_STATUS, VISIT_TYPES, fmt, money, initials, bmiTone } from '../format.js';

const TONE_CLASS = { good: 'text-leaf-600', warn: 'text-sun-600', bad: 'text-clay-600', muted: 'text-ink/45' };

function MiniAvatar({ p, size = 'h-9 w-9 text-[12px]' }) {
  return (
    <span className={`grid ${size} shrink-0 place-items-center rounded-xl bg-brand-100 font-extrabold text-brand-800`}>
      {initials(p)}
    </span>
  );
}

export default function Dashboard() {
  const { run } = useApp();
  const nav = useNavigate();
  const { data, loading, error, reload } = useLoader(async () => {
    const [summary, charts, today] = await Promise.all([
      api.get('/dashboard/summary'),
      api.get('/dashboard/charts?months=12'),
      api.get('/dashboard/today'),
    ]);
    return { summary, charts, today };
  }, []);

  if (loading && !data) return <Spinner label="جارٍ تجهيز لوحة التحكم…" />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { summary, charts, today } = data;

  const setStatus = async (id, status) => {
    await run(() => api.post(`/appointments/${id}/status`, { status }), { ok: status === 'done' ? 'تم تسجيل الزيارة ✓' : 'حُدّثت الحالة' })
      .then(reload).catch(() => {});
  };

  return (
    <div className="grid gap-4">
      {/* ---------- البطاقات ---------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="عدد المرضى" value={fmt(summary.patients.total, 0)}
          hint={`${summary.patients.inactive} متوقف · ${summary.patients.archived} مؤرشف`}
          icon={<Icon.users />} onClick={() => nav('/patients')} />
        <Stat label="المرضى النشطون" value={fmt(summary.patients.active, 0)}
          hint={`+${summary.patients.new_this_month} مريض جديد هذا الشهر`}
          tone="leaf" icon={<Icon.check />} onClick={() => nav('/patients?status=active')} />
        <Stat label="مواعيد اليوم" value={fmt(summary.appointments.today, 0)}
          hint={`تمّت ${summary.appointments.done} · في الانتظار ${summary.appointments.pending}`}
          tone="sun" icon={<Icon.cal />} onClick={() => nav('/appointments')} />
        <Stat label="إيرادات الشهر" value={money(summary.revenue.month, summary.revenue.currency).split(' ')[0]}
          unit={summary.revenue.currency} hint={`${summary.revenue.month_count} دفعة مسجّلة`}
          icon={<Icon.wallet />} onClick={() => nav('/payments')} />
        <Stat label="إجمالي الإيرادات" value={money(summary.revenue.total, summary.revenue.currency).split(' ')[0]}
          unit={summary.revenue.currency} hint={`${summary.revenue.total_count} عملية منذ الافتتاح`}
          tone="ink" icon={<Icon.chart />} onClick={() => nav('/reports')} />
      </div>

      {/* ---------- متابعة ونقاط تحتاج تدخلاً ---------- */}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card title="إحصائيات المتابعة" subtitle="مؤشرات الالتزام والنتائج خلال آخر 30 يوماً" icon={<Icon.scale />}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: 'مرضى قاسوا هذا الشهر', v: summary.followUp.measured_30d, s: 'زيارة متابعة مُسجّلة', tone: 'brand' },
              { t: 'زيارات آخر 30 يوم', v: summary.followUp.visits_30d, s: 'كل الأنواع', tone: 'brand' },
              { t: 'برامج غذائية نشطة', v: summary.followUp.active_plans, s: 'معتمدة حالياً', tone: 'leaf' },
              { t: 'متوسط نزول الوزن', v: summary.followUp.avg_weight_loss_kg == null ? '—' : `${fmt(summary.followUp.avg_weight_loss_kg)} كغ`, s: `على ${summary.followUp.tracked_patients} مريض`, tone: 'sun' },
            ].map((b) => (
              <div key={b.t} className="rounded-xl border border-line bg-sand/60 p-3.5">
                <p className="text-[12px] font-bold text-ink/55">{b.t}</p>
                <p className="kpi-num mt-1.5">{b.v}</p>
                <p className="muted mt-1">{b.s}</p>
              </div>
            ))}
          </div>
          {summary.followUp.overdue_60d > 0 && (
            <button onClick={() => nav('/patients?status=active')}
              className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-sun-100 bg-sun-50 px-3.5 py-3 text-start transition hover:border-sun-500/40">
              <Icon.alert className="text-sun-600" />
              <span className="flex-1 text-[13px] font-bold text-sun-600">
                {summary.followUp.overdue_60d} مريضاً نشطاً بلا أي قياسات منذ أكثر من 60 يوماً — يُنصح بالتواصل معهم
              </span>
              <span className="text-[12px] font-extrabold text-sun-600 underline">عرض القائمة</span>
            </button>
          )}
        </Card>

        <Card title="توزيع فئات BMI" subtitle="لآخر قياس مسجّل لكل مريض" icon={<Icon.chart />}>
          {charts.bmiDistribution.length ? <BmiPie data={charts.bmiDistribution} /> : <Empty title="لا توجد قياسات بعد" />}
        </Card>
      </div>

      {/* ---------- الرسوم ---------- */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="نمو عدد المرضى" subtitle="الجدد والتراكمي خلال 12 شهراً" icon={<Icon.users />}>
          {charts.patientGrowth.length ? <GrowthChart data={charts.patientGrowth} /> : <Empty title="لا توجد بيانات" />}
        </Card>
        <Card title="تطور المرضى" subtitle="متوسط الوزن و BMI ونسبة الدهون عبر الشهور" icon={<Icon.scale />}>
          {charts.measurements.length ? <WeightTrendChart data={charts.measurements} /> : <Empty title="لا توجد قياسات بعد" />}
        </Card>
        <Card title="الإيرادات الشهرية" subtitle={money(summary.revenue.total, summary.revenue.currency)} icon={<Icon.wallet />}>
          {charts.revenue.length ? <RevenueChart data={charts.revenue} currency={summary.revenue.currency} /> : <Empty title="لا توجد مدفوعات بعد" />}
        </Card>
        <Card title="أكثر أيام الأسبوع ازدحاماً" subtitle="المواعيد المنفّذة" icon={<Icon.cal />}>
          <WeekdayChart data={charts.weekdays} />
        </Card>
      </div>

      {/* ---------- اليوم + الأفضل ---------- */}
      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <Card title={`مواعيد اليوم (${today.date})`} icon={<Icon.clock />}
          actions={<button className="btn-soft btn-sm" onClick={() => nav('/appointments')}>كل المواعيد</button>}
          pad={false}>
          {today.items.length === 0 ? (
            <Empty icon="🗓️" title="لا توجد مواعيد اليوم" message="سجّل موعداً جديداً من صفحة المواعيد."
              action={<button className="btn-primary btn-sm" onClick={() => nav('/appointments?new=1')}><Icon.plus /> موعد جديد</button>} />
          ) : (
            <Table head={['الوقت', 'المريض', 'النوع', 'الحالة', 'إجراءات']}>
              {today.items.map((a) => (
                <tr key={a.id} className="group">
                  <td className="tnum whitespace-nowrap font-extrabold">{a.time}</td>
                  <td>
                    <button onClick={() => nav(`/patients/${a.patient_id}`)} className="flex items-center gap-2.5 text-start">
                      <MiniAvatar p={a} />
                      <span>
                        <span className="block text-[13.5px] font-extrabold hover:text-brand-700">{a.patient_name}</span>
                        <span className="block text-[11.5px] font-bold text-ink/45 tnum">{a.file_no}</span>
                      </span>
                    </button>
                  </td>
                  <td><Badge tone={VISIT_TYPES[a.visit_type]?.color}>{VISIT_TYPES[a.visit_type]?.label}</Badge></td>
                  <td><Badge tone={APPT_STATUS[a.status]?.color}>{APPT_STATUS[a.status]?.label}</Badge></td>
                  <td className="row-actions">
                    {a.status !== 'done' && a.status !== 'cancelled' && (
                      <div className="flex gap-1">
                        <button title="تمّت" className="btn-ghost btn-sm !px-2" onClick={() => setStatus(a.id, 'done')}><Icon.check /></button>
                        <button title="ملغي" className="btn-danger btn-sm !px-2" onClick={() => setStatus(a.id, 'cancelled')}><Icon.close /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="أفضل نتائج النزول" subtitle="أكبر انخفاض في الوزن بين أول وآخر قياس" icon={<Icon.flame />} pad={false}>
          {charts.weightProgressTop.length === 0 ? <Empty icon="⚖️" title="لا توجد مقارنة كافية" message="يحتاج المريض زيارتين على الأقل لقياس التطور." /> : (
            <Table head={['المريض', 'البداية', 'الحالي', 'النزول', 'زيارات']}>
              {charts.weightProgressTop.map((p) => (
                <tr key={p.id} className="group">
                  <td>
                    <button onClick={() => nav(`/patients/${p.id}`)} className="flex items-center gap-2.5 text-start">
                      <MiniAvatar p={p} size="h-8 w-8 text-[11px]" />
                      <span>
                        <span className="block text-[13px] font-extrabold hover:text-brand-700">{p.name}</span>
                        <span className="block text-[11px] font-bold text-ink/45 tnum">{p.file_no}</span>
                      </span>
                    </button>
                  </td>
                  <td className="tnum">{fmt(p.first_w)} كغ</td>
                  <td className="tnum">{fmt(p.last_w)} كغ</td>
                  <td><span className={`tnum font-extrabold ${TONE_CLASS.good}`}>−{fmt(p.lost)} كغ</span></td>
                  <td className="tnum text-ink/55">{p.visits}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* ---------- نصائح تشغيل ---------- */}
      <Card title="توزيع المرضى حسب الفئة الأخيرة" subtitle="مؤشر سريع لخطة المتابعة" icon={<Icon.scale />}>
        <div className="flex flex-wrap gap-2">
          {charts.bmiDistribution.map((b) => (
            <span key={b.label} className="flex items-center gap-2 rounded-xl border border-line bg-sand/70 px-3 py-2 text-[12.5px] font-bold">
              <span className={`tnum text-[15px] font-extrabold ${TONE_CLASS[bmiTone(b.label === 'وزن طبيعي' ? 22 : b.label.includes('نقص') ? 17 : 31)]}`}>{b.n}</span>
              {b.label}
            </span>
          ))}
          {!charts.bmiDistribution.length && <p className="muted">ابدأ بتسجيل قياسات أول زيارة لتظهر هنا.</p>}
        </div>
      </Card>
    </div>
  );
}
