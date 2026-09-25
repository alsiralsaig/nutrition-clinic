// طبقة قاعدة البيانات — PostgreSQL فقط، بمحركين يتكلمان نفس لهجة SQL:
//   1) DATABASE_URL موجود  → Postgres حقيقي (Neon على Vercel، أو أي Postgres) عبر مكتبة pg
//   2) بدون DATABASE_URL    → PGlite: نسخة Postgres مدمجة داخل Node (لا تحتاج تثبيت شيء)
//        - محلياً: تحفظ في apps/api/.data/pgdata (بيانات دائمة على جهازك)
//        - على Vercel بلا قاعدة: في الذاكرة فقط = «وضع تجريبي» تظهر له لافتة في الواجهة
//
// الواجهة البرمجية (كلها async):
//   db.all(sql, ...params)  → صفوف     db.get(sql, ...params) → صف أو undefined
//   db.run(sql, ...params)  → { changes }
//   db.insert(sql, ...params) → id السجل الجديد (يُلحق RETURNING id تلقائياً)
//   db.exec(sql)            → تنفيذ عدة أوامر (المخطط)
//   db.tx(async () => {...}) → معاملة؛ كل استدعاءات db داخلها تمر عبر نفس الاتصال تلقائياً
// المعاملات: إما «?» بالترتيب، أو كائن واحد مع أسماء «@name».
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/** يرفع هذا الرقم عند أي تعديل على schema.sql كي تُطبَّق التعديلات على القواعد الموجودة */
export const SCHEMA_VERSION = '3';

export const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
export const DRIVER = DATABASE_URL ? 'postgres' : 'pglite';
/** على Vercel بدون قاعدة خارجية: الذاكرة فقط → بيانات تجريبية تُمسح */
export const EPHEMERAL = !!process.env.VERCEL && !DATABASE_URL;
/** قاعدة حقيقية دائمة (Neon أو غيرها) — تُعامل كإنتاج: لا بيانات تجريبية افتراضياً */
export const PRODUCTION_DB = DRIVER === 'postgres';

export const DATA_DIR = process.env.CLINIC_DATA_DIR || path.join(__dirname, '..', '.data');
const PGLITE_DIR = path.join(DATA_DIR, 'pgdata');

/** وصف آمن لمكان القاعدة (بدون كلمة المرور) للعرض في /api/health */
export const DB_LABEL = (() => {
  if (DATABASE_URL) {
    try { const u = new URL(DATABASE_URL); return `postgres://${u.hostname}${u.pathname}`; }
    catch { return 'postgres://(DATABASE_URL)'; }
  }
  return EPHEMERAL ? 'pglite://memory (تجريبي)' : `pglite://${PGLITE_DIR}`;
})();

/** نص «الآن» بتوقيت UTC وبنفس صيغة التخزين YYYY-MM-DD HH:MM:SS */
export const NOW = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;
/** تاريخ اليوم بصيغة YYYY-MM-DD */
export const TODAY = `to_char(CURRENT_DATE, 'YYYY-MM-DD')`;

// ---------------- تحويل «?» و «@name» إلى $1.. الخاصة بـ Postgres ----------------
const compiled = new Map();
function compile(sql, named) {
  const key = (named ? 'N:' : 'P:') + sql;
  const hit = compiled.get(key);
  if (hit) return hit;
  let out = '';
  let n = 0;
  const names = [];
  const index = new Map();
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {            // تخطي النصوص والأسماء المقتبسة
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) { if (sql[j + 1] === ch) { j += 2; continue; } break; }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j;
    } else if (!named && ch === '?') {
      out += `$${++n}`;
    } else if (named && ch === '@' && /[A-Za-z_]/.test(sql[i + 1] || '')) {
      let j = i + 1;
      while (j < sql.length && /\w/.test(sql[j])) j++;
      const name = sql.slice(i + 1, j);
      if (!index.has(name)) { names.push(name); index.set(name, names.length); }
      out += `$${index.get(name)}`;
      i = j - 1;
    } else out += ch;
  }
  const res = { text: out, names };
  compiled.set(key, res);
  return res;
}

function prepareArgs(sql, params) {
  const isNamed = params.length === 1 && params[0] && typeof params[0] === 'object'
    && !Array.isArray(params[0]) && !(params[0] instanceof Date);
  const { text, names } = compile(sql, isNamed);
  const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  const values = isNamed ? names.map((k) => clean(params[0][k])) : params.map(clean);
  return { text, values };
}

// ---------------- المحركان ----------------
let impl = null;
const txStore = new AsyncLocalStorage();

