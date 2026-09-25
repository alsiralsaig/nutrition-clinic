// يجمع كل النصوص العربية التي ستُلف بـ __t/__tf ويقارنها بالقاموس en.js
//   node i18n-extract.mjs          → تقرير التغطية (يفشل إن نقص شيء مع --check)
//   node i18n-extract.mjs --json   → قائمة المفاتيح الناقصة JSON
import { transformAsync } from '@babel/core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import plugin from './babel-plugin-arabic-i18n.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'src');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|mjs)$/.test(f)) files.push(p); } })(src);

const keys = new Set();
for (const f of files) {
  await transformAsync(fs.readFileSync(f, 'utf8'), { filename: f, babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] }, plugins: [[plugin, { collect: keys }]] });
}
// تسميات الخادم الثابتة + أسماء الوجبات (مستثناة من الإضافة لكنها تُعرض بـ __t)
const extra = JSON.parse(fs.readFileSync(path.join(here, 'i18n-extra.json'), 'utf8'));
extra.forEach((k) => keys.add(k));

const { default: EN } = await import('./src/i18n/en.js');
const missing = [...keys].filter((k) => EN[k] === undefined);
const unused = Object.keys(EN).filter((k) => !keys.has(k));
if (process.argv.includes('--json')) { console.log(JSON.stringify(missing, null, 1)); process.exit(0); }
console.log(`i18n: ${keys.size} نص · مترجم ${keys.size - missing.length} · ناقص ${missing.length} · غير مستعمل ${unused.length}`);
if (missing.length) console.log(missing.slice(0, 40).map((k) => '  - ' + k).join('\n'));
if (process.argv.includes('--check') && missing.length) process.exit(1);
