/**
 * اختبار واجهة المرحلة D: نافذتان حقيقيتان (jsdom) أمام خادم API يعمل فعلاً —
 *   A = الأخصائي (ملف المريض، QR، المواعيد، قائمة الانتظار، بدء المكالمة)
 *   B = هاتف المريض (دخول QR تلقائي، العادات، قائمة الانتظار، قبول العرض، الانضمام للمكالمة، دخول بالرمز)
 * WebRTC مُحاكى (لا كاميرا في jsdom)، لكن تبادل الإشارات بين النافذتين حقيقي عبر الخادم.
 * التشغيل:  node apps/web/test/portal-ui.test.mjs   (يحتاج API على 4000 ببيانات جديدة و SEED_DEMO=1)
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { transformAsync } from '@babel/core';
import arabicI18n from '../babel-plugin-arabic-i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, '..');
const BASE = process.env.UI_TEST_BASE || 'http://127.0.0.1:4000';

const results = [];
let failures = 0;
const check = (name, cond, extra = '') => {
  results.push(name);
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name} ${extra ? '→ ' + String(extra).slice(0, 400) : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- الحزمة ----------
const i18nEsbuild = {
  name: 'arabic-i18n',
  setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/].*\.jsx?$/ }, async (args) => {
      const src = await fs.promises.readFile(args.path, 'utf8');
      const out = await transformAsync(src, { filename: args.path, babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] }, plugins: [arabicI18n] });
      return { contents: out.code, loader: 'jsx' };
    });
  },
};
const tmp = path.join(WEB, '.test-bundle-portal.js');
await build({
  entryPoints: [path.join(WEB, 'src/main.jsx')], outfile: tmp, bundle: true, format: 'iife', platform: 'browser',
  jsx: 'automatic', minify: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'empty' }, plugins: [i18nEsbuild],
});
const code = fs.readFileSync(tmp, 'utf8');

// ---------- API مباشر (للتحضير والتحقق) ----------
async function api(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* */ }
  return { status: r.status, json: j };
}
const staffToken = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' })).json.token;
const tz = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Khartoum', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TOMORROW = addDays(tz, 1);

// ---------- WebRTC/الكاميرا المحاكاة ----------
function installFakeMedia(window) {
  const track = (kind) => ({ kind, enabled: true, stop() { this.stopped = true; }, onended: null });
  const stream = (tracks) => ({
    _t: tracks, getTracks() { return this._t; }, getAudioTracks() { return this._t.filter((x) => x.kind === 'audio'); },
    getVideoTracks() { return this._t.filter((x) => x.kind === 'video'); }, addTrack(t) { this._t.push(t); }, removeTrack(t) { this._t = this._t.filter((x) => x !== t); },
  });
  window.MediaStream = function MediaStream(tr = []) { return stream(tr); };
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async (c) => { window.__gum = (window.__gum || 0) + 1; return stream([...(c.audio ? [track('audio')] : []), ...(c.video ? [track('video')] : [])]); },
      getDisplayMedia: async () => stream([track('video')]),
    },
  });
  window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  window.__pcs = [];
  window.RTCPeerConnection = class {
    constructor(cfg) { this.cfg = cfg; this.senders = []; this.iceGatheringState = 'complete'; this.signalingState = 'stable'; this.connectionState = 'new'; this.localDescription = null; this.remoteDescription = null; window.__pcs.push(this); }
    addTrack(t) { const s = { track: t, replaceTrack: async (n) => { s.track = n; } }; this.senders.push(s); return s; }
    getSenders() { return this.senders; }
    addEventListener() {} removeEventListener() {}
    async createOffer() { return { type: 'offer', sdp: `v=0 fake-offer ${Math.random()}` }; }
    async createAnswer() { return { type: 'answer', sdp: `v=0 fake-answer ${Math.random()}` }; }
    async setLocalDescription(d) { this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; this._maybe(); }
    async setRemoteDescription(d) { this.remoteDescription = d; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'; this._maybe(); }
    async addIceCandidate() {}
    _maybe() {
      if (this.localDescription && this.remoteDescription && this.connectionState !== 'connected' && !this.closed) {
        setTimeout(() => {
          if (this.closed) return;
          this.connectionState = 'connected';
          this.ontrack?.({ streams: [stream([track('audio'), track('video')])] });
          this.onconnectionstatechange?.();
        }, 50);
      }
    }
    close() { this.closed = true; this.connectionState = 'closed'; }
  };
}

