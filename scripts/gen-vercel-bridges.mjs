// يولّد دالة Vercel الوحيدة: api/index.js — كل /api/* يُعاد توجيهه إليها من vercel.json
// لماذا دالة واحدة؟ خطة Hobby تمنع أكثر من 12 دالة في النشر الواحد
//   ("No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan").
// ولماذا لا [[...path]].js؟ Vercel لا يبني الـ catch-all الاختياري داخل api/ (يمرّ مقطع واحد فقط).
// الحل: rewrite  /api/(.*) → /api/index?__p=$1  والجسر يعيد بناء المسار الأصلي قبل Express.
// node scripts/gen-vercel-bridges.mjs   (ويُستدعى من deploy:check)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API_DIR = path.join(ROOT, 'api');
export const FUNCTION_FILE = 'api/index.js';
export const API_REWRITE = { source: '/api/(.*)', destination: '/api/index?__p=$1' };
export const HOBBY_FUNCTION_LIMIT = 12;

const BRIDGE = `// مُولَّد بواسطة scripts/gen-vercel-bridges.mjs — لا تحرّره يدوياً.
// الدالة الوحيدة على Vercel: نفس تطبيق Express المحلي بلا أي منطق مكرر.
// vercel.json يوجّه /api/<أي مسار> إلى هنا بالشكل /api/index?__p=<أي مسار>.
// نعيد req.url إلى المسار الأصلي (سواء مرّره Vercel أصلياً أو مُعاد كتابته) ثم نسلّمه لـ Express.
import app from '../apps/api/src/server.js';

export function restoreUrl(url) {
  const u = new URL(url, 'http://vercel.local');
  if (!u.searchParams.has('__p')) return url;
  const p = u.searchParams.get('__p').replace(/^\\/+/, '');
  u.searchParams.delete('__p');
  const rewritten = u.pathname === '/api/index' || u.pathname === '/api/index.js' || u.pathname === '/api' || u.pathname === '/api/';
  const pathname = rewritten ? '/api/' + p : u.pathname;
  return pathname + (u.searchParams.size ? '?' + u.searchParams.toString() : '');
}

export default function handler(req, res) {
  req.url = restoreUrl(req.url);
  return app(req, res);
}
`;

export function functionFiles() {
  if (!fs.existsSync(API_DIR)) return [];
  return fs.readdirSync(API_DIR, { recursive: true }).map(String)
    .filter((f) => /\.(c|m)?(js|ts)$/.test(f))
    .filter((f) => !f.split('/').some((seg) => seg.startsWith('_') || seg.startsWith('.')))
    .map((f) => 'api/' + f);
}

export function generate({ write = true } = {}) {
  if (write) {
    // احذف جسور النمط القديم (مجلد لكل بادئة = 29 دالة) — تتجاوز حد الخطة المجانية
    for (const d of fs.existsSync(API_DIR) ? fs.readdirSync(API_DIR, { withFileTypes: true }) : []) {
      const abs = path.join(API_DIR, d.name);
      if (d.isDirectory()) fs.rmSync(abs, { recursive: true, force: true });
      else if (d.name !== 'index.js') fs.rmSync(abs, { force: true });
    }
    fs.mkdirSync(API_DIR, { recursive: true });
    fs.writeFileSync(path.join(ROOT, FUNCTION_FILE), BRIDGE);
  }
  return { files: functionFiles() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { files } = generate();
  console.log(`  ${files.length} دالة Vercel: ${files.join(', ')}  (الحد في Hobby: ${HOBBY_FUNCTION_LIMIT})`);
}
