// المصادقية والصلاحيات: JWT + bcrypt + أدوار (admin / staff / viewer)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, audit } from './db.js';
import { forbidden, HttpError } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET_FILE = path.join(__dirname, '..', '.jwt-secret');

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    const saved = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (saved) return saved;
  } catch { /* لا يوجد ملف بعد */ }
  const generated = randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  return generated;
}

const SECRET = loadSecret();
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
    SECRET,
    { expiresIn: TTL },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
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

export function authRequired(req, res, next) {
  const token = readToken(req);
  if (!token) return next(authError());
  try {
    const payload = verifyToken(token);
    const user = db
      .prepare(`SELECT id, username, full_name, role, active FROM users WHERE id = ?`)
      .get(payload.sub);
    if (!user || !user.active) return next(authError('الحساب موقوف — راجع الإدارة'));
    req.user = user;
    next();
  } catch (e) {
    next(e.name === 'TokenExpiredError' ? authError('انتهت الجلسة، سجّل الدخول من جديد') : authError());
  }
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

export function touchLogin(userId) {
  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(userId);
  audit({ userId, action: 'auth.login', entity: 'users', entityId: userId });
}

export { SECRET_FILE, TTL };
