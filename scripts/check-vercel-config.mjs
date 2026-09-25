// فحص ذاتي لإعداد Vercel قبل الدفع: يقرأ الملفات ويتأكد من اتساقها
import fs from 'node:fs';
const fail = [];
const ok = [];
const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const pkgWeb = JSON.parse(fs.readFileSync('apps/web/package.json', 'utf8'));

if (v.buildCommand !== 'npm run build') fail.push('buildCommand يجب أن يكون npm run build');
if (!fs.existsSync(v.outputDirectory + '/index.html') && !fs.existsSync('apps/web/dist/index.html')) {
  ok.push('مجلد الإخراج سيُولَّد أثناء البناء على Vercel');
} else ok.push('apps/web/dist/index.html موجود ✓');
if (!v.outputDirectory?.endsWith('apps/web/dist')) fail.push('outputDirectory غير صحيح');
if (!fs.existsSync('api/[[...path]].js')) fail.push('ملف الدالة api/[[...path]].js مفقود');
if (!/apps\/web/.test(root.scripts.build || '')) fail.push('npm run build لا يفوّض البناء إلى apps/web');
if (root.engines?.node !== '20.x') fail.push('engines.node يجب أن يكون 20.x (مثبّت لتوافق better-sqlite3)');
if (!v.functions?.['api/[[...path]].js']?.maxDuration) fail.push('maxDuration غير مضبوط لدالة Vercel');
if (!JSON.stringify(v.rewrites).includes('(?!api/)')) fail.push('rewrite الخاص بـ SPA مفقود');
if (!pkgWeb.dependencies?.react) fail.push('اعتماديات الواجهة غير معلنة في apps/web/package.json');
// يجب أن يصدّر server.js دالة قابلة للاستعمال كـ handler
const srv = fs.readFileSync('apps/api/src/server.js', 'utf8');
if (!/export default app/.test(srv)) fail.push('server.js لا يصدّر app كـ default');
if (!/!process\.env\.VERCEL/.test(srv)) fail.push('server.js سيستدعي listen على Vercel (يجب منعه)');
if (!/EPHEMERAL/.test(fs.readFileSync('apps/api/src/db.js', 'utf8'))) fail.push('db.js لا يعرف وضع /tmp المؤقت');

console.log(ok.map((x) => '  ✓ ' + x).join('\n'));
if (fail.length) { console.error(fail.map((x) => '  ✗ ' + x).join('\n')); process.exit(1); }
console.log('  ✓ إعداد Vercel متسق (' + Object.keys(v).join(', ') + ')');
