import React, { useCallback, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar, ComposedChart, ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, Brush, ReferenceLine,
} from 'recharts';
import { fmt, monthLabel } from '../format.js';
import { useChartTheme } from '../theme.jsx';

/*
 * رسوم تفاعلية:
 *  - الضغط على عنصر في المفتاح (Legend) يُخفي/يُظهر السلسلة.
 *  - شريط Brush أسفل الرسوم الزمنية الطويلة للتكبير على فترة.
 *  - تلميح (Tooltip) مفصّل، وألوان تتبع الوضع الفاتح/الداكن.
 */

const axisProps = (t) => ({ tick: { fill: t.axis, opacity: 0.6, fontSize: 11, fontWeight: 700 }, axisLine: false, tickLine: false });
const grid = (t) => <CartesianGrid stroke={t.grid} strokeDasharray="3 5" vertical={false} />;

/** إظهار/إخفاء السلاسل بالضغط على المفتاح */
export function useSeriesToggle(initialHidden = []) {
  const [hidden, setHidden] = useState(() => new Set(initialHidden));
  const toggle = useCallback((o) => {
    const k = o?.dataKey ?? o?.value;
    setHidden((h) => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }, []);
  const legendProps = {
    onClick: toggle,
    wrapperStyle: { fontSize: 12, fontWeight: 700, cursor: 'pointer', userSelect: 'none' },
    formatter: (value, entry) => (
      <span style={{ opacity: hidden.has(entry?.dataKey) ? 0.35 : 1, textDecoration: hidden.has(entry?.dataKey) ? 'line-through' : 'none' }}>{value}</span>
    ),
  };
  return { hidden, isHidden: (k) => hidden.has(k), legendProps };
}

export const TooltipBox = ({ active, payload, label, unit = '', labelFormatter, digits = 1 }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface/95 px-3 py-2 text-[12px] shadow-pop backdrop-blur">
      {label !== undefined && label !== '' && <p className="mb-1 font-extrabold text-ink/70">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.filter((p) => p.value !== null && p.value !== undefined).map((p) => (
        <p key={p.dataKey ?? p.name} className="flex items-center justify-between gap-4 tnum">
          <span className="flex items-center gap-1.5 font-bold text-ink/60">
            <i className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />{p.name}
          </span>
          <span className="font-extrabold">{fmt(p.value, digits)}{p.unit ?? unit}</span>
        </p>
      ))}
    </div>
  );
};

const wrap = (children, h) => (
  <div style={{ width: '100%', height: h }} dir="ltr">{children}</div>
);

/** شريط التكبير: يظهر فقط حين تكون النقاط كثيرة */
const brush = (t, n, key = 'month', fmtFn = monthLabel) => (n > 8 ? (
  <Brush dataKey={key} height={20} travellerWidth={8} stroke={t.teal} fill={t.dark ? '#13201f' : '#f6f4ef'}
    tickFormatter={fmtFn} startIndex={Math.max(0, n - 12)} />
) : null);

/** نمو عدد المرضى (أعمدة + خط تراكمي) */
export function GrowthChart({ data = [], height = 250 }) {
  const t = useChartTheme();
  const { isHidden, legendProps } = useSeriesToggle();
  return wrap(
    <ResponsiveContainer>
      <ComposedChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        {grid(t)}
        <XAxis dataKey="month" {...axisProps(t)} tickFormatter={monthLabel} />
        <YAxis {...axisProps(t)} />
        <Tooltip content={<TooltipBox labelFormatter={monthLabel} digits={0} />} cursor={{ fill: t.cursor }} />
        <Legend {...legendProps} />
        <Bar dataKey="new_patients" name="مرضى جدد" fill={t.mint} radius={[6, 6, 0, 0]} maxBarSize={34} hide={isHidden('new_patients')} />
        <Line type="monotone" dataKey="total_patients" name="الإجمالي التراكمي" stroke={t.tealDeep} strokeWidth={2.4} dot={{ r: 2.5 }} hide={isHidden('total_patients')} />
        {brush(t, data.length)}
      </ComposedChart>
    </ResponsiveContainer>, height,
  );
}

