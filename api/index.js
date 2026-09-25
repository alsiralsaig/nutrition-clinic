// مُولَّد بواسطة scripts/gen-vercel-bridges.mjs — لا تحرّره يدوياً.
// الدالة الوحيدة على Vercel: نفس تطبيق Express المحلي بلا أي منطق مكرر.
// vercel.json يوجّه /api/<أي مسار> إلى هنا بالشكل /api/index?__p=<أي مسار>.
// نعيد req.url إلى المسار الأصلي (سواء مرّره Vercel أصلياً أو مُعاد كتابته) ثم نسلّمه لـ Express.
import app from '../apps/api/src/server.js';

export function restoreUrl(url) {
  const u = new URL(url, 'http://vercel.local');
  if (!u.searchParams.has('__p')) return url;
  const p = u.searchParams.get('__p').replace(/^\/+/, '');
  u.searchParams.delete('__p');
  const rewritten = u.pathname === '/api/index' || u.pathname === '/api/index.js' || u.pathname === '/api' || u.pathname === '/api/';
  const pathname = rewritten ? '/api/' + p : u.pathname;
  return pathname + (u.searchParams.size ? '?' + u.searchParams.toString() : '');
}

export default function handler(req, res) {
  req.url = restoreUrl(req.url);
  return app(req, res);
}
