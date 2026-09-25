import { TIME_LOCALE } from '../i18n.js';
import React from 'react';
import { fmt, longDate, shortDate, GENDERS, VISIT_TYPES, PAY_METHODS, money, bmiTone } from '../format.js';
import { DAYS } from './Smart.jsx';

/* ترويسة أي ورقة مطبوعة */
export function DocHeader({ clinic = {}, title, subtitle, patient }) {
  return (
    <header className="mb-5 border-b-2 border-black pb-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl border border-black text-[22px]">🥗</span>
          <div>
            <p className="text-[16px] font-extrabold leading-tight">{clinic['clinic.name'] || 'عيادة التغذية'}</p>
            <p className="text-[11px]">{clinic['clinic.address'] || ''} · هاتف {clinic['clinic.phone'] || ''}</p>
          </div>
        </div>
        <div className="text-end text-[11px] leading-5">
          <p className="font-bold">التاريخ: {longDate(new Date().toISOString().slice(0, 10))}</p>
          {patient?.file_no && <p className="font-bold">رقم الملف: {patient.file_no}</p>}
        </div>
      </div>
      <div className="mt-3.5 rounded-lg bg-[#f1efe9] px-3 py-2">
        <p className="text-[14px] font-extrabold">{title}</p>
        {subtitle && <p className="text-[11px]">{subtitle}</p>}
      </div>
    </header>
  );
}

export function DocFooter({ clinic = {} }) {
  return (
    <footer className="mt-6 border-t border-black/60 pt-2 text-[10px] leading-5">
      <p>{clinic['clinic.printFooter'] || ''}</p>
      <p className="mt-0.5">توقيع أخصائية التغذية: ……………………………… &nbsp;&nbsp;&nbsp; ختم العيادة: ………………………………</p>
    </footer>
  );
}

export function DocSection({ title, children }) {
  return (
    <section className="keep mb-4">
      {title && <h3 className="mb-1.5 border-b border-black/70 pb-1 text-[12.5px] font-extrabold">{title}</h3>}
      {children}
    </section>
  );
}

