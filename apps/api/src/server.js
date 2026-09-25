// نقطة تشغيل الخادم: REST API + تقديم واجهة الويب من نفس المنفذ (وضع الإنتاج)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { migrate, db, DB_PATH, EPHEMERAL } from './db.js';
import { authRequired } from './auth.js';
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
import { ensureSeed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const WEB_DIST = process.env.WEB_DIST || path.join(__dirname, '..', '..', 'web', 'dist');

migrate();
ensureSeed({ quiet: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '8mb' })); // نسخ احتياطي كبير الحجم يستوعبه الحد

// تقييد بسيط مضاد للتخمين على مسارات الدخول
const loginAttempts = new Map();
app.use('/api/auth/login', (req, res, next) => {
  const ip = req.ip || 'unknown';
  const rec = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - rec.t > 60_000) { rec.n = 0; rec.t = Date.now(); }
  if (rec.n > 25) return res.status(429).json({ error: 'محاولات كثيرة، انتظر دقيقة ثم أعد المحاولة' });
  rec.n += 1;
  loginAttempts.set(ip, rec);
  next();
});

// ---------- مسارات عامة ----------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    mode: EPHEMERAL ? 'demo-ephemeral' : 'persistent',
    db_path: DB_PATH,
    counts: {
      patients: db.prepare(`SELECT COUNT(*) n FROM patients`).get().n,
      appointments: db.prepare(`SELECT COUNT(*) n FROM appointments`).get().n,
      payments: db.prepare(`SELECT COUNT(*) n FROM payments`).get().n,
    },
  });
});
app.use('/api/auth', authRoutes);

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
app.use('/api', protectedApi);

// ---------- مستندات الـ API لتطبيق الموبايل (قبل مسار الـ SPA العام) ----------
const OPENAPI_FILE = path.join(__dirname, '..', 'openapi.json');
app.get('/openapi.json', (req, res) => {
  if (fs.existsSync(OPENAPI_FILE)) return res.type('json').send(fs.readFileSync(OPENAPI_FILE, 'utf8'));
  res.status(404).json({ error: 'openapi.json غير موجود' });
});

// ---------- واجهة الويب (بعد npm run build) ----------
if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  app.use(express.static(WEB_DIST));
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
  if (String(err?.message || '').includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: 'بيانات مكرّرة: قيمة يجب أن تكون فريدة (موعد أو اسم مستخدم مستخدم بالفعل)' });
  }
  console.error('[api]', err);
  res.status(500).json({ error: 'خطأ في الخادم', detail: process.env.NODE_ENV === 'production' ? undefined : String(err?.message || err) });
});

// احتياط: قاعدة البيانات تُغلق بأمان
process.on('SIGINT', () => { try { db.close(); } catch {} process.exit(0); });

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`\n  🥗 Nutrition Clinic API  →  http://localhost:${PORT}`);
    console.log(`     قاعدة البيانات: ${db.name}`);
    console.log(`     الواجهة: ${fs.existsSync(path.join(WEB_DIST, 'index.html')) ? 'مقدمة من نفس المنفذ' : 'وضع التطوير (Vite)\n'}`);
  });
}

export default app;
