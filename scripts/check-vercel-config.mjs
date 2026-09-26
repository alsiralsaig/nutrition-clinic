// فحص ذاتي لإعداد Vercel قبل الدفع: يقرأ الملفات ويتأكد من اتساقها
// node scripts/check-vercel-config.mjs
import fs from 'node:fs';
import path from 'node:path';
import { functionFiles, FUNCTION_FILE, API_REWRITE, HOBBY_FUNCTION_LIMIT } from './gen-vercel-bridges.mjs';

const fail = [];
const ok = [];
const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const pkgWeb = JSON.parse(fs.readFileSync('apps/web/package.json', 'utf8'));

if (v.buildCommand !== 'npm run build') fail.push('buildCommand يجب أن يكون npm run build');
if (!v.outputDirectory?.endsWith('apps/web/dist')) fail.push('outputDirectory غير صحيح');
else ok.push('مجلد الإخراج يُبنى من apps/web/dist ✓');
if (!/apps\/web/.test(root.scripts.build || '')) fail.push('npm run build لا يفوّض البناء إلى apps/web');
if (root.engines?.node !== '20.x') fail.push('engines.node يجب أن يكون 20.x');
const fnCfg = v.functions?.[FUNCTION_FILE];
if (!fnCfg) fail.push(`functions يجب أن يضبط ${FUNCTION_FILE}`);
if (!fnCfg?.maxDuration) fail.push('maxDuration غير مضبوط لدالة Vercel');
if (fnCfg?.maxDuration > 300) fail.push('maxDuration يتجاوز حد خطة Hobby (300 ثانية)');
const rw = v.rewrites || [];
const apiIdx = rw.findIndex((r) => r.source === API_REWRITE.source && r.destination === API_REWRITE.destination);
const spaIdx = rw.findIndex((r) => String(r.source).includes('(?!api/)'));
if (apiIdx < 0) fail.push(`rewrite الخاص بالـ API مفقود: ${API_REWRITE.source} → ${API_REWRITE.destination}`);
if (spaIdx < 0) fail.push('rewrite الخاص بـ SPA مفقود');
if (apiIdx >= 0 && spaIdx >= 0 && apiIdx > spaIdx) fail.push('rewrite الـ API يجب أن يسبق rewrite الواجهة');
if (!pkgWeb.dependencies?.react) fail.push('اعتماديات الواجهة غير معلنة في apps/web/package.json');

// ── عدد الدوال: هذا ما كان يُفشل النشر ──
// خطة Hobby: "No more than 12 Serverless Functions can be added to a Deployment".
// وصيغة api/[[...path]].js لا يبنيها Vercel (يمرّ مقطع واحد فقط) — لذلك دالة واحدة + rewrite.
const fns = functionFiles();
for (const f of fns) if (f.includes('[[')) fail.push(`صيغة غير مدعومة على Vercel: ${f}`);
if (fns.length > HOBBY_FUNCTION_LIMIT) fail.push(`${fns.length} دالة في api/ — خطة Hobby تسمح بـ ${HOBBY_FUNCTION_LIMIT} فقط. أعد التوليد: node scripts/gen-vercel-bridges.mjs`);
else if (!fns.includes(FUNCTION_FILE)) fail.push(`${FUNCTION_FILE} مفقود — node scripts/gen-vercel-bridges.mjs`);
else ok.push(`${fns.length} دالة Vercel فقط (${fns.join(', ')}) — ضمن حد Hobby (${HOBBY_FUNCTION_LIMIT}) ✓`);

