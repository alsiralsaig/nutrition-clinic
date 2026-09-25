// الحماية: دخول، جلسة، تغيير كلمة المرور، إدارة المستخدمين (للمدير فقط)
import { Router } from 'express';
import { db, audit } from '../db.js';
import { badRequest, conflict, notFound, str, wrap } from '../lib.js';
import { authRequired, adminOnly, signToken, hashPassword, checkPassword, touchLogin, TTL } from '../auth.js';

export const router = Router();

const publicUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: !!u.active, last_login_at: u.last_login_at });

router.post('/login', wrap((req, res) => {
  const username = str(req.body.username, 60)?.toLowerCase();
  const password = req.body.password == null ? '' : String(req.body.password);
  if (!username || !password) throw badRequest('اسم المستخدم وكلمة المرور مطلوبان');
  const user = db.prepare(`SELECT * FROM users WHERE lower(username) = ?`).get(username);
  if (!user || !checkPassword(password, user.password_hash)) throw badRequest('اسم المستخدم أو كلمة المرور غير صحيحة');
  if (!user.active) throw conflict('هذا الحساب موقوف — راجع مدير النظام');
  touchLogin(user.id);
  res.json({ token: signToken(user), token_type: 'Bearer', expires_in: TTL, user: publicUser(user) });
}));

router.get('/me', authRequired, wrap((req, res) => res.json({ user: req.user })));

router.post('/change-password', authRequired, wrap((req, res) => {
  const current = req.body.current_password == null ? '' : String(req.body.current_password);
  const next = req.body.new_password == null ? '' : String(req.body.new_password);
  if (next.length < 8) throw badRequest('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  if (!checkPassword(current, user.password_hash)) throw badRequest('كلمة المرور الحالية غير صحيحة');
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(next), user.id);
  audit({ userId: user.id, action: 'auth.change_password', entity: 'users', entityId: user.id });
  res.json({ ok: true });
}));

// ---------- إدارة المستخدمين ----------
router.get('/users', authRequired, adminOnly(), wrap((req, res) => {
  res.json({ items: db.prepare(`SELECT * FROM users ORDER BY id`).all().map(publicUser) });
}));

router.post('/users', authRequired, adminOnly(), wrap((req, res) => {
  const username = str(req.body.username, 60)?.toLowerCase();
  const password = req.body.password == null ? '' : String(req.body.password);
  if (!username || !/^[a-z0-9._-]{3,60}$/.test(username)) throw badRequest('اسم المستخدم: 3–60 حرفاً إنجليزياً (أرقام ونقاط وشرطة فقط)');
  if (password.length < 8) throw badRequest('كلمة المرور يجب ألا تقل عن 8 أحرف');
  if (db.prepare(`SELECT id FROM users WHERE lower(username)=?`).get(username)) throw conflict('اسم المستخدم مستخدم بالفعل');
  const role = ['admin', 'staff', 'viewer'].includes(req.body.role) ? req.body.role : 'staff';
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role, active) VALUES (?, ?, ?, ?, 1)
  `).run(username, hashPassword(password), str(req.body.full_name, 120) || username, role);
  audit({ userId: req.user.id, action: 'user.create', entity: 'users', entityId: info.lastInsertRowid, detail: { username, role } });
  res.status(201).json(publicUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(info.lastInsertRowid)));
}));

router.put('/users/:id(\\d+)', authRequired, adminOnly(), wrap((req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
  if (!user) throw notFound('المستخدم غير موجود');
  const role = ['admin', 'staff', 'viewer'].includes(req.body.role) ? req.body.role : user.role;
  const active = req.body.active === undefined ? user.active : (req.body.active ? 1 : 0);
  if (user.id === req.user.id && (!active || role !== 'admin'))
    throw badRequest('لا يمكنك إيقاف حسابك أو تخفيض صلاحيتك');
  db.prepare(`UPDATE users SET full_name=?, role=?, active=? WHERE id=?`)
    .run(str(req.body.full_name, 120) || user.full_name, role, active, id);
  if (req.body.password) {
    if (String(req.body.password).length < 8) throw badRequest('كلمة المرور يجب ألا تقل عن 8 أحرف');
    db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(hashPassword(String(req.body.password)), id);
  }
  audit({ userId: req.user.id, action: 'user.update', entity: 'users', entityId: id });
  res.json(publicUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(id)));
}));

router.delete('/users/:id(\\d+)', authRequired, adminOnly(), wrap((req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw badRequest('لا يمكنك حذف حسابك الحالي');
  if (db.prepare(`SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1`).get().n <= 1
      && db.prepare(`SELECT role FROM users WHERE id=?`).get(id)?.role === 'admin')
    throw badRequest('يجب أن يبقى مدير واحد نشط على الأقل');
  db.prepare(`DELETE FROM users WHERE id=?`).run(id);
  audit({ userId: req.user.id, action: 'user.delete', entity: 'users', entityId: id });
  res.json({ deleted: true, id });
}));
