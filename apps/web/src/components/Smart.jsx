import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { api } from '../api.js';
import { Badge, Empty, Field, Icon, Input, MacroBar, Modal, PrintSheet, Select, Spinner, Textarea } from './ui.jsx';
import { fmt, shortDate } from '../format.js';
import { currentLang, TIME_LOCALE } from '../i18n.js';

/* ====================================================================== ثوابت */
export const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
export const ACTIVITY_LEVELS = {
  sedentary: 'خامل (بلا رياضة تقريباً)',
  light: 'نشاط خفيف (1–3 أيام أسبوعياً)',
  moderate: 'نشاط متوسط (3–5 أيام)',
  active: 'نشيط (6–7 أيام)',
  very_active: 'نشيط جداً (عمل بدني أو تمرينان يومياً)',
};
export const GOAL_KINDS = { lose: 'إنقاص الوزن', maintain: 'تثبيت الوزن', gain: 'زيادة الوزن' };
/** يوم الأسبوع بترقيم الخادم: 0 = السبت … 6 = الجمعة */
export const todayDow = () => (new Date().getDay() + 1) % 7;

/* ============================================================ ملاحظات صوتية */
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const speechSupported = !!SR;
const VOICE_LANGS = [['ar-SA', 'العربية'], ['ar-EG', 'عربي مصري'], ['en-US', 'English']];

/**
 * زر إملاء صوتي (Web Speech API): يحوّل الكلام إلى نص ويضيفه للحقل مباشرة.
 * يختفي تلقائياً في المتصفحات غير الداعمة (فايرفوكس مثلاً). يعمل في Chrome/Edge/Safari.
 */
