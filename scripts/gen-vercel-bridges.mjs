// يولّد جسور Vercel: ملف لكل بادئة مسار في /api
// السبب: Vercel يتجاهل صيغة [[...path]] الاختيارية داخل مجلد api/ مباشرة، فيمرّ مقطع واحد
// فقط ويرا بقية المسارات 404. النمط الموثّق: مجلد لكل بادئة بداخله index.js و[...path].js.
// node scripts/gen-vercel-bridges.mjs   (ويُستدعى من deploy:check للتحقق من التغطية)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API_DIR = path.join(ROOT, 'api');
const OPENAPI = path.join(ROOT, 'apps/api/openapi.json');

// بادئات المسارات التي يفتحها العميل، مستخرجة من عقد OpenAPI (مصدر الحقيقة)
export function prefixes() {
  const spec = JSON.parse(fs.readFileSync(OPENAPI, 'utf8'));
  const set = new Set();
  for (const p of Object.keys(spec.paths)) {
    const first = p.replace(/^\/+/, '').split('/')[1]; // /api/<this>/...
    if (first && !first.startsWith('{')) set.add(first);
  }
  // ملف التوثيق يُقدَّم تحت /api/openapi.json (ملف واحد بامتداد مركّب، لا مجلد بنقطة)
  set.delete('openapi.json');
  return [...set].sort();
}

// /api/openapi.json -> api/openapi.json.js (مقطع واحد، فلا يحتاج مجلداً)
export const SINGLE_FILES = ['openapi.json.js'];

const BRIDGE = (depth, comment) =>
  `// مُولَّد بواسطة scripts/gen-vercel-bridges.mjs — لا تحرّره يدوياً.\n` +
  `// نفس تطبيق Express المحلي، بلا أي منطق مكرر.\n${comment}` +
  `export { default as default } from '${'../'.repeat(depth)}apps/api/src/server.js';\n`;

export function generate({ write = true } = {}) {
  const list = prefixes();
  const wanted = [];
  for (const p of list) {
    wanted.push([`api/${p}/index.js`, BRIDGE(2, `// يخدم /api/${p} تماماً\n`)]);
    wanted.push([`api/${p}/[...path].js`, BRIDGE(2, `// يخدم /api/${p}/* بكل أعماقه\n`)]);
  }
  for (const f of SINGLE_FILES) wanted.push([`api/${f}`, BRIDGE(1, '// يخدم /api/openapi.json (مقطع واحد)\n')]);
  if (write) {
    // نظّف أي جسر قديم بصيغة مدموجة لا يدعمها Vercel
    for (const f of fs.readdirSync(API_DIR)) {
      if (f.includes('[[')) fs.rmSync(path.join(API_DIR, f), { force: true });
    }
    const keep = new Set(list);
    for (const d of fs.readdirSync(API_DIR, { withFileTypes: true })) {
      if (d.isDirectory() && !keep.has(d.name)) fs.rmSync(path.join(API_DIR, d.name), { recursive: true, force: true });
      if (d.isFile() && d.name.includes('.') && !SINGLE_FILES.includes(d.name)) fs.rmSync(path.join(API_DIR, d.name), { force: true });
    }
    for (const [rel, body] of wanted) {
      const abs = path.join(ROOT, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
  }
  return { list, files: wanted.map(([r]) => r) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { list, files } = generate();
  console.log(`  ${list.length} بادئة → ${files.length} ملف جسر في api/`);
  console.log('  ' + list.join(' · '));
}
