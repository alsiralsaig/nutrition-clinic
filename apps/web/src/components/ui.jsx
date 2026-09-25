import React from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../app-context.jsx';
import { fmt } from '../format.js';

/* ---------------------------------------------------------------- أيقونات */
const I = (path, extra = '') => (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
       strokeLinecap="round" strokeLinejoin="round" className={`h-[1.15em] w-[1.15em] shrink-0 ${extra}`}
       aria-hidden {...props}>
    {path}
  </svg>
);
export const Icon = {
  dash: I(<><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="4.5" rx="2" /><rect x="13.5" y="10.5" width="7.5" height="10.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /></>),
  users: I(<><circle cx="12" cy="8" r="3.4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>),
  cal: I(<><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3.5v3M16 3.5v3M3.5 10h17" /></>),
  scale: I(<><path d="M12 4v16" /><path d="M6 8h12" /><path d="M4 15a3 3 0 0 0 6 0l-3-6-3 6Z" /><path d="M14 15a3 3 0 0 0 6 0l-3-6-3 6Z" /></>),
  meal: I(<><path d="M5 3v8a2.5 2.5 0 0 0 5 0V3" /><path d="M7.5 11v10" /><path d="M18 3c-1.7 1.4-2.5 3.4-2.5 5.5S16.3 12 18 12.5V21" /></>),
  wallet: I(<><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2M3 10h18" /></>),
  chart: I(<><path d="M4 20V9M10 20V4M16 20v-7M22 20H2" /></>),
  gear: I(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>),
  search: I(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>),
  plus: I(<><path d="M12 5v14M5 12h14" /></>),
  print: I(<><path d="M6 9V3h12v6" /><rect x="3.5" y="9" width="17" height="7.5" rx="2" /><path d="M7 16h10v5H7z" /></>),
  pdf: I(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>),
  download: I(<><path d="M12 4v11M7.5 11 12 15.5 16.5 11" /><path d="M4.5 19h15" /></>),
  upload: I(<><path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4.5 19h15" /></>),
  pencil: I(<><path d="M4 20h4L20 8l-4-4L4 16z" /></>),
  trash: I(<><path d="M5 7h14M10 7V4h4v3M6 7l1 13h10l1-13" /></>),
  close: I(<><path d="M6 6l12 12M18 6 6 18" /></>),
  check: I(<><path d="M4 12.5 9 18 20 6" /></>),
  logout: I(<><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" /><path d="M10 8 6 12l4 4M6 12h11" /></>),
  shield: I(<><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" /><path d="M9.5 12.5 11 14l4-4" /></>),
  clock: I(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  phone: I(<><path d="M5 4h3.5l1.5 4-2 1.5c1 3 3 5 6 6l1.5-2 4 1.5V19a1 1 0 0 1-1 1C10 20 4 14 4 5a1 1 0 0 1 1-1Z" /></>),
  flame: I(<><path d="M12 3c3 4 6 5.5 6 9a6 6 0 0 1-12 0c0-2 1-3 2-4 .5 1.2 1.5 2 2.5 2 0-2.5-.5-4 1.5-7Z" /></>),
  chev: I(<><path d="M9 6l6 6-6 6" /></>),
  alert: I(<><path d="M12 4 3 19h18z" /><path d="M12 9v5M12 16.5v.5" /></>),
  copy: I(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 5H6a2 2 0 0 0-2 2v9" /></>),
  refresh: I(<><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4v4h-4" /></>),
  db: I(<><ellipse cx="12" cy="6" rx="7.5" ry="3" /><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" /><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" /></>),
};

/* ---------------------------------------------------------------- بطاقات */
export function Card({ title, subtitle, actions, children, className = '', pad = true, icon }) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700 text-[15px]">{icon}</span>}
            <div className="min-w-0">
              <h3 className="section-title truncate">{title}</h3>
              {subtitle && <p className="muted truncate">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, unit, hint, tone = 'brand', icon, onClick }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    leaf: 'bg-leaf-50 text-leaf-600',
    sun: 'bg-sun-50 text-sun-600',
    clay: 'bg-clay-50 text-clay-600',
    ink: 'bg-ink/5 text-ink/70',
  };
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`card card-pad group flex w-full items-start justify-between gap-3 text-start transition
        ${onClick ? 'hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-pop cursor-pointer' : 'cursor-default'}`}>
      <div className="min-w-0">
        <p className="text-[12.5px] font-bold text-ink/55">{label}</p>
        <p className="mt-1.5 flex items-baseline gap-1">
          <span className="kpi-num">{value}</span>
          {unit && <span className="text-[12px] font-bold text-ink/45">{unit}</span>}
        </p>
        {hint && <p className="muted mt-1.5">{hint}</p>}
      </div>
      {icon && <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[18px] ${tones[tone]}`}>{icon}</span>}
    </button>
  );
}

/* ---------------------------------------------------------------- عناصر إدخال */
export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && !error && <span className="muted mt-1 block">{hint}</span>}
      {error && <span className="mt-1 block text-[12px] font-bold text-clay-600">{error}</span>}
    </label>
  );
}

export function Input({ className = '', ...p }) {
  return <input className={`field ${className}`} {...p} />;
}

export function Textarea({ className = 'min-h-[86px] resize-y', ...p }) {
  return <textarea className={`field ${className}`} {...p} />;
}

export function Select({ options = [], className = '', placeholder, children, ...p }) {
  return (
    <select className={`field appearance-none bg-[length:0] ${className}`} {...p}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>))}
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-[13px] font-bold text-ink/70">
      <span className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-ink/15'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'right-0.5' : 'right-[calc(100%-1.375rem)]'}`} />
      </span>
      {label}
    </button>
  );
}

export function Badge({ tone = 'ink', children, className = '' }) {
  const tones = {
    good: 'bg-leaf-100 text-leaf-600', warn: 'bg-sun-100 text-sun-600',
    bad: 'bg-clay-100 text-clay-600', info: 'bg-brand-100 text-brand-800', ink: 'bg-ink/8 text-ink/65',
  };
  return <span className={`chip ${tones[tone] || tone} ${className}`}>{children}</span>;
}

/* ---------------------------------------------------------------- نوافذ */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', icon }) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };
  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/45 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div role="dialog" aria-modal="true" className={`pop-in my-auto w-full ${widths[size]} rounded-xl2 bg-white shadow-pop`}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex items-start gap-3">
            {icon && <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-[16px] text-brand-700">{icon}</span>}
            <div>
              <h2 className="text-[16px] font-extrabold">{title}</h2>
              {subtitle && <p className="muted mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="إغلاق"><Icon.close /></button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-sand/60 px-5 py-3.5">{footer}</footer>}
      </div>
    </div>
  );
}

/** تأكيد حذف/إلغاء — لا نفّذ أي عملية مدمّرة بصمت */
export function Confirm({ open, onCancel, onConfirm, title, message, confirmText = 'تأكيد', tone = 'danger', busy }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm" icon={<Icon.alert />}>
      <p className="text-[13.5px] leading-7 text-ink/75">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>تراجع</button>
        <button className={tone === 'danger' ? 'btn bg-clay-500 text-white hover:bg-clay-600' : 'btn-primary'}
          onClick={onConfirm} disabled={busy}>{busy ? 'جارٍ…' : confirmText}</button>
      </div>
    </Modal>
  );
}

/** ورقة A4 للمعاينة والطباعة — تُبوَّب خارج شجرة التطبيق حتى تُطبع وحدها */
export function PrintSheet({ open, onClose, children, title, actions }) {
  React.useEffect(() => {
    if (!open) return undefined;
    document.body.classList.add('printing');
    const after = () => document.body.classList.remove('printing');
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('afterprint', after);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('printing');
      window.removeEventListener('afterprint', after);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="print-portal fixed inset-0 z-[60] overflow-auto bg-ink/50 p-0 backdrop-blur-[1px] sm:p-6 print:static print:block print:overflow-visible print:bg-white print:p-0 print:backdrop-blur-none">
      <div className="mx-auto flex max-w-[900px] items-center justify-between gap-3 px-4 py-3 no-print">
        <span className="text-[13px] font-bold text-white/90">معاينة للطباعة · {title}</span>
        <div className="flex gap-2">
          {actions}
          <button className="btn-primary btn-sm" onClick={() => window.print()}><Icon.pdf /> حفظ PDF</button>
          <button className="btn-ghost btn-sm bg-white/90" onClick={onClose}><Icon.close /> إغلاق</button>
        </div>
      </div>
      <div className="print-doc mx-auto max-w-[860px] bg-white p-7 shadow-pop sm:mb-10 sm:rounded-lg print:mx-0 print:max-w-none print:p-0 print:shadow-none">
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------- حالات */
export function Empty({ icon = '🥗', title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-[26px]">{icon}</div>
      <h4 className="mt-1 text-[15px] font-extrabold">{title}</h4>
      {message && <p className="muted max-w-md">{message}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'جارٍ التحميل…' }) {
  return (
    <div className="flex items-center justify-center gap-3 px-6 py-14 text-ink/50">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700" />
      <span className="text-[13px] font-bold">{label}</span>
    </div>
  );
}

export function ErrorBox({ error, retry }) {
  if (!error) return null;
  return (
    <div className="card card-pad flex flex-wrap items-center justify-between gap-3 border-clay-100 bg-clay-50">
      <p className="flex items-center gap-2 text-[13px] font-bold text-clay-600">
        <Icon.alert /> تعذّر تحميل البيانات: {error.message}
      </p>
      {retry && <button className="btn-ghost btn-sm bg-white" onClick={retry}>إعادة المحاولة</button>}
    </div>
  );
}

/* ---------------------------------------------------------------- جدول */
export function Table({ head, children, className = '' }) {
  return (
    <div className={`scroll-x ${className}`}>
      <table className="table">
        <thead>
          <tr>{head.map((h) => <th key={typeof h === 'string' ? h : h.key} className={h.align === 'start' ? 'text-start' : ''}>{typeof h === 'string' ? h : h.label}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- صف تعريف */
export function Row({ label, value, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-line/80 py-2 last:border-0">
      <dt className="shrink-0 text-[12.5px] font-bold text-ink/55">{label}</dt>
      <dd className={`text-end text-[13.5px] font-bold text-ink ${mono ? 'tnum' : ''}`}>{value ?? '—'}</dd>
    </div>
  );
}

/* ---------------------------------------------------------------- شارت ماكرو */
export function MacroBar({ totals, target }) {
  const kcal = totals?.kcal || 0;
  const items = [
    { k: 'بروتين', v: (totals?.protein_g || 0) * 4, color: '#229a92' },
    { k: 'كربوهيدرات', v: (totals?.carbs_g || 0) * 4, color: '#d69a19' },
    { k: 'دهون', v: (totals?.fat_g || 0) * 9, color: '#c9604a' },
  ];
  const total = items.reduce((s, i) => s + i.v, 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-sand">
        {items.map((i) => <span key={i.k} style={{ width: `${(i.v / total) * 100}%`, background: i.color }} />)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] font-bold text-ink/60">
        {items.map((i) => (
          <span key={i.k} className="flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full" style={{ background: i.color }} />
            {i.k} {Math.round((i.v / total) * 100)}%
          </span>
        ))}
        {target ? <span className="text-ink/40">الهدف {fmt(target)} سعرة · المحقق {fmt(kcal, 0)}</span> : null}
      </div>
    </div>
  );
}
