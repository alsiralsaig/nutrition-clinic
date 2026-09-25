// المصادقية والصلاحيات: JWT + bcrypt + أدوار (admin / staff / viewer)
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, audit, EPHEMERAL, NOW } from './db.js';
import { forbidden, HttpError } from './lib.js';

/**
 * مفتاح توقيع الجلسات (JWT) — بالأولوية:
 *  1) متغير البيئة JWT_SECRET (الأفضل على Vercel)
 *  2) الوضع التجريبي بلا قاعدة: مفتاح ثابت معلن (كل حاويات Vercel يجب أن تتفق عليه)
 *  3) مفتاح عشوائي يُولَّد مرة واحدة ويُحفظ داخل القاعدة (settings._jwt_secret)
 *     → يبقى ثابتاً عبر إعادة التشغيل وعبر كل الحاويات التي تشارك نفس القاعدة
 */
let SECRET = process.env.JWT_SECRET || null;
export async function initSecret() {
  if (process.env.JWT_SECRET) { SECRET = process.env.JWT_SECRET; return; }
  if (EPHEMERAL) {
    console.warn('[auth] وضع تجريبي: استعمل JWT_SECRET ثابتاً في متغيرات البيئة على Vercel');
    SECRET = 'vercel-demo-secret-not-for-production';
    return;
  }
  await db.run(`INSERT INTO settings (key, value) VALUES ('_jwt_secret', ?) ON CONFLICT (key) DO NOTHING`,
    randomBytes(48).toString('hex'));
  SECRET = (await db.get(`SELECT value FROM settings WHERE key = '_jwt_secret'`)).value;
}
const secret = () => {
  if (!SECRET) throw new HttpError(503, 'الخادم ما زال يُهيّئ الجلسات — أعد المحاولة بعد ثوانٍ');
  return SECRET;
};
const TTL = process.env.JWT_TTL || '12h';

export const ROLES = {
  admin:  ['admin'],
  write:  ['admin', 'staff'],
  read:   ['admin', 'staff', 'viewer'],
};

export const hashPassword = (plain) => bcrypt.hashSync(String(plain), 10);
export const checkPassword = (plain, hash) => {
  try { return bcrypt.compareSync(String(plain ?? ''), String(hash ?? '')); }
  catch { return false; }
};

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, name: user.full_name },
    secret(),
    { expiresIn: TTL },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, secret());
}

/** يبني خطأ مصادقة موحد */
const authError = (msg = 'يلزم تسجيل الدخول') => new HttpError(401, msg);

function readToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  // يُسمح بالتوكن في الـ query لروابط الطباعة/التنزيل فقط
  if (req.query?.token) return String(req.query.token);
  return null;
}

export async function authRequired(req, res, next) {
  const token = readToken(req);
  if (!token) return next(authError());
  let payload;
  try { payload = verifyToken(token); }
  catch (e) {
    if (e instanceof HttpError) return next(e);
    return next(e.name === 'TokenExpiredError' ? authError('انتهت الجلسة، سجّل الدخول من جديد') : authError());
  }
  // توكن المريض (بوابة المريض) لا يفتح مسارات الموظفين أبداً
  if (payload.typ === 'patient') return next(new HttpError(403, 'هذا الحساب لبوابة المريض فقط'));
  try {
    const user = await db.get(`SELECT id, username, full_name, role, active FROM users WHERE id = ?`, payload.sub);
    if (!user || !user.active) return next(authError('الحساب موقوف — راجع الإدارة'));
    req.user = user;
    next();
  } catch (e) { next(e); }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(authError());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export const canWrite = () => requireRole('admin', 'staff');
export const adminOnly = () => requireRole('admin');

export async function touchLogin(userId) {
  await db.run(`UPDATE users SET last_login_at = ${NOW} WHERE id = ?`, userId);
  await audit({ userId, action: 'auth.login', entity: 'users', entityId: userId });
}

/** كلمة مرور المدير الافتراضية ما زالت مستعملة؟ (تُعرض كتنبيه في الواجهة) */
export const DEFAULT_ADMIN_PASSWORD = 'admin123';

export { TTL };

// ================= بوابة المريض =================
const PATIENT_TTL = process.env.PATIENT_JWT_TTL || '30d';

/** توكن مريض: مرتبط برمز الدخول (aid) — إلغاء الرمز من العيادة يُسقط الجلسة فوراً */
export function signPatientToken({ patientId, accessId }) {
  return jwt.sign({ typ: 'patient', pid: patientId, aid: accessId }, secret(), { expiresIn: PATIENT_TTL });
}

export async function patientRequired(req, res, next) {
  const token = readToken(req);
  if (!token) return next(authError('افتح البوابة بمسح رمز QR الخاص بك'));
  let payload;
  try { payload = verifyToken(token); }
  catch (e) {
    if (e instanceof HttpError) return next(e);
    return next(authError(e.name === 'TokenExpiredError' ? 'انتهت الجلسة — امسح رمز QR من جديد' : 'جلسة غير صالحة'));
  }
  if (payload.typ !== 'patient') return next(new HttpError(403, 'هذا المسار لبوابة المريض'));
  try {
    const row = await db.get(`
      SELECT a.id AS access_id, a.revoked_at, p.id, p.first_name, p.last_name, p.file_no, p.phone, p.status
      FROM patient_access a JOIN patients p ON p.id = a.patient_id WHERE a.id = ? AND a.patient_id = ?`, payload.aid, payload.pid);
    if (!row || row.revoked_at) return next(authError('أُلغي رمز الدخول — اطلب رمزاً جديداً من العيادة'));
    req.patient = row;
    next();
  } catch (e) { next(e); }
}