/** متوسط الوزن ونسبة الدهون عبر الشهور */
export function WeightTrendChart({ data = [], height = 250 }) {
  const t = useChartTheme();
  const { isHidden, legendProps } = useSeriesToggle();
  return wrap(
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        {grid(t)}
        <XAxis dataKey="month" {...axisProps(t)} tickFormatter={monthLabel} />
        <YAxis {...axisProps(t)} domain={['auto', 'auto']} />
        <Tooltip content={<TooltipBox labelFormatter={monthLabel} />} />
        <Legend {...legendProps} />
        <Line type="monotone" dataKey="avg_weight" name="متوسط الوزن" unit=" كغ" stroke={t.teal} strokeWidth={2.6} dot={{ r: 3 }} activeDot={{ r: 5 }} hide={isHidden('avg_weight')} />
        <Line type="monotone" dataKey="avg_bmi" name="متوسط BMI" stroke={t.sun} strokeWidth={2.2} strokeDasharray="5 4" dot={false} hide={isHidden('avg_bmi')} />
        <Line type="monotone" dataKey="avg_fat" name="نسبة الدهون %" stroke={t.clay} strokeWidth={2} dot={false} hide={isHidden('avg_fat')} />
        {brush(t, data.length)}
      </LineChart>
    </ResponsiveContainer>, height,
  );
}

/** الإيرادات الشهرية */
export function RevenueChart({ data = [], height = 230, currency = '' }) {
  const t = useChartTheme();
  return wrap(
    <ResponsiveContainer>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.teal} stopOpacity={0.35} />
            <stop offset="100%" stopColor={t.teal} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {grid(t)}
        <XAxis dataKey="month" {...axisProps(t)} tickFormatter={monthLabel} />
        <YAxis {...axisProps(t)} />
        <Tooltip content={<TooltipBox unit={` ${currency}`} labelFormatter={monthLabel} digits={0} />} />
        <Area type="monotone" dataKey="total" name="الإيراد" stroke={t.tealDeep} strokeWidth={2.4} fill="url(#rev)" />
        {brush(t, data.length)}
      </AreaChart>
    </ResponsiveContainer>, height,
  );
}

/** الإيراد حسب نوع الخدمة — دائري تفاعلي (الضغط على شريحة يبرزها) */
export function RevenueByServicePie({ data = [], height = 280, currency = '', onSelect, selected }) {
  const t = useChartTheme();
  const total = data.reduce((s, d) => s + d.total, 0) || 1;
  const [active, setActive] = useState(null);
  return wrap(
    <ResponsiveContainer>
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="key" innerRadius="50%" outerRadius="78%" paddingAngle={2}
          stroke={t.stroke} strokeWidth={2} onMouseEnter={(_, i) => setActive(i)} onMouseLeave={() => setActive(null)}
          onClick={(d) => onSelect?.(selected === d.key ? null : d.key)}
          label={({ percent }) => (percent >= 0.06 ? `${Math.round(percent * 100)}%` : '')} labelLine={false}>
          {data.map((d, i) => (
            <Cell key={d.key} fill={t.series[i % t.series.length]} cursor="pointer"
              opacity={(selected && selected !== d.key) || (active !== null && active !== i) ? 0.45 : 1} />
          ))}
        </Pie>
        <Tooltip content={({ active: a, payload }) => (a && payload?.length ? (
          <div className="rounded-lg border border-line bg-surface/95 px-3 py-2 text-[12px] shadow-pop">
            <p className="font-extrabold">{payload[0].name}</p>
            <p className="tnum font-bold text-ink/70">{fmt(payload[0].value, 0)} {currency} · {Math.round((payload[0].value / total) * 100)}% · {payload[0].payload.n} عملية</p>
          </div>
        ) : null)} />
        <Legend wrapperStyle={{ fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }} onClick={(e) => onSelect?.(selected === e.value ? null : e.value)} />
      </PieChart>
    </ResponsiveContainer>, height,
  );
}

/** الإيراد الشهري مكدّساً حسب الخدمة (أو خدمة واحدة إن اختيرت) */
export function RevenueByMonthBars({ data = [], services = [], height = 300, currency = '', only }) {
  const t = useChartTheme();
  const { isHidden, legendProps } = useSeriesToggle();
  const shown = only ? services.filter((s) => s === only) : services;
  return wrap(
    <ResponsiveContainer>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        {grid(t)}
        <XAxis dataKey="month" {...axisProps(t)} tickFormatter={monthLabel} />
        <YAxis {...axisProps(t)} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v)} />
        <Tooltip content={<TooltipBox unit={` ${currency}`} labelFormatter={monthLabel} digits={0} />} cursor={{ fill: t.cursor }} />
        <Legend {...legendProps} />
        {shown.map((sv) => (
          <Bar key={sv} dataKey={sv} name={sv} stackId="rev" fill={t.series[services.indexOf(sv) % t.series.length]} maxBarSize={38} hide={isHidden(sv)} />
        ))}
        {!only && <Line type="monotone" dataKey="total" name="الإجمالي" stroke={t.ink} strokeOpacity={0.55} strokeWidth={1.8} strokeDasharray="4 4" dot={false} hide={isHidden('total')} />}
        {brush(t, data.length)}
      </ComposedChart>
    </ResponsiveContainer>, height,
  );
}

