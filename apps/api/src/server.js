// نقطة تشغيل الخادم: REST API + تقديم واجهة الويب من نفس المنفذ (وضع الإنتاج)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { connect, db, DB_LABEL, DRIVER, EPHEMERAL, PRODUCTION_DB } from './db.js';
import { authRequired, initSecret } from './auth.js';
import { HttpError } from './lib.js';

import { router as authRoutes } from './routes/auth.js';
import { router as patientRoutes } from './routes/patients.js';
import { router as measurementRoutes } from './routes/measurements.js';
import { router as planRoutes } from './routes/plans.js';
import { router as appointmentRoutes } from './routes/appointments.js';
import { router as paymentRoutes } from './routes/payments.js';
import { router as dashboardRoutes } from './routes/dashboard.js';
import { router as reportRoutes } from './routes/reports.js';
import { router as systemRoutes } from './routes/system.js';
import { router as messagingRoutes, runDailyJob } from './routes/messaging.js';
import { router as careRoutes } from './routes/care.js';
import { router as portalRoutes } from './routes/portal.js';
import { ensureSeed, SEED_DEMO } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const WEB_DIST = process.env.WEB_DIST || path.join(__dirname, '..', '..', 'web', 'dist');

/**
 * تهيئة لمرة واحدة لكل عملية/حاوية: اتصال → مخطط → مفتاح الجلسات → بذرة.
 * لو فشلت (مثلاً DATABASE_URL خاطئ) تُعاد المحاولة مع الطلب التالي بدل تعطيل الحاوية للأبد.
 */
let booting = null;
export function bootstrap() {
  if (!booting) {
    booting = (async () => {
      await connect();
      await initSecret();
      await ensureSeed({ quiet: !!process.env.VERCEL || process.env.NODE_ENV === 'test' });
    })().catch((e) => { booting = null; throw e; });
  }
  return booting;
}
// تسخين مبكر (على Vercel يوفّر زمن أول طلب). CLINIC_LAZY_BOOT=1 يؤجلها لأول طلب (أدوات الفحص)
if (!process.env.CLINIC_LAZY_BOOT) bootstrap().catch((e) => console.error('[db] تعذّرت التهيئة:', e.message));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '8mb' })); // نسخ احتياطي كبير الحجم يستوعبه الحد

// تقييد بسيط مضاد للتخمين على مسارات الدخول
const loginAttempts = new Map();
const limitLogin = (req, res, next) => {
  const ip = req.ip || 'unknown';
  const rec = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - rec.t > 60_000) { rec.n = 0; rec.t = Date.now(); }
  if (rec.n > 25) return res.status(429).json({ error: 'محاولات كثيرة، انتظر دقيقة ثم أعد المحاولة' });
  rec.n += 1;
  loginAttempts.set(ip, rec);
  next();
};
app.use('/api/auth/login', limitLogin);
app.use('/api/portal/auth', limitLogin);   // دخول المريض بالـ QR/الرمز

// كل مسارات الـ API تنتظر جاهزية القاعدة (الملفات الثابتة لا تنتظر)
app.use('/api', (req, res, next) => { bootstrap().then(() => next(), next); });

// ---------- مسارات عامة ----------
app.get('/api/health', async (req, res, next) => {
  try {
    const t0 = Date.now();
    const counts = await db.get(`
      SELECT (SELECT COUNT(*) FROM patients) AS patients, (SELECT COUNT(*) FROM appointments) AS appointments,
             (SELECT COUNT(*) FROM payments) AS payments`);
    res.json({
      ok: true,
      time: new Date().toISOString(),
      mode: EPHEMERAL ? 'demo-ephemeral' : 'persistent',
      engine: DRIVER,                 // postgres (Neon/حقيقي) أو pglite (مدمج)
      production_db: PRODUCTION_DB,
      demo_data: SEED_DEMO,
      db: DB_LABEL,
      db_latency_ms: Date.now() - t0,
      counts,
    });
  } catch (e) { next(e); }
});
app.use('/api/auth', authRoutes);
// بوابة المريض: توكن مريض مستقل (لا يفتح مسارات الموظفين، ولا توكن الموظف يفتحها)
app.use('/api/portal', portalRoutes);