// ---------- نافذة ----------
function openWindow({ hash, lang = 'ar', storage = {}, label }) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Could not parse CSS|Not implemented/.test(e.message)) errors.push(e.message + (e.detail ? ` :: ${e.detail}` : '')); });
  vc.on('error', (m) => errors.push(String(m)));
  const dom = new JSDOM(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>`, {
    url: `${BASE}/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      if (lang === 'en') w.localStorage.setItem('clinic.lang', 'en');
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
    },
  });
  const w = dom.window;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; // jsdom يفتقدها (كل المتصفحات فيها)
  w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  w.print = () => { w.__printed = (w.__printed || 0) + 1; };
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.Element.prototype.scrollIntoView = function () {};
  w.scrollTo = () => {};
  w.confirm = () => true;
  w.open = (u) => { w.__opened = u; return null; };
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() } });
  Object.defineProperty(w.navigator, 'vibrate', { value: () => true });
  w.addEventListener('error', (e) => errors.push(`window.onerror: ${e.message}`));
  w.__responses = [];
  w.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? new URL(input, BASE).toString() : input;
    const res = await fetch(url, init);
    if (/portal-access|\/call$/.test(url) && (init.method || 'GET') === 'POST') {
      const clone = res.clone();
      clone.json().then((j) => w.__responses.push({ url, j })).catch(() => {});
    }
    return res;
  };
  installFakeMedia(w);
  w.eval(code);
  const q = (s) => w.document.querySelector(s);
  const qa = (s) => Array.from(w.document.querySelectorAll(s));
  const T = () => w.document.body.textContent.replace(/\s+/g, ' ');
  const byText = (needle, sel = 'button, a') => qa(sel).find((el) => (el.textContent || '').includes(needle));
  const setV = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const clk = async (el, ms = 700) => {
    if (!el) throw new Error(`[${label}] العنصر غير موجود للنقر`);
    el.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(ms);
  };
  const go = async (h, ms = 1000) => { w.location.hash = h; await sleep(ms); };
  const wake = async (ms = 1200) => { w.document.dispatchEvent(new w.Event('visibilitychange')); await sleep(ms); };
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(150); } return !!fn(); };
  return { w, dom, q, qa, T, byText, setV, clk, go, wake, waitFor, errors };
}

