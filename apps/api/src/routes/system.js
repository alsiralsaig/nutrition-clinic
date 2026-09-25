// الإعدادات + النسخ الاحتياطي (JSON منطقي يعمل على أي قاعدة) + استعادة آمنة
import { Router } from 'express';
import { db, DB_LABEL, DRIVER, getSettings, setSettings, audit, resetSequences } from '../db.js';
import { badRequest, notFound, wrap, str, todayISO } from '../lib.js';
import { adminOnly, authRequired } from '../auth.js';

export const router = Router();

/** بترتيب الاعتماديات: الأب قبل الابن (الإدخال بهذا الترتيب، والحذف بعكسه) */
const TABLES = [
  'users', 'patients', 'visits', 'measurements', 'diet_plans', 'diet_meals',
  'appointments', 'payments', 'message_log', 'patient_access', 'habit_logs', 'waitlist', 'waitlist_offers',
  'audit_log', 'settings',
];
const WITH_ID = TABLES.filter((t) => t !== 'settings');
const KEEP_SNAPSHOTS = 5;

// ---------- إعدادات العيادة ----------
router.get('/settings', wrap(async (req, res) => res.json({ settings: await getSettings() })));

router.put('/settings', authRequired, adminOnly(), wrap(async (req, res) => {
  const body = req.body || {};
  if (!body || typeof body !== 'object') throw badRequest('بصيغة كائن key/value');
  const patch = {};
  for (const [k, v] of Object.entries(body)) {
    if (!/^clinic\.[a-zA-Z_]{2,40}$/.test(k)) continue; // لا يُقبل سوى مفاتيح العيادة
    patch[k] = typeof v === 'string' ? str(v, 500) : v;
  }
  if (!Object.keys(patch).length) throw badRequest('لا يوجد إعداد صالح للتحديث');
  await setSettings(patch);
  await audit({ userId: req.user.id, action: 'settings.update', entity: 'settings', detail: patch });
  res.json({ settings: await getSettings() });
}));

// ---------- النسخ الاحتياطي ----------
async function dumpJson() {
  const out = {
    meta: { app: 'nutrition-clinic', version: 2, engine: 'postgres', exported_at: new Date().toISOString(), source: DB_LABEL },
    tables: {},
  };
  for (const t of TABLES) {
    out.tables[t] = await db.all(
      t === 'settings'
        ? `SELECT * FROM settings WHERE key NOT LIKE '\\_%' ESCAPE '\\' ORDER BY key` // الأسرار الداخلية لا تخرج في النسخ
        : `SELECT * FROM ${t} ORDER BY id`,
    );
  }
  return out;
}

router.get('/backup', authRequired, adminOnly(), wrap(async (req, res) => res.json(await dumpJson())));

/** نفس النسخة كملف للتنزيل (زر «تنزيل ملف النسخة» في الإعدادات) */
router.get('/backup/file', authRequired, adminOnly(), wrap(async (req, res) => {
  const body = JSON.stringify(await dumpJson());
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(Buffer.byteLength(body)));
  res.setHeader('Content-Disposition', `attachment; filename="clinic-backup-${todayISO()}.json"`);
  res.send(body);
}));

