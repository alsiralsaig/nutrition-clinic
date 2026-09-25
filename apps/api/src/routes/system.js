// الإعدادات + النسخ الاحتياطي (JSON منطقي + ملف القاعدة الخام) + استعادة
import fs from 'node:fs';
import { Router } from 'express';
import { db, DB_PATH, getSettings, setSettings, audit } from '../db.js';
import { badRequest, forbidden, wrap, str, todayISO } from '../lib.js';
import { adminOnly, authRequired } from '../auth.js';

export const router = Router();

const TABLES = [
  'users', 'patients', 'visits', 'measurements', 'diet_plans', 'diet_meals',
  'appointments', 'payments', 'audit_log', 'settings',
];

const EMAIL_SAFE = /^[a-zA-Z0-9._@-]{0,120}$/;

// ---------- إعدادات العيادة ----------
router.get('/settings', wrap((req, res) => res.json({ settings: getSettings() })));

router.put('/settings', authRequired, adminOnly(), wrap((req, res) => {
  const body = req.body || {};
  if (!body || typeof body !== 'object') throw badRequest('بصيغة كائن key/value');
  const patch = {};
  for (const [k, v] of Object.entries(body)) {
    if (!/^clinic\.[a-z_]{2,40}$/.test(k)) continue; // لا يُقبل سوى مفاتيح العيادة
    patch[k] = typeof v === 'string' ? str(v, 500) : v;
  }
  if (!Object.keys(patch).length) throw badRequest('لا يوجد إعداد صالح للتحديث');
  setSettings(patch);
  audit({ userId: req.user.id, action: 'settings.update', entity: 'settings', detail: patch });
  res.json({ settings: getSettings() });
}));

// ---------- النسخ الاحتياطي ----------
function dumpJson() {
  const out = { meta: { app: 'nutrition-clinic', version: 1, exported_at: new Date().toISOString(), db: DB_PATH }, tables: {} };
  for (const t of TABLES) out.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return out;
}

router.get('/backup', authRequired, adminOnly(), wrap((req, res) => res.json(dumpJson())));

router.get('/backup/file', authRequired, adminOnly(), wrap((req, res) => {
  db.pragma('wal_checkpoint(TRUNCATE)'); // ضمّ سجل WAL إلى الملف الأساسي
  const stat = fs.statSync(DB_PATH);
  const name = `clinic-backup-${todayISO()}.sqlite`;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  fs.createReadStream(DB_PATH).pipe(res);
}));

/** استعادة من نسخة JSON — المدير فقط، ويُنسخ الأمان أولاً */
router.post('/restore', authRequired, adminOnly(), wrap((req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object' || !data.tables) throw badRequest('الملف غير صالح: يجب أن يكون نسخة JSON من هذا النظام');
  const allowed = new Set(TABLES);
  const incoming = Object.keys(data.tables).filter((t) => allowed.has(t));
  if (!incoming.length) throw badRequest('لا توجد جداول معروفة داخل الملف');

  const safe = dumpJson();
  const safetyPath = `${DB_PATH}.pre-restore-${Date.now()}.json`;
  fs.writeFileSync(safetyPath, JSON.stringify(safe));

  db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    for (const t of incoming) {
      db.prepare(`DELETE FROM ${t}`).run();
      const rows = Array.isArray(data.tables[t]) ? data.tables[t] : [];
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => /^[a-z_]{2,40}$/.test(c));
        if (!cols.length) continue;
        db.prepare(`INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`)
          .run(Object.fromEntries(cols.map((c) => [c, row[c] ?? null])));
      }
    }
    db.pragma('foreign_keys = ON');
  })();
  audit({ userId: req.user.id, action: 'system.restore', entity: 'system', detail: { tables: incoming, safety_copy: safetyPath } });
  res.json({ restored: true, tables: incoming, safety_copy: safetyPath });
}));

/** إعادة ترتيب/فحص سلامة القاعدة */
router.post('/maintenance/vacuum', authRequired, adminOnly(), wrap((req, res) => {
  db.exec('VACUUM;');
  const integrity = db.pragma('integrity_check');
  audit({ userId: req.user.id, action: 'system.vacuum', entity: 'system' });
  res.json({ ok: true, integrity });
}));

// ---------- صحة النظام ----------
router.get('/health', (req, res) => {
  const counts = {};
  for (const t of ['patients', 'appointments', 'payments', 'measurements']) {
    counts[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  }
  res.json({ ok: true, time: new Date().toISOString(), version: 1, counts, db_path: DB_PATH });
});