/** توزيع فئات BMI */
export function BmiPie({ data = [], height = 230 }) {
  const t = useChartTheme();
  const colors = [t.sun, t.leaf, t.mint, '#e0a03f', t.clay, '#a94a36'];
  return wrap(
    <ResponsiveContainer>
      <PieChart>
        <Pie data={data} dataKey="n" nameKey="label" innerRadius="52%" outerRadius="80%" paddingAngle={2}
             strokeWidth={2} stroke={t.stroke}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
        <Tooltip content={<TooltipBox digits={0} />} />
        <Legend wrapperStyle={{ fontSize: 11.5, fontWeight: 700 }} />
      </PieChart>
    </ResponsiveContainer>, height,
  );
}

/** تطور مريض واحد في ملفه */
export function PatientProgressChart({ series = [], height = 240, show = ['weight_kg', 'bmi'] }) {
  const t = useChartTheme();
  const { isHidden, legendProps } = useSeriesToggle();
  const data = series.map((s) => ({ ...s, label: `#${s.visit_no} ${String(s.date).slice(5)}` }));
  return wrap(
    <ResponsiveContainer>
      <ComposedChart data={data} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="w" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.teal} stopOpacity={0.3} />
            <stop offset="100%" stopColor={t.teal} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {grid(t)}
        <XAxis dataKey="label" {...axisProps(t)} />
        <YAxis {...axisProps(t)} domain={['auto', 'auto']} />
        <Tooltip content={<TooltipBox />} />
        <Legend {...legendProps} />
        {show.includes('weight_kg') && <Area type="monotone" dataKey="weight_kg" name="الوزن كغ" stroke={t.teal} strokeWidth={2.6} fill="url(#w)" hide={isHidden('weight_kg')} />}
        {show.includes('bmi') && <Line type="monotone" dataKey="bmi" name="BMI" stroke={t.sun} strokeWidth={2.2} dot={false} hide={isHidden('bmi')} />}
        {show.includes('waist_cm') && <Line type="monotone" dataKey="waist_cm" name="الخصر سم" stroke={t.clay} strokeWidth={2} strokeDasharray="4 4" dot={false} hide={isHidden('waist_cm')} />}
        {show.includes('body_fat_pct') && <Line type="monotone" dataKey="body_fat_pct" name="دهون %" stroke={t.leaf} strokeWidth={2} dot={false} hide={isHidden('body_fat_pct')} />}
        {brush(t, data.length, 'label', (x) => x)}
      </ComposedChart>
    </ResponsiveContainer>, height,
  );
}

/**
 * ملف المريض: الالتزام (أعمدة %) مقابل الوزن (خط) والتقدّم الأسبوعي (خط متقطع) عبر الزيارات.
 * محوران: يسار للنسبة 0–100، يمين للكيلوغرام.
 */
export function AdherenceWeightChart({ points = [], height = 260 }) {
  const t = useChartTheme();
  const { isHidden, legendProps } = useSeriesToggle(['weekly_progress_kg']);
  const data = points.map((p) => ({ ...p, label: String(p.date).slice(5) }));
  const tone = (a) => (a >= 90 ? t.leaf : a >= 75 ? t.teal : a >= 50 ? t.sun : t.clay);
  return wrap(
    <ResponsiveContainer>
      <ComposedChart data={data} margin={{ top: 8, right: 0, left: -12, bottom: 0 }}>
        {grid(t)}
        <XAxis dataKey="label" {...axisProps(t)} />
        <YAxis yAxisId="pct" domain={[0, 100]} {...axisProps(t)} tickFormatter={(v) => `${v}%`} />
        <YAxis yAxisId="kg" orientation="right" domain={['auto', 'auto']} {...axisProps(t)} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: t.cursor }} />
        <Legend {...legendProps} />
        <Bar yAxisId="pct" dataKey="adherence" name="الالتزام" unit="%" maxBarSize={26} radius={[6, 6, 0, 0]} hide={isHidden('adherence')}>
          {data.map((d) => <Cell key={d.visit_id} fill={tone(d.adherence)} />)}
        </Bar>
        <Line yAxisId="kg" type="monotone" dataKey="weight_kg" name="الوزن" unit=" كغ" stroke={t.tealDeep} strokeWidth={2.4} dot={{ r: 3 }} connectNulls hide={isHidden('weight_kg')} />
        <Line yAxisId="kg" type="monotone" dataKey="weekly_progress_kg" name="التقدّم الأسبوعي" unit=" كغ" stroke={t.clay} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2.5 }} connectNulls hide={isHidden('weekly_progress_kg')} />
      </ComposedChart>
    </ResponsiveContainer>, height,
  );
}

