// فحص ذاتي لإعداد Vercel قبل الدفع: يقرأ الملفات ويتأكد من اتساقها
// node scripts/check-vercel-config.mjs
import fs from 'node:fs';
import path from 'node:path';
import { prefixes } from './gen-vercel-bridges.mjs';

const fail = [];
const ok = [];
const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const pkgWeb = JSON.parse(fs.readFileSync('apps/web/package.json', 'utf8'));

if (v.buildCommand !== 'npm run build') fail.push('buildCommand يجب أن يكون npm run build');
if (!v.outputDirectory?.endsWith('apps/web/dist')) fail.push('outputDirectory غير صحيح');
else ok.push('مجلد الإخراج يُبنى من apps/web/dist ✓');
if (!/apps\/web/.test(root.scripts.build || '')) fail.push('npm run build لا يفوّض البناء إلى apps/web');
if (root.engines?.node !== '20.x') fail.push('engines.node يجب أن يكون 20.x (مثبّت لتوافق better-sqlite3)');
if (!JSON.stringify(v.functions).includes('api/**/*.js')) fail.push('functions يجب أن تغطي api/**/*.js');
if (!v.functions?.['api/**/*.js']?.maxDuration) fail.push('maxDuration غير مضبوط لدوال Vercel');
if (v.functions?.['api/**/*.js']?.maxDuration > 300) fail.push('maxDuration يتجاوز حد خطة Hobby (300 ثانية)');
if (!JSON.stringify(v.rewrites).includes('(?!api/)')) fail.push('rewrite الخاص بـ SPA مفقود');
if (!pkgWeb.dependencies?.react) fail.push('اعتماديات الواجهة غير معلنة في apps/web/package.json');

// ── تغطية المسارات: هذا هو الشرط الذي كان يكسر النشر ──
// Vercel لا يبني دالة بصيغة api/[[...path]].js، فيمرّ مقطع واحد فقط وترجع بقية المسارات NOT_FOUND.
for (const f of fs.existsSync('api') ? fs.readdirSync('api') : []) {
  if (f.includes('[[')) fail.push(`صيغة غير مدعومة على Vercel: api/${f} — استعمل مجلداً لكل بادئة`);
}
const list = prefixes();
const { SINGLE_FILES } = await import('./gen-vercel-bridges.mjs');
const missing = [];
for (const p of list) {
  for (const f of ['index.js', '[...path].js']) {
    if (!fs.existsSync(path.join('api', p, f))) missing.push(`api/${p}/${f}`);
  }
}
for (const f of SINGLE_FILES) if (!fs.existsSync(path.join('api', f))) missing.push(`api/${f}`);
if (missing.length) fail.push(`جسور مفقودة (${missing.length}): ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}\n    أعد التوليد: node scripts/gen-vercel-bridges.mjs`);
else ok.push(`${list.length} بادئة API (${list.length * 2 + SINGLE_FILES.length} دالة جسر) مغطاة بالكامل ✓`);

// يجب أن يصدّر server.js دالة قابلة للاستعمال كـ handler
const srv = fs.readFileSync('apps/api/src/server.js', 'utf8');
if (!/export default app/.test(srv)) fail.push('server.js لا يصدّر app كـ default');
if (!/!process\.env\.VERCEL/.test(srv)) fail.push('server.js سيستدعي listen على Vercel (يجب منعه)');
if (!/EPHEMERAL/.test(fs.readFileSync('apps/api/src/db.js', 'utf8'))) fail.push('db.js لا يعرف وضع /tmp المؤقت');
if (!/EPHEMERAL/.test(fs.readFileSync('apps/api/src/auth.js', 'utf8'))) fail.push('auth.js سيكتب مفتاح JWT على قرص للقراءة فقط');

console.log(ok.map((x) => '  ✓ ' + x).join('\n'));
if (fail.length) { console.error('\n' + fail.map((x) => '  ✗ ' + x).join('\n')); process.exit(1); }
console.log('  ✓ إعداد Vercel متسق (' + Object.keys(v).join(', ') + ')');
