import React from 'react';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { fmt, monthLabel } from '../format.js';

const AXIS = { tick: { fill: '#1c2b2a', opacity: 0.55, fontSize: 11, fontWeight: 700 }, axisLine: false, tickLine: false };
const GRID = <CartesianGrid stroke="#e6e1d8" strokeDasharray="3 5" vertical={false} />;

const TooltipBox = ({ active, payload, label, unit = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-white/95 px-3 py-2 text-[12px] shadow-pop backdrop-blur">
      <p className="mb-1 font-extrabold text-ink/70">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-4 tnum">
          <span className="flex items-center gap-1.5 font-bold text-ink/60">
            <i className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}
          </span>
          <span className="font-extrabold">{fmt(p.value, 1)}{unit}</span>
        </p>
      ))}
    </div>
  );
};

const wrap = (children, h) => (
  <div style={{ width: '100%', height: h }}>{children}</div>
);

/** نمو عدد المرضى (أعمدة + خط تراكمي) */
export function GrowthChart({ data = [], height = 250 }) {
  return wrap(
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="month" {...AXIS} tickFormatter={monthLabel} />
        <YAxis {...AXIS} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: '#effaf8' }} />
        <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
        <Bar dataKey="new_patients" name="مرضى جدد" fill="#78d2ca" radius={[6, 6, 0, 0]} maxBarSize={34} />
        <Bar dataKey="total_patients" name="الإجمالي التراكمي" fill="#0f6360" radius={[6, 6, 0, 0]} maxBarSize={34} />
      </BarChart>
    </ResponsiveContainer>, height,
  );
}

/** متوسط الوزن ونسبة الدهون عبر الشهور */
export function WeightTrendChart({ data = [], height = 250 }) {
  return wrap(
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="month" {...AXIS} tickFormatter={monthLabel} />
        <YAxis {...AXIS} domain={['auto', 'auto']} />
        <Tooltip content={<TooltipBox unit=" كغ" />} />
        <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
        <Line type="monotone" dataKey="avg_weight" name="متوسط الوزن" stroke="#157c77" strokeWidth={2.6} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        <Line type="monotone" dataKey="avg_bmi" name="متوسط BMI" stroke="#d69a19" strokeWidth={2.2} strokeDasharray="5 4" dot={false} />
        <Line type="monotone" dataKey="avg_fat" name="نسبة الدهون %" stroke="#c9604a" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>, height,
  );
}

/** الإيرادات الشهرية */
export function RevenueChart({ data = [], height = 230, currency = '' }) {
  return wrap(
    <ResponsiveContainer>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#229a92" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#229a92" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {GRID}
        <XAxis dataKey="month" {...AXIS} tickFormatter={monthLabel} />
        <YAxis {...AXIS} />
        <Tooltip content={<TooltipBox unit={` ${currency}`} />} />
        <Area type="monotone" dataKey="total" name="الإيراد" stroke="#0f6360" strokeWidth={2.4} fill="url(#rev)" />
      </AreaChart>
    </ResponsiveContainer>, height,
  );
}

/** توزيع فئات BMI */
const BMI_COLORS = ['#d69a19', '#5aa843', '#78d2ca', '#e0a03f', '#c9604a', '#a94a36'];
export function BmiPie({ data = [], height = 230 }) {
  return wrap(
    <ResponsiveContainer>
      <PieChart>
        <Pie data={data} dataKey="n" nameKey="label" innerRadius="52%" outerRadius="80%" paddingAngle={2}
             strokeWidth={2} stroke="#fff">
          {data.map((_, i) => <Cell key={i} fill={BMI_COLORS[i % BMI_COLORS.length]} />)}
        </Pie>
        <Tooltip content={<TooltipBox />} />
        <Legend wrapperStyle={{ fontSize: 11.5, fontWeight: 700 }} />
      </PieChart>
    </ResponsiveContainer>, height,
  );
}

/** تطور مريض واحد في ملفه */
export function PatientProgressChart({ series = [], height = 240, show = ['weight_kg', 'bmi'] }) {
  const labels = series.map((s) => `#${s.visit_no} ${String(s.date).slice(5)}`);
  const data = series.map((s, i) => ({ ...s, label: labels[i] }));
  return wrap(
    <ResponsiveContainer>
      <AreaChart data={data} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="w" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#229a92" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#229a92" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {GRID}
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} domain={['auto', 'auto']} />
        <Tooltip content={<TooltipBox />} />
        <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
        {show.includes('weight_kg') && <Area type="monotone" dataKey="weight_kg" name="الوزن كغ" stroke="#157c77" strokeWidth={2.6} fill="url(#w)" />}
        {show.includes('bmi') && <Line type="monotone" dataKey="bmi" name="BMI" stroke="#d69a19" strokeWidth={2.2} dot={false} />}
        {show.includes('waist_cm') && <Line type="monotone" dataKey="waist_cm" name="الخصر سم" stroke="#c9604a" strokeWidth={2} strokeDasharray="4 4" dot={false} />}
        {show.includes('body_fat_pct') && <Line type="monotone" dataKey="body_fat_pct" name="دهون %" stroke="#468735" strokeWidth={2} dot={false} />}
      </AreaChart>
    </ResponsiveContainer>, height,
  );
}

/** توزيع المواعيد على أيام الأسبوع */
export function WeekdayChart({ data = [], height = 190 }) {
  return wrap(
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} allowDecimals={false} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: '#effaf8' }} />
        <Bar dataKey="n" name="مواعيد" fill="#43b7ae" radius={[6, 6, 0, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>, height,
  );
}
