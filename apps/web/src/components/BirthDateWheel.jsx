import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui.jsx';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const ITEM_H = 44;
const VISIBLE = 5;
const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const ageOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a -= 1;
  return Math.max(0, a);
};
function parse(value) {
  const [y, m, d] = String(value || '').split('-').map(Number);
  const now = new Date();
  return { y: y > 1800 ? y : now.getFullYear() - 30, m: m >= 1 && m <= 12 ? m : 1, d: d >= 1 && d <= 31 ? d : 1 };
}

/** عمود واحد في العجلة: يثبت على العنصر الذي في المنتصف */
function WheelColumn({ items, index, onChange, label }) {
  const ref = useRef(null);
  const timer = useRef();
  const last = useRef(index);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (Math.round(el.scrollTop / ITEM_H) !== index) el.scrollTo({ top: index * ITEM_H });
    last.current = index;
  }, [index, items.length]);

  const onScroll = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_H)));
      if (i !== last.current) { last.current = i; onChange(i); }
    }, 90);
  };

  return (
    <div ref={ref} onScroll={onScroll} role="listbox" aria-label={label} data-testid={`wheel-${label}`}
      className="wheel-col relative z-[1] min-w-0 flex-1 snap-y snap-mandatory overflow-y-scroll overscroll-contain"
      style={{ height: ITEM_H * VISIBLE, paddingTop: ITEM_H * 2, paddingBottom: ITEM_H * 2 }}>
      {items.map((it, i) => (
        <button type="button" key={`${it}-${i}`} role="option" aria-selected={i === index}
          onClick={() => ref.current?.scrollTo({ top: i * ITEM_H, behavior: 'smooth' })}
          className={`flex w-full snap-center items-center justify-center transition-all ${
            i === index ? 'text-[18px] font-extrabold text-ink' : Math.abs(i - index) === 1 ? 'text-[15px] text-ink/55' : 'text-[13px] text-ink/25'}`}
          style={{ height: ITEM_H }}>
          {it}
        </button>
      ))}
    </div>
  );
}

/** تاريخ الميلاد بثلاث عجلات دوّارة (يوم · شهر · سنة) — أسرع بكثير من التقويم */
export default function BirthDateWheel({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => parse(value));
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 111 }, (_, i) => thisYear - 110 + i), [thisYear]);
  const maxDay = daysIn(draft.y, draft.m);
  const days = useMemo(() => Array.from({ length: maxDay }, (_, i) => String(i + 1)), [maxDay]);
  const months = MONTHS;

  useEffect(() => { if (draft.d > maxDay) setDraft((d) => ({ ...d, d: maxDay })); }, [maxDay, draft.d]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  const iso = (d) => `${d.y}-${pad(d.m)}-${pad(Math.min(d.d, daysIn(d.y, d.m)))}`;
  const openSheet = (e) => { e.preventDefault(); setDraft(parse(value)); setOpen(true); };
  const confirm = () => {
    let v = iso(draft);
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    if (v > todayIso) v = todayIso; // لا تاريخ ميلاد في المستقبل
    onChange(v);
    setOpen(false);
  };

  const cur = parse(value);
  const draftIso = iso(draft);

  return (
    <>
      <button type="button" onClick={openSheet} data-testid="birthdate-button"
        className="field flex items-center justify-between gap-2 text-start">
        <span className={value ? 'font-semibold' : 'text-ink/35'}>
          {value ? `${cur.d} ${months[cur.m - 1]} ${cur.y}` : 'اختر تاريخ الميلاد'}
        </span>
        <span className="text-brand-600"><Icon.cal /></span>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#0b1413]/55 backdrop-blur-[2px] sm:items-center"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="w-full space-y-4 rounded-t-3xl border border-line bg-surface p-5 shadow-pop sm:max-w-sm sm:rounded-3xl"
            data-testid="birthdate-sheet">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[16px] font-extrabold text-ink">تاريخ الميلاد</h3>
                <p className="muted">حرّك كل عجلة لأعلى أو لأسفل</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost btn-sm" aria-label="إغلاق">✕</button>
            </div>

            <div className="flex text-center text-[11.5px] font-bold text-ink/45">
              <span className="flex-1">اليوم</span>
              <span className="flex-[1.6]">الشهر</span>
              <span className="flex-1">السنة</span>
            </div>

            <div className="relative flex gap-1">
              <div className="pointer-events-none absolute inset-x-0 rounded-xl border border-brand-200 bg-brand-50" style={{ top: ITEM_H * 2, height: ITEM_H }} />
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-16 bg-gradient-to-b from-surface to-surface/0" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-16 bg-gradient-to-t from-surface to-surface/0" />
              <div className="flex flex-1"><WheelColumn label="اليوم" items={days} index={Math.min(draft.d, maxDay) - 1} onChange={(i) => setDraft((d) => ({ ...d, d: i + 1 }))} /></div>
              <div className="flex flex-[1.6]"><WheelColumn label="الشهر" items={months} index={draft.m - 1} onChange={(i) => setDraft((d) => ({ ...d, m: i + 1 }))} /></div>
              <div className="flex flex-1"><WheelColumn label="السنة" items={years.map(String)} index={Math.max(0, years.indexOf(draft.y))} onChange={(i) => setDraft((d) => ({ ...d, y: years[i] }))} /></div>
            </div>

            <p className="text-center text-[14px] text-ink/70">العمر: <b className="text-brand-700">{ageOf(draftIso)} سنة</b></p>

            <div className="flex gap-2">
              <button type="button" onClick={confirm} className="btn-primary flex-1 !py-3" data-testid="birthdate-confirm">تم</button>
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost !py-3">إلغاء</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
