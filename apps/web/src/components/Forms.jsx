import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.jsx';
import { Field, Icon, Input, Modal, Select, Textarea } from './ui.jsx';
import { MEAL_SLOTS, PAY_METHODS, VISIT_TYPES, fmt, todayISO } from '../format.js';
import { AdherencePicker, DAYS, VoiceNoteButton, appendText, todayDow } from './Smart.jsx';
import { DIET_TEMPLATES, MEAL_TEMPLATES } from '../templates.js';
import { currentLang } from '../i18n.js';

const toNumOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const previewBmi = (w, h) => (!w || !h ? null : Math.round((w / (h / 100) ** 2) * 10) / 10);

/* ============================ تسجيل القياسات ============================ */
const MEAS_KEYS = ['weight_kg', 'height_cm', 'waist_cm', 'chest_cm', 'hip_cm', 'body_fat_pct'];

const MEAS_EMPTY = {
  measured_on: '', visit_id: '', weight_kg: '', height_cm: '', waist_cm: '', chest_cm: '', hip_cm: '',
  body_fat_pct: '', notes: '', createVisit: true, visit_type: 'followup',
};

export function MeasurementForm({ open, onClose, patient, visitId = null, defaultDate, measurement, onSaved }) {
  const { run, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(MEAS_EMPTY);
  const [visits, setVisits] = useState([]);

  useEffect(() => {
    if (!open) return;
    if (measurement) {
      setForm({
        ...MEAS_EMPTY, createVisit: false,
        measured_on: measurement.measured_on, visit_id: measurement.visit_id || '',
        ...Object.fromEntries(MEAS_KEYS.map((k) => [k, measurement[k] ?? ''])),
        notes: measurement.notes || '', visit_type: measurement.visit_type || 'followup',
        adherence: null, adherence_notes: '', _adhOrig: null,
      });
      if (measurement.visit_id) {
        api.get(`/visits?patient_id=${patient.id}`).then((r) => {
          setVisits(r.items || []);
          const v = (r.items || []).find((x) => x.id === measurement.visit_id);
          if (v) setForm((f) => ({ ...f, adherence: v.adherence ?? null, adherence_notes: v.adherence_notes || '', _adhOrig: v.adherence ?? null }));
        }).catch(() => {});
      }
      return;
    }
    setForm({
      ...MEAS_EMPTY,
      measured_on: defaultDate || todayISO(),
      visit_id: visitId || '',
      weight_kg: '', height_cm: patient?.height_cm ?? '', waist_cm: '', chest_cm: '', hip_cm: '', body_fat_pct: '',
      notes: '', createVisit: true, visit_type: 'followup', adherence: null, adherence_notes: '', _adhOrig: null,
    });
    api.get(`/visits?patient_id=${patient.id}`).then((r) => setVisits(r.items || [])).catch(() => setVisits([]));
  }, [open, patient, visitId, defaultDate, measurement]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const bmi = useMemo(() => previewBmi(Number(form.weight_kg), Number(form.height_cm)), [form.weight_kg, form.height_cm]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.weight_kg) { toast('الوزن مطلوب لتسجيل الزيارة', 'warn'); return; }
    setBusy(true);
    try {
      if (measurement?.id) {
        await run(() => api.put(`/measurements/${measurement.id}`, {
          measured_on: form.measured_on, visit_id: form.visit_id ? Number(form.visit_id) : null,
          ...Object.fromEntries(MEAS_KEYS.map((k) => [k, toNumOrNull(form[k])])), notes: form.notes || null,
        }), { ok: 'تم تحديث القياسات' });
        if (form.visit_id && (form.adherence !== form._adhOrig || form.adherence_notes)) {
          await api.put(`/visits/${form.visit_id}`, { adherence: form.adherence, adherence_notes: form.adherence_notes || null }).catch(() => {});
        }
        onSaved?.(); onClose(); return;
      }
      await run(async () => {
        let vid = form.visit_id ? Number(form.visit_id) : null;
        if (!vid && form.createVisit) {
          const v = await api.post('/visits', {
            patient_id: patient.id, visit_date: form.measured_on, visit_type: form.visit_type, reason: form.notes?.slice(0, 200) || null,
            adherence: form.adherence, adherence_notes: form.adherence_notes || null,
          });
          vid = v.id;
        } else if (vid && form.adherence !== null) {
          await api.put(`/visits/${vid}`, { adherence: form.adherence, adherence_notes: form.adherence_notes || null });
        }
        return api.post('/measurements', {
          patient_id: patient.id, visit_id: vid, measured_on: form.measured_on,
          ...Object.fromEntries(MEAS_KEYS.map((k) => [k, toNumOrNull(form[k])])),
          notes: form.notes || null,
        });
      }, { ok: 'تم تسجيل قياسات الزيارة ✓' });
      onSaved?.();
      onClose();
    } catch { /* التنبيه ظاهر */ } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="تسجيل قياسات زيارة" icon={<Icon.scale />}
      subtitle={`${patient?.full_name || ''} · ${patient?.file_no || ''}`}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button form="meas-form" className="btn-primary" disabled={busy || !form.weight_kg}>{busy ? 'جارٍ الحفظ…' : <><Icon.check /> حفظ القياسات</>}</button></>}>
      <form id="meas-form" onSubmit={submit} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاريخ القياس"><Input type="date" value={form.measured_on} onChange={set('measured_on')} /></Field>
          <Field label="ربط بزيارة" hint="أو اتركها لتُنشأ زيارة جديدة تلقائياً">
            <Select value={form.visit_id} onChange={set('visit_id')} placeholder="— زيارة جديدة —">
              {visits.map((v) => <option key={v.id} value={v.id}>{v.visit_date} · {VISIT_TYPES[v.visit_type]?.label || v.visit_type}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="الوزن (كغ)" required><Input type="number" step="0.1" autoFocus value={form.weight_kg} onChange={set('weight_kg')} placeholder="81.5" className="text-[16px] font-extrabold" /></Field>
          <Field label="الطول (سم)"><Input type="number" step="0.1" value={form.height_cm} onChange={set('height_cm')} /></Field>
          <Field label="نسبة الدهون %"><Input type="number" step="0.1" value={form.body_fat_pct} onChange={set('body_fat_pct')} /></Field>
          <Field label="محيط الخصر (سم)"><Input type="number" step="0.1" value={form.waist_cm} onChange={set('waist_cm')} /></Field>
          <Field label="محيط الصدر (سم)"><Input type="number" step="0.1" value={form.chest_cm} onChange={set('chest_cm')} /></Field>
          <Field label="محيط الورك (سم)"><Input type="number" step="0.1" value={form.hip_cm} onChange={set('hip_cm')} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-brand-200 bg-brand-50/60 px-3.5 py-2.5">
          <p className="text-[12.5px] font-bold text-brand-800">
            BMI المتوقع: <span className="tnum text-[15px] font-extrabold">{fmt(bmi)}</span>
            <span className="ms-1 text-[11px] font-bold text-brand-700/70">(يُحسب في الخادم عند الحفظ)</span>
          </p>
          <label className="ms-auto flex items-center gap-2 text-[12.5px] font-bold text-ink/60">
            <input type="checkbox" checked={form.createVisit} onChange={(e) => set('createVisit')(e.target.checked)} className="h-4 w-4 accent-brand-600" disabled={!!form.visit_id} />
            إنشاء زيارة مرتبطة
          </label>
          {!form.visit_id && <Select value={form.visit_type} onChange={set('visit_type')} className="!w-auto !py-1.5 text-[12.5px]">
            {Object.entries(VISIT_TYPES).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
          </Select>}
        </div>
        {(form.createVisit || form.visit_id) && (
          <AdherencePicker value={form.adherence} onChange={(v) => setForm((f) => ({ ...f, adherence: v }))}
            note={form.adherence_notes} onNote={(v) => setForm((f) => ({ ...f, adherence_notes: v }))} />
        )}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="label !mb-0">ملاحظات الزيارة</span>
            <VoiceNoteButton onText={(t) => setForm((f) => ({ ...f, notes: appendText(f.notes, t) }))} />
          </div>
          <Textarea value={form.notes} onChange={set('notes')} placeholder="الالتزام، الشهية، النوم، الحركة، الدورة الشهرية، أي شكوى…" />
        </div>
      </form>
    </Modal>
  );
}

/* ============================ المواعيد ============================ */
const APPT_EMPTY = { patient_id: '', date: '', time: '', duration_min: 30, visit_type: 'followup', status: 'scheduled', notes: '' };

export function AppointmentForm({ open, onClose, patient, defaultDate, appointment, onSaved }) {
  const { run, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(APPT_EMPTY);
  const [patients, setPatients] = useState([]);
  const standalone = !patient;

  useEffect(() => {
    if (!open) return;
    setForm(appointment ? {
      patient_id: appointment.patient_id || '', date: appointment.date, time: appointment.time,
      duration_min: appointment.duration_min ?? 30, visit_type: appointment.visit_type || 'followup',
      status: appointment.status || 'scheduled', notes: appointment.notes || '', mode: appointment.mode || 'in_person',
    } : {
      patient_id: patient?.id || '', date: defaultDate || todayISO(), time: '10:00', duration_min: 30,
      visit_type: 'followup', status: 'scheduled', notes: '', mode: 'in_person',
    });
    if (standalone) api.get('/patients?status=active&limit=300').then((r) => setPatients(r.items || [])).catch(() => {});
  }, [open, appointment, patient, defaultDate, standalone]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = { ...form, patient_id: Number(form.patient_id), duration_min: Number(form.duration_min) };
    try {
      const r = await run(() => appointment?.id ? api.put(`/appointments/${appointment.id}`, body) : api.post('/appointments', body),
        { ok: appointment?.id ? 'تم تحديث الموعد' : 'تم تسجيل الموعد ✓' });
      if (r?.waitlist?.offered) toast(`الموعد الشاغر عُرض تلقائياً على ${r.waitlist.offered} من قائمة الانتظار 🔔`, 'good', 6000);
      onSaved?.(r); onClose();
    } catch { /* toast shown */ } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={appointment?.id ? 'تعديل موعد' : 'موعد جديد'} icon={<Icon.cal />}
      subtitle={patient ? `${patient.full_name} · ${patient.file_no}` : 'اختر المريض والوقت'}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button form="appt-form" className="btn-primary" disabled={busy || !form.patient_id || !form.date || !form.time}>
          {busy ? 'جارٍ الحفظ…' : <><Icon.check /> حفظ الموعد</>}</button></>}>
      <form id="appt-form" onSubmit={submit} className="grid gap-4">
        {standalone && (
          <Field label="المريض">
            <Select value={form.patient_id} onChange={set('patient_id')} placeholder="— اختر مريضاً —" className="!text-[14px]">
              {patients.map((p) => <option key={p.id} value={p.id}>{p.file_no} · {p.full_name}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="التاريخ"><Input type="date" value={form.date} onChange={set('date')} /></Field>
          <Field label="الساعة"><Input type="time" step="300" value={form.time} onChange={set('time')} /></Field>
          <Field label="المدة (دقيقة)"><Select value={form.duration_min} onChange={set('duration_min')}>
            {[15, 20, 30, 45, 60].map((d) => <option key={d} value={d}>{d}</option>)}
          </Select></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="نوع الزيارة"><Select value={form.visit_type} onChange={set('visit_type')}>
            {Object.entries(VISIT_TYPES).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
          </Select></Field>
          <Field label="حالة الموعد"><Select value={form.status} onChange={set('status')}>
            <option value="scheduled">مجدول</option><option value="confirmed">مؤكد</option><option value="done">تمت</option>
            <option value="cancelled">ملغي</option><option value="no_show">لم يحضر</option>
          </Select></Field>
        </div>
        <Field label="طريقة الزيارة">
          <div className="flex gap-1 rounded-xl border border-line bg-sand p-1">
            {[['in_person', '🏥 حضوري'], ['video', '🎥 استشارة مرئية']].map(([k, l]) => (
              <button type="button" key={k} onClick={() => setForm((f) => ({ ...f, mode: k }))}
                className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-bold ${form.mode === k ? 'bg-surface text-brand-700 shadow-card' : 'text-ink/50'}`}>{l}</button>
            ))}
          </div>
        </Field>
        <Field label="ملاحظات"><Textarea value={form.notes} onChange={set('notes')} className="min-h-[64px]" placeholder="طلب تقرير، تغيير وقت، مراجعة تحاليل…" /></Field>
      </form>
    </Modal>
  );
}

/* ============================ المدفوعات ============================ */
const PAY_EMPTY = { patient_id: '', paid_on: '', service: '', amount: '', method: 'cash', invoice_no: '', note: '' };

export function PaymentForm({ open, onClose, patient, defaultDate, payment, onSaved }) {
  const { run } = useApp();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(PAY_EMPTY);
  const [patients, setPatients] = useState([]);
  const standalone = !patient;

  useEffect(() => {
    if (!open) return;
    setForm(payment ? {
      patient_id: payment.patient_id, paid_on: payment.paid_on, service: payment.service, amount: payment.amount,
      method: payment.method || 'cash', invoice_no: payment.invoice_no || '', note: payment.note || '',
    } : {
      patient_id: patient?.id || '', paid_on: defaultDate || todayISO(), service: 'متابعة أسبوعية', amount: '',
      method: 'cash', invoice_no: `INV-${Date.now().toString().slice(-6)}`, note: '',
    });
    if (standalone) api.get('/patients?status=active&limit=300').then((r) => setPatients(r.items || [])).catch(() => {});
  }, [open, payment, patient, defaultDate, standalone]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await run(() => payment?.id
        ? api.put(`/payments/${payment.id}`, { ...form, amount: Number(form.amount) })
        : api.post('/payments', { ...form, amount: Number(form.amount) }), { ok: 'تم تسجيل الدفعة ✓' });
      onSaved?.(); onClose();
    } catch { /* toast */ } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={payment?.id ? 'تعديل دفعة' : 'تسجيل دفعة'} icon={<Icon.wallet />} size="sm"
      subtitle={patient ? `${patient.full_name} · ${patient.file_no}` : undefined}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button form="pay-form" className="btn-primary" disabled={busy || !form.patient_id || !Number(form.amount)}>
          {busy ? 'جارٍ…' : <><Icon.check /> حفظ</>}</button></>}>
      <form id="pay-form" onSubmit={submit} className="grid gap-3.5">
        {standalone && (
          <Field label="المريض"><Select value={form.patient_id} onChange={set('patient_id')} placeholder="— اختر مريضاً —">
            {patients.map((p) => <option key={p.id} value={p.id}>{p.file_no} · {p.full_name}</option>)}
          </Select></Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="المبلغ"><Input type="number" step="0.01" autoFocus value={form.amount} onChange={set('amount')} placeholder="800" className="text-[16px] font-extrabold" /></Field>
          <Field label="تاريخ الدفع"><Input type="date" value={form.paid_on} onChange={set('paid_on')} /></Field>
        </div>
        <Field label="نوع الخدمة"><Input value={form.service} onChange={set('service')} placeholder="استشارة أولى / متابعة / برنامج غذائي" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="طريقة الدفع"><Select value={form.method} onChange={set('method')}>
            {Object.entries(PAY_METHODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select></Field>
          <Field label="رقم الفاتورة"><Input value={form.invoice_no} onChange={set('invoice_no')} /></Field>
        </div>
        <Field label="ملاحظة"><Input value={form.note} onChange={set('note')} placeholder="اختياري" /></Field>
      </form>
    </Modal>
  );
}

/* ============================ محرر البرنامج الغذائي ============================ */
const emptyMeal = (slot, i) => ({ slot, slot_time: ['08:00', '11:00', '14:00', '17:00', '20:00'][i] || '', title: '', items: '', portions: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '' });

export function PlanEditor({ open, onClose, patient, plan, onSaved }) {
  const { run, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState({
    title: '', start_date: '', end_date: '', target_kcal: '', target_protein_g: '', target_carbs_g: '',
    target_fat_g: '', advice: '', status: 'draft',
  });
  const [meals, setMeals] = useState([]);
  const [foods, setFoods] = useState([]);
  const [dayView, setDayView] = useState('all'); // all | every | 0..6
  const [undo, setUndo] = useState(null); // لقطة قبل تطبيق قالب كامل

  useEffect(() => {
    if (!open) return;
    setMeta(plan ? {
      title: plan.title, start_date: plan.start_date || todayISO(), end_date: plan.end_date || '',
      target_kcal: plan.target_kcal ?? '', target_protein_g: plan.target_protein_g ?? '', target_carbs_g: plan.target_carbs_g ?? '',
      target_fat_g: plan.target_fat_g ?? '', advice: plan.advice || '', status: plan.status,
    } : {
      title: 'برنامج غذائي جديد', start_date: todayISO(), end_date: '', target_kcal: 1800, target_protein_g: 120,
      target_carbs_g: 170, target_fat_g: 55, advice: 'شرب 2–3 لتر ماء يومياً · النوم 7 ساعات · لا حذف للوجبات.', status: 'draft',
    });
    setMeals(plan?.meals?.length
      ? plan.meals.map((m) => ({
        ...m,
        ...Object.fromEntries(['kcal', 'protein_g', 'carbs_g', 'fat_g'].map((k) => [k, m[k] ?? ''])),
        slot_time: m.slot_time ?? '', title: m.title ?? '', items: m.items ?? '', portions: m.portions ?? '',
        day_of_week: m.day_of_week ?? '',
      }))
      : MEAL_SLOTS.slice(0, 5).map(emptyMeal));
    setFoods([]);
    setUndo(null);
    setDayView(plan?.meals?.some((m) => m.day_of_week !== null && m.day_of_week !== undefined) ? String(todayDow()) : 'all');
  }, [open, plan]);

  // الخطة الأسبوعية: المجموع ليوم واحد («كل يوم» + وجبات اليوم المختار)، أو متوسط الأيام في عرض «الكل»
  const weekly = meals.some((m) => m.day_of_week !== '' && m.day_of_week !== null && m.day_of_week !== undefined);
  const sum = (list) => list.reduce((t, m) => ({
    kcal: t.kcal + (Number(m.kcal) || 0), protein_g: t.protein_g + (Number(m.protein_g) || 0),
    carbs_g: t.carbs_g + (Number(m.carbs_g) || 0), fat_g: t.fat_g + (Number(m.fat_g) || 0),
  }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  const isEvery = (m) => m.day_of_week === '' || m.day_of_week === null || m.day_of_week === undefined;
  const totals = useMemo(() => {
    if (!weekly) return sum(meals);
    const every = meals.filter(isEvery);
    if (dayView !== 'all' && dayView !== 'every') return sum([...every, ...meals.filter((m) => String(m.day_of_week) === dayView)]);
    const used = [...new Set(meals.filter((m) => !isEvery(m)).map((m) => String(m.day_of_week)))];
    const per = used.map((d) => sum([...every, ...meals.filter((m) => String(m.day_of_week) === d)]));
    const avg = (k) => per.reduce((t, x) => t + x[k], 0) / (per.length || 1);
    return { kcal: avg('kcal'), protein_g: avg('protein_g'), carbs_g: avg('carbs_g'), fat_g: avg('fat_g') };
  }, [meals, weekly, dayView]); // eslint-disable-line
  const visible = meals.map((m, i) => [m, i]).filter(([m]) => dayView === 'all' || (dayView === 'every' ? isEvery(m) : (isEvery(m) || String(m.day_of_week) === dayView)));
  const dayCounts = DAYS.map((_, d) => meals.filter((m) => String(m.day_of_week) === String(d)).length);

  const setM = (i, k) => (e) => {
    const v = e?.target ? e.target.value : e;
    setMeals((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  };
  const lookup = async (q) => {
    const r = await api.get(`/diet-plans/foods/lookup?q=${encodeURIComponent(q)}`);
    setFoods(r.items || []);
  };
  const applyFood = (i, f) => {
    setMeals((ms) => ms.map((m, j) => (j === i ? {
      ...m, kcal: (Number(m.kcal) || 0) + f.kcal, protein_g: round1((Number(m.protein_g) || 0) + f.p),
      carbs_g: round1((Number(m.carbs_g) || 0) + f.c), fat_g: round1((Number(m.fat_g) || 0) + f.f),
      items: [m.items, f.name].filter(Boolean).join(' + '), portions: [m.portions, `${f.g}غ`].filter(Boolean).join(' / '),
    } : m)));
    toast(`أُضيف ${f.name} للوجبة`, 'good', 1800);
  };

  // ---- قوالب جاهزة (من نسخة AI Studio) + تنبيه الحساسية ----
  const risky = useMemo(() => allergyTerms(patient), [patient]);
  const conflictsOf = (m) => risky.filter((t) => `${m.title || ''} ${m.items || ''}`.includes(t));
  const conflicts = [...new Set(meals.flatMap(conflictsOf))];
  const toRow = (t, i) => ({
    ...emptyMeal(t.slot, i), slot_time: t.slot_time, title: t.title, items: t.items, portions: t.portions,
    kcal: t.kcal, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g,
  });
  const applyDiet = (d) => {
    setUndo({ meta, meals, dayView });
    setMeta((mt) => ({
      ...mt, title: tName(d), target_kcal: d.target_kcal, target_protein_g: d.target_protein_g,
      target_carbs_g: d.target_carbs_g, target_fat_g: d.target_fat_g, advice: d.advice,
    }));
    setMeals(d.meals.map(toRow));
    setDayView('all');
    toast(`طُبّق قالب «${tName(d)}» — عدّل ما تريد ثم احفظ`, 'good', 2600);
  };
  const addMealTemplate = (t) => {
    setMeals((ms) => [...ms, { ...toRow(t, ms.length), day_of_week: /^\d$/.test(dayView) ? dayView : '' }]);
    toast(`أُضيفت وجبة «${tName(t)}»`, 'good', 1800);
  };
  const undoTemplate = () => { if (!undo) return; setMeta(undo.meta); setMeals(undo.meals); setDayView(undo.dayView); setUndo(null); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = {
      ...meta, patient_id: patient.id,
      target_kcal: toNumOrNull(meta.target_kcal), target_protein_g: toNumOrNull(meta.target_protein_g),
      target_carbs_g: toNumOrNull(meta.target_carbs_g), target_fat_g: toNumOrNull(meta.target_fat_g),
      meals: meals.map((m, i) => ({
        slot: m.slot, slot_time: m.slot_time || null, title: m.title || null, items: m.items || null,
        portions: m.portions || null, kcal: toNumOrNull(m.kcal), protein_g: toNumOrNull(m.protein_g),
        carbs_g: toNumOrNull(m.carbs_g), fat_g: toNumOrNull(m.fat_g), position: i,
        day_of_week: isEvery(m) ? null : Number(m.day_of_week),
      })),
    };
    try {
      await run(() => plan?.id ? api.put(`/diet-plans/${plan.id}`, body) : api.post('/diet-plans', body),
        { ok: 'تم حفظ البرنامج الغذائي' });
      onSaved?.(); onClose();
    } catch { /* toast */ } finally { setBusy(false); }
  };

  const rows = [
    ['السعرات', 'kcal', ''], ['بروتين', 'protein_g', 'غ'], ['كربوهيدرات', 'carbs_g', 'غ'], ['دهون', 'fat_g', 'غ'],
  ];
  const inputs = ['target_kcal', 'target_protein_g', 'target_carbs_g', 'target_fat_g'];

  return (
    <Modal open={open} onClose={onClose} size="xl" icon={<Icon.meal />}
      title={plan?.id ? 'تعديل البرنامج الغذائي' : 'برنامج غذائي جديد'}
      subtitle={`${patient?.full_name} · ${patient?.file_no} — المجاميع تُحسب تلقائياً`}
      footer={<>
        <span className="me-auto flex items-center gap-2 text-[12px] font-bold text-ink/55">
          {weekly ? (dayView === 'all' || dayView === 'every' ? 'متوسط اليوم:' : `مجموع ${DAYS[Number(dayView)]}:`) : 'المجموع:'} <b className="tnum text-brand-700">{fmt(totals.kcal, 0)}</b> سعرة ·
          ب {fmt(totals.protein_g)} · ك {fmt(totals.carbs_g)} · د {fmt(totals.fat_g)} غ
        </span>
        <button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button form="plan-form" className="btn-primary" disabled={busy || !meta.title}>{busy ? 'جارٍ الحفظ…' : <><Icon.check /> حفظ البرنامج</>}</button>
      </>}>
      <form id="plan-form" onSubmit={submit} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="عنوان البرنامج" className="sm:col-span-2"><Input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></Field>
          <Field label="يبدأ"><Input type="date" value={meta.start_date} onChange={(e) => setMeta({ ...meta, start_date: e.target.value })} /></Field>
          <Field label="ينتهي"><Input type="date" value={meta.end_date} onChange={(e) => setMeta({ ...meta, end_date: e.target.value })} /></Field>
        </div>

        {(risky.length > 0) && (
          <div data-allergy-alert={conflicts.length ? 'conflict' : 'info'}
            className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px] font-bold ${conflicts.length ? 'border-clay-100 bg-clay-50 text-clay-600' : 'border-sun-100 bg-sun-50 text-sun-600'}`}>
            <span>⚠</span>
            {conflicts.length
              ? <span>{`تنبيه: البرنامج يحتوي أصنافاً ممنوعة على المريض: ${conflicts.join('، ')}`}</span>
              : <span>{`حساسية / ممنوعات المريض: ${risky.join('، ')}`}</span>}
          </div>
        )}

        <details className="rounded-xl border border-brand-200 bg-brand-50/60 p-3" data-templates>
          <summary className="cursor-pointer text-[13px] font-extrabold text-brand-700">📋 قوالب جاهزة — برنامج كامل أو وجبة بضغطة</summary>
          <div className="mt-3 grid gap-3">
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-[12px] font-extrabold text-ink/55">
                برامج كاملة (تستبدل الوجبات الحالية)
                {undo && <button type="button" className="btn-ghost btn-sm" onClick={undoTemplate} data-undo-template>↶ تراجع</button>}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {DIET_TEMPLATES.map((d) => (
                  <button type="button" key={d.id} data-diet-template={d.id} onClick={() => applyDiet(d)}
                    className="rounded-xl border border-line bg-surface p-2.5 text-start shadow-card transition hover:border-brand-300 hover:bg-brand-50">
                    <div className="text-[12.5px] font-extrabold leading-5">{tName(d)}</div>
                    <div className="tnum mt-1 text-[11px] font-bold text-ink/50">
                      {`${d.meals.length} وجبات · ب ${fmt(d.target_protein_g, 0)} · ك ${fmt(d.target_carbs_g, 0)} · د ${fmt(d.target_fat_g, 0)} غ`}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[12px] font-extrabold text-ink/55">وجبات جاهزة (تُضاف إلى البرنامج)</div>
              <div className="flex flex-wrap gap-1.5">
                {MEAL_TEMPLATES.map((t) => {
                  const bad = conflictsOf(t).length > 0;
                  return (
                    <button type="button" key={t.id} data-meal-template={t.id} onClick={() => addMealTemplate(t)}
                      title={bad ? `يحتوي: ${conflictsOf(t).join('، ')}` : t.portions}
                      className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-bold transition ${bad ? 'border-clay-100 bg-clay-50 text-clay-600' : 'border-line bg-surface hover:border-brand-300 hover:bg-brand-50'}`}>
                      {bad && '⚠ '}<span className="text-ink/45">{__t(t.slot)} ·</span> {tName(t)} <span className="tnum text-ink/45">{t.kcal}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </details>

        <div className="grid gap-3 rounded-xl border border-line bg-sand/70 p-3 sm:grid-cols-4 lg:grid-cols-8">
          {rows.map(([label, key], idx) => {
            const goal = Number(meta[inputs[idx]] || 0) || 0;
            const got = Number(totals[key] || 0) || 0;
            const onTarget = goal === 0 || Math.abs(got - goal) <= Math.max(3, goal * 0.08);
            return (
              <React.Fragment key={key}>
                <Field label={`هدف ${label}`} className="lg:col-span-3">
                  <Input type="number" step="0.1" value={meta[inputs[idx]]} onChange={(e) => setMeta({ ...meta, [inputs[idx]]: e.target.value })} />
                </Field>
                <div className="flex flex-col justify-end pb-1 text-[11.5px] font-bold text-ink/45">
                  <span>
                    المحقق: <b className={`tnum text-[13px] ${onTarget ? 'text-leaf-600' : 'text-sun-600'}`}>{fmt(got, 0)}</b>
                    <span className="tnum ms-1 text-[10.5px]">{goal ? (onTarget ? '✓ مطابق' : `${got > goal ? '+' : '−'}${fmt(Math.abs(got - goal), 0)}`) : ''}</span>
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1" data-day-filter>
          <span className="me-1 text-[12px] font-extrabold text-ink/55">عرض:</span>
          {[['all', 'كل الوجبات'], ['every', 'كل يوم'], ...DAYS.map((d, i) => [String(i), d])].map(([k, l]) => (
            <button type="button" key={k} onClick={() => setDayView(k)}
              className={`rounded-lg px-2.5 py-1 text-[12px] font-bold transition ${dayView === k ? 'bg-brand-700 text-white' : 'bg-sand text-ink/60 hover:bg-brand-50'}`}>
              {l}{/^\d$/.test(k) && dayCounts[Number(k)] > 0 && <span className="tnum ms-1 opacity-70">{dayCounts[Number(k)]}</span>}
            </button>
          ))}
        </div>

        <div className="grid gap-2.5">
          {visible.map(([m, i]) => (
            <div key={i} className="grid gap-2.5 rounded-xl border border-line bg-surface p-3 shadow-card lg:grid-cols-[150px_88px_1fr_1fr_1fr_repeat(4,78px)_auto] lg:items-end">
              <div className="grid gap-1.5">
                <Field label="الوجبة"><Select value={m.slot} onChange={setM(i, 'slot')}>{!MEAL_SLOTS.includes(m.slot) && m.slot && <option value={m.slot}>{__t(m.slot)}</option>}{MEAL_SLOTS.map((s) => <option key={s} value={s}>{__t(s)}</option>)}</Select></Field>
                <Select value={m.day_of_week == null ? '' : String(m.day_of_week)} onChange={setM(i, 'day_of_week')} className="!py-1.5 text-[12px]" aria-label="اليوم">
                  <option value="">كل يوم</option>
                  {DAYS.map((d, di) => <option key={d} value={String(di)}>{d}</option>)}
                </Select>
              </div>
              <Field label="التوقيت"><Input type="time" step="300" value={m.slot_time} onChange={setM(i, 'slot_time')} /></Field>
              <Field label="اسم الطبق"><Input value={m.title || ''} onChange={setM(i, 'title')} placeholder="مثال: صدر دجاج مشوي مع أرز بني" /></Field>
              <Field label="الأصناف"><Input value={m.items || ''} onChange={setM(i, 'items')} placeholder="دجاج + أرز + سلطة" /></Field>
              <Field label="الكميات"><Input value={m.portions || ''} onChange={setM(i, 'portions')} placeholder="150غ / ¾ كوب / كوب" /></Field>
              {rows.map(([label, key]) => (
                <Field key={key} label={label}><Input type="number" step="0.1" value={m[key]} onChange={setM(i, key)} className="text-center tnum" /></Field>
              ))}
              <div className="flex flex-col gap-1.5 pb-1">
                <button type="button" title="حذف الوجبة" className="btn-danger btn-sm !px-2" onClick={() => setMeals((ms) => ms.filter((_, j) => j !== i))}><Icon.trash /></button>
                <button type="button" title="إضافة وجبة" className="btn-ghost btn-sm !px-2" onClick={() => setMeals((ms) => [...ms, { ...emptyMeal(MEAL_SLOTS[3], ms.length), day_of_week: /^\d$/.test(dayView) ? dayView : m.day_of_week ?? '' }])}><Icon.plus /></button>
              </div>
              <details className="lg:col-span-9">
                <summary className="cursor-pointer text-[11.5px] font-bold text-brand-700">إضافة من جدول الأغذية (تحسب السعرات والماكرو)</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Input placeholder="ابحث: أرز، دجاج، خبز…" onChange={(e) => lookup(e.target.value)} className="!w-56 !py-1.5 !text-[12.5px]" />
                  {foods.map((f) => (
                    <button type="button" key={f.name} onClick={() => applyFood(i, f)}
                      className="rounded-lg border border-line bg-sand px-2.5 py-1 text-[11.5px] font-bold hover:border-brand-300 hover:bg-brand-50">
                      {f.name} <span className="tnum text-ink/45">{f.kcal}</span>
                    </button>
                  ))}
                </div>
              </details>
            </div>
          ))}
          {!meals.length && <EmptyRow onAdd={() => setMeals(MEAL_SLOTS.slice(0, 5).map(emptyMeal))} />}
        </div>

        <Field label="تعليمات عامة للمريض"><Textarea value={meta.advice} onChange={(e) => setMeta({ ...meta, advice: e.target.value })} /></Field>
        <Field label="حالة البرنامج"><Select value={meta.status} onChange={(e) => setMeta({ ...meta, status: e.target.value })} className="!w-56">
          <option value="draft">مسودة</option><option value="active">معتمد (الحالي)</option><option value="archived">مؤرشف</option>
        </Select></Field>
      </form>
    </Modal>
  );
}

const EmptyRow = ({ onAdd }) => (
  <button type="button" onClick={onAdd} className="btn-ghost w-full border-dashed !py-6">
    <Icon.plus /> إضافة الوجبات الخمس الأساسية بضغطة واحدة
  </button>
);

const round1 = (n) => Math.round(n * 10) / 10;

/** اسم القالب حسب لغة الواجهة */
const tName = (t) => (currentLang() === 'en' && t.en ? t.en : t.name);

/** كلمات الحساسية والأطعمة الممنوعة من ملف المريض (مفصولة بفواصل أو أسطر) */
export function allergyTerms(patient) {
  return [...new Set([patient?.allergies, patient?.forbidden_foods].filter(Boolean).join('\n')
    .split(/[،,؛;\n+/]| و /).map((x) => x.trim().replace(/^(حساسية|حساسيه)\s+(من\s+)?/, '')).filter((x) => x.length >= 2))];
}