/** التقارير: كل زيارة نقطة (الالتزام × التقدّم الأسبوعي) — هل الالتزام الأعلى يعني نتيجة أفضل؟ */
export function AdherenceScatter({ points = [], height = 300 }) {
  const t = useChartTheme();
  const lose = points.filter((p) => p.weekly_progress_kg !== null && p.goal !== 'gain');
  const gain = points.filter((p) => p.weekly_progress_kg !== null && p.goal === 'gain');
  const tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
      <div className="rounded-lg border border-line bg-surface/95 px-3 py-2 text-[12px] shadow-pop">
        <p className="font-extrabold">{p.patient_name} <span className="text-ink/45 tnum">{p.file_no}</span></p>
        <p className="tnum font-bold text-ink/70">{p.date} · التزام {p.adherence}%</p>
        <p className="tnum font-bold text-ink/70">تقدّم {fmt(p.weekly_progress_kg, 2)} كغ/أسبوع{p.goal === 'gain' ? ' (هدف زيادة)' : ''}</p>
      </div>
    );
  };
  return wrap(
    <ResponsiveContainer>
      <ScatterChart margin={{ top: 10, right: 12, left: -10, bottom: 4 }}>
        {grid(t)}
        <XAxis type="number" dataKey="adherence" name="الالتزام" domain={[0, 100]} unit="%" {...axisProps(t)} />
        <YAxis type="number" dataKey="weekly_progress_kg" name="التقدّم" unit=" كغ" {...axisProps(t)} />
        <ZAxis range={[46, 46]} />
        <ReferenceLine y={0} stroke={t.ref} strokeOpacity={0.35} />
        <Tooltip content={tip} cursor={{ strokeDasharray: '3 3' }} />
        <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
        <Scatter name="هدف إنقاص الوزن" data={lose} fill={t.teal} fillOpacity={0.75} />
        {gain.length > 0 && <Scatter name="هدف زيادة الوزن" data={gain} fill={t.sun} fillOpacity={0.8} shape="diamond" />}
      </ScatterChart>
    </ResponsiveContainer>, height,
  );
}

/** متوسط التقدّم الأسبوعي لكل شريحة التزام */
export function AdherenceBandsChart({ bands = [], height = 230 }) {
  const t = useChartTheme();
  const colors = { low: t.clay, mid: t.sun, good: t.teal, excellent: t.leaf };
  const data = bands.map((b) => ({ ...b, name: b.label, value: b.avg_weekly_progress_kg ?? b.avg_weekly_loss_kg }));
  return wrap(
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 16, right: 8, left: -14, bottom: 0 }}>
        {grid(t)}
        <XAxis dataKey="name" {...axisProps(t)} interval={0} tick={{ ...axisProps(t).tick, fontSize: 10.5 }} />
        <YAxis {...axisProps(t)} unit=" كغ" />
        <ReferenceLine y={0} stroke={t.ref} strokeOpacity={0.35} />
        <Tooltip content={({ active, payload }) => (active && payload?.length ? (
          <div className="rounded-lg border border-line bg-surface/95 px-3 py-2 text-[12px] shadow-pop">
            <p className="font-extrabold">{payload[0].payload.label}</p>
            <p className="tnum font-bold text-ink/70">{fmt(payload[0].value, 2)} كغ/أسبوع · {payload[0].payload.visits} زيارة</p>
          </div>
        ) : null)} cursor={{ fill: t.cursor }} />
        <Bar dataKey="value" name="متوسط التقدّم الأسبوعي" radius={[6, 6, 0, 0]} maxBarSize={56}
          label={{ position: 'top', fill: t.axis, fontSize: 11, fontWeight: 800, formatter: (v) => (v === null || v === undefined ? '' : fmt(v, 2)) }}>
          {data.map((d) => <Cell key={d.key} fill={colors[d.key] || t.teal} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>, height,
  );
}

/** توزيع المواعيد على أيام الأسبوع */
export function WeekdayChart({ data = [], height = 190 }) {
  const t = useChartTheme();
  return wrap(
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
        {grid(t)}
        <XAxis dataKey="label" {...axisProps(t)} />
        <YAxis {...axisProps(t)} allowDecimals={false} />
        <Tooltip content={<TooltipBox digits={0} />} cursor={{ fill: t.cursor }} />
        <Bar dataKey="n" name="مواعيد" fill={t.teal} radius={[6, 6, 0, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>, height,
  );
}