export function VoiceNoteButton({ onText, className = '', compact = false }) {
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState('');
  const [lang, setLang] = useState(() => localStorage.getItem('clinic.voiceLang') || (currentLang() === 'en' ? 'en-US' : 'ar-SA'));
  const [err, setErr] = useState('');
  const rec = useRef(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => () => { try { rec.current?.abort(); } catch { /* */ } }, []);
  if (!SR) return null;

  const start = () => {
    setErr('');
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let fin = ''; let tmp = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else tmp += t;
      }
      if (fin.trim()) onTextRef.current?.(fin.trim());
      setInterim(tmp);
    };
    r.onerror = (e) => {
      setErr(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'اسمح للمتصفح باستخدام الميكروفون'
        : e.error === 'no-speech' ? 'لم يُلتقط صوت — تكلّم بالقرب من الميكروفون'
          : e.error === 'network' ? 'التعرّف الصوتي يحتاج اتصالاً بالإنترنت' : `خطأ: ${e.error}`);
    };
    r.onend = () => { setOn(false); setInterim(''); };
    rec.current = r;
    try { r.start(); setOn(true); } catch { setOn(false); }
  };
  const stop = () => { try { rec.current?.stop(); } catch { /* */ } };

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <button type="button" onClick={on ? stop : start} data-voice-btn
        className={`btn-sm btn ${on ? 'bg-clay-500 text-white hover:bg-clay-600' : 'btn-soft'}`} title="إملاء صوتي">
        {on ? <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" /></span>
          : <svg viewBox="0 0 24 24" className="h-[1.1em] w-[1.1em]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>}
        {on ? 'إيقاف' : (compact ? '' : 'إملاء صوتي')}
      </button>
      {!on && !compact && (
        <select value={lang} onChange={(e) => { setLang(e.target.value); localStorage.setItem('clinic.voiceLang', e.target.value); }}
          className="rounded-lg border border-line bg-surface px-1.5 py-1 text-[11.5px] font-bold text-ink/60" aria-label="لغة الإملاء">
          {VOICE_LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}
      {on && <span className="max-w-[240px] truncate text-[11.5px] font-bold text-clay-600">{interim || 'أستمع…'}</span>}
      {err && <span className="text-[11.5px] font-bold text-clay-600">{err}</span>}
    </span>
  );
}

/** يضيف نصاً مُملى إلى نص موجود بفاصل مناسب */
export const appendText = (prev, t) => {
  const p = String(prev || '');
  if (!p.trim()) return t;
  return /[.!?؟،\n]\s*$/.test(p) ? `${p.trimEnd()} ${t}` : `${p.trimEnd()}، ${t}`;
};

/* ============================================================ الالتزام بالخطة */
const bandTone = (a) => (a >= 90 ? 'good' : a >= 75 ? 'info' : a >= 50 ? 'warn' : 'bad');
const bandLabel = (a) => (a >= 90 ? 'ممتاز' : a >= 75 ? 'جيد' : a >= 50 ? 'متوسط' : 'ضعيف');

export function AdherencePill({ value, className = '' }) {
  if (value === null || value === undefined) return <span className="text-ink/35">—</span>;
  return <Badge tone={bandTone(value)} className={`tnum ${className}`}>{value}% · {bandLabel(value)}</Badge>;
}

/** منزلق 0–100 مع اختيارات سريعة */
export function AdherencePicker({ value, onChange, note, onNote }) {
  const v = value === '' || value === null || value === undefined ? null : Number(value);
  const color = v === null ? '#9aa5a3' : v >= 90 ? '#5aa843' : v >= 75 ? '#229a92' : v >= 50 ? '#d69a19' : '#c9604a';
  return (
    <div className="rounded-xl border border-line bg-sand/50 p-3" data-adherence>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-extrabold text-ink/70">الالتزام بالخطة منذ الزيارة السابقة</span>
        <span className="flex items-center gap-2">
          {v === null ? <span className="text-[12px] font-bold text-ink/40">غير مُقيّم</span> : <AdherencePill value={v} />}
          {v !== null && <button type="button" className="text-[11.5px] font-bold text-ink/45 hover:text-clay-600" onClick={() => onChange(null)}>مسح</button>}
        </span>
      </div>
      <input type="range" min="0" max="100" step="5" value={v ?? 50} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full" style={{ accentColor: color, opacity: v === null ? 0.45 : 1 }} aria-label="نسبة الالتزام" dir="ltr" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[0, 25, 50, 75, 100].map((q) => (
          <button key={q} type="button" onClick={() => onChange(q)}
            className={`tnum rounded-lg border px-2.5 py-1 text-[12px] font-extrabold transition ${v === q ? 'border-brand-400 bg-brand-700 text-white' : 'border-line bg-surface text-ink/60 hover:border-brand-300'}`}>{q}%</button>
        ))}
      </div>
      {onNote && (
        <Input className="mt-2 !py-2 text-[13px]" value={note || ''} onChange={(e) => onNote(e.target.value)} placeholder="سبب التقييم (اختياري): مناسبة اجتماعية، سفر، جوع مسائي…" />
      )}
    </div>
  );
}

/** نافذة تعديل التزام زيارة موجودة (PUT /visits/:id) */
export function AdherenceModal({ open, visit, onClose, onSaved }) {
  const { run } = useApp();
  const [val, setVal] = useState(null);
  const [note, setNote] = useState('');
  useEffect(() => { if (open && visit) { setVal(visit.adherence ?? null); setNote(visit.adherence_notes || ''); } }, [open, visit]);
  const save = () => run(() => api.put(`/visits/${visit.id}`, { adherence: val, adherence_notes: note || null }), { ok: 'تم حفظ تقييم الالتزام' })
    .then(() => { onSaved?.(); onClose(); }).catch(() => {});
  return (
    <Modal open={open} onClose={onClose} size="sm" title="تقييم الالتزام بالخطة" subtitle={visit ? `زيارة ${shortDate(visit.visit_date)}` : ''} icon={<Icon.flame />}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save}><Icon.check /> حفظ</button></>}>
      <AdherencePicker value={val} onChange={setVal} note={note} onNote={setNote} />
    </Modal>
  );
}