// يجب أن يصدّر server.js دالة قابلة للاستعمال كـ handler
const srv = fs.readFileSync('apps/api/src/server.js', 'utf8');
if (!/export default app/.test(srv)) fail.push('server.js لا يصدّر app كـ default');
if (!/!process\.env\.VERCEL/.test(srv)) fail.push('server.js سيستدعي listen على Vercel (يجب منعه)');
const dbSrc = fs.readFileSync('apps/api/src/db.js', 'utf8');
if (!/EPHEMERAL/.test(dbSrc)) fail.push('db.js لا يعرف الوضع التجريبي (Vercel بلا قاعدة)');
if (!/EPHEMERAL/.test(fs.readFileSync('apps/api/src/auth.js', 'utf8'))) fail.push('auth.js لا يعرف الوضع التجريبي (سر JWT يجب أن يتفق بين الحاويات)');
// قاعدة البيانات: Postgres (Neon) عبر DATABASE_URL — لا SQLite على Vercel إطلاقاً
if (!/process\.env\.DATABASE_URL/.test(dbSrc)) fail.push('db.js لا يقرأ DATABASE_URL (رابط Neon)');
const apiPkg = JSON.parse(fs.readFileSync('apps/api/package.json', 'utf8'));
if (!apiPkg.dependencies?.pg) fail.push('apps/api ينقصه الاعتماد pg (مشغّل Postgres/Neon)');
if (apiPkg.dependencies?.['better-sqlite3']) fail.push('better-sqlite3 ما زال معتمداً — SQLite لا يحفظ شيئاً على Vercel');
const srcFiles = fs.readdirSync('apps/api/src', { recursive: true }).map(String).filter((f) => f.endsWith('.js'));
const sqliteLeft = srcFiles.filter((f) => /better-sqlite3|\.prepare\(|datetime\('now'\)|lastInsertRowid/.test(fs.readFileSync('apps/api/src/' + f, 'utf8')));
if (sqliteLeft.length) fail.push('بقايا لهجة SQLite في: ' + sqliteLeft.join(', '));

console.log(ok.map((x) => '  ✓ ' + x).join('\n'));
// المهام المجدولة: خطة Hobby تسمح بمرة واحدة يومياً كحد أقصى لكل مهمة، وإلا يفشل النشر
for (const c of v.crons || []) {
  const parts = String(c.schedule || '').trim().split(/\s+/);
  if (!String(c.path || '').startsWith('/api/')) fail.push(`cron ${c.path}: يجب أن يبدأ المسار بـ /api/`);
  if (parts.length !== 5) fail.push(`cron ${c.path}: جدول غير صالح "${c.schedule}"`);
  else if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) fail.push(`cron ${c.path}: Hobby يسمح بمرة يومياً فقط — حدّد دقيقة وساعة ثابتتين (مثل "0 5 * * *")`);
}
if ((v.crons || []).length) console.log(`  ✓ ${(v.crons || []).length} مهمة مجدولة يومية (ضمن حد Hobby): ${(v.crons || []).map((c) => c.path + ' @ ' + c.schedule + ' UTC').join('، ')}`);
// تطبيق المريض (PWA): ملفات ثابتة في public/ — Vercel يخدمها قبل rewrite الواجهة
const PUB = 'apps/web/public';
if (!fs.existsSync(`${PUB}/sw.js`) || !/addEventListener\('push'/.test(fs.readFileSync(`${PUB}/sw.js`, 'utf8'))) fail.push('public/sw.js مفقود أو لا يعالج الإشعارات');
try {
  const man = JSON.parse(fs.readFileSync(`${PUB}/app.webmanifest`, 'utf8'));
  if (man.start_url !== '/app' || man.display !== 'standalone') fail.push('app.webmanifest: start_url=/app و display=standalone مطلوبان');
  for (const ic of man.icons || []) if (!fs.existsSync(PUB + ic.src)) fail.push(`أيقونة مفقودة: ${ic.src}`);
  if (!(man.icons || []).some((i) => i.sizes === '512x512') || !(man.icons || []).some((i) => i.purpose === 'maskable')) fail.push('app.webmanifest: أيقونة 512 وأيقونة maskable مطلوبتان');
} catch (e) { fail.push(`app.webmanifest غير صالح: ${e.message}`); }
if (!/app\.webmanifest/.test(fs.readFileSync('apps/web/index.html', 'utf8'))) fail.push('index.html لا يربط app.webmanifest');

if (fail.length) { console.error('\n' + fail.map((x) => '  ✗ ' + x).join('\n')); process.exit(1); }
console.log('  ✓ إعداد Vercel متسق (' + Object.keys(v).join(', ') + ')');
