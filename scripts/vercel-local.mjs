// يشغّل الدالة الوحيدة api/index.js كما يفعل Vercel: يطبّق rewrites من vercel.json ثم يستدعي الـ handler.
// node scripts/vercel-local.mjs <port> [replace|preserve]
//   replace : req.url يصبح الوجهة (/api/index?__p=…)       ← السلوك الافتراضي للـ rewrite
//   preserve: req.url يبقى الأصلي مع دمج ?__p=… في الاستعلام ← سلوك بعض بيئات Vercel
// الجسر يجب أن ينجح في الحالتين، فنختبرهما معاً.
import http from 'node:http';
import fs from 'node:fs';
process.env.VERCEL ??= '1';
const [port = '4300', mode = 'replace'] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const { default: handler } = await import(new URL('../api/index.js', import.meta.url).href);

export function route(original) {
  const u = new URL(original, 'http://x');
  for (const r of cfg.rewrites || []) {
    const m = u.pathname.match(new RegExp('^' + r.source + '$'));
    if (!m) continue;
    const dest = r.destination.replace(/\$(\d)/g, (_, i) => m[+i] ?? '');
    if (!dest.startsWith('/api/')) return { static: dest };
    const d = new URL(dest, 'http://x');
    for (const [k, v] of u.searchParams) d.searchParams.append(k, v); // Vercel يمرّر استعلام الطلب الأصلي
    if (mode === 'preserve') { const o = new URL(original, 'http://x'); o.searchParams.set('__p', d.searchParams.get('__p')); return { fn: o.pathname + o.search }; }
    return { fn: d.pathname + d.search };
  }
  return { static: u.pathname };
}

http.createServer((req, res) => {
  const r = route(req.url);
  if (r.static) { res.writeHead(r.static === '/index.html' ? 200 : 404, { 'content-type': 'text/plain' }); return res.end('STATIC ' + r.static); }
  req.url = r.fn;
  handler(req, res);
}).listen(+port, '127.0.0.1', () => console.log(`ready ${mode}`));
