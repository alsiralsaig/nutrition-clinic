// محاكاة تشغيل Vercel محلياً: نفس ملف الدالة، مع VERCEL=1 وقرص مؤقت
// node scripts/simulate-vercel.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 4124;
const BASE = `http://127.0.0.1:${PORT}`;
fs.rmSync('/tmp/clinic', { recursive: true, force: true });

const child = spawn(process.execPath, ['-e', `
  import('./api/[[...path]].js').then(({ default: app }) => {
    app.listen(${PORT}, '127.0.0.1', () => console.log('ready'));
  }).catch((e) => { console.error('IMPORT_FAIL', e.message); process.exit(1); });
`], {
  env: { ...process.env, VERCEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production' },
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
check('الدالة تُحمَّل بـ VERCEL=1 بدون listen مزدوج', log.includes('ready'), log.slice(0, 300));

const h = await j('GET', '/api/health');
check('/api/health يعمل ويُعلن الوضع المؤقت', h.json?.mode === 'demo-ephemeral', JSON.stringify(h.json));
check('قاعدة البيانات على /tmp لا على القرص الدائم', String(h.json?.db_path || '').startsWith('/tmp/clinic'), h.json?.db_path);
check('ملف القاعدة أُنشئ فعلاً', fs.existsSync(h.json.db_path));
check('البيانات التجريبية زُرعت تلقائياً عند الإقلاع', (h.json?.counts?.patients || 0) > 0, JSON.stringify(h.json?.counts));
check('لا ملفات WAL على وسيط مؤقت', !fs.existsSync(h.json.db_path + '-wal'), 'wal موجود');

const login = await j('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
check('تسجيل الدخول يعمل في الوضع المؤقت', login.status === 200 && !!login.json?.token);
const t = login.json?.token;
const created = await j('POST', '/api/patients', { first_name: 'مؤقت', last_name: 'اختبار', height_cm: 170, start_weight: 90 }, t);
check('كتابة مريض جديد تنجح (journal_mode = DELETE)', created.status === 201, JSON.stringify(created.json).slice(0, 160));
const list = await j('GET', '/api/patients?q=' + encodeURIComponent('مؤقت'), null, t);
check('الكتابة تُقرأ فوراً داخل نفس الحاوية', list.json?.items?.length === 1, JSON.stringify(list.json?.total));

// ── محاكاة «حاوية جديدة»: عملية أخرى بنفس التوكن ──
child.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 600));

const second = spawn('node', ['-e', `
  import('./api/[[...path]].js').then(({ default: app }) => app.listen(${PORT}, '127.0.0.1', () => console.log('ready2')));
`], { env: { ...process.env, VERCEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production' }, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let log2 = '';
second.stdout.on('data', (d) => { log2 += d; });
second.stderr.on('data', (d) => { log2 += d; });
for (let i = 0; i < 60 && !log2.includes('ready2'); i++) await new Promise((r) => setTimeout(r, 250));
check('الحاوية الثانية تُقلاع بلا انهيار على قرص للقراءة فقط', log2.includes('ready2'), log2.slice(0, 240));
check('لا تحذير من تعذّر كتابة مفتاح الجلسة', !/تعذّر حفظ مفتاح/.test(log2), log2.slice(0, 200));
const reused = await j('GET', '/api/patients?limit=1', null, t);
check('توكن صدر من الحاوية الأولى مقبول في الثانية (سر JWT ثابت في الوضع التجريبي)', reused.status === 200, `status=${reused.status}`);
const stillThere = await j('GET', '/api/patients?q=' + encodeURIComponent('مؤقت'), null, t);
check('ملف القاعدة في /tmp نجا لإعادة تشغيل العملية (محلياً)', (stillThere.json?.total || 0) >= 1, JSON.stringify(stillThere.json?.total));
second.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 300));
fs.rmSync('/tmp/clinic', { recursive: true, force: true });

console.log(`\n${results.length - fails}/${results.length} نجحت`);
process.exit(fails ? 1 : 0);