// ---------- المهمة اليومية (Vercel Cron يستدعيها كل صباح — انظر vercel.json) ----------
// Vercel يرسل «Authorization: Bearer $CRON_SECRET» تلقائياً إن ضُبط المتغير. بدونه نقبل فقط وكيل vercel-cron.
app.get('/api/cron/daily', async (req, res, next) => {
  try {
    const secret = process.env.CRON_SECRET;
    const ok = secret
      ? req.headers.authorization === `Bearer ${secret}`
      : /vercel-cron/i.test(String(req.headers['user-agent'] || ''));
    if (!ok) return res.status(401).json({ error: 'غير مصرح' });
    res.json(await runDailyJob({ source: 'cron' }));
  } catch (e) { next(e); }
});

// ---------- مستندات الـ API لتطبيق الموبايل (قبل مسار الـ SPA العام) ----------
const OPENAPI_FILE = path.join(__dirname, '..', 'openapi.json');
function sendOpenApi(req, res) {
  if (fs.existsSync(OPENAPI_FILE)) return res.type('json').send(fs.readFileSync(OPENAPI_FILE, 'utf8'));
  res.status(404).json({ error: 'openapi.json غير موجود' });
}
app.get('/openapi.json', sendOpenApi);
// على Vercel لا توجد مسارات خارج /api (الدوال تعيش هناك)، فليكن الملف متاحاً تحت البادئتين
app.get('/api/openapi.json', sendOpenApi);

// ---------- مسارات محمية ----------
const protectedApi = express.Router();
protectedApi.use(authRequired);
protectedApi.use('/patients', patientRoutes);
protectedApi.use('/', measurementRoutes);   // /visits + /measurements
protectedApi.use('/diet-plans', planRoutes);
protectedApi.use('/appointments', appointmentRoutes);
protectedApi.use('/payments', paymentRoutes);
protectedApi.use('/dashboard', dashboardRoutes);
protectedApi.use('/reports', reportRoutes);
protectedApi.use('/', systemRoutes);       // /settings /backup /restore /maintenance
protectedApi.use('/', messagingRoutes);    // /whatsapp/* /notifications /cron/daily/run
protectedApi.use('/', careRoutes);         // عادات المريض، QR البوابة، قائمة الانتظار، مكالمات الفيديو
app.use('/api', protectedApi);

// ---------- واجهة الويب (بعد npm run build) ----------
if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  app.use(express.static(WEB_DIST, {
    // عامل الخدمة (تطبيق المريض) يجب ألا يُخزَّن حتى تصل التحديثات فوراً
    setHeaders: (res, file) => { if (/[\\/](sw\.js|[\w-]+\.webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
} else {
  app.get('/', (req, res) => res.json({
    ok: true,
    note: 'الخادم يعمل. الواجهة تُشغّل بأمر: npm run dev (وضع التطوير) أو npm run build للنشر.',
    api_docs: '/openapi.json',
  }));
}

// ---------- معالجة الأخطاء ----------
app.use((req, res) => res.status(404).json({ error: 'المسار غير موجود', path: req.originalUrl }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details ?? null });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'حجم البيانات أكبر من المسموح' });
  // أكواد أخطاء Postgres المعروفة → رسائل مفهومة بدل 500
  if (err?.code === '23505') {
    return res.status(409).json({ error: 'بيانات مكرّرة: قيمة يجب أن تكون فريدة (موعد أو اسم مستخدم مستخدم بالفعل)' });
  }
  if (err?.code === '23503') return res.status(400).json({ error: 'السجل المرتبط غير موجود (مريض أو موعد أو مستخدم)' });
  if (err?.code === '23514' || err?.code === '22P02' || err?.code === '22003') {
    return res.status(400).json({ error: 'قيمة غير صالحة لأحد الحقول' });
  }
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '28P01', '3D000', '57P01'].includes(err?.code)) {
    console.error('[db] الاتصال بالقاعدة فشل:', err.code, err.message);
    return res.status(503).json({ error: 'تعذّر الاتصال بقاعدة البيانات — تحقق من DATABASE_URL أو أعد المحاولة بعد قليل' });
  }
  console.error('[api]', err);
  res.status(500).json({ error: 'خطأ في الخادم', detail: process.env.NODE_ENV === 'production' ? undefined : String(err?.message || err) });
});

// إغلاق آمن (PGlite يكتب ملفاته عند الإغلاق)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { db.close().catch(() => {}).finally(() => process.exit(0)); });
}

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`\n  🥗 Nutrition Clinic API  →  http://localhost:${PORT}`);
    console.log(`     قاعدة البيانات: ${DB_LABEL}`);
    console.log(`     الواجهة: ${fs.existsSync(path.join(WEB_DIST, 'index.html')) ? 'مقدمة من نفس المنفذ' : 'وضع التطوير (Vite)\n'}`);
  });
}

export default app;
