// محاكاة تشغيل Vercel محلياً: نفس ملف الدالة، مع VERCEL=1
//   المرحلة 1: بدون DATABASE_URL  → الوضع التجريبي (Postgres مدمج في الذاكرة)
//   المرحلة 2: مع SIM_DATABASE_URL → وضع Neon الحقيقي: البيانات يجب أن تنجو من «حاوية جديدة»
// node scripts/simulate-vercel.mjs                      (المرحلة 1 فقط)
// SIM_DATABASE_URL=postgres://… node scripts/simulate-vercel.mjs   (المرحلتان)
import { spawn } from 'node:child_process';
process.env.VERCEL = '1';            // حتى لا يستدعي الأب listen عند استيراد الجسور
process.env.CLINIC_LAZY_BOOT = '1';  // الأب يفحص الجسور فقط؛ لا يفتح قاعدة بيانات
delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL;
import fs from 'node:fs';

const PORT = 4100 + Math.floor(Math.random() * 400); // منفذ عشوائي: لا تعارض مع عملية متبقية
const BASE = `http://127.0.0.1:${PORT}`;
// الحاوية = scripts/vercel-local.mjs: الدالة الوحيدة api/index.js + قواعد rewrites من vercel.json نفسها
const child = spawn(process.execPath, ['scripts/vercel-local.mjs', String(PORT), 'replace'], {
  env: { ...process.env, CLINIC_LAZY_BOOT: '', VERCEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production' },
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

const results = [];
let fails = 0;
const check = (n, c, extra = '') => {
  results.push(n);
  if (c) console.log(`  ✓ ${n}`);
  else { fails++; console.error(`  ✗ ${n} ${extra}`); }
};
const j = async (m, p, b, t) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

for (let i = 0; i < 60 && !log.includes('ready'); i++) await new Promise((r) => setTimeout(r, 250));
check('الدالة الوحيدة api/index.js تُحمَّل بـ VERCEL=1 بلا listen مزدوج', log.includes('ready'), log.slice(0, 300));
{
  const { functionFiles, HOBBY_FUNCTION_LIMIT } = await import('./gen-vercel-bridges.mjs');
  const n = functionFiles().length;
  check(`عدد دوال Vercel = ${n} (حد Hobby ${HOBBY_FUNCTION_LIMIT})`, n >= 1 && n <= HOBBY_FUNCTION_LIMIT, String(n));
}

const h = await j('GET', '/api/health');
check('/api/health يعمل ويُعلن الوضع التجريبي', h.json?.mode === 'demo-ephemeral', JSON.stringify(h.json));
check('بلا DATABASE_URL: Postgres مدمج في الذاكرة (لا كتابة على قرص Vercel للقراءة فقط)', h.json?.engine === 'pglite' && /memory/.test(h.json?.db || ''), h.json?.db);
check('البيانات التجريبية زُرعت تلقائياً عند الإقلاع', (h.json?.counts?.patients || 0) > 0, JSON.stringify(h.json?.counts));

const login = await j('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
check('تسجيل الدخول يعمل في الوضع المؤقت', login.status === 200 && !!login.json?.token);
const t = login.json?.token;
const created = await j('POST', '/api/patients', { first_name: 'مؤقت', last_name: 'اختبار', height_cm: 170, start_weight: 90 }, t);
check('كتابة مريض جديد تنجح في الوضع التجريبي', created.status === 201, JSON.stringify(created.json).slice(0, 160));
const list = await j('GET', '/api/patients?q=' + encodeURIComponent('مؤقت'), null, t);
check('الكتابة تُقرأ فوراً داخل نفس الحاوية', list.json?.items?.length === 1, JSON.stringify(list.json?.total));

// الجسر يعيد بناء المسار الأصلي من ?__p في الحالتين (مُعاد كتابته / أصلي) ويحافظ على بقية الاستعلام
{
  const { restoreUrl } = await import(new URL('../api/index.js', import.meta.url).href);
  const cases = [
    ['/api/index?__p=patients/1/profile', '/api/patients/1/profile'],
    ['/api/index?__p=patients&q=%D8%B3&page=2', '/api/patients?q=%D8%B3&page=2'],
    ['/api/patients/1/profile?__p=patients/1/profile', '/api/patients/1/profile'],
    ['/api/auth/login', '/api/auth/login'],
  ];
  const bad = cases.filter(([i, o]) => restoreUrl(i) !== o).map(([i]) => i + ' → ' + restoreUrl(i));
  check('الجسر يستعيد المسار الأصلي (4 أشكال لعناوين Vercel)', !bad.length, bad.join(' | '));
}

// مسارات أعمق (كانت تسقط 404 على Vercel) — يجب أن يخدمها Express نفسه
const deep1 = await j('GET', '/api/patients/1/profile', null, t);
const deep2 = await j('GET', '/api/dashboard/summary', null, t);
const deep3 = await j('GET', '/api/reports/weight-progress/1', null, t);
check('مسار بثلاثة مقاطع /api/patients/1/profile', deep1.status === 200, `status=${deep1.status} ${JSON.stringify(deep1.json).slice(0,120)}`);
check('مسار بمقطعَين /api/dashboard/summary', deep2.status === 200, `status=${deep2.status}`);
check('تقرير /api/reports/weight-progress/1', deep3.status === 200, `status=${deep3.status}`);
// المرحلة D: بوابة المريض عبر نفس الدالة — إصدار QR ثم دخول به ثم ملف المريض
const acc = await j('POST', '/api/patients/1/portal-access', {}, t);
const qrLogin = acc.json?.url ? await j('POST', '/api/portal/auth/qr', { token: acc.json.url.split('t=')[1] }) : { status: 0 };
const pme = qrLogin.json?.token ? await j('GET', '/api/portal/me', null, qrLogin.json.token) : { status: 0 };
const staffWithPatient = qrLogin.json?.token ? await j('GET', '/api/patients', null, qrLogin.json.token) : { status: 0 };
check('بوابة المريض عبر الدالة: QR → دخول → /api/portal/me (والتوكن لا يفتح بيانات العيادة)',
  acc.status === 201 && qrLogin.status === 200 && pme.status === 200 && pme.json?.patient?.id === 1 && staffWithPatient.status === 403,
  `acc=${acc.status} qr=${qrLogin.status} me=${pme.status} staff=${staffWithPatient.status}`);
const doc = await j('GET', '/api/openapi.json');
check('ملف التوثيق متاح تحت /api/openapi.json', doc.status === 200 && !!doc.json?.openapi, `status=${doc.status}`);

// ── محاكاة «حاوية جديدة»: عملية أخرى بنفس التوكن ──
child.kill('SIGTERM');
await Promise.race([new Promise((r) => child.once('exit', r)), new Promise((r) => setTimeout(r, 4000))]);

const second = spawn(process.execPath, ['scripts/vercel-local.mjs', String(PORT), 'preserve'], { env: { ...process.env, CLINIC_LAZY_BOOT: '', VERCEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production' }, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let log2 = '';
second.stdout.on('data', (d) => { log2 += d; });
second.stderr.on('data', (d) => { log2 += d; });
for (let i = 0; i < 60 && !log2.includes('ready'); i++) await new Promise((r) => setTimeout(r, 250));
check('الحاوية الثانية تُقلاع بلا انهيار على قرص للقراءة فقط', log2.includes('ready'), log2.slice(0, 240));
check('لا تحذير من تعذّر كتابة مفتاح الجلسة', !/تعذّر حفظ مفتاح/.test(log2), log2.slice(0, 200));
const reused = await j('GET', '/api/patients?limit=1', null, t);
check('توكن صدر من الحاوية الأولى مقبول في الثانية (سر JWT ثابت في الوضع التجريبي)', reused.status === 200, `status=${reused.status}`);
const stillThere = await j('GET', '/api/patients?q=' + encodeURIComponent('مؤقت'), null, t);
check('الوضع التجريبي صادق: الحاوية الجديدة تبدأ من بيانات العرض (ولهذا تظهر اللافتة)', (stillThere.json?.total ?? -1) === 0, JSON.stringify(stillThere.json?.total));
second.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 500));

// ── المرحلة 2: Vercel + Neon (قاعدة حقيقية عبر DATABASE_URL) ──
if (process.env.SIM_DATABASE_URL) {
  const boot = async (tag) => {
    const p = spawn(process.execPath, ['scripts/vercel-local.mjs', String(PORT), tag === 'neon1' ? 'replace' : 'preserve'], { env: { ...process.env, CLINIC_LAZY_BOOT: '', VERCEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production', DATABASE_URL: process.env.SIM_DATABASE_URL, JWT_SECRET: '' }, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let l = ''; p.stdout.on('data', (d) => { l += d; }); p.stderr.on('data', (d) => { l += d; });
    for (let i = 0; i < 80 && !l.includes('ready'); i++) await new Promise((r) => setTimeout(r, 250));
    return { p, ok: l.includes('ready'), log: () => l };
  };
  const c1 = await boot('neon1');
  check('Vercel+Neon: الحاوية تُقلع بـ DATABASE_URL', c1.ok, c1.log().slice(0, 300));
  const hh = await j('GET', '/api/health');
  check('Vercel+Neon: الوضع دائم (لا لافتة تجريبية)', hh.json?.mode === 'persistent' && hh.json?.engine === 'postgres', JSON.stringify(hh.json));
  const lg = await j('POST', '/api/auth/login', { username: 'admin', password: process.env.SIM_ADMIN_PASSWORD || 'admin123' });
  check('Vercel+Neon: دخول المدير', lg.status === 200, JSON.stringify(lg.json));
  const marker = 'حاوية-' + Date.now();
  const mk = await j('POST', '/api/patients', { first_name: marker, last_name: 'دائم' }, lg.json?.token);
  check('Vercel+Neon: حفظ مريض', mk.status === 201, JSON.stringify(mk.json).slice(0, 120));
  c1.p.kill('SIGTERM');
  await Promise.race([new Promise((r) => c1.p.once('exit', r)), new Promise((r) => setTimeout(r, 4000))]);
  const c2 = await boot('neon2');
  check('Vercel+Neon: حاوية جديدة تُقلع', c2.ok, c2.log().slice(0, 300));
  const found = await j('GET', '/api/patients?q=' + encodeURIComponent(marker), null, lg.json?.token);
  check('Vercel+Neon: المريض نجا من إعدام الحاوية + التوكن صالح (السر في القاعدة)', found.status === 200 && found.json?.total === 1, `status=${found.status} total=${found.json?.total}`);
  c2.p.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
} else {
  console.log('  • (تخطّي مرحلة Neon: عيّن SIM_DATABASE_URL لتشغيلها)');
}

console.log(`\n${results.length - fails}/${results.length} نجحت`);
process.exit(fails ? 1 : 0);