export function InfoGrid({ items, cols = 4 }) {
  return (
    <dl className={`grid gap-x-5 gap-y-1.5 ${cols === 2 ? 'grid-cols-2' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 border-b border-dotted border-black/25 pb-0.5">
          <dt className="text-[11px] font-bold opacity-70">{k}</dt>
          <dd className="tnum text-[12px] font-extrabold">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ====== تقرير المريض الكامل ====== */
export function PatientReportDoc({ report }) {
  const { patient: p, measurements = [], visits = [], plans = [], appointments = [], payments = [], totals = {}, clinic } = report;
  const first = measurements[0], last = measurements.at(-1);
  const activePlan = plans.find((x) => x.status === 'active') || plans[0];
  const valid = payments.filter((x) => !x.voided);
  return (
    <article dir="rtl">
      <DocHeader clinic={clinic} patient={p} title={`تقرير طبي تغذوي شامل — ${p.first_name} ${p.last_name}`} subtitle={`${p.file_no} · صادر في ${new Date().toLocaleString(TIME_LOCALE)}`} />
      <DocSection title="أولاً: بيانات المريض">
        <InfoGrid items={[
          ['الاسم الكامل', `${p.first_name} ${p.last_name}`], ['الجنس', GENDERS[p.gender] || '—'],
          ['تاريخ الميلاد', p.birth_date ? shortDate(p.birth_date) : '—'], ['الهاتف', p.phone || '—'],
          ['الطول', p.height_cm ? `${fmt(p.height_cm)} سم` : '—'], ['وزن البداية', p.start_weight ? `${fmt(p.start_weight)} كغ` : '—'],
          ['الوزن الحالي', last?.weight_kg ? `${fmt(last.weight_kg)} كغ` : '—'], ['الوزن المستهدف', p.goal_weight ? `${fmt(p.goal_weight)} كغ` : '—'],
          ['BMI الحالي', last?.bmi ? fmt(last.bmi) : '—'], ['آخر قياس', last?.measured_on ? shortDate(last.measured_on) : '—'],
          ['عدد الزيارات', visits.length], ['الحالة', p.status === 'active' ? 'نشط' : p.status === 'inactive' ? 'متوقف' : 'مؤرشف'],
        ]} />
        {p.goal && <p className="mt-2 text-[12px]"><b>الهدف الغذائي: </b>{p.goal}</p>}
        {p.notes && <p className="mt-1 text-[12px]"><b>ملاحظات: </b>{p.notes}</p>}
        {(p.allergies || p.forbidden_foods) && <p className="mt-1 text-[12px]" style={{ color: '#b42318' }}><b>⚠ حساسية / ممنوعات: </b>{[p.allergies, p.forbidden_foods].filter(Boolean).join(' · ')}</p>}
        {(p.chronic_conditions || p.medications || p.blood_type) && <p className="mt-1 text-[12px]"><b>التاريخ الطبي: </b>{[p.chronic_conditions, p.medications && `أدوية: ${p.medications}`, p.blood_type && `فصيلة الدم ${p.blood_type}`].filter(Boolean).join(' · ')}</p>}
      </DocSection>

      <DocSection title="ثانياً: تطور القياسات">
        {measurements.length ? (
          <table>
            <thead><tr>{['التاريخ', 'الوزن', 'BMI', 'الخصر', 'الورك', 'الصدر', 'الدهون %', 'ملاحظات'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {measurements.map((m) => (
                <tr key={m.id}>
                  <td>{shortDate(m.measured_on)}</td><td>{fmt(m.weight_kg)}</td><td>{fmt(m.bmi)}</td>
                  <td>{fmt(m.waist_cm)}</td><td>{fmt(m.hip_cm)}</td><td>{fmt(m.chest_cm)}</td>
                  <td>{fmt(m.body_fat_pct)}</td><td className="text-[10.5px]">{m.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-[11.5px] italic">لم تُسجَّل قياسات بعد.</p>}
        {first && last && first.id !== last.id && (
          <p className="mt-2 text-[12px] font-extrabold">
            الحصيلة: {fmt(first.weight_kg - last.weight_kg)} كغ
            {first.weight_kg > last.weight_kg ? ' نزول' : ' زيادة'} · الخصر {fmt(last.waist_cm - first.waist_cm)} سم · الدهون {fmt((last.body_fat_pct ?? 0) - (first.body_fat_pct ?? 0))}٪
          </p>
        )}
      </DocSection>

      <DocSection title="ثالثاً: سجل الزيارات">
        {visits.length ? (
          <table>
            <thead><tr>{['#', 'التاريخ', 'النوع', 'السبب'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{visits.map((v, i) => <tr key={v.id}><td>{i + 1}</td><td>{shortDate(v.visit_date)}</td><td>{VISIT_TYPES[v.visit_type]?.label || v.visit_type}</td><td>{v.reason || '—'}</td></tr>)}</tbody>
          </table>
        ) : <p className="text-[11.5px] italic">لا زيارات.</p>}
      </DocSection>

      {activePlan && <DocSection title="رابعاً: البرنامج الغذائي الحالي">
        <p className="mb-1.5 text-[12px]"><b>{activePlan.title}</b> — {activePlan.start_date ? shortDate(activePlan.start_date) : ''}{activePlan.end_date ? ` إلى ${shortDate(activePlan.end_date)}` : ''}</p>
        <InfoGrid cols={4} items={[
          ['السعرات', activePlan.target_kcal ? `${fmt(activePlan.target_kcal, 0)} سعرة` : '—'],
          ['بروتين', activePlan.target_protein_g ? `${fmt(activePlan.target_protein_g)} غ` : '—'],
          ['كربوهيدرات', activePlan.target_carbs_g ? `${fmt(activePlan.target_carbs_g)} غ` : '—'],
          ['دهون', activePlan.target_fat_g ? `${fmt(activePlan.target_fat_g)} غ` : '—'],
        ]} />
        <table className="mt-2">
          <thead><tr>{['الوجبة', 'التوقيت', 'الأصناف', 'الكمية', 'سعرات', 'بروتين', 'كربو', 'دهون'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{(activePlan.meals || []).map((m) => (
            <tr key={m.id}><td className="font-bold">{__t(m.slot)}</td><td>{m.slot_time || '—'}</td><td>{m.items || m.title || '—'}</td><td>{m.portions || '—'}</td>
              <td>{fmt(m.kcal, 0)}</td><td>{fmt(m.protein_g)}</td><td>{fmt(m.carbs_g)}</td><td>{fmt(m.fat_g)}</td></tr>
          ))}</tbody>
        </table>
        {activePlan.advice && <p className="mt-2 text-[11.5px]"><b>تعليمات: </b>{activePlan.advice}</p>}
      </DocSection>}

      <DocSection title="خامساً: المواعيد والمدفوعات">
        <table className="mb-2">
          <thead><tr>{['التاريخ', 'الوقت', 'النوع', 'الحالة'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{appointments.slice(0, 14).map((a) => (
            <tr key={a.id}><td>{shortDate(a.date)}</td><td>{a.time}</td><td>{VISIT_TYPES[a.visit_type]?.label}</td>
              <td>{({ scheduled: 'مجدول', confirmed: 'مؤكد', done: 'تمت', cancelled: 'ملغي', no_show: 'لم يحضر' })[a.status]}</td></tr>
          ))}</tbody>
        </table>
        <table>
          <thead><tr>{['التاريخ', 'الخدمة', 'المبلغ', 'الطريقة', 'فاتورة'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{payments.slice(0, 14).map((x) => (
            <tr key={x.id} style={x.voided ? { opacity: 0.45, textDecoration: 'line-through' } : {}}>
              <td>{shortDate(x.paid_on)}</td><td>{x.service}</td><td className="tnum">{money(x.amount, x.currency)}</td>
              <td>{PAY_METHODS[x.method] || x.method}</td><td>{x.invoice_no || '—'}</td></tr>
          ))}</tbody>
        </table>
        <p className="mt-2 text-[12px] font-extrabold">إجمالي المسدد: {money(totals.paid ?? valid.reduce((s, x) => s + x.amount, 0), 'SDG')}</p>
      </DocSection>
      <DocFooter clinic={clinic} />
    </article>
  );
}

/* ====== ورقة البرنامج الغذائي للمريض ====== */
export function PlanDoc({ plan, patient, clinic, measurements }) {
  const first = measurements?.[0], last = measurements?.at(-1);
  const totals = plan.totals || {};
  return (
    <article dir="rtl">
      <DocHeader clinic={clinic} patient={patient} title={`البرنامج الغذائي — ${patient.full_name}`} subtitle={plan.title} />
      <DocSection>
        <InfoGrid items={[
          ['الطول', patient.height_cm ? `${fmt(patient.height_cm)} سم` : null],
          ['الوزن الحالي', last?.weight_kg ? `${fmt(last.weight_kg)} كغ` : (patient.start_weight ? `${fmt(patient.start_weight)} كغ` : '—')],
          ['الهدف', patient.goal_weight ? `${fmt(patient.goal_weight)} كغ` : '—'],
          ['BMI', last?.bmi ? fmt(last.bmi) : null],
          ['السعرات اليومية', plan.target_kcal ? `${fmt(plan.target_kcal, 0)} سعرة` : '—'],
          ['بروتين', plan.target_protein_g ? `${fmt(plan.target_protein_g)} غ` : '—'],
          ['كربوهيدرات', plan.target_carbs_g ? `${fmt(plan.target_carbs_g)} غ` : '—'],
          ['دهون', plan.target_fat_g ? `${fmt(plan.target_fat_g)} غ` : '—'],
        ]} />
        {first && last && first.weight_kg && last.weight_kg && (
          <p className="mt-2 text-[11.5px] font-bold">قطع المشوار: {fmt(first.weight_kg - last.weight_kg)} كغ من أصل {fmt((patient.start_weight || 0) - (patient.goal_weight || 0))} كغ.</p>
        )}
      </DocSection>

      {(() => {
        // الخطة الأسبوعية: جدول لكل يوم («كل يوم» تُضاف لكل الأيام) بمجموعه؛ وإلا جدول واحد
        const every = plan.meals.filter((m) => m.day_of_week === null || m.day_of_week === undefined);
        const days = DAYS.map((name, d) => ({ name, d, meals: [...every, ...plan.meals.filter((m) => m.day_of_week === d)] }))
          .filter((x) => plan.meals.some((m) => m.day_of_week === x.d));
        const groups = days.length ? days : [{ name: 'الوجبات اليومية', d: null, meals: plan.meals }];
        const sumOf = (ms) => ms.reduce((t, m) => ({ kcal: t.kcal + (m.kcal || 0), protein_g: t.protein_g + (m.protein_g || 0), carbs_g: t.carbs_g + (m.carbs_g || 0), fat_g: t.fat_g + (m.fat_g || 0) }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
        return groups.map((g) => {
          const t = days.length ? sumOf(g.meals) : totals;
          return (
            <DocSection key={g.name} title={days.length ? `يوم ${g.name}` : g.name}>
              <table className="keep">
                <thead><tr>{['الوجبة', 'التوقيت', 'الأصناف', 'الكميات', 'سعرات', 'ب', 'ك', 'د'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {g.meals.map((m) => (
                    <tr key={`${g.name}-${m.id}`}>
                      <td className="font-bold">{__t(m.slot)}</td><td>{m.slot_time || '—'}</td>
                      <td>{m.title && m.items && m.title !== m.items ? <><b>{m.title}</b>: {m.items}</> : (m.items || m.title || '—')}</td><td>{m.portions || '—'}</td>
                      <td className="tnum">{fmt(m.kcal, 0)}</td><td className="tnum">{fmt(m.protein_g)}</td>
                      <td className="tnum">{fmt(m.carbs_g)}</td><td className="tnum">{fmt(m.fat_g)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="4" className="font-extrabold">المجموع اليومي</td>
                    <td className="tnum font-extrabold">{fmt(t.kcal, 0)}</td>
                    <td className="tnum font-extrabold">{fmt(t.protein_g)}</td>
                    <td className="tnum font-extrabold">{fmt(t.carbs_g)}</td>
                    <td className="tnum font-extrabold">{fmt(t.fat_g)}</td>
                  </tr>
                </tfoot>
              </table>
            </DocSection>
          );
        });
      })()}

      {plan.advice && <DocSection title="تعليمات والتزامات">
        <ul className="list-inside list-disc space-y-1 text-[12px]">
          {String(plan.advice).split(/[•·\n]|·/).map((s) => s.trim()).filter(Boolean).map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </DocSection>}

      <DocSection title="بدائل مسموحة">
        <table>
          <thead><tr>{['الفئة', 'البديل المكافئ'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{[
            ['نشويات', 'شريحة توست أسمر = 3 ملاعق أرز = ½ كوب مكرونة مسلوقة'],
            ['بروتين', '100غ صدر دجاج = 150غ سمك = 3 بيضات = كوب بقوليات'],
            ['ألبان', 'كوب زبادي طبيعي = شريحتا جبن قريش = كوب حليب قليل الدسم'],
            ['خضار', 'كوبخضار ورقية = حبتا خيار = كوب سلطة بدون مايونيز'],
            ['فاكهة', 'حبة وسط تفاح/برتقال = كوب فراولة = حبتا تمر (للدايت)'],
            ['دهون', 'ملعقة صغيرة زيت زيتون = 10 حبات زيتون = 15غ مكسرات'],
          ].map(([a, b]) => <tr key={a}><td className="font-bold">{a}</td><td>{b}</td></tr>)}</tbody>
        </table>
      </DocSection>
      <DocFooter clinic={clinic} />
    </article>
  );
}

/* ====== تقرير تطور الوزن ====== */
export function WeightReportDoc({ data, patient, clinic }) {
  const { rows = [], summary = {} } = data;
  return (
    <article dir="rtl">
      <DocHeader clinic={clinic} patient={patient} title="تقرير تطور الوزن والقياسات" subtitle={patient?.full_name} />
      <DocSection>
        <InfoGrid items={[
          ['وزن البداية', `${fmt(summary.start_weight)} كغ`], ['الوزن الحالي', `${fmt(summary.current_weight)} كغ`],
          ['إجمالي النزول', `${fmt(summary.total_loss)} كغ`], ['تغير الخصر', `${fmt(summary.waist_change)} سم`],
          ['تغير الدهون', `${fmt(summary.fat_change)} ٪`], ['عدد القياسات', summary.measurements],
          ['من تاريخ', shortDate(summary.first_date)], ['إلى تاريخ', shortDate(summary.last_date)],
        ]} />
      </DocSection>
      <DocSection title="التفصيل">
        <table>
          <thead><tr>{['#', 'التاريخ', 'الوزن', 'النزول من البداية', 'الفارق عن السابق', 'BMI', 'الخصر', 'الدهون %', 'أسابيع'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={`${r.measured_on}-${r.seq}`}>
              <td>{r.seq}</td><td>{shortDate(r.measured_on)}</td><td className="tnum">{fmt(r.weight_kg)}</td>
              <td className="tnum">{fmt(r.loss_vs_start)}</td><td className="tnum">{fmt(r.loss_vs_prev)}</td>
              <td className="tnum">{fmt(r.bmi)}</td><td className="tnum">{fmt(r.waist_cm)}</td>
              <td className="tnum">{fmt(r.body_fat_pct)}</td><td className="tnum">{fmt(r.weeks_since_start, 0)}</td>
            </tr>))}
          </tbody>
        </table>
      </DocSection>
      <DocFooter clinic={clinic} />
    </article>
  );
}

/* ====== تقرير إداري (زيارات/إيرادات) ====== */
export function VisitsReportDoc({ data, clinic }) {
  return (
    <article dir="rtl">
      <DocHeader clinic={clinic} title="تقرير الزيارات" subtitle={`من ${shortDate(data.from)} إلى ${shortDate(data.to)}`} />
      <DocSection>
        <InfoGrid cols={4} items={[['إجمالي الزيارات', data.count], ['مرضى متميزون', data.unique_patients],
          ...Object.entries(data.by_type || {}).map(([k, v]) => [VISIT_TYPES[k]?.label || k, v])]} />
      </DocSection>
      <DocSection title="الشهرية">
        <table><thead><tr><th>الشهر</th><th>عدد الزيارات</th></tr></thead>
          <tbody>{(data.by_month || []).map((m) => <tr key={m.month}><td>{m.month}</td><td className="tnum">{m.n}</td></tr>)}</tbody></table>
      </DocSection>
      <DocSection title="التفصيل">
        <table><thead><tr>{['التاريخ', 'المريض', 'الملف', 'النوع', 'الموظف'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{(data.rows || []).slice(0, 120).map((r, i) => (
            <tr key={i}><td>{shortDate(r.date)}</td><td>{r.patient_name}</td><td>{r.file_no}</td>
              <td>{VISIT_TYPES[r.visit_type]?.label || r.visit_type}</td><td>{r.staff_name || '—'}</td></tr>
          ))}</tbody></table>
      </DocSection>
      <DocFooter clinic={clinic} />
    </article>
  );
}

export function RevenueReportDoc({ data, clinic }) {
  return (
    <article dir="rtl">
      <DocHeader clinic={clinic} title="تقرير الإيرادات" subtitle={`من ${shortDate(data.from)} إلى ${shortDate(data.to)}`} />
      <DocSection>
        <InfoGrid cols={4} items={[
          ['إجمالي الإيراد', money(data.gross, data.currency)], ['عدد العمليات', data.count],
          ['متوسط العملية', money(data.average, data.currency)], ['عمليات ملغاة', data.voided_count],
        ]} />
      </DocSection>
      <DocSection title="حسب الخدمة">
        <table><thead><tr><th>الخدمة</th><th>الإيراد</th><th>عدد</th></tr></thead>
          <tbody>{(data.by_service || []).map((r) => <tr key={r.key}><td>{r.key}</td><td className="tnum">{money(r.total, data.currency)}</td><td className="tnum">{r.n}</td></tr>)}</tbody></table>
      </DocSection>
      <DocSection title="حسب طريقة الدفع">
        <table><thead><tr><th>الطريقة</th><th>الإيراد</th><th>عدد</th></tr></thead>
          <tbody>
            {(data.by_method || []).map((r) => (
              <tr key={r.key}><td>{PAY_METHODS[r.key] || r.key}</td><td className="tnum">{money(r.total, data.currency)}</td><td className="tnum">{r.n}</td></tr>
            ))}
          </tbody></table>
      </DocSection>
      <DocSection title="أعلى المرضى تسديداً">
        <table><thead><tr><th>المريض</th><th>الإجمالي</th></tr></thead>
          <tbody>{(data.top_patients || []).map((r, i) => <tr key={i}><td>{r.name}</td><td className="tnum">{money(r.total, data.currency)}</td></tr>)}</tbody></table>
      </DocSection>
      <DocFooter clinic={clinic} />
    </article>
  );
}