/** أعمدة كل جدول كما هي في القاعدة فعلاً (يمنع حقن أعمدة غريبة من ملف الاستعادة) */
async function tableColumns() {
  const rows = await db.all(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ANY(?::text[])`, TABLES);
  const map = {};
  for (const r of rows) (map[r.table_name] ||= new Set()).add(r.column_name);
  return map;
}

/** استعادة من نسخة JSON — المدير فقط، وتُحفظ نسخة أمان داخل القاعدة أولاً */
router.post('/restore', authRequired, adminOnly(), wrap(async (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object' || !data.tables || typeof data.tables !== 'object') {
    throw badRequest('الملف غير صالح: يجب أن يكون نسخة JSON من هذا النظام');
  }
  const incoming = TABLES.filter((t) => Array.isArray(data.tables[t]));
  if (!incoming.length) throw badRequest('لا توجد جداول معروفة داخل الملف');
  if (incoming.includes('users') && !data.tables.users.some((u) => u.role === 'admin' && (u.active ?? 1))) {
    throw badRequest('النسخة لا تحتوي على مدير نشط واحد على الأقل — رُفضت كي لا تُقفل النظام');
  }

  const safety = JSON.stringify(await dumpJson());
  const columns = await tableColumns();
  let snapshotId;
  const counts = {};

  await db.tx(async () => {
    snapshotId = await db.insert(`INSERT INTO backup_snapshots (reason, payload, created_by) VALUES (?, ?, ?)`,
      'pre-restore', safety, req.user.id);
    // حذف بعكس ترتيب الاعتماديات، ثم إدخال بالترتيب
    for (const t of [...incoming].reverse()) {
      await db.run(t === 'settings' ? `DELETE FROM settings WHERE key NOT LIKE '\\_%' ESCAPE '\\'` : `DELETE FROM ${t}`);
    }
    for (const t of incoming) {
      counts[t] = 0;
      for (const row of data.tables[t]) {
        if (!row || typeof row !== 'object') continue;
        const cols = Object.keys(row).filter((c) => columns[t]?.has(c));
        if (!cols.length) continue;
        if (t === 'settings' && String(row.key || '').startsWith('_')) continue;
        await db.run(
          `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`
          + (t === 'settings' ? ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value' : ''),
          Object.fromEntries(cols.map((c) => [c, row[c] ?? null])),
        );
        counts[t] += 1;
      }
    }
    await resetSequences(WITH_ID.filter((t) => incoming.includes(t)));
    // الاحتفاظ بآخر نسخ الأمان فقط كي لا تكبر القاعدة
    await db.run(`DELETE FROM backup_snapshots WHERE id NOT IN (SELECT id FROM backup_snapshots ORDER BY id DESC LIMIT ${KEEP_SNAPSHOTS})`);
  });

  // المستخدم الحالي قد لا يكون موجوداً بعد الاستعادة؛ نسجل العملية بدون ربط إن لزم
  const stillExists = await db.get(`SELECT id FROM users WHERE id = ?`, req.user.id);
  await audit({ userId: stillExists ? req.user.id : null, action: 'system.restore', entity: 'system', detail: { tables: incoming, counts, safety_snapshot: snapshotId } });
  res.json({ restored: true, tables: incoming, counts, safety_copy: `snapshot#${snapshotId}` });
}));

/** قائمة نسخ الأمان التلقائية (قبل كل استعادة) */
router.get('/backup/snapshots', authRequired, adminOnly(), wrap(async (req, res) => {
  res.json({ items: await db.all(`SELECT id, reason, created_at, created_by, length(payload) AS bytes FROM backup_snapshots ORDER BY id DESC`) });
}));

router.get('/backup/snapshots/:id(\\d+)', authRequired, adminOnly(), wrap(async (req, res) => {
  const row = await db.get(`SELECT payload, created_at FROM backup_snapshots WHERE id = ?`, Number(req.params.id));
  if (!row) throw notFound('نسخة الأمان غير موجودة');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="clinic-safety-${req.params.id}.json"`);
  res.send(row.payload);
}));

/** صيانة: تحديث إحصائيات المخطِّط + فحص سلامة منطقي للبيانات */
router.post('/maintenance/vacuum', authRequired, adminOnly(), wrap(async (req, res) => {
  await db.exec('ANALYZE');
  const orphans = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM measurements m WHERE NOT EXISTS (SELECT 1 FROM patients p WHERE p.id = m.patient_id)) AS measurements,
      (SELECT COUNT(*) FROM payments pa    WHERE NOT EXISTS (SELECT 1 FROM patients p WHERE p.id = pa.patient_id)) AS payments,
      (SELECT COUNT(*) FROM diet_meals dm  WHERE NOT EXISTS (SELECT 1 FROM diet_plans d WHERE d.id = dm.plan_id)) AS meals`);
  const size = await db.get(`SELECT pg_database_size(current_database()) AS bytes`).catch(() => null);
  const clean = Object.values(orphans).every((n) => n === 0);
  await audit({ userId: req.user.id, action: 'system.vacuum', entity: 'system' });
  res.json({ ok: true, integrity: clean ? ['ok'] : [`سجلات يتيمة: ${JSON.stringify(orphans)}`], engine: DRIVER, db_bytes: size?.bytes ?? null });
}));

// ---------- صحة النظام ----------
router.get('/health', wrap(async (req, res) => {
  const counts = await db.get(`
    SELECT (SELECT COUNT(*) FROM patients) AS patients, (SELECT COUNT(*) FROM appointments) AS appointments,
           (SELECT COUNT(*) FROM payments) AS payments, (SELECT COUNT(*) FROM measurements) AS measurements`);
  res.json({ ok: true, time: new Date().toISOString(), version: 2, counts, db: DB_LABEL });
}));
