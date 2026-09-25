// طبقة قاعدة البيانات: اتصال SQLite واحد + أدوات مساعدة آمنة (prepared statements)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * وضع المنصة:
 *  - خادم العادي (الخيار الافتراضي): ملف SQLite على قرص دائم → البيانات محفوظة.
 *  - Vercel / serverless: لا قرص دائم؛ نكتب في /tmp وتُمسح البيانات عند إعدام الحاوية،
 *    لذلك يُبذر النظام نفسه تلقائياً وتظهر لافتة «وضع تجريبي» في الواجهة.
 */
export const EPHEMERAL = !!process.env.VERCEL && !process.env.CLINIC_DB_PATH;

const DATA_DIR = process.env.CLINIC_DATA_DIR || (EPHEMERAL ? '/tmp/clinic' : path.join(__dirname, '..', '.data'));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.CLINIC_DB_PATH || path.join(DATA_DIR, 'clinic.sqlite');

export const db = new Database(DB_PATH);
// WAL أسرع على قرص دائم؛ لكن على وسيط مؤقت قد تفشل ملفات -shm/-wal، فنكتفي بـ DELETE
db.pragma(EPHEMERAL ? 'journal_mode = DELETE' : 'journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function migrate() {
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const seedDefaults = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`,
  );
  for (const [key, value] of DEFAULT_SETTINGS) seedDefaults.run(key, JSON.stringify(value));
}

export const DEFAULT_SETTINGS = [
  ['clinic.name', 'عيادة تغذية علاجية ورياضية'],
  ['clinic.currency', 'SDG'],
  ['clinic.phone', '+249 000 000 000'],
  ['clinic.address', 'الخرطوم — السودان'],
  ['clinic.weekend', 'Friday'],
  ['clinic.workday', JSON.stringify({ from: '09:00', to: '20:00' })],
  ['clinic.printFooter', 'هذا التقرير صادر إلكترونياً من نظام إدارة العيادة ولا يُعتد به إلا معتمدًا من الإدارة.'],
];

export function getSettings() {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const out = {};
  for (const r of rows) {
    let v = r.value;
    try { v = JSON.parse(r.value); } catch { /* نص عادي */ }
    out[r.key] = v;
  }
  return out;
}

export function setSettings(obj) {
  const up = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) up.run(k, typeof v === 'string' ? v : JSON.stringify(v));
  });
  tx(Object.entries(obj || {}));
}

export function audit({ userId, action, entity, entityId = null, detail = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`,
  ).run(userId ?? null, action, entity, entityId, detail ? JSON.stringify(detail) : null);
}

export function nextFileNo() {
  // رقم ملف تلقائي بصيغة NC-0001 دون فجوات
  const row = db.prepare(
    `SELECT COALESCE(MAX(CAST(substr(file_no, 4) AS INTEGER)), 0) AS n FROM patients`,
  ).get();
  return `NC-${String(row.n + 1).padStart(4, '0')}`;
}

export { DB_PATH, DATA_DIR };
