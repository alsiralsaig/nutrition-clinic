// اختبار دخاني شامل للـ API عبر HTTP حقيقي (يشغّل الخادم على منفذ مؤقت)
// node apps/api/test/smoke.test.js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.join(__dirname, '..', 'src');
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-test-'));

const results = [];
let failures = 0;
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  if (!cond) { failures++; console.error(`  ✗ ${name} ${extra}`); }
  else console.log(`  ✓ ${name}`);
}

async function req(method, url, { body, token } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ملفات ثنائية/نص */ }
  return { status: res.status, json, text };
}

const server = spawn(process.execPath, [path.join(API_DIR, 'server.js')], {
  env: { ...process.env, PORT, HOST: '127.0.0.1', CLINIC_DATA_DIR: DATA, JWT_SECRET: 'test-secret', ADMIN_PASSWORD: 'admin123' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const waitReady = async () => {
  for (let i = 0; i < 100; i++) {
    try { const r = await req('GET', '/api/health'); if (r.status === 200) return true; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

try {
  check('الخادم يقلع ويصلح health', await waitReady(), serverLog.slice(-400));

  // ---------- الحماية ----------
  check('منع الوصول بدون توكن', (await req('GET', '/api/patients')).status === 401);
  check('رفض كلمة مرور خاطئة', (await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'nope' } })).status === 400);
  const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  check('تسجيل دخول ناجح يعيد JWT', login.status === 200 && !!login.json?.token, JSON.stringify(login.json));
  const token = login.json?.token;
  check('/auth/me يرجع بيانات المستخدم', (await req('GET', '/api/auth/me', { token })).json?.user?.role === 'admin');

  // ---------- مريض جديد + رقم ملف تلقائي ----------
  const before = (await req('GET', '/api/patients?limit=1', { token })).json.total;
  const created = await req('POST', '/api/patients', {
    token,
    body: { first_name: 'اختبار', last_name: 'النظام', phone: '0911223344', birth_date: '1992-05-14', gender: 'female', height_cm: 165, start_weight: 88, goal_weight: 70, goal: 'إنقاص 18 كجم', notes: 'حالة اختبار آلية' },
  });
  check('إنشاء مريض', created.status === 201, JSON.stringify(created.json));
  const pid = created.json?.id;
  check('رقم ملف تلقائي بصيغة NC-000x', /^NC-\d{4}$/.test(created.json?.file_no || ''), created.json?.file_no);
  check('BMI محسوب في السيرفر = 32.3', Math.abs((created.json?.start_bmi ?? 0) - 32.3) < 0.15, String(created.json?.start_bmi));
  check('تصنيف السمنة صحيح', created.json?.start_bmi_category === 'سمنة درجة أولى', created.json?.start_bmi_category);
  check('الوزنIdeal محسوب', typeof created.json?.ideal_weight === 'number', String(created.json?.ideal_weight));
  check('عدد المرضى زاد بواحد', (await req('GET', '/api/patients?limit=1', { token })).json.total === before + 1);

  // ---------- البحث السريع ----------
  const found = await req('GET', '/api/patients?q=' + encodeURIComponent('اختبار'), { token });
  check('البحث بالاسم يجد المريض', found.json?.items?.some((i) => i.id === pid));
  const foundByPhone = await req('GET', '/api/patients?q=0911223344', { token });
  check('البحث بالهاتف يجد المريض', foundByPhone.json?.items?.some((i) => i.id === pid));
  const foundByFile = await req('GET', '/api/patients?q=' + encodeURIComponent(created.json.file_no), { token });
  check('البحث برقم الملف', foundByFile.json?.items?.some((i) => i.id === pid));

  // ---------- رفض مدخلات غير منطقية ----------
  check('رفض تاريخ ميلاد بصيغة خاطئة', (await req('POST', '/api/patients', { token, body: { first_name: 'x', last_name: 'y', birth_date: '14/05/1992' } })).status === 400);
  check('رفض اسم فارغ', (await req('POST', '/api/patients', { token, body: { first_name: '  ', last_name: 'z' } })).status === 400);
  check('رفض وزن غير منطقي', (await req('POST', '/api/patients', { token, body: { first_name: 'a', last_name: 'b', start_weight: 900 } })).status === 400);

  // ---------- زيارة + قياسات ----------
  const visit = await req('POST', '/api/visits', { token, body: { patient_id: pid, visit_date: '2026-09-01', visit_type: 'initial', reason: 'أول تقييم' } });
  check('تسجيل زيارة', visit.status === 201);
  const m1 = await req('POST', '/api/measurements', { token, body: { patient_id: pid, visit_id: visit.json?.id, measured_on: '2026-09-01', weight_kg: 88, waist_cm: 102, chest_cm: 104, hip_cm: 112, body_fat_pct: 38 } });
  check('تسجيل قياسات أول زيارة', m1.status === 201);
  check('BMI في القياس = 32.3', m1.json?.bmi === 32.3, String(m1.json?.bmi));
  const m2 = await req('POST', '/api/measurements', { token, body: { patient_id: pid, measured_on: '2026-09-20', weight_kg: 84.5, waist_cm: 98.5, body_fat_pct: 35.4 } });
  check('تسجيل قياسات زيارة تانية', m2.status === 201 && m2.json?.bmi === 31.0, JSON.stringify(m2.json?.bmi));
  check('نسبة الخصر/الورك محسوبة', m1.json?.waist_hip_ratio === 0.91, String(m1.json?.waist_hip_ratio));
  check('رفض قياس بلا وزن', (await req('POST', '/api/measurements', { token, body: { patient_id: pid, measured_on: '2026-09-21', waist_cm: 90 } })).status === 400);

  // ---------- حماية الصيغ: العميل لا يستطيع تزوير BMI ----------
  const forged = await req('POST', '/api/measurements', { token, body: { patient_id: pid, measured_on: '2026-09-22', weight_kg: 80, bmi: 12.3 } });
  check('حقن BMI مزوّر يُتجاهل ويُعاد حسابه', forged.json?.bmi === 29.4, String(forged.json?.bmi));

  // ---------- تعديل وتحديث ----------
  const upd = await req('PUT', `/api/patients/${pid}`, { token, body: { notes: 'ملاحظة معدّلة', goal_weight: 72 } });
  check('تعديل بيانات المريض', upd.json?.notes === 'ملاحظة معدّلة' && upd.json?.goal_weight === 72, JSON.stringify(upd.json?.notes));
  check('رقم الملف لا يتغير بالتحديث', upd.json?.file_no === created.json.file_no);
  const lastMeas = (await req('GET', `/api/measurements?patient_id=${pid}`, { token })).json.items[0];
  const measUpd = await req('PUT', `/api/measurements/${lastMeas.id}`, { token, body: { weight_kg: 79.5 } });
  check('تعديل قياس يعيد حساب BMI', measUpd.json?.bmi === 29.2, String(measUpd.json?.bmi));
  check('تعديل قياس يبقي باقي القيم', measUpd.json?.measured_on === lastMeas.measured_on);

  // ---------- برنامج غذائي ----------
  const plan = await req('POST', '/api/diet-plans', {
    token,
    body: {
      patient_id: pid, title: 'برنامج إنقاص — اختبار', target_kcal: 1600, status: 'draft',
      meals: [
        { slot: 'الفطور', slot_time: '08:00', title: 'توست وبيض', items: 'توست أسمر + بيضتان', portions: '60غ + 2 حبة', kcal: 300, protein_g: 20, carbs_g: 25, fat_g: 12 },
        { slot: 'الغداء', slot_time: '14:00', title: 'دجاج وأرز', items: 'صدور + أرز بني', portions: '150غ + كوب', kcal: 500, protein_g: 42, carbs_g: 45, fat_g: 10 },
        { slot: 'العشاء', slot_time: '20:00', title: 'زبادي ومكسرات', items: 'زبادي + لوز', portions: 'كوب + 15غ', kcal: 250, protein_g: 12, carbs_g: 14, fat_g: 15 },
      ],
    },
  });
  check('إنشاء برنامج غذائي بوجبات', plan.status === 201 && plan.json?.meals?.length === 3, JSON.stringify(plan.json).slice(0, 200));
  check('وجبة بلا عنوان تأخذ اسم الوقت', plan.json?.meals?.every((m) => !!m.title));
  check('مجموع السعرات محسوب = 1050', plan.json?.totals?.kcal === 1050, JSON.stringify(plan.json?.totals));
  check('مجموع البروتين محسوب = 74', plan.json?.totals?.protein_g === 74);
  const editPlan = await req('PUT', `/api/diet-plans/${plan.json?.id}`, { token, body: { meals: [{ slot: 'الفطور', kcal: 400, protein_g: 25 }] } });
  check('تعديل البرنامج يستبدل الوجبات', editPlan.json?.meals?.length === 1 && editPlan.json?.totals?.kcal === 400);
  check('تفعيل البرنامج', (await req('POST', `/api/diet-plans/${plan.json?.id}/activate`, { token })).json?.status === 'active');
  check('نسخ برنامج مسموح', (await req('POST', `/api/diet-plans/${plan.json?.id}/duplicate`, { token })).status === 201);

  // ---------- المواعيد ----------
  // «اليوم» بتوقيت العيادة (نفس ما يستخدمه الخادم) كي لا يفشل الاختبار قرب منتصف الليل UTC
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.CLINIC_TZ || 'Africa/Khartoum' }).format(new Date());
  const t0 = (await req('GET', '/api/appointments/today', { token })).json.total;
  const appt = await req('POST', '/api/appointments', { token, body: { patient_id: pid, date: today, time: '21:15', duration_min: 45, visit_type: 'followup' } });
  check('تسجيل موعد', appt.status === 201);
  check('مواعيد اليوم زادت', (await req('GET', '/api/appointments/today', { token })).json.total === t0 + 1);
  check('منع تداخل نفس الوقت', (await req('POST', '/api/appointments', { token, body: { patient_id: pid, date: today, time: '21:15' } })).status === 409);
  check('رفض ساعة غير صالحة', (await req('POST', '/api/appointments', { token, body: { patient_id: pid, date: today, time: '25:99' } })).status === 400);
  const done = await req('POST', `/api/appointments/${appt.json?.id}/status`, { token, body: { status: 'done' } });
  check('تحويل الموعد إلى «تم»', done.json?.status === 'done');
  const visitsAfter = (await req('GET', `/api/visits?patient_id=${pid}`, { token })).json.items.length;
  check('إنشاء زيارة تلقائياً عند إتمام الموعد', visitsAfter === 2, String(visitsAfter));

  // ---------- المدفوعات والإيرادات ----------
  const revBefore = (await req('GET', '/api/dashboard/summary', { token })).json.revenue.total;
  const pay = await req('POST', '/api/payments', { token, body: { patient_id: pid, paid_on: today, service: 'برنامج غذائي جديد', amount: 1200, method: 'mobile_wallet' } });
  check('تسجيل دفعة', pay.status === 201);
  const revAfter = (await req('GET', '/api/dashboard/summary', { token })).json.revenue.total;
  check('الإيراد الكلي زاد بالمبلغ', revAfter - revBefore === 1200, `${revBefore} → ${revAfter}`);
  await req('POST', `/api/payments/${pay.json?.id}/void`, { token, body: {} });
  check('إلغاء الدفعة يُسقطها من الإيراد', (await req('GET', '/api/dashboard/summary', { token })).json.revenue.total === revBefore);
  check('رفض مبلغ سالب', (await req('POST', '/api/payments', { token, body: { patient_id: pid, paid_on: today, service: 'x', amount: -50 } })).status === 400);
  const summary = (await req('GET', '/api/payments/summary', { token })).json;
  check('ملخص الإيرادات فيه تقسيم شهري وخدمي', Array.isArray(summary?.monthly) && Array.isArray(summary?.byService));

  // ---------- ملف المريض الشامل ----------
  const prof = await req('GET', `/api/patients/${pid}/profile`, { token });
  const P = prof.json;
  check('ملف المريض يرجع في استجابة واحدة', prof.status === 200);
  check('  ├ بيانات المريض', P?.patient?.file_no === created.json.file_no);
  check('  ├ الزيارات', P?.visits?.length >= 1);
  check('  ├ القياسات 3', P?.measurements?.length === 3, String(P?.measurements?.length));
  check('  ├ سلسلة تطور الوزن فيها الفرق عن البداية', P?.weight_series?.length === 3 && P.weight_series[1].delta_vs_start === -3.5, JSON.stringify(P?.weight_series?.[1]));
  check('  ├ البرنامج الغذائي الحالي', !!P?.active_plan);
  check('  ├ المواعيد', Array.isArray(P?.appointments));
  check('  ├ المدفوعات', Array.isArray(P?.payments));
  check('  ├ الإجمالي المدفوع = 0 بعد الإلغاء', P?.financials?.paid_total === 0, String(P?.financials?.paid_total));

  check('حذف قياس مسموح', (await req('DELETE', `/api/measurements/${(await req('GET', `/api/measurements?patient_id=${pid}`, { token })).json.items[0].id}`, { token })).json?.deleted === true);
  check('الملف يتحدث بعد الحذف', (await req('GET', `/api/patients/${pid}/profile`, { token })).json.measurements.length === 2);
  check('404 لمريض غير موجود', (await req('GET', '/api/patients/999999', { token })).status === 404);

  // ---------- اللوحة ----------
  const dash = await req('GET', '/api/dashboard/summary', { token });
  check('Dashboard: عدد المرضى + النشطون', typeof dash.json?.patients?.total === 'number' && typeof dash.json?.patients?.active === 'number');
  check('Dashboard: مواعيد اليوم', typeof dash.json?.appointments?.today === 'number');
  check('Dashboard: الإيرادات', typeof dash.json?.revenue?.month === 'number');
  check('Dashboard: إحصائيات المتابعة (متوسط النزول)', 'avg_weight_loss_kg' in (dash.json?.followUp || {}));
  const charts = await req('GET', '/api/dashboard/charts', { token });
  check('Dashboard: رسوم الإيرادات والنمو والتوزيع', ['revenue', 'patientGrowth', 'measurements', 'bmiDistribution', 'weightProgressTop', 'weekdays'].every((k) => Array.isArray(charts.json?.[k])), JSON.stringify(Object.keys(charts.json || {})));

  // ---------- التقارير ----------
  check('تقرير مريض كامل', (await req('GET', `/api/reports/patient/${pid}`, { token })).json?.patient?.id === pid);
  const wp = await req('GET', `/api/reports/weight-progress/${pid}`, { token });
  check('تقرير تطور الوزن فيه الإجمالي', wp.json?.summary?.total_loss === 3.5, String(wp.json?.summary?.total_loss));
  check('تقرير الزيارات', Array.isArray((await req('GET', '/api/reports/visits?from=2026-01-01&to=2026-12-31', { token })).json?.rows));
  const rev = await req('GET', '/api/reports/revenue?from=2020-01-01&to=2030-01-01', { token });
  check('تقرير الإيرادات فيه المتوسطات', typeof rev.json?.average === 'number' && Array.isArray(rev.json?.by_service));
  check('تصدير CSV بترميم عربي', (await req('GET', '/api/reports/export/patients', { token })).text.startsWith('\uFEFF"file_no"') === false && (await req('GET', '/api/reports/export/patients', { token })).text.includes('رقم الملف'));
  check('سجل التدقيق يسجل العمليات', (await req('GET', '/api/reports/audit?limit=100', { token })).json.items.some((i) => i.action === 'patient.create'));

  // ---------- الأدوار ----------
  const doc = await req('POST', '/api/auth/login', { body: { username: 'reception', password: 'reception123' } });
  const vtoken = doc.json?.token;
  check('دخول حساب viewer', doc.status === 200);
  check('viewer لا يستطيع الكتابة', (await req('POST', '/api/patients', { token: vtoken, body: { first_name: 'لا', last_name: 'يستطيع' } })).status === 403);
  check('viewer يقرأ التقارير', (await req('GET', '/api/patients?limit=1', { token: vtoken })).status === 200);
  check('viewer لا يصل لإدارة المستخدمين', (await req('GET', '/api/auth/users', { token: vtoken })).status === 403);
  check('viewer لا يستطيع الاستعادة', (await req('POST', '/api/restore', { token: vtoken, body: { tables: {} } })).status === 403);

  // ---------- النسخ الاحتياطي ----------
  const backup = await req('GET', '/api/backup', { token });
  check('نسخة احتياطية JSON فيها الجداول الـ15 (مع سجل الرسائل والعادات وقائمة الانتظار)', Object.keys(backup.json?.tables || {}).length === 15 && ['message_log', 'habit_logs', 'waitlist'].every((t) => t in (backup.json?.tables || {})), JSON.stringify(Object.keys(backup.json?.tables || {})));
  check('نسخة المرضى محفوظة', backup.json?.tables?.patients?.some((p) => p.id === pid));
  const raw = await fetch(`${BASE}/api/backup/file`, { headers: { authorization: `Bearer ${token}` } });
  check('تنزيل ملف النسخة الاحتياطية بحجم منطقي', raw.ok && Number(raw.headers.get('content-length')) > 4096 && /\.json/.test(raw.headers.get('content-disposition') || ''), String(raw.headers.get('content-length')));
  check(' Vacuum/فحص سلامة القاعدة', (await req('POST', '/api/maintenance/vacuum', { token })).json?.ok === true);
  const bad = await req('POST', '/api/restore', { token, body: { nope: 1 } });
  check('رفض ملف استعادة غير صالح', bad.status === 400);
  const restored = await req('POST', `/api/restore`, { token, body: backup.json });
  check('استعادة ناجحة من نفس النسخة', restored.json?.restored === true);
  check('المريض موجود بعد الاستعادة', (await req('GET', `/api/patients/${pid}`, { token })).status === 200);

  // ---------- إعدادات ----------
  await req('PUT', '/api/settings', { token, body: { 'clinic.name': 'عيادة اختبار' } });
  check('تحديث إعداد مسموح', (await req('GET', '/api/settings', { token })).json.settings['clinic.name'] === 'عيادة اختبار');
  check('رفض مفتاح إعداد خارج النطاق', (await req('PUT', '/api/settings', { token, body: { 'evil.key': 'x' } })).status === 400);

  // ---------- الموبايل: نفس الـ API يعمل بالتوكن عبر CORS ----------
  const pre = await fetch(`${BASE}/api/patients?limit=1`, { method: 'OPTIONS', headers: { Origin: 'https://app.clinic.test' } });
  check('CORS يسمح لعميل خارجي (تطبيق موبايل)', pre.headers.get('access-control-allow-origin') === '*');
  check('توثيق OpenAPI متاح لتطبيق الموبايل', (await req('GET', '/openapi.json')).status === 200);
} catch (e) {
  failures++;
  console.error('EXCEPTION', e);
} finally {
  server.kill('SIGTERM');
  fs.rmSync(DATA, { recursive: true, force: true });
}

console.log(`\n${results.length - failures}/${results.length} نجحت${failures ? ` — ${failures} فشلت` : ''}`);
if (failures) process.exit(1);
