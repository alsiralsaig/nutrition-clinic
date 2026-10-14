// الحماية: دخول، جلسة، تغيير كلمة المرور، إدارة المستخدمين (للمدير فقط)
import { Router } from 'express';
import { db, audit } from '../db.js';
import { badRequest, conflict, notFound, str, wrap, HttpError } from '../lib.js';
import { authRequired, adminOnly, signToken, hashPassword, checkPassword, touchLogin, TTL, DEFAULT_ADMIN_PASSWORD } from '../auth.js';
import { createHash, timingSafeEqual } from 'node:crypto';

/** «نسيت كلمة المرور»: رمز سرّي واحد (ADMIN_RECOVERY_CODE) يسمح بتعيين كلمة مرور جديدة والدخول مباشرة. */
function recoveryCodeOk(code) {
  const expected = (process.env.ADMIN_RECOVERY_CODE || '').trim();
  if (!expected) throw new HttpError(501, 'رمز الاستعادة غير مضبوط — أضف ADMIN_RECOVERY_CODE في متغيرات Vercel ثم أعد النشر');
  // مقارنة متسامحة: تُهمل المسافات الطرفية وحالة الأحرف (كثير من الأجهزة تبدّلها تلقائياً)
  const a = createHash('sha256').update(String(code || '').trim().toLowerCase()).digest();
  const b = createHash('sha256').update(expected.toLowerCase()).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

export const router = Router();

/** توحيد رقم التلفون السوداني: أرقام عربية→إنجليزية، حذف الرموز، +249/00249 → محلي 9 أرقام (يبدأ 9 أو 1) */
export function normPhone(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  s = s.replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00249')) s = s.slice(5);
  else if (s.startsWith('249')) s = s.slice(3);
  if (s.startsWith('0')) s = s.slice(1);            // 0913009060 → 913009060
  return s;
}
const isPhoneLike = (s) => /^9\d{8}$/.test(s) || /^1\d{8}$/.test(s);
const PIN_RE = /^\d{4,6}$/;

const publicUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: !!u.active, last_login_at: u.last_login_at, phone: u.phone || '' });

router.post('/login', wrap(async (req, res) => {
  const username = str(req.body.username, 60)?.toLowerCase();
  const password = req.body.password == null ? '' : String(req.body.password);
  if (!username || !password) throw badRequest('اسم المستخدم وكلمة المرور مطلوبان');
  // دخول برقم التلفون: لو الحقل أرقام تلفون → ابحث بالتلفون (PIN = نفس خانة كلمة المرور)
  const ph = normPhone(username);
  let user = null;
  if (isPhoneLike(ph)) {
    user = await db.get(`SELECT * FROM users WHERE phone_norm = ? AND active = 1`, ph);
    if (!user) user = await db.get(`SELECT * FROM users WHERE phone = ? AND active = 1`, username.trim());
  }
  if (!user) user = await db.get(`SELECT * FROM users WHERE lower(username) = ?`, username);
  // لوحة مفاتيح الجوال قد تضيف مسافة في آخر الكلمة — نجرّب الكلمة كما هي ثم بدون المسافات الطرفية
  const ok = user && (checkPassword(password, user.password_hash)
    || (password.trim() !== password && password.trim() && checkPassword(password.trim(), user.password_hash)));
  if (!ok) throw badRequest('اسم المستخدم أو كلمة المرور غير صحيحة');
  if (!user.active) throw conflict('هذا الحساب موقوف — راجع مدير النظام');
  await touchLogin(user.id);
  res.json({ token: signToken(user), token_type: 'Bearer', expires_in: TTL, user: publicUser(user) });
}));

router.post('/reset-password', wrap(async (req, res) => {
  const code = req.body.code == null ? '' : String(req.body.code);
  const next = req.body.new_password == null ? '' : String(req.body.new_password);
  const username = (str(req.body.username, 60) || 'admin').toLowerCase();
  if (!code || !next) throw badRequest('أدخل رمز الاستعادة وكلمة المرور الجديدة');
  if (next.length < 8) throw badRequest('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
  if (!recoveryCodeOk(code)) throw new HttpError(401, 'رمز الاستعادة غير صحيح — تأكد أن ADMIN_RECOVERY_CODE مضاف في مشروع Vercel لهذا الموقع (بنفس القيمة) وأنك أعدت النشر بعد إضافته');
  const user = await db.get(`SELECT * FROM users WHERE lower(username) = ?`, username);
  if (!user) throw notFound('المستخدم غير موجود');
  await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, hashPassword(next), user.id);
  await audit({ userId: user.id, action: 'auth.reset_password', entity: 'users', entityId: user.id });
  await touchLogin(user.id);
  res.json({ token: signToken(user), token_type: 'Bearer', expires_in: TTL, user: publicUser(user) });
}));

router.get('/me', authRequired, wrap(async (req, res) => {
  // تنبيه أمني: المدير ما زال يستعمل كلمة المرور الافتراضية المنشورة في README
  let defaultPassword = false;
  if (req.user.role === 'admin') {
    const row = await db.get(`SELECT password_hash FROM users WHERE id = ?`, req.user.id);
    defaultPassword = checkPassword(DEFAULT_ADMIN_PASSWORD, row?.password_hash);
  }
  res.json({ user: req.user, default_password: defaultPassword });
}));

