import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.jsx';
import { Field, Icon, Input, Modal, Select, Textarea, Toggle } from './ui.jsx';
import { ACTIVITY_LEVELS, VoiceNoteButton, appendText } from './Smart.jsx';
import { GENDERS, fmt, todayISO } from '../format.js';

const EMPTY = {
  first_name: '', last_name: '', phone: '', birth_date: '', gender: 'female',
  height_cm: '', start_weight: '', goal_weight: '', goal: '', notes: '', status: 'active',
  activity_level: 'light', reminders_opt_in: true, daily_reminder: false,
};

/** BMI محسوب للمعاينة فقط — القيمة المعتمدة تُحسب في الخادم */
const previewBmi = (w, h) => (!w || !h ? null : Math.round((w / (h / 100) ** 2) * 10) / 10);
const bmiWord = (b) => (b == null ? '—' : b < 18.5 ? 'نقص وزن' : b < 25 ? 'طبيعي' : b < 30 ? 'زيادة' : b < 35 ? 'سمنة ١' : b < 40 ? 'سمنة ٢' : 'سمنة مفرطة');

export default function PatientForm({ open, onClose, patient, onSaved }) {
  const { run, toast } = useApp();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const isEdit = !!patient?.id;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(patient ? {
      ...EMPTY,
      ...Object.fromEntries(Object.entries(patient).filter(([, v]) => v !== null && v !== undefined)),
      birth_date: patient.birth_date || '',
      height_cm: patient.height_cm ?? '',
      start_weight: patient.start_weight ?? '',
      goal_weight: patient.goal_weight ?? '',
      activity_level: patient.activity_level || 'light',
      reminders_opt_in: !(patient.reminders_opt_in === false || patient.reminders_opt_in === 0),
      daily_reminder: !!patient.daily_reminder,
    } : EMPTY);
  }, [open, patient]);

  const set = (k) => (e) => {
    const v = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const bmi = useMemo(() => previewBmi(Number(form.start_weight), Number(form.height_cm)), [form.start_weight, form.height_cm]);
  const targetBmi = useMemo(() => previewBmi(Number(form.goal_weight), Number(form.height_cm)), [form.goal_weight, form.height_cm]);
  const diff = Number(form.start_weight) && Number(form.goal_weight)
    ? Math.round((Number(form.start_weight) - Number(form.goal_weight)) * 10) / 10 : null;
  const age = form.birth_date ? Math.floor((Date.now() - new Date(form.birth_date).getTime()) / (365.25 * 864e5)) : null;

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.first_name.trim()) errs.first_name = 'الاسم مطلوب';
    if (!form.last_name.trim()) errs.last_name = 'اللقب مطلوب';
    if (form.phone && !/^[0-9+\-\s()]{6,20}$/.test(form.phone.trim())) errs.phone = 'رقم هاتف غير صالح';
    if (form.birth_date && form.birth_date > todayISO()) errs.birth_date = 'تاريخ في المستقبل!';
    for (const k of ['height_cm', 'start_weight', 'goal_weight']) {
      const v = form[k];
      if (v !== '' && (Number(v) <= 0 || Number(v) > 400)) errs[k] = 'قيمة غير منطقية';
    }
    setErrors(errs);
    if (Object.keys(errs).length) { toast('راجع الحقول المعلَّمة بالأحمر', 'bad'); return; }

    const body = {
      ...form,
      first_name: form.first_name.trim(), last_name: form.last_name.trim(),
      phone: form.phone.trim(), birth_date: form.birth_date || null,
      height_cm: form.height_cm === '' ? null : Number(form.height_cm),
      start_weight: form.start_weight === '' ? null : Number(form.start_weight),
      goal_weight: form.goal_weight === '' ? null : Number(form.goal_weight),
      goal: form.goal.trim(), notes: form.notes.trim(),
      activity_level: form.activity_level || null,
      reminders_opt_in: !!form.reminders_opt_in, daily_reminder: !!form.daily_reminder,
    };
    setBusy(true);
    try {
      const saved = isEdit ? await run(() => api.put(`/patients/${patient.id}`, body)) : await run(() => api.post('/patients', body));
      toast(isEdit ? 'تم تحديث ملف المريض' : `تم فتح ملف جديد برقم ${saved.file_no} ✓`, 'good');
      onSaved?.(saved);
      onClose();
    } catch { /* أخطاء run تظهر كتنبيه */ } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg"
      title={isEdit ? `تعديل ملف ${patient.file_no}` : 'مريض جديد'}
      subtitle={isEdit ? 'التعديلات تُسجَّل في سجل التدقيق باسم المستخدم الحالي' : 'رقم الملف يُمنح تلقائياً عند الحفظ'}
      icon={<Icon.users />}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>إلغاء</button>
          <button form="patient-form" className="btn-primary" disabled={busy}>
            {busy ? 'جارٍ الحفظ…' : <>{isEdit ? <Icon.check /> : <Icon.plus />} {isEdit ? 'حفظ التعديلات' : 'فتح الملف'}</>}
          </button>
        </>
      }>
      <form id="patient-form" onSubmit={submit} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم" error={errors.first_name}><Input value={form.first_name} onChange={set('first_name')} placeholder="مثال: مريم" /></Field>
          <Field label="اللقب" error={errors.last_name}><Input value={form.last_name} onChange={set('last_name')} placeholder="مثال: الطيب" /></Field>
          <Field label="الهاتف" error={errors.phone} hint="يُستخدم في البحث السريع والتواصل"><Input value={form.phone} onChange={set('phone')} placeholder="09…" inputMode="tel" /></Field>
          <Field label="تاريخ الميلاد" error={errors.birth_date} hint={age != null ? `العمر ${age} سنة` : undefined}>
            <Input type="date" max={todayISO()} value={form.birth_date} onChange={set('birth_date')} />
          </Field>
          <Field label="الجنس"><Select value={form.gender} onChange={set('gender')}>{Object.entries(GENDERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="حالة الملف"><Select value={form.status} onChange={set('status')}>
            <option value="active">نشط</option><option value="inactive">متوقف مؤقتاً</option><option value="archived">مؤرشف (منتهٍ)</option>
          </Select></Field>
          <Field label="الطول (سم)" error={errors.height_cm}><Input type="number" step="0.1" min="80" max="230" value={form.height_cm} onChange={set('height_cm')} placeholder="165" /></Field>
          <Field label="وزن البداية (كغ)" error={errors.start_weight}><Input type="number" step="0.1" min="20" max="350" value={form.start_weight} onChange={set('start_weight')} placeholder="82" /></Field>
          <Field label="الوزن المستهدف (كغ)" error={errors.goal_weight}><Input type="number" step="0.1" min="20" max="350" value={form.goal_weight} onChange={set('goal_weight')} placeholder="70" /></Field>
          <Field label="الهدف الغذائي"><Input value={form.goal} onChange={set('goal')} placeholder="إنقاص 12 كجم دهون مع الحفاظ على العضل" /></Field>
        </div>

        <div className="grid gap-3 rounded-xl border border-line bg-sand/50 p-3 sm:grid-cols-[1.2fr_1fr]">
          <Field label="مستوى النشاط البدني" hint="يدخل في حساب السعرات لمولّد الخطة">
            <Select value={form.activity_level} onChange={set('activity_level')}>
              {Object.entries(ACTIVITY_LEVELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <div className="grid content-center gap-2.5">
            <Toggle checked={!!form.reminders_opt_in} onChange={set('reminders_opt_in')} label="تذكير واتساب قبل المواعيد" />
            <Toggle checked={!!form.daily_reminder} onChange={set('daily_reminder')} label="تذكير يومي بوجبات الخطة" />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="label !mb-0">ملاحظات سريرية</span>
            <VoiceNoteButton onText={(t) => setForm((f) => ({ ...f, notes: appendText(f.notes, t) }))} />
          </div>
          <Textarea value={form.notes} onChange={set('notes')} placeholder="حساسية، أمراض مزمنة، أدوية، تفضيلات الأكل…" />
        </div>

        {/* مؤشرات محسوبة — للعرض فقط ولا تُرسل للحفظ */}
        <div className="grid gap-2 rounded-xl border border-dashed border-brand-200 bg-brand-50/60 p-3.5 sm:grid-cols-3">
          {[
            ['BMI الحالي', bmi == null ? '—' : `${fmt(bmi)} · ${bmiWord(bmi)}`],
            ['BMI المستهدف', targetBmi == null ? '—' : `${fmt(targetBmi)} · ${bmiWord(targetBmi)}`],
            ['الفرق المطلوب', diff == null ? '—' : `${diff > 0 ? 'إنقاص' : 'زيادة'} ${fmt(Math.abs(diff))} كغ`],
          ].map(([l, v]) => (
            <div key={l}>
              <p className="text-[11.5px] font-bold text-brand-700/70">{l} <span className="opacity-60">(محسوب آلياً)</span></p>
              <p className="mt-0.5 text-[13.5px] font-extrabold text-brand-800 tnum">{v}</p>
            </div>
          ))}
        </div>
      </form>
    </Modal>
  );
}