/* ============================================================ مولّد الخطة الأسبوعية */
export function GeneratorModal({ open, onClose, patient, onSaved }) {
  const { run, toast } = useApp();
  const [opts, setOpts] = useState({ activity_level: 'light', goal: '', target_kcal: '', seed: 0 });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [day, setDay] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open || !patient) return;
    setOpts({ activity_level: patient.activity_level || 'light', goal: '', target_kcal: '', seed: 0 });
    setPreview(null); setDay(0); setErr('');
  }, [open, patient]);

  const load = useCallback(async (o) => {
    setLoading(true); setErr('');
    try {
      const r = await api.post('/diet-plans/generate', {
        patient_id: patient.id, activity_level: o.activity_level, goal: o.goal || undefined,
        target_kcal: o.target_kcal ? Number(o.target_kcal) : undefined, seed: o.seed, save: false,
      });
      setPreview(r);
    } catch (e) { setErr(e.message); setPreview(null); } finally { setLoading(false); }
  }, [patient]);

  // معاينة فورية مع كل تغيير (بتأخير بسيط عند كتابة السعرات)
  useEffect(() => {
    if (!open || !patient) return undefined;
    const t = setTimeout(() => load(opts), opts.target_kcal ? 450 : 0);
    return () => clearTimeout(t);
  }, [open, patient, opts, load]);

  const set = (k) => (e) => setOpts((o) => ({ ...o, [k]: e.target.value }));
  const save = () => run(() => api.post('/diet-plans/generate', {
    patient_id: patient.id, activity_level: opts.activity_level, goal: opts.goal || undefined,
    target_kcal: opts.target_kcal ? Number(opts.target_kcal) : undefined, seed: opts.seed, save: true,
  }), { ok: 'تم حفظ الخطة الأسبوعية كمسودة — راجعها ثم اعتمدها' }).then((pl) => { onSaved?.(pl); onClose(); }).catch(() => {});

  const t = preview?.targets;
  const dayMeals = (preview?.meals || []).filter((m) => m.day_of_week === day);
  const dayTotals = preview?.by_day?.find((d) => d.day === day);

  return (
    <Modal open={open} onClose={onClose} size="xl" icon={<Icon.flame />} title="توليد خطة أسبوعية ذكية"
      subtitle={`${patient?.full_name || ''} — من الطول والوزن والعمر ومستوى النشاط (معادلة Mifflin-St Jeor)`}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button className="btn-soft" disabled={loading} onClick={() => setOpts((o) => ({ ...o, seed: o.seed + 1 }))}><Icon.refresh /> اقتراح آخر</button>
        <button className="btn-primary" disabled={!preview || loading} onClick={save}><Icon.check /> حفظ الخطة</button>
      </>}>
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="grid content-start gap-3">
          <Field label="مستوى النشاط">
            <Select value={opts.activity_level} onChange={set('activity_level')}>
              {Object.entries(ACTIVITY_LEVELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="الهدف" hint="تلقائي: يُستنتج من الوزن المستهدف">
            <Select value={opts.goal} onChange={set('goal')} placeholder="— تلقائي —">
              {Object.entries(GOAL_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="السعرات اليومية المستهدفة" hint="اتركها فارغة لتُحسب آلياً">
            <Input type="number" min="1000" max="4500" step="50" value={opts.target_kcal} onChange={set('target_kcal')} placeholder={t ? String(t.kcal) : 'تلقائي'} />
          </Field>
          {t && (
            <div className="grid gap-1.5 rounded-xl border border-brand-100 bg-brand-50/70 p-3 text-[12.5px]">
              {[['معدل الأيض الأساسي BMR', `${fmt(t.bmr, 0)} سعرة`], ['الاحتياج اليومي TDEE', `${fmt(t.tdee, 0)} سعرة`], ['الهدف اليومي', `${fmt(t.kcal, 0)} سعرة`],
                ['بروتين / كربوهيدرات / دهون', `${t.protein_g} / ${t.carbs_g} / ${t.fat_g} غ`],
                ...(t.fiber_g ? [['الألياف / الماء', `${t.fiber_g} غ / ${fmt(t.water_ml / 1000)} لتر`]] : []),
                ['التغيّر المتوقع', `${t.weekly_change_kg > 0 ? '+' : ''}${fmt(t.weekly_change_kg, 2)} كغ/أسبوع`]].map(([l, v]) => (
                <div key={l} className="flex items-baseline justify-between gap-2"><span className="font-bold text-ink/55">{l}</span><b className="tnum text-brand-800">{v}</b></div>
              ))}
              {t.floor_applied && <p className="font-bold text-sun-600">رُفعت السعرات للحد الآمن الأدنى.</p>}
            </div>
          )}
          {preview?.warnings?.map((w) => <p key={w} className="rounded-lg bg-sun-50 px-2.5 py-1.5 text-[12px] font-bold text-sun-600">⚠️ {w}</p>)}
        </div>

        <div className="min-w-0">
          {err ? <p className="rounded-xl bg-clay-50 p-4 text-[13px] font-bold text-clay-600">{err}</p> : !preview ? <Spinner label="جارٍ حساب الاحتياج وتوليد الأسبوع…" /> : (
            <div className={`grid gap-3 transition ${loading ? 'opacity-50' : ''}`}>
              <div className="flex gap-1 overflow-x-auto no-scrollbar">
                {DAYS.map((d, i) => {
                  const bd = preview.by_day?.find((x) => x.day === i);
                  return (
                    <button key={d} onClick={() => setDay(i)} className={`shrink-0 rounded-lg px-3 py-1.5 text-center text-[12px] font-bold transition ${day === i ? 'bg-brand-700 text-white' : 'bg-sand text-ink/60 hover:bg-brand-50'}`}>
                      {d}<span className="tnum block text-[10.5px] opacity-75">{bd ? fmt(bd.kcal, 0) : '—'}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-2">
                {dayMeals.map((m, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-xl border border-line bg-sand/40 p-2.5">
                    <span className="w-16 shrink-0 text-center"><b className="block text-[11.5px] text-brand-700">{__t(m.slot)}</b><span className="tnum text-[10.5px] text-ink/40">{m.slot_time}</span></span>
                    <div className="min-w-0 flex-1"><p className="text-[13px] font-extrabold">{m.title}</p><p className="text-[12px] leading-5 text-ink/65">{m.items}</p></div>
                    <div className="tnum shrink-0 text-end text-[11px] font-bold text-ink/50"><b className="text-[13px] text-brand-700">{fmt(m.kcal, 0)}</b><br />ب{fmt(m.protein_g, 0)} ك{fmt(m.carbs_g, 0)} د{fmt(m.fat_g, 0)}</div>
                  </div>
                ))}
              </div>
              {dayTotals && <MacroBar totals={dayTotals} target={t?.kcal} />}
              <p className="muted">الخطة تُحفظ كمسودة بـ {preview.meals.length} وجبة (7 أيام × 5). يمكن تعديل أي وجبة قبل الاعتماد، واطلب «اقتراح آخر» لتنويع الأطعمة بنفس السعرات.</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================ واتساب */
const WA_KINDS = [
  ['appointment_reminder', 'تذكير بموعد', Icon.cal],
  ['plan', 'تفاصيل الخطة', Icon.meal],
  ['shopping_list', 'قائمة التسوق', Icon.download],
  ['daily_reminder', 'تذكير اليوم', Icon.clock],
  ['custom', 'رسالة حرة', Icon.pencil],
];
const WaIcon = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" className={`h-[1.15em] w-[1.15em] ${className}`} fill="currentColor" aria-hidden><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" /></svg>
);
export { WaIcon };

/**
 * إرسال رسالة واتساب لمريض: معاينة النص (قابل للتعديل) ← إرسال.
 * إن كانت مفاتيح WhatsApp Cloud API مضبوطة يُرسل آلياً من الخادم،
 * وإلا يُفتح wa.me برسالة جاهزة ويُسجَّل في سجل الرسائل.
 */
export function WhatsAppModal({ open, onClose, patient, initialKind = 'custom', refId = null, days: initialDays = 7, appointments = [] }) {
  const { run, toast } = useApp();
  const [kind, setKind] = useState(initialKind);
  const [ref, setRef] = useState(refId);
  const [days, setDays] = useState(initialDays);
  const [text, setText] = useState('');
  const [orig, setOrig] = useState('');
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (open) { setKind(initialKind); setRef(refId); setDays(initialDays); setErr(''); if (initialKind === 'custom') { setText(''); setOrig(''); } } }, [open, initialKind, refId, initialDays]);
  const upcoming = appointments.filter((a) => ['scheduled', 'confirmed'].includes(a.status));
  useEffect(() => { if (open && kind === 'appointment_reminder' && !ref && upcoming[0]) setRef(upcoming[0].id); }, [open, kind]); // eslint-disable-line

  useEffect(() => {
    if (!open || !patient) return;
    if (kind === 'custom') { setInfo(null); api.post('/whatsapp/send', { patient_id: patient.id, kind: 'custom', text: '.', preview: true }).then((r) => setInfo(r)).catch(() => {}); return; }
    if (kind === 'appointment_reminder' && !ref) { setErr('لا يوجد موعد قادم لهذا المريض'); setText(''); return; }
    setLoading(true); setErr('');
    api.post('/whatsapp/send', { patient_id: patient.id, kind, ref_id: ref || undefined, days, preview: true })
      .then((r) => { setInfo(r); setText(r.text); setOrig(r.text); })
      .catch((e) => { setErr(e.message); setText(''); setOrig(''); })
      .finally(() => setLoading(false));
  }, [open, patient, kind, ref, days]);

  const edited = kind === 'custom' || text !== orig;
  const linkMode = info && !info.configured;
  const noPhone = info && !info.to;
  const send = async () => {
    // نافذة فارغة تُفتح فوراً بضغطة المستخدم (وإلا يمنعها المتصفح) ثم تُوجَّه لرابط wa.me
    const w = linkMode ? window.open('', '_blank') : null;
    try {
      const r = await run(() => api.post('/whatsapp/send', { patient_id: patient.id, kind, ref_id: ref || undefined, days, text: edited ? text : undefined }));
      if (r.status === 'link' && r.link) { if (w) w.location.href = r.link; else window.open(r.link, '_blank'); toast('فُتح واتساب برسالة جاهزة — اضغط إرسال هناك', 'good'); }
      else if (r.status === 'sent') { w?.close(); toast('أُرسلت الرسالة عبر WhatsApp Cloud API ✓', 'good'); }
      else { w?.close(); toast(r.error || 'لم تُرسل الرسالة', 'warn'); }
      onClose();
    } catch { w?.close(); }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" icon={<WaIcon className="text-[#25D366]" />} title="إرسال عبر واتساب"
      subtitle={`${patient?.full_name || ''} · ${info?.to ? `+${info.to}` : patient?.phone || 'بلا رقم'}`}
      footer={<>
        <span className="me-auto text-[11.5px] font-bold text-ink/45">{info ? (info.configured ? (info.dry_run ? 'وضع تجريبي (لا إرسال فعلي)' : 'إرسال آلي عبر WhatsApp Cloud API') : 'بدون مفاتيح API: سيُفتح واتساب برسالة جاهزة') : ''}</span>
        <button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button className="btn bg-[#1f9d55] text-white hover:bg-[#188247]" disabled={!text.trim() || loading || noPhone || !!err} onClick={send}><WaIcon /> {linkMode ? 'فتح واتساب' : 'إرسال الآن'}</button>
      </>}>
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {WA_KINDS.map(([k, l, Ic]) => (
            <button key={k} onClick={() => { setKind(k); if (k !== 'appointment_reminder') setRef(null); }}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition ${kind === k ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-line bg-surface text-ink/60 hover:border-brand-300'}`}><Ic /> {l}</button>
          ))}
        </div>
        {kind === 'appointment_reminder' && upcoming.length > 1 && (
          <Select value={ref || ''} onChange={(e) => setRef(Number(e.target.value))}>
            {upcoming.map((a) => <option key={a.id} value={a.id}>{a.date} · {a.time}</option>)}
          </Select>
        )}
        {kind === 'shopping_list' && (
          <div className="flex items-center gap-2 text-[12.5px] font-bold text-ink/60">لمدة
            {[3, 7, 14].map((d) => <button key={d} onClick={() => setDays(d)} className={`tnum rounded-lg px-2.5 py-1 ${days === d ? 'bg-brand-700 text-white' : 'bg-sand'}`}>{d} أيام</button>)}
          </div>
        )}
        {noPhone && <p className="rounded-lg bg-clay-50 px-3 py-2 text-[12.5px] font-bold text-clay-600">لا يوجد رقم هاتف صالح لهذا المريض — أضفه من «تعديل».</p>}
        {err ? <p className="rounded-lg bg-sun-50 px-3 py-2 text-[12.5px] font-bold text-sun-600">{err}</p> : (
          <div className="relative">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[220px] whitespace-pre-wrap leading-7" placeholder="اكتب رسالتك…" />
            {loading && <span className="absolute inset-0 grid place-items-center rounded-xl bg-surface/60"><Spinner label="" /></span>}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <VoiceNoteButton onText={(t) => setText((x) => appendText(x, t))} />
          {edited && kind !== 'custom' && <span className="text-[11.5px] font-bold text-sun-600">عُدّل النص — سيُرسل كرسالة نصية (القوالب المعتمدة تُستعمل للنص الأصلي فقط)</span>}
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================ قائمة التسوق */
export function ShoppingListModal({ open, onClose, plan, patient, clinic = {} }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [printing, setPrinting] = useState(false);
  const [wa, setWa] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open || !plan) return;
    setData(null); setErr('');
    api.get(`/diet-plans/${plan.id}/shopping-list?days=${days}`).then(setData).catch((e) => setErr(e.message));
  }, [open, plan, days]);
  useEffect(() => { if (open) setChecked(new Set()); }, [open, plan]);

  const toggle = (k) => setChecked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const total = data?.items_count || 0;
  const copy = async () => { try { await navigator.clipboard.writeText(data.text); } catch { /* */ } };

  return (
    <>
      <Modal open={open && !printing && !wa} onClose={onClose} size="lg" icon={<Icon.download />} title="قائمة التسوق من الخطة"
        subtitle={plan ? `${plan.title} — الكميات مجمّعة ومضروبة في عدد الأيام` : ''}
        footer={<>
          <span className="me-auto tnum text-[12px] font-bold text-ink/50">{total ? `${checked.size} / ${total} تم شراؤه` : ''}</span>
          <button className="btn-ghost" onClick={copy} disabled={!data}><Icon.copy /> نسخ</button>
          <button className="btn-ghost" onClick={() => setPrinting(true)} disabled={!data}><Icon.print /> طباعة</button>
          <button className="btn bg-[#1f9d55] text-white hover:bg-[#188247]" onClick={() => setWa(true)} disabled={!data || !patient}><WaIcon /> إرسال واتساب</button>
        </>}>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] font-bold text-ink/60">
          المدة:
          {[1, 3, 7, 14, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`tnum rounded-lg px-2.5 py-1 transition ${days === d ? 'bg-brand-700 text-white' : 'bg-sand hover:bg-brand-50'}`}>{d === 1 ? 'يوم' : `${d} أيام`}</button>
          ))}
        </div>
        {err ? <p className="rounded-lg bg-clay-50 p-3 text-[13px] font-bold text-clay-600">{err}</p> : !data ? <Spinner /> : !data.groups.length ? (
          <Empty icon="🛒" title="لا مكوّنات في هذه الخطة" message="أضف أصناف الوجبات (المكوّنات) في محرر الخطة لتُستخرج القائمة." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.groups.map((g) => (
              <div key={g.category} className="rounded-xl border border-line bg-sand/40 p-3">
                <p className="mb-1.5 text-[12.5px] font-extrabold text-brand-700">{g.label} <span className="tnum text-ink/35">({g.items.length})</span></p>
                <ul className="grid gap-1">
                  {g.items.map((it) => {
                    const k = `${g.category}|${it.name}|${it.unit}`;
                    return (
                      <li key={k}>
                        <label className={`flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] font-bold transition hover:bg-surface ${checked.has(k) ? 'text-ink/35 line-through' : ''}`}>
                          <input type="checkbox" checked={checked.has(k)} onChange={() => toggle(k)} className="h-4 w-4 accent-brand-600" />
                          <span className="flex-1">{it.name}</span>
                          <span className="tnum text-[12px] text-ink/55">{it.qty == null ? (it.times > 1 ? `×${it.times}` : '') : it.text.split(': ').slice(1).join(': ')}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Modal>
      <PrintSheet open={printing} onClose={() => setPrinting(false)} title="قائمة التسوق">
        {data && (
          <article dir="rtl">
            <div className="mb-4 flex items-end justify-between border-b-2 border-black pb-3">
              <div>
                <p className="text-[16px] font-extrabold">🛒 قائمة التسوق — {data.patient.first_name} {data.patient.last_name}</p>
                <p className="text-[11.5px]">{data.plan_title} · لمدة {data.days} {data.days === 1 ? 'يوم' : 'أيام'}</p>
              </div>
              <p className="text-[11px]">{clinic['clinic.name'] || ''}<br />{new Date().toLocaleDateString(TIME_LOCALE)}</p>
            </div>
            <div style={{ columnCount: 2, columnGap: '24px' }}>
              {data.groups.map((g) => (
                <div key={g.category} className="keep mb-3" style={{ breakInside: 'avoid' }}>
                  <p className="mb-1 border-b border-black/60 pb-0.5 text-[12.5px] font-extrabold">{g.label}</p>
                  {g.items.map((it) => (
                    <p key={it.name + it.unit} className="flex items-center gap-2 py-0.5 text-[12px]"><span className="inline-block h-3 w-3 border border-black" /> {it.text}</p>
                  ))}
                </div>
              ))}
            </div>
          </article>
        )}
      </PrintSheet>
      <WhatsAppModal open={wa} onClose={() => setWa(false)} patient={patient} initialKind="shopping_list" refId={plan?.id} days={days} />
    </>
  );
}

/* ============================================================ جرس التنبيهات */
const LEVEL = { high: 'border-clay-500/40 bg-clay-50', warn: 'border-sun-500/40 bg-sun-50', info: 'border-line bg-surface' };
const SEEN_KEY = 'clinic.notified';

/**
 * يسأل الخادم كل 60 ثانية عن: مواعيد خلال ساعة، تذكيرات لم تُرسل، متابعات متأخرة، رسائل فشلت.
 * يُظهر إشعار المتصفح (Notification API) للمواعيد القريبة مرة واحدة لكل موعد.
 */
export function NotificationBell() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState(() => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'));
  const box = useRef(null);

  const poll = useCallback(async () => {
    try {
      const r = await api.get('/notifications');
      setData(r);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        let seen = [];
        try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { /* */ }
        const fresh = (r.items || []).filter((n) => (n.level === 'high' || n.type === 'appointment_soon') && !seen.includes(n.id));
        for (const n of fresh.slice(0, 3)) {
          try {
            const note = new Notification(n.title, { body: n.body, tag: n.id, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🥗</text></svg>' });
            note.onclick = () => { window.focus(); if (n.patient_id) nav(`/patients/${n.patient_id}`); };
          } catch { /* بعض المتصفحات تمنعه خارج Service Worker */ }
        }
        if (fresh.length) localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, ...fresh.map((n) => n.id)].slice(-200)));
      }
    } catch { /* صامت */ }
  }, [nav]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 60_000);
    const vis = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [poll]);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);

  const items = data?.items || [];
  const urgent = items.filter((n) => n.level === 'high').length;
  const ask = async () => { try { setPerm(await Notification.requestPermission()); } catch { /* */ } };

  return (
    <div className="relative" ref={box}>
      <button className="btn-ghost btn-sm relative !px-2.5" onClick={() => setOpen((o) => !o)} aria-label="التنبيهات" title="التنبيهات" data-bell>
        <svg viewBox="0 0 24 24" className="h-[1.15em] w-[1.15em]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>
        {items.length > 0 && (
          <span className={`absolute -top-1.5 -end-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-extrabold text-white tnum ${urgent ? 'bg-clay-500' : 'bg-sun-500'}`}>{items.length > 99 ? '99+' : items.length}</span>
        )}
      </button>
      {open && (
        <div className="pop-in absolute end-0 top-[calc(100%+8px)] z-50 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <p className="text-[13.5px] font-extrabold">التنبيهات <span className="tnum text-ink/40">({items.length})</span></p>
            <button className="text-[11.5px] font-bold text-brand-700 hover:underline" onClick={poll}>تحديث</button>
          </div>
          {perm === 'default' && (
            <button onClick={ask} className="flex w-full items-center gap-2 border-b border-line bg-brand-50 px-3.5 py-2 text-start text-[12px] font-bold text-brand-800">
              🔔 فعّل إشعارات المتصفح لتنبيهك بالمواعيد القريبة حتى لو كانت الصفحة في الخلفية
            </button>
          )}
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {items.length === 0 ? <p className="px-3 py-8 text-center text-[12.5px] font-bold text-ink/45">لا تنبيهات الآن ✓</p> : items.map((n) => (
              <div key={n.id} className={`mb-1.5 rounded-lg border p-2.5 ${LEVEL[n.level] || LEVEL.info}`}>
                <button className="block w-full text-start" onClick={() => { if (n.patient_id) { nav(`/patients/${n.patient_id}`); setOpen(false); } }}>
                  <p className="text-[12.5px] font-extrabold">{n.title}</p>
                  <p className="mt-0.5 text-[12px] font-bold leading-5 text-ink/60">{n.body}</p>
                </button>
                {n.wa_link && (
                  <a href={n.wa_link} target="_blank" rel="noreferrer" onClick={() => n.appointment_id && api.post('/whatsapp/send', { patient_id: n.patient_id, kind: 'appointment_reminder', ref_id: n.appointment_id }).then(poll).catch(() => {})}
                    className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-[#1f9d55] px-2.5 py-1 text-[11.5px] font-bold text-white hover:bg-[#188247]"><WaIcon /> إرسال التذكير</a>
                )}
              </div>
            ))}
          </div>
          {data?.today_count != null && <p className="border-t border-line px-3.5 py-2 text-[11.5px] font-bold text-ink/45">مواعيد اليوم: <span className="tnum">{data.today_count}</span></p>}
        </div>
      )}
    </div>
  );
}

/* ============================================================ عرض الخطة حسب اليوم */
/** يقسم وجبات الخطة: «كل يوم» + أيام الأسبوع؛ يُرجع قائمة أيام فيها وجبات */
export function groupMealsByDay(meals = []) {
  const every = meals.filter((m) => m.day_of_week === null || m.day_of_week === undefined);
  const days = DAYS.map((name, d) => ({ day: d, name, meals: meals.filter((m) => m.day_of_week === d) })).filter((x) => x.meals.length);
  return { every, days, weekly: days.length > 0 };
}

export function useDaySelector(plan) {
  const g = useMemo(() => groupMealsByDay(plan?.meals || []), [plan]);
  const [day, setDay] = useState(() => todayDow());
  useEffect(() => { if (g.weekly && !g.days.some((x) => x.day === day)) setDay(g.days[0].day); }, [g]); // eslint-disable-line
  const meals = g.weekly ? [...g.every, ...(g.days.find((x) => x.day === day)?.meals || [])] : g.every;
  return { ...g, day, setDay, meals };
}