router.post('/change-password', authRequired, wrap(async (req, res) => {
  const current = req.body.current_password == null ? '' : String(req.body.current_password);
  const next = req.body.new_password == null ? '' : String(req.body.new_password);
  if (next.length < 8) throw badRequest('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
  const user = await db.get(`SELECT * FROM users WHERE id = ?`, req.user.id);
  if (!checkPassword(current, user.password_hash)) throw badRequest('كلمة المرور الحالية غير صحيحة');
  await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, hashPassword(next), user.id);
  await audit({ userId: user.id, action: 'auth.change_password', entity: 'users', entityId: user.id });
  res.json({ ok: true });
}));

// ---------- إدارة المستخدمين ----------
router.get('/users', authRequired, adminOnly(), wrap(async (req, res) => {
  res.json({ items: (await db.all(`SELECT * FROM users ORDER BY id`)).map(publicUser) });
}));

router.post('/users', authRequired, adminOnly(), wrap(async (req, res) => {
  const username = str(req.body.username, 60)?.toLowerCase();
  const password = req.body.password == null ? '' : String(req.body.password);
  if (!username || !/^[a-z0-9._-]{3,60}$/.test(username)) throw badRequest('اسم المستخدم: 3–60 حرفاً إنجليزياً (أرقام ونقاط وشرطة فقط)');
  const pin = String(req.body.pin || '').trim();
  const phoneRaw = String(req.body.phone || '').trim();
  const phone = phoneRaw ? normPhone(phoneRaw) : '';
  if (phone && !isPhoneLike(phone)) throw badRequest('رقم التلفون غير صحيح — مثال: 0913009060');
  if (pin && !PIN_RE.test(pin)) throw badRequest('رمز الدخول (PIN): من 4 إلى 6 أرقام');
  const finalHash = pin ? hashPassword(pin) : hashPassword(password);
  if (!pin && password.length < 8) throw badRequest('كلمة المرور يجب ألا تقل عن 8 أحرف (أو استعمل PIN من 4-6 أرقام)');
  if (await db.get(`SELECT id FROM users WHERE lower(username)=?`, username)) throw conflict('اسم المستخدم مستخدم بالفعل');
  if (phone && await db.get(`SELECT id FROM users WHERE phone_norm=?`, phone)) throw conflict('رقم التلفون مسجل لمستخدم آخر');
  const role = ['admin', 'staff', 'viewer'].includes(req.body.role) ? req.body.role : 'staff';
  const newId = await db.insert(`
    INSERT INTO users (username, password_hash, full_name, role, active, phone, phone_norm) VALUES (?, ?, ?, ?, 1, ?, ?)
  `, username, finalHash, str(req.body.full_name, 120) || username, role, phoneRaw || null, phone || null);
  await audit({ userId: req.user.id, action: 'user.create', entity: 'users', entityId: newId, detail: { username, role } });
  res.status(201).json(publicUser(await db.get(`SELECT * FROM users WHERE id=?`, newId)));
}));

router.put('/users/:id(\\d+)', authRequired, adminOnly(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const user = await db.get(`SELECT * FROM users WHERE id=?`, id);
  if (!user) throw notFound('المستخدم غير موجود');
  const role = ['admin', 'staff', 'viewer'].includes(req.body.role) ? req.body.role : user.role;
  const active = req.body.active === undefined ? user.active : (req.body.active ? 1 : 0);
  if (user.id === req.user.id && (!active || role !== 'admin'))
    throw badRequest('لا يمكنك إيقاف حسابك أو تخفيض صلاحيتك');
  if (req.body.password && String(req.body.password).length < 8) throw badRequest('كلمة المرور يجب ألا تقل عن 8 أحرف');
  const pin = String(req.body.pin || '').trim();
  if (pin && !PIN_RE.test(pin)) throw badRequest('رمز الدخول (PIN): من 4 إلى 6 أرقام');
  const phoneRaw = req.body.phone === undefined ? (user.phone || '') : String(req.body.phone || '').trim();
  const phone = phoneRaw ? normPhone(phoneRaw) : '';
  if (phone && !isPhoneLike(phone)) throw badRequest('رقم التلفون غير صحيح — مثال: 0913009060');
  if (phone && await db.get(`SELECT id FROM users WHERE phone_norm=? AND id<>?`, phone, id)) throw conflict('رقم التلفون مسجل لمستخدم آخر');
  await db.run(`UPDATE users SET full_name=?, role=?, active=?, phone=?, phone_norm=? WHERE id=?`,
    str(req.body.full_name, 120) || user.full_name, role, active, phoneRaw || null, phone || null, id);
  if (pin) {
    await db.run(`UPDATE users SET password_hash=? WHERE id=?`, hashPassword(pin), id);
  } else if (req.body.password) {
    await db.run(`UPDATE users SET password_hash=? WHERE id=?`, hashPassword(String(req.body.password)), id);
  }
  await audit({ userId: req.user.id, action: 'user.update', entity: 'users', entityId: id });
  res.json(publicUser(await db.get(`SELECT * FROM users WHERE id=?`, id)));
}));

router.delete('/users/:id(\\d+)', authRequired, adminOnly(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw badRequest('لا يمكنك حذف حسابك الحالي');
  if ((await db.get(`SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1`)).n <= 1
      && (await db.get(`SELECT role FROM users WHERE id=?`, id))?.role === 'admin')
    throw badRequest('يجب أن يبقى مدير واحد نشط على الأقل');
  await db.run(`DELETE FROM users WHERE id=?`, id);
  await audit({ userId: req.user.id, action: 'user.delete', entity: 'users', entityId: id });
  res.json({ deleted: true, id });
}));