async function createPostgres() {
  const { default: pg } = await import('pg');
  // الأعداد الكبيرة (COUNT/SUM) والـ numeric (ROUND) كأرقام JS عادية
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => Number(v));
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || (process.env.VERCEL ? 3 : 10)),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
  pool.on('error', (e) => console.error('[db] خطأ اتصال خامل:', e.message));
  const wrapClient = (c) => ({
    query: (text, values) => c.query(text, values),
    exec: (sql) => c.query(sql),
  });
  return {
    ...wrapClient(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrapClient(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}

async function createPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const parsers = { 20: (v) => Number(v), 1700: (v) => Number(v) };
  let dataDir;
  if (!EPHEMERAL) { fs.mkdirSync(PGLITE_DIR, { recursive: true }); dataDir = PGLITE_DIR; }
  const lite = dataDir ? new PGlite(dataDir, { parsers }) : new PGlite({ parsers });
  await lite.waitReady;
  const wrapLite = (c) => ({
    query: async (text, values) => {
      const r = await c.query(text, values);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
    exec: (sql) => c.exec(sql),
  });
  return {
    ...wrapLite(lite),
    tx: (fn) => lite.transaction((t) => fn(wrapLite(t))),
    close: () => lite.close(),
  };
}

function conn() {
  const inTx = txStore.getStore();
  if (inTx) return inTx;
  if (!impl) throw new Error('قاعدة البيانات لم تُهيّأ بعد — استدعِ connect() أولاً');
  return impl;
}

export const db = {
  async all(sql, ...params) {
    const { text, values } = prepareArgs(sql, params);
    return (await conn().query(text, values)).rows;
  },
  async get(sql, ...params) {
    return (await db.all(sql, ...params))[0];
  },
  async run(sql, ...params) {
    const { text, values } = prepareArgs(sql, params);
    const r = await conn().query(text, values);
    return { changes: r.rowCount ?? 0 };
  },
  async insert(sql, ...params) {
    const row = await db.get(`${sql.trim().replace(/;$/, '')} RETURNING id`, ...params);
    return row?.id;
  },
  exec: (sql) => conn().exec(sql),
  async tx(fn) {
    if (txStore.getStore()) return fn();           // معاملة متداخلة = نفس المعاملة
    if (!impl) throw new Error('قاعدة البيانات لم تُهيّأ بعد');
    return impl.tx((client) => txStore.run(client, fn));
  },
  async close() { if (impl) { const i = impl; impl = null; await i.close(); } },
};

let connecting = null;
/** يفتح الاتصال ويطبّق المخطط مرة واحدة لكل حاوية/عملية */
export function connect() {
  if (!connecting) {
    connecting = (async () => {
      impl = DRIVER === 'postgres' ? await createPostgres() : await createPglite();
      await migrate();
    })().catch((e) => { connecting = null; impl = null; throw e; });
  }
  return connecting;
}

/** أمر الـ migrate: آمن مع عدة حاويات تقلع معاً (قفل استشاري داخل معاملة) */
export async function migrate() {
  // مسار سريع: المخطط مطبّق بالإصدار الحالي
  try {
    const v = await db.get(`SELECT value FROM settings WHERE key = '_schema_version'`);
    if (v?.value === SCHEMA_VERSION) return;
  } catch { /* الجداول غير موجودة بعد */ }

  await db.tx(async () => {
    await db.get(`SELECT pg_advisory_xact_lock(724301)`);
    await db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    for (const [key, value] of DEFAULT_SETTINGS) {
      await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`,
        key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    await db.run(`INSERT INTO settings (key, value) VALUES ('_schema_version', ?)
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, SCHEMA_VERSION);
  });
}

export const DEFAULT_SETTINGS = [
  ['clinic.name', 'عيادة تغذية علاجية ورياضية'],
  ['clinic.currency', 'SDG'],
  ['clinic.phone', '+249 000 000 000'],
  ['clinic.address', 'الخرطوم — السودان'],
  ['clinic.weekend', 'Friday'],
  ['clinic.workday', JSON.stringify({ from: '09:00', to: '20:00' })],
  ['clinic.country_code', '249'],            // لتحويل أرقام الهواتف المحلية إلى صيغة واتساب الدولية
  ['clinic.reminders_enabled', true],        // تذكير المواعيد التلقائي (المهمة اليومية)
  ['clinic.daily_reminder_enabled', true],   // التذكير اليومي بالخطة للمرضى المشتركين
  ['clinic.printFooter', 'هذا التقرير صادر إلكترونياً من نظام إدارة العيادة ولا يُعتد به إلا معتمدًا من الإدارة.'],
];

/** إعدادات العيادة العامة — المفاتيح التي تبدأ بـ «_» داخلية (سر الجلسات، إصدار المخطط) ولا تُعرض */
export async function getSettings() {
  const rows = await db.all(`SELECT key, value FROM settings WHERE key NOT LIKE '\\_%' ESCAPE '\\'`);
  const out = {};
  for (const r of rows) {
    let v = r.value;
    try { v = JSON.parse(r.value); } catch { /* نص عادي */ }
    out[r.key] = v;
  }
  return out;
}

export async function getSetting(key, fallback = null) {
  const all = await getSettings();
  return all[key] ?? fallback;
}

export async function setSettings(obj) {
  await db.tx(async () => {
    for (const [k, v] of Object.entries(obj || {})) {
      await db.run(`INSERT INTO settings (key, value) VALUES (?, ?)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  });
}

export async function audit({ userId, action, entity, entityId = null, detail = null }) {
  await db.run(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`,
    userId ?? null, action, entity, entityId, detail ? JSON.stringify(detail) : null,
  );
}

export async function nextFileNo() {
  // رقم ملف تلقائي بصيغة NC-0001 (يتجاهل أي أرقام ملفات غير قياسية مستوردة)
  const row = await db.get(`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(file_no, '\\D', '', 'g'), '')::int), 0) AS n
    FROM patients WHERE file_no ~ '^NC-[0-9]+$'`);
  return `NC-${String(row.n + 1).padStart(4, '0')}`;
}

/** بعد إدخال معرّفات صريحة (استعادة/بذرة) نعيد مزامنة عدّاد الـ identity */
export async function resetSequences(tables) {
  for (const t of tables) {
    await db.get(`SELECT setval(pg_get_serial_sequence('${t}', 'id'),
                   COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
  }
}
