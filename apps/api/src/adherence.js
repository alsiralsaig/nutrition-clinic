// الالتزام بالخطة الغذائية مقابل تغيّر الوزن — منطق مشترك بين ملف المريض والتقارير
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

export const ADHERENCE_BANDS = [
  { key: 'low', label: 'ضعيف (أقل من 50٪)', min: 0, max: 49 },
  { key: 'mid', label: 'متوسط (50–74٪)', min: 50, max: 74 },
  { key: 'good', label: 'جيد (75–89٪)', min: 75, max: 89 },
  { key: 'excellent', label: 'ممتاز (90–100٪)', min: 90, max: 100 },
];
export const bandOf = (a) => ADHERENCE_BANDS.find((b) => a >= b.min && a <= b.max) || null;

/** معامل ارتباط بيرسون (null إن كانت النقاط أقل من 3 أو بلا تباين) */
export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (!sxx || !syy) return null;
  return r2(sxy / Math.sqrt(sxx * syy));
}

/**
 * اتجاه الهدف: 1 = إنقاص الوزن (النزول تقدّم)، ‎-1 = زيادة الوزن (الصعود تقدّم).
 * يُستنتج من الوزن المستهدف مقارنة بوزن البداية؛ الافتراضي إنقاص.
 */
export function goalDirection(patient) {
  const s = Number(patient?.start_weight); const g = Number(patient?.goal_weight);
  return s && g && g > s ? -1 : 1;
}

/**
 * لكل زيارة فيها تقييم التزام: الوزن في تلك الزيارة، والنزول منذ القياس السابق
 * (موجب = نزول)، ومعدّله الأسبوعي — كي تُقارن فترات مختلفة الطول بعدل.
 */
export function adherenceSeries(visits, measurements, direction = 1) {
  const ms = [...measurements].filter((m) => m.weight_kg != null)
    .sort((a, b) => (a.measured_on + String(a.id).padStart(9, '0')).localeCompare(b.measured_on + String(b.id).padStart(9, '0')));
  const start = ms[0]?.weight_kg ?? null;
  const points = [];
  for (const v of [...visits].sort((a, b) => a.visit_date.localeCompare(b.visit_date) || a.id - b.id)) {
    if (v.adherence === null || v.adherence === undefined) continue;
    const cur = ms.find((m) => m.visit_id === v.id) || ms.filter((m) => m.measured_on === v.visit_date).at(-1);
    const prev = cur ? ms.filter((m) => m !== cur && (m.measured_on < cur.measured_on || (m.measured_on === cur.measured_on && m.id < cur.id))).at(-1) : null;
    const days = cur && prev ? Math.max(1, Math.round((new Date(cur.measured_on) - new Date(prev.measured_on)) / 864e5)) : null;
    const loss = cur && prev ? r1(prev.weight_kg - cur.weight_kg) : null;
    points.push({
      visit_id: v.id, date: v.visit_date, adherence: v.adherence, band: bandOf(v.adherence)?.key ?? null,
      notes: v.adherence_notes ?? null,
      weight_kg: cur?.weight_kg ?? null,
      loss_kg: loss, days,
      weekly_loss_kg: loss !== null && days ? r2((loss / days) * 7) : null,
      // التقدّم نحو الهدف (موجب = في الاتجاه الصحيح) — عادل لمرضى زيادة الوزن أيضاً
      weekly_progress_kg: loss !== null && days ? r2((loss / days) * 7 * direction) : null,
      total_loss_kg: cur && start !== null ? r1(start - cur.weight_kg) : null,
    });
  }
  const paired = points.filter((p) => p.weekly_progress_kg !== null);
  const avg = points.length ? Math.round(points.reduce((s, p) => s + p.adherence, 0) / points.length) : null;
  return {
    points,
    average_adherence: avg,
    last_adherence: points.at(-1)?.adherence ?? null,
    direction,
    correlation: pearson(paired.map((p) => p.adherence), paired.map((p) => p.weekly_progress_kg)),
    pairs: paired.length,
  };
}

/** متوسط التقدّم الأسبوعي نحو الهدف لكل شريحة التزام (لتقرير العيادة كلها) */
export function bandsSummary(points) {
  return ADHERENCE_BANDS.map((b) => {
    const ps = points.filter((p) => p.adherence >= b.min && p.adherence <= b.max && p.weekly_progress_kg !== null);
    const avg = ps.length ? r2(ps.reduce((s, p) => s + p.weekly_progress_kg, 0) / ps.length) : null;
    return {
      ...b,
      visits: ps.length,
      avg_weekly_progress_kg: avg,
      avg_weekly_loss_kg: avg, // اسم قديم للتوافق
    };
  });
}
