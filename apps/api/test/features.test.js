// اختبار الميزات الذكية عبر HTTP حقيقي:
//   الخطة الأسبوعية · قائمة التسوق · الالتزام مقابل الوزن · التنبيهات · واتساب (رابط + API وهمي) · المهمة اليومية · CSV
// node apps/api/test/features.test.js         (PGlite مؤقت)
// DATABASE_URL=postgres://… node apps/api/test/features.test.js   (Postgres حقيقي — قاعدة فارغة مخصصة للاختبار)
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const PORT = 4400 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-feat-'));

const results = [];
let failures = 0;
function check(name, cond, extra = '') {
  results.push(name);
  if (!cond) { failures++; console.error(`  ✗ ${name} ${extra}`); } else console.log(`  ✓ ${name}`);
}
async function req(method, url, { body, token, headers = {} } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV */ }
  return { status: res.status, json, text, headers: res.headers };
}

// ---------- خادم واتساب وهمي (يحاكي graph.facebook.com) ----------
const waCalls = [];
const mock = http.createServer((rq, rs) => {
  let b = '';
  rq.on('data', (d) => { b += d; });
  rq.on('end', () => {
    const body = JSON.parse(b || '{}');
    waCalls.push({ path: rq.url, auth: rq.headers.authorization, body });
    if (body.to === '249900000000') { rs.writeHead(400, { 'content-type': 'application/json' }); return rs.end(JSON.stringify({ error: { message: 'Recipient not on WhatsApp' } })); }
    rs.writeHead(200, { 'content-type': 'application/json' });
    rs.end(JSON.stringify({ messages: [{ id: `wamid.${waCalls.length}` }] }));
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const MOCK_BASE = `http://127.0.0.1:${mock.address().port}`;

let server = null;
let serverLog = '';
async function boot(extraEnv) {
  server = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT, HOST: '127.0.0.1', CLINIC_DATA_DIR: DATA, JWT_SECRET: 'feat-secret', SEED_DEMO: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 150; i++) {
    try { if ((await req('GET', '/api/health')).status === 200) return true; } catch { /* ليس جاهزاً */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
async function stop() {
  if (!server) return;
  server.kill('SIGTERM');
  await Promise.race([new Promise((r) => server.once('exit', r)), new Promise((r) => setTimeout(r, 5000))]);
  server = null;
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Khartoum', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const hmPlus = (mins) => {
  const d = new Date(Date.now() + mins * 60000);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Khartoum', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
};
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

try {
  // ============ المرحلة 1: بدون مفاتيح واتساب (وضع الرابط) ============
  check('الخادم يقلع (المخطط الإصدار 3)', await boot({ WHATSAPP_TOKEN: '', WHATSAPP_PHONE_ID: '', CRON_SECRET: '' }), serverLog.slice(-500));
  const token = (await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } })).json?.token;
  check('دخول المدير', !!token);
  const viewer = (await req('POST', '/api/auth/login', { body: { username: 'reception', password: 'reception123' } })).json?.token;

  // مريض اختبار كامل البيانات
  const pt = (await req('POST', '/api/patients', { token, body: { first_name: 'سارة', last_name: 'اختبار', phone: '0912345678', gender: 'female', birth_date: '1988-03-10', height_cm: 165, start_weight: 92, goal_weight: 75, goal: 'إنقاص الوزن' } })).json;
  check('إنشاء مريض اختبار', pt?.id > 0, JSON.stringify(pt).slice(0, 200));

  // ---------- الخطة الأسبوعية الذكية ----------
  const prev = await req('POST', '/api/diet-plans/generate', { token, body: { patient_id: pt.id, activity_level: 'light' } });
  check('معاينة الخطة الذكية (200)', prev.status === 200 && prev.json?.preview === true, JSON.stringify(prev.json).slice(0, 300));
  const t = prev.json?.targets || {};
  check('الهدف مستنتج من الوزن المستهدف = إنقاص', t.goal === 'lose', t.goal);
  check('الاحتياج محسوب (Mifflin) ضمن حدود منطقية', t.bmr > 1300 && t.bmr < 2000 && t.kcal >= 1200 && t.kcal < t.tdee, JSON.stringify(t));
  check('7 أيام × 5 وجبات = 35 وجبة', prev.json?.meals?.length === 35);
  const dev = Math.max(...(prev.json?.by_day || []).map((d) => Math.abs(d.kcal - t.kcal) / t.kcal));
  check('كل يوم ضمن ±8٪ من السعرات المستهدفة', dev <= 0.08, `أقصى انحراف ${(dev * 100).toFixed(1)}٪`);
  check('الوجبات بكميات قابلة للتسوق («الاسم — الكمية الوحدة»)', /— \d+ /.test(prev.json?.meals?.[0]?.items || ''), prev.json?.meals?.[0]?.items);
  const active = await req('POST', '/api/diet-plans/generate', { token, body: { patient_id: pt.id, activity_level: 'very_active' } });
  check('النشاط الأعلى → سعرات أعلى', active.json?.targets?.kcal > t.kcal, `${active.json?.targets?.kcal} vs ${t.kcal}`);
  const fixed = await req('POST', '/api/diet-plans/generate', { token, body: { patient_id: pt.id, target_kcal: 1500 } });
  check('سعرات يحددها الأخصائي يدوياً تُحترم', fixed.json?.targets?.kcal === 1500, fixed.json?.targets?.kcal);
  const seedB = await req('POST', '/api/diet-plans/generate', { token, body: { patient_id: pt.id, seed: 2 } });
  check('«اقتراح آخر» (seed) يغيّر الوجبات', seedB.json?.meals?.[0]?.title !== prev.json?.meals?.[0]?.title);

  const saved = await req('POST', '/api/diet-plans/generate', { token, body: { patient_id: pt.id, activity_level: 'moderate', save: true } });
  check('حفظ الخطة الذكية كمسودة (201)', saved.status === 201 && saved.json?.status === 'draft', JSON.stringify(saved.json).slice(0, 200));
  check('الخطة المحفوظة أسبوعية بمجاميع يومية لا مجموع الأسبوع', saved.json?.weekly === true && saved.json?.by_day?.length === 7 && saved.json?.daily_average?.kcal > 1000, JSON.stringify(saved.json?.daily_average));
  check('الوجبات مرتبة باليوم (0=السبت)', saved.json?.meals?.[0]?.day_of_week === 0 && saved.json?.meals?.at(-1)?.day_of_week === 6);
  const pAfter = (await req('GET', `/api/patients/${pt.id}`, { token })).json;
  check('مستوى النشاط حُفظ في ملف المريض', pAfter?.activity_level === 'moderate', pAfter?.activity_level);
  const planId = saved.json?.id;
  check('totals في الأسبوعية = متوسط اليوم (وليس 7 أضعاف)', Math.abs((saved.json?.totals?.kcal || 0) - saved.json?.daily_average?.kcal) < 2 && saved.json?.week_totals?.kcal > 5 * saved.json?.daily_average?.kcal, JSON.stringify({ t: saved.json?.totals?.kcal, w: saved.json?.week_totals?.kcal }));
  const plist = await req('GET', `/api/diet-plans?patient_id=${pt.id}`, { token });
  const pl = plist.json?.items?.find((x) => x.id === planId);
  check('قائمة البرامج: سعرات الأسبوعية يومية + عدد الأيام', pl && Math.abs(pl.kcal_total - saved.json.daily_average.kcal) <= 2 && pl.days_count === 7, JSON.stringify(pl && { k: pl.kcal_total, d: pl.days_count }));
  const profW = await req('GET', `/api/patients/${pt.id}/profile`, { token });
  const pp = profW.json?.plans?.find((x) => x.id === planId);
  check('ملف المريض: الخطة الأسبوعية بمجاميع يومية وأيام', pp?.weekly === true && Math.abs(pp.totals.kcal - saved.json.daily_average.kcal) < 2 && pp.by_day?.length === 7, JSON.stringify(pp?.totals));
  await req('POST', `/api/diet-plans/${planId}/activate`, { token });

  const noData = (await req('POST', '/api/patients', { token, body: { first_name: 'بلا', last_name: 'قياسات' } })).json;
  const bad = await req('POST', '/api/diet-plans/generate', { token, body: { patient_id: noData.id } });
  check('مريض بلا طول/وزن → 400 برسالة عربية واضحة', bad.status === 400 && /الوزن|الطول/.test(bad.json?.error || ''), JSON.stringify(bad.json));
  const badDay = await req('PUT', `/api/diet-plans/${planId}`, { token, body: { meals: [{ slot: 'الفطور', title: 'x', day_of_week: 9 }] } });
  check('يوم وجبة غير صالح (9) يُرفض', badDay.status === 400);
  check('المشاهد (reception) لا يولّد خططاً', (await req('POST', '/api/diet-plans/generate', { token: viewer, body: { patient_id: pt.id } })).status === 403);

  // ---------- قائمة التسوق ----------
  const sl7 = await req('GET', `/api/diet-plans/${planId}/shopping-list?days=7`, { token });
  check('قائمة التسوق مجمّعة حسب الأقسام', sl7.status === 200 && sl7.json?.groups?.length >= 5, JSON.stringify(sl7.json?.groups?.map((g) => g.label)));
  const find = (sl, name) => sl.json?.groups?.flatMap((g) => g.items).find((i) => i.name === name);
  const bread7 = find(sl7, 'خبز أسمر');
  check('الكميات مجموعة من كل وجبات الأسبوع', bread7?.qty > 3, JSON.stringify(bread7));
  const sl14 = await req('GET', `/api/diet-plans/${planId}/shopping-list?days=14`, { token });
  check('14 يوماً = ضعف كميات الأسبوع', find(sl14, 'خبز أسمر')?.qty === bread7?.qty * 2, `${find(sl14, 'خبز أسمر')?.qty} vs ${bread7?.qty}`);
  check('نص واتساب لقائمة التسوق جاهز', /قائمة التسوق/.test(sl7.json?.text || '') && sl7.json.text.includes('سارة'));
  // خطة يدوية بنص حر (بدون يوم) تُضرب في عدد الأيام
  const manual = await req('POST', '/api/diet-plans', { token, body: { patient_id: pt.id, title: 'يدوية', meals: [{ slot: 'الفطور', title: 'بيض', items: '2 حبة بيض + خبز أسمر — 2 شريحة' }] } });
  const slm = await req('GET', `/api/diet-plans/${manual.json?.id}/shopping-list?days=3`, { token });
  check('الخطة اليومية العادية × عدد الأيام (2 بيض × 3 = 6)', find(slm, 'بيض')?.qty === 6 && find(slm, 'خبز أسمر')?.qty === 6, JSON.stringify(slm.json?.groups));

  // ---------- الالتزام مقابل نزول الوزن ----------
  const mk = async (date, adherence, weight) => {
    const v = await req('POST', '/api/visits', { token, body: { patient_id: pt.id, visit_date: date, visit_type: 'followup', adherence } });
    await req('POST', '/api/measurements', { token, body: { patient_id: pt.id, visit_id: v.json?.id, measured_on: date, weight_kg: weight } });
    return v;
  };
  await mk(addDays(today, -42), null, 92);
  const v1 = await mk(addDays(today, -28), 90, 90);
  await mk(addDays(today, -14), 40, 89.8);
  await mk(addDays(today, -7), 85, 88.6);
  check('زيارة بتقييم التزام تُحفظ', v1.status === 201 && v1.json?.adherence === 90, JSON.stringify(v1.json));
  check('التزام خارج 0–100 يُرفض', (await req('POST', '/api/visits', { token, body: { patient_id: pt.id, visit_date: today, adherence: 150 } })).status === 400);
  const ad = await req('GET', `/api/patients/${pt.id}/adherence`, { token });
  check('سلسلة الالتزام: 3 نقاط بتقييم', ad.json?.points?.length === 3, JSON.stringify(ad.json).slice(0, 300));
  check('النزول الأسبوعي محسوب لكل فترة (90٪ → 1 كغ/أسبوع)', ad.json?.points?.[0]?.weekly_loss_kg === 1 && ad.json?.points?.[0]?.loss_kg === 2, JSON.stringify(ad.json?.points?.[0]));
  check('ارتباط موجب بين الالتزام والنزول', ad.json?.correlation > 0.5, String(ad.json?.correlation));
  const upd = await req('PUT', `/api/visits/${v1.json.id}`, { token, body: { adherence: 95, adherence_notes: 'ممتاز' } });
  check('تعديل تقييم الالتزام بعد الزيارة', upd.json?.adherence === 95 && upd.json?.adherence_notes === 'ممتاز');
  const prof = (await req('GET', `/api/patients/${pt.id}/profile`, { token })).json;
  check('ملف المريض يتضمن الالتزام', prof?.adherence?.points?.length === 3 && prof?.adherence?.average_adherence > 0);
  const rep = await req('GET', '/api/reports/adherence', { token });
  check('تقرير العيادة: 4 شرائح التزام + ارتباط', rep.json?.bands?.length === 4 && rep.json?.rated_visits >= 3, JSON.stringify(rep.json?.bands));

  // ---------- تحديث جزئي آمن ----------
  await req('PUT', `/api/patients/${pt.id}`, { token, body: { notes: 'ملاحظة صوتية: يفضّل الفول صباحاً' } });
  const pNotes = (await req('GET', `/api/patients/${pt.id}`, { token })).json;
  check('حفظ الملاحظات وحدها لا يمسح الهاتف والطول', pNotes?.notes?.includes('صوتية') && pNotes?.phone === '0912345678' && pNotes?.height_cm === 165, JSON.stringify({ phone: pNotes?.phone, h: pNotes?.height_cm }));

  // ---------- التنبيهات ----------
  // قرب منتصف الليل لا يوجد «بعد ساعة» في نفس اليوم — نقرّب الموعد
  const soon = hmPlus(60) > hmPlus(0) ? hmPlus(60) : '23:59';
  const appt = await req('POST', '/api/appointments', { token, body: { patient_id: pt.id, date: today, time: soon, visit_type: 'followup' } });
  const apptTomorrow = await req('POST', '/api/appointments', { token, body: { patient_id: pt.id, date: addDays(today, 1), time: '10:30', visit_type: 'followup' } });
  check('حجز موعد اليوم وغداً', appt.status === 201 && apptTomorrow.status === 201, JSON.stringify(appt.json).slice(0, 150));
  const nt = await req('GET', '/api/notifications', { token });
  const soonItem = nt.json?.items?.find((i) => i.type === 'appointment_soon' && i.appointment_id === appt.json?.id);
  check('تنبيه «موعد قريب» خلال ساعة', !!soonItem && soonItem.minutes_to >= 0 && soonItem.minutes_to <= 61, JSON.stringify(soonItem));
  const pend = nt.json?.items?.find((i) => i.type === 'reminder_pending' && i.appointment_id === apptTomorrow.json?.id);
  check('تنبيه «تذكير لم يُرسل» مع رابط واتساب جاهز', pend?.wa_link?.startsWith('https://wa.me/249912345678?text='), JSON.stringify(pend));

  // ---------- واتساب: وضع الرابط ----------
  const st = await req('GET', '/api/whatsapp/status', { token });
  check('حالة واتساب: غير مربوط → وضع الرابط', st.json?.configured === false && st.json?.provider === 'link');
  const lk = await req('POST', '/api/whatsapp/send', { token, body: { patient_id: pt.id, kind: 'appointment_reminder', ref_id: apptTomorrow.json.id } });
  check('إرسال تذكير بدون مفاتيح → رابط wa.me بالرقم الدولي', lk.json?.status === 'link' && lk.json?.link?.startsWith('https://wa.me/249912345678'), JSON.stringify(lk.json).slice(0, 200));
  check('نص التذكير فيه الاسم و«غداً» والوقت', /سارة/.test(lk.json?.text) && /غداً/.test(lk.json?.text) && lk.json.text.includes('10:30'));
  const pv = await req('POST', '/api/whatsapp/send', { token, body: { patient_id: pt.id, kind: 'plan', preview: true } });
  check('معاينة رسالة الخطة (أيام الأسبوع)', pv.json?.preview && /السبت/.test(pv.json?.text) && /سعرة/.test(pv.json?.text));
  check('المشاهد لا يرسل رسائل', (await req('POST', '/api/whatsapp/send', { token: viewer, body: { patient_id: pt.id, kind: 'plan' } })).status === 403);

  // ---------- المهمة اليومية: الحماية ----------
  check('المهمة اليومية بلا تصريح → 401', (await req('GET', '/api/cron/daily')).status === 401);
  const cronUa = await req('GET', '/api/cron/daily', { headers: { 'user-agent': 'vercel-cron/1.0' } });
  check('Vercel Cron (بدون CRON_SECRET) يُقبل', cronUa.status === 200 && cronUa.json?.date === today, JSON.stringify(cronUa.json));
  check('بدون مفاتيح: التذكيرات تبقى «رابط» ولا تُعلَّم كمُرسلة', cronUa.json?.appointment_reminders?.link >= 1 && cronUa.json?.appointment_reminders?.sent === 0, JSON.stringify(cronUa.json?.appointment_reminders));

  // ---------- CSV ----------
  const csv = await req('GET', `/api/reports/export/visits?from=${addDays(today, -60)}&to=${today}`, { token });
  check('تصدير الزيارات CSV بعمود الالتزام', csv.headers.get('content-type')?.includes('text/csv') && csv.text.includes('الالتزام %') && csv.text.includes('95'));
  const csvEn = await req('GET', '/api/reports/export/visits?lang=en', { token });
  check('CSV بعناوين إنجليزية (lang=en)', csvEn.text.includes('Adherence %') && csvEn.text.includes('Patient'));
  const meals = await req('GET', '/api/reports/export/meals', { token });
  check('تصدير وجبات الخطط CSV (باليوم)', meals.text.includes('السبت') && meals.text.includes('المكونات'));
  const rj = await req('GET', `/api/reports/revenue?from=${addDays(today, -365)}&to=${today}`, { token });
  const sumOk = (rj.json?.by_month_service || []).every((m) => Math.abs((rj.json.services || []).reduce((t, sv) => t + (m[sv] || 0), 0) - m.total) < 0.05);
  check('الإيراد شهر × خدمة: مجموع الخدمات = إجمالي الشهر', rj.status === 200 && rj.json.by_month_service?.length > 0 && rj.json.services?.length > 0 && sumOk, JSON.stringify(rj.json?.by_month_service?.[0]));
  const rv = await req('GET', `/api/reports/revenue.csv?from=${addDays(today, -365)}&to=${today}`, { token });
  check('تقرير الإيرادات CSV', rv.status === 200 && rv.text.includes('المبلغ'));
  const msgs = await req('GET', '/api/reports/export/messages', { token });
  check('تصدير سجل الرسائل CSV', msgs.status === 200 && msgs.text.includes('appointment_reminder'));
  const csvFilt = await req('GET', '/api/reports/export/visits?from=2000-01-01&to=2000-01-02', { token });
  check('فلترة CSV بالتاريخ (فترة فارغة)', csvFilt.text.includes('لا توجد بيانات'));
  await stop();

  // ============ المرحلة 2: واتساب Cloud API (خادم Meta وهمي) + CRON_SECRET ============
  check('إعادة الإقلاع بمفاتيح واتساب', await boot({
    WHATSAPP_TOKEN: 'TEST_TOKEN', WHATSAPP_PHONE_ID: '1234567890', WHATSAPP_API_BASE: MOCK_BASE,
    WHATSAPP_TEMPLATE_APPT: 'appointment_reminder_ar', CRON_SECRET: 'cron-s3cret',
  }), serverLog.slice(-400));
  const tk = (await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } })).json?.token;
  check('حالة واتساب: مربوط (Cloud API)', (await req('GET', '/api/whatsapp/status', { token: tk })).json?.provider === 'whatsapp-cloud-api');

  const sentPlan = await req('POST', '/api/whatsapp/send', { token: tk, body: { patient_id: pt.id, kind: 'plan' } });
  const call = waCalls.at(-1);
  check('إرسال الخطة آلياً عبر Cloud API', sentPlan.json?.status === 'sent' && sentPlan.json?.provider_id?.startsWith('wamid.'), JSON.stringify(sentPlan.json).slice(0, 200));
  check('الطلب إلى Meta صحيح (المسار + التوكن + الرقم + نص)', call?.path === '/v21.0/1234567890/messages' && call?.auth === 'Bearer TEST_TOKEN' && call?.body?.to === '249912345678' && call?.body?.type === 'text' && call?.body?.messaging_product === 'whatsapp', JSON.stringify(call));

  const wrongCron = await req('GET', '/api/cron/daily', { headers: { authorization: 'Bearer nope', 'user-agent': 'vercel-cron/1.0' } });
  check('مع CRON_SECRET: سرّ خاطئ يُرفض حتى مع وكيل vercel-cron', wrongCron.status === 401);
  // تفعيل التذكير اليومي للمريض
  await req('PUT', `/api/patients/${pt.id}`, { token: tk, body: { daily_reminder: true } });
  const before = waCalls.length;
  const cron = await req('GET', '/api/cron/daily', { headers: { authorization: 'Bearer cron-s3cret' } });
  check('المهمة اليومية بالسر الصحيح', cron.status === 200, JSON.stringify(cron.json));
  check('تذكيرات مواعيد اليوم وغداً أُرسلت (2)', cron.json?.appointment_reminders?.sent >= 2, JSON.stringify(cron.json?.appointment_reminders));
  const tplCall = waCalls.slice(before).find((c) => c.body?.type === 'template');
  check('تذكير الموعد يُرسل بالقالب المعتمد ومعاملاته الثلاثة', tplCall?.body?.template?.name === 'appointment_reminder_ar' && tplCall.body.template.components[0].parameters.length === 3 && tplCall.body.template.language.code === 'ar', JSON.stringify(tplCall?.body));
  const dailyTo = waCalls.slice(before).filter((c) => c.body?.template?.name !== 'appointment_reminder_ar').map((c) => c.body.to);
  check('التذكير اليومي بالخطة أُرسل للمشترك (ومنهم مريض الاختبار)', cron.json?.daily_reminders?.sent >= 1 && dailyTo.includes('249912345678'), JSON.stringify({ r: cron.json?.daily_reminders, dailyTo }));
  const dailyCall = waCalls.slice(before).find((c) => c.body?.type === 'text' && /خطة اليوم/.test(c.body?.text?.body || ''));
  check('نص التذكير اليومي فيه وجبات اليوم', !!dailyCall && /الفطور/.test(dailyCall.body.text.body));
  const again = await req('GET', '/api/cron/daily', { headers: { authorization: 'Bearer cron-s3cret' } });
  check('تشغيل المهمة مرتين لا يكرر الرسائل', again.json?.appointment_reminders?.sent === 0 && again.json?.daily_reminders?.sent === 0, JSON.stringify(again.json));
  const nt2 = await req('GET', '/api/notifications', { token: tk });
  check('بعد الإرسال الآلي: لا «تذكير لم يُرسل» لهذه المواعيد', !nt2.json?.items?.some((i) => i.type === 'reminder_pending' && i.appointment_id === apptTomorrow.json?.id));

  // فشل من Meta → يُسجَّل ويظهر كتنبيه
  const unreachable = (await req('POST', '/api/patients', { token: tk, body: { first_name: 'رقم', last_name: 'خاطئ', phone: '0900000000' } })).json;
  const fail = await req('POST', '/api/whatsapp/send', { token: tk, body: { patient_id: unreachable.id, kind: 'custom', text: 'مرحبا' } });
  check('خطأ Meta يُعاد برسالته (502) ويُسجَّل', fail.status === 502 && fail.json?.status === 'failed' && /not on WhatsApp/.test(fail.json?.error || ''), JSON.stringify(fail.json));
  const nt3 = await req('GET', '/api/notifications', { token: tk });
  check('الرسالة الفاشلة تظهر في التنبيهات', nt3.json?.items?.some((i) => i.type === 'message_failed'));
  const log = await req('GET', `/api/whatsapp/log?patient_id=${pt.id}`, { token: tk });
  check('سجل الرسائل للمريض', log.json?.items?.length >= 3 && log.json.items.some((m) => m.kind === 'daily_reminder'));
  const manualRun = await req('POST', '/api/cron/daily/run', { token: tk });
  check('تشغيل يدوي للمهمة من الإعدادات (مدير)', manualRun.status === 200 && manualRun.json?.source === 'manual');
  const bk = await req('GET', '/api/backup', { token: tk });
  check('النسخة الاحتياطية تشمل سجل الرسائل', Array.isArray(bk.json?.tables?.message_log) && bk.json.tables.message_log.length >= 3);
} catch (e) {
  failures++;
  console.error('EXCEPTION', e, serverLog.slice(-800));
} finally {
  await stop();
  mock.close();
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(`\n${results.length - failures}/${results.length} نجحت${failures ? ` — ${failures} فشلت` : ''}`);
if (failures) process.exit(1);