let A; let B;
try {
  // ================= A: الأخصائي — ملف المريض =================
  const p1 = (await api('GET', '/api/patients/1', null, staffToken)).json;
  const p1Name = p1.patient?.full_name || p1.full_name || `${p1.first_name} ${p1.last_name}`;
  A = openWindow({ hash: '#/patients/1', storage: { 'clinic.token': staffToken }, label: 'A' });
  await A.waitFor(() => A.T().includes('درجة الالتزام بالعادات') && A.q('[data-portal]'), 12000);
  check('ملف المريض: بطاقة «العادات اليومية»', A.T().includes('العادات اليومية') && A.T().includes('درجة الالتزام بالعادات'), A.T().slice(0, 200));
  check('ملف المريض: بطاقة «بوابة المريض»', A.T().includes('بوابة المريض') && !!A.q('[data-portal="none"]'));
  check('ملف المريض: شريط التنقل فيه «العادات والبوابة»', !!A.byText('العادات والبوابة'));
  check('ملف المريض: حاويات رسوم العادات أو حالة الفراغ', A.T().includes('لم يُسجّل المريض أي عادة بعد') || A.qa('.recharts-responsive-container').length > 1);

  await A.clk(A.byText('إصدار رمز QR'), 1500);
  await A.waitFor(() => A.q('.qr-box svg'), 5000);
  const issued = A.w.__responses.find((r) => /portal-access$/.test(r.url))?.j;
  const codeShown = A.q('[data-portal-code]')?.textContent || '';
  check('إصدار QR: يظهر الرمز SVG', !!A.q('.qr-box svg') && A.q('.qr-box')?.dataset.qr === 'ready');
  check('إصدار QR: الرمز XXXX-XXXX يظهر مرة واحدة مع تحذير', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codeShown) && A.T().includes('يظهر مرة واحدة فقط'), codeShown);
  check('إصدار QR: الرابط يوجّه لـ #/portal/login?t=', /#\/portal\/login\?t=[A-Za-z0-9_-]{20,}/.test(issued?.url || ''), issued?.url);
  await A.clk(A.byText('طباعة البطاقة'), 700);
  check('بطاقة QR قابلة للطباعة', A.T().includes('بطاقة دخول البوابة') && A.T().includes('لا تشاركها مع أحد') && A.qa('.qr-box svg').length >= 2);
  await A.clk(A.byText('إغلاق', 'button'), 400);

  // ================= B: هاتف المريض — دخول QR تلقائي =================
  const qrToken = issued.url.split('t=')[1];
  B = openWindow({ hash: `#/portal/login?t=${qrToken}`, label: 'B' });
  await B.waitFor(() => B.q('[data-portal-name]'), 9000);
  check('QR: الدخول التلقائي يفتح البوابة مباشرة', B.w.location.hash === '#/portal' && !!B.q('[data-portal-name]'), `${B.w.location.hash} ${B.T().slice(0, 160)}`);
  check('QR: البوابة تعرض ملف المريض الصحيح', B.T().includes(p1.first_name || p1Name.split(' ')[0]) && B.T().includes(p1.file_no));
  check('QR: توكن البوابة منفصل عن توكن الموظفين', !!B.w.localStorage.getItem('clinic.portal') && !B.w.localStorage.getItem('clinic.token'));
  check('البوابة: شريط سفلي بـ 4 تبويبات', B.qa('[data-portal-tab]').length === 4);

  // العادات
  await B.clk(B.q('[data-add-water]'), 900);
  await B.clk(B.q('[data-add-water]'), 900);
  check('العادات: «+ كوب» مرتين = 0.50 لتر', ['0.5', '0.50'].includes(B.q('[data-water-ml]')?.textContent.trim()), B.q('[data-water-ml]')?.textContent);
  await B.clk(B.qa('[data-habit="sleep"] button').find((b) => b.textContent.trim() === '7'), 900);
  check('العادات: تسجيل النوم 7 ساعات', ['7', '7.0'].includes(B.q('[data-sleep-h]')?.textContent.trim()), B.q('[data-sleep-h]')?.textContent);
  await B.clk(B.qa('[data-habit="activity"] button').find((b) => b.textContent.includes('جري')), 700);
  await B.clk(B.qa('[data-habit="activity"] button').find((b) => b.textContent.trim() === '30د'), 900);
  const streak = B.q('[data-portal-streak]')?.textContent || '';
  check('العادات: سلسلة الأيام ≥ 1', /🔥\s*[1-9]/.test(streak), streak);
  const hab = (await api('GET', '/api/patients/1/habits?days=7', null, staffToken)).json;
  check('مزامنة: الماء/النوم/النشاط وصلت للملف السريري (المصدر: البوابة)',
    hab.today?.water_ml === 500 && hab.today?.sleep_hours === 7 && hab.today?.activity_min === 30 && hab.today?.activity_type === 'run' && hab.today?.source === 'portal', JSON.stringify(hab.today));
  await A.go('#/patients', 600); await A.go('#/patients/1', 1800);
  await A.waitFor(() => Number(A.q('[data-habits]')?.dataset.habits) >= 1, 5000);
  check('ملف المريض عند الأخصائي يعرض ما سجّله المريض', Number(A.q('[data-habits]')?.dataset.habits) >= 1 && A.T().includes('البوابة') && A.qa('.recharts-responsive-container').length >= 3);
  check('ملف المريض: حالة الوصول «مفعّل» بعد الدخول', !!A.q('[data-portal="active"]') && A.T().includes('مرات الدخول'));

  // التبويبات
  await B.clk(B.q('[data-portal-tab="plan"]'), 900);
  check('البوابة: تبويب «خطتي»', !!B.q('[data-portal-plan]') || B.T().includes('لا توجد خطة غذائية بعد'));
  await B.clk(B.q('[data-portal-tab="progress"]'), 1200);
  check('البوابة: تبويب «تقدّمي» (الوزن + العادات)', !!B.q('[data-portal-progress]') && B.T().includes('الوزن الحالي') && B.qa('.recharts-responsive-container').length >= 3);

  // ================= قائمة الانتظار =================
  await B.clk(B.q('[data-portal-tab="appointments"]'), 900);
  check('البوابة: تبويب «مواعيدي»', !!B.q('[data-portal-appointments]'));
  await B.clk(B.q('[data-portal-waitlist-open]'), 500);
  await B.clk(B.q('[data-portal-waitlist-submit]'), 1600);
  check('قائمة الانتظار: المريض طلب موعداً أقرب من البوابة', !!B.q('[data-portal-waitlist="waiting"]') && !!B.q('[data-wl-position]'), B.T().slice(-300));

  // موعد لمريض آخر غداً ثم يلغيه الأخصائي من الواجهة
  const other = (await api('POST', '/api/appointments', { patient_id: 2, date: TOMORROW, time: '07:10', duration_min: 30, visit_type: 'followup' }, staffToken)).json;
  await A.go(`#/appointments?date=${TOMORROW}`, 1800);
  check('المواعيد: لوحة «قائمة الانتظار الافتراضية» تعرض طلب المريض', A.T().includes('قائمة الانتظار الافتراضية') && Number(A.q('[data-waitlist]')?.dataset.waitlist) >= 1 && A.T().includes('من البوابة'));
  check('المواعيد: موعد 07:10 (خارج الشبكة) يظهر في جدول اليوم', A.T().includes('07:10'));
  const row = A.qa('[data-appt-details]').find((b) => b.closest('div.shadow-card')?.textContent.includes(other.patient_name));
  await A.clk(row, 900);
  check('تفاصيل الموعد: نافذة بزر «بدء استشارة مرئية»', !!A.q('[data-start-call]') && A.T().includes('طريقة الزيارة'));
  await A.clk(A.byText('إلغاء (يُعرض على قائمة الانتظار)'), 1800);
  check('إلغاء موعد → إشعار «عُرض تلقائياً على قائمة الانتظار»', A.T().includes('عُرض تلقائياً على'), A.T().slice(-300));
  await A.waitFor(() => A.T().includes('عروض بانتظار رد المرضى'), 4000);
  check('لوحة الانتظار تعرض العرض القائم وحالة واتساب', A.T().includes('عروض بانتظار رد المرضى') && A.T().includes('واتساب ✓'));

  await B.wake(1800);
  await B.waitFor(() => B.q('[data-portal-offers]'), 5000);
  check('البوابة: شريط «توفّر موعد أقرب!» يظهر للمريض', !!B.q('[data-portal-offers]') && B.T().includes('07:10'));
  await B.clk(B.q('[data-offer-accept]'), 2000);
  check('البوابة: «احجزه لي» يحجز الموعد', B.T().includes('تم حجز موعدك'), B.T().slice(-200));
  const booked = (await api('GET', `/api/appointments?from=${TOMORROW}&to=${TOMORROW}`, null, staffToken)).json.items.find((a) => a.patient_id === 1 && a.time === '07:10');
  check('الحجز: موعد مؤكد للمريض في نفس الوقت', booked?.status === 'confirmed', JSON.stringify(booked));
  check('البوابة: الموعد الجديد ضمن «المواعيد القادمة»', B.T().includes('07:10') && !B.q('[data-portal-offers]'));

  // ================= الاستشارة المرئية =================
  await A.go(`#/appointments?call=${booked.id}`, 2500);
  await A.waitFor(() => A.q('[data-video-call]'), 6000);
  check('المكالمة: رابط ?call= يفتح الموعد ويبدأ المكالمة', !!A.q('[data-video-call]'), A.T().slice(-200));
  check('المكالمة: الكاميرا والميكروفون طُلبا (getUserMedia)', (A.w.__gum || 0) >= 1);
  check('المكالمة: أزرار الكتم/الكاميرا/مشاركة الشاشة/الإنهاء', ['كتم الميكروفون', 'إيقاف الكاميرا', 'مشاركة الشاشة', 'إنهاء المكالمة'].every((t) => A.q(`button[title="${t}"]`)));
  await B.wake(1800);
  await B.waitFor(() => B.q('[data-portal-call-banner]'), 5000);
  check('البوابة: شريط «بانتظارك في الاستشارة المرئية»', !!B.q('[data-portal-call-banner]'));
  await B.clk(B.q('[data-portal-call-banner]'), 1500);
  check('البوابة: صفحة المكالمة تفتح', B.w.location.hash === '#/portal/call' && !!B.q('[data-video-call]'), B.w.location.hash);
  const connected = await A.waitFor(() => A.q('[data-video-call="connected"]') && B.q('[data-video-call="connected"]'), 15000);
  check('المكالمة: تبادل الإشارات (hello → offer → answer) يربط الطرفين', connected, `A=${A.q('[data-video-call]')?.dataset.videoCall} B=${B.q('[data-video-call]')?.dataset.videoCall}`);
  const docPc = A.w.__pcs.at(-1); const patPc = B.w.__pcs.at(-1);
  check('المكالمة: SDP العرض عند المريض = SDP الأخصائي', patPc?.remoteDescription?.sdp === docPc?.localDescription?.sdp && /fake-offer/.test(docPc?.localDescription?.sdp || ''));
  check('المكالمة: SDP الإجابة وصل للأخصائي', /fake-answer/.test(docPc?.remoteDescription?.sdp || ''));
  await A.clk(A.q('button[title="مشاركة الشاشة"]'), 500);
  check('مشاركة الشاشة: replaceTrack بدون إعادة تفاوض', !!A.q('button[title="إيقاف مشاركة الشاشة"]') && A.w.__pcs.at(-1) === docPc);
  await A.clk(A.q('button[title="كتم الميكروفون"]'), 200);
  check('كتم الميكروفون يعطّل المسار', !!A.q('button[title="تشغيل الميكروفون"]'));
  await A.clk(A.q('button[title="إنهاء المكالمة"]'), 1000);
  const callRow = (await api('GET', `/api/calls/${A.w.__responses.find((r) => /\/call$/.test(r.url))?.j?.call?.id}`, null, staffToken)).json;
  check('إنهاء المكالمة: الجلسة «ended» في الخادم', callRow?.call?.status === 'ended', JSON.stringify(callRow?.call?.status));
  const ended = await B.waitFor(() => B.q('[data-video-call="ended"]'), 8000);
  check('المريض يرى «انتهت المكالمة»', ended && B.T().includes('انتهت المكالمة'));

  // ================= الدخول برقم الملف + الرمز =================
  await B.go('#/portal', 1500);
  await B.clk(B.q('button[title="خروج"]'), 800);
  check('خروج المريض يعيد لشاشة الدخول', B.w.location.hash === '#/portal/login' && !B.w.localStorage.getItem('clinic.portal'));
  check('شاشة الدخول: خيارا المسح والرمز', !!B.q('[data-portal-scan]') && !!B.q('[data-portal-code-login]'));
  await B.clk(B.q('[data-portal-code-login]'), 400);
  B.setV(B.q('input[autocomplete="username"]'), p1.file_no);
  B.setV(B.q('input[autocomplete="one-time-code"]'), 'ZZZZ-ZZZZ');
  await B.clk(B.byText('دخول', 'button'), 1200);
  check('رمز خاطئ → رسالة خطأ', !!B.q('[data-portal-error]'), B.T().slice(0, 200));
  B.setV(B.q('input[autocomplete="one-time-code"]'), codeShown.toLowerCase().replace('-', ''));
  await B.clk(B.byText('دخول', 'button'), 1800);
  check('رقم الملف + الرمز (بلا شرطة وبحروف صغيرة) يسجّل الدخول', B.w.location.hash === '#/portal' && !!B.q('[data-portal-name]'), B.w.location.hash);

  // إيقاف الوصول يُخرج المريض
  await api('DELETE', '/api/patients/1/portal-access', null, staffToken);
  await B.wake(1800);
  check('إيقاف الوصول من العيادة يُخرج المريض فوراً', B.w.location.hash.startsWith('#/portal/login') && B.T().includes('انتهت الجلسة'), B.w.location.hash);

  // الإعدادات
  await A.go('#/settings', 1200);
  await A.clk(A.byText('واتساب والتذكيرات'), 1200);
  check('الإعدادات: بطاقة «بوابة المريض وقائمة الانتظار»', !!A.q('[data-portal-settings]') && A.T().includes('مهلة الرد على العرض'));

  // ================= English =================
  const again = (await api('POST', '/api/patients/1/portal-access', {}, staffToken)).json;
  const qr = (await api('POST', '/api/portal/auth/qr', { token: again.url.split('t=')[1] })).json;
  const E = openWindow({ hash: '#/portal', lang: 'en', storage: { 'clinic.portal': qr.token }, label: 'E' });
  await E.waitFor(() => E.q('[data-portal-name]'), 9000);
  check('English: البوابة LTR وبالإنجليزية', E.w.document.documentElement.dir === 'ltr' && E.T().includes('Hello') && E.T().includes('My plan') && E.T().includes('Water'), E.T().slice(0, 200));
  for (const t of ['plan', 'progress', 'appointments', 'today']) { await E.clk(E.q(`[data-portal-tab="${t}"]`), 1000); }
  await E.go('#/portal/login', 200); // تبقى داخل (التوكن موجود) — فقط نتأكد أنها لا تنهار
  const EA = openWindow({ hash: `#/appointments?date=${TOMORROW}`, lang: 'en', storage: { 'clinic.token': staffToken }, label: 'EA' });
  await EA.waitFor(() => EA.T().includes('Virtual waitlist'), 9000);
  await EA.go('#/patients/1', 2200);
  check('English: لوحة الانتظار + العادات + البوابة مترجمة', EA.T().includes('Daily habits') && EA.T().includes('Patient portal'), EA.T().slice(0, 200));
  await EA.go('#/settings', 1200); await EA.clk(EA.byText('WhatsApp & reminders'), 1200);
  check('English: بطاقة إعدادات البوابة', EA.T().includes('Patient portal & waitlist'));
  const missing = [...(E.w.__missingI18n() || []), ...(EA.w.__missingI18n() || [])].filter((x) => /[\u0600-\u06FF]/.test(x));
  check('English: لا نصوص عربية بلا ترجمة', missing.length === 0, [...new Set(missing)].slice(0, 8).join(' | '));
  const errs = [...A.errors, ...B.errors, ...E.errors, ...EA.errors].filter((e) => !/ResizeObserver|getComputedStyle|not implemented|Could not parse CSS/i.test(e));
  check('لا أخطاء تشغيل في النوافذ الأربع', errs.length === 0, errs.slice(0, 3).join(' | '));
  for (const x of [E, EA]) x.w.close();
} catch (e) {
  failures++;
  console.error('EXCEPTION', e.stack?.split('\n').slice(0, 4).join('\n'));
}
A?.w.close(); B?.w.close();
fs.rmSync(tmp, { force: true });
console.log(`\n${results.length - failures}/${results.length} نجحت${failures ? ` — ${failures} فشلت` : ''}`);
process.exit(failures ? 1 : 0);
