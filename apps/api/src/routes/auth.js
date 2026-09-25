// الحماية: دخول، جلسة، تغيير كلمة المرور، إدارة المستخدمين (للمدير فقط)
import { Router } from 'express';
import { db, audit } from '../db.js';
import { badRequest, conflict, notFound, str, wrap } from '../lib.js';
import { authRequired, adminOnly, signToken, hashPassword, checkPassword, touchLogin, TTL, DEFAULT_ADMIN_PASSWORD } from '../auth.js';

export const router = Router();

const publicUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: !!u.active, last_login_at: u.last_login_at });

router.post('/login', wrap(async (req, res) => {
  const username = str(req.body.username, 60)?.toLowerCase();
  const password = req.body.password == null ? '' : String(req.body.password);
  if (!username || !password) throw badRequest('اسم المستخدم وكلمة المرور مطلوبان');
  const user = await db.get(`SELECT * FROM users WHERE lower(username) = ?`, username);
  if (!user || !checkPassword(password, user.password_hash)) throw badRequest('اسم المستخدم أو كلمة المرور غير صحيحة');
  if (!user.active) throw conflict('هذا الحساب موقوف — راجع مدير النظام');
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
  if (password.length < 8) throw badRequest('كلمة المرور يجب ألا تقل عن 8 أحرف');
  if (await db.get(`SELECT id FROM users WHERE lower(username)=?`, username)) throw conflict('اسم المستخدم مستخدم بالفعل');
  const role = ['admin', 'staff', 'viewer'].includes(req.body.role) ? req.body.role : 'staff';
  const newId = await db.insert(`
    INSERT INTO users (username, password_hash, full_name, role, active) VALUES (?, ?, ?, ?, 1)
  `, username, hashPassword(password), str(req.body.full_name, 120) || username, role);
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
  await db.run(`UPDATE users SET full_name=?, role=?, active=? WHERE id=?`,
    str(req.body.full_name, 120) || user.full_name, role, active, id);
  if (req.body.password) {
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
