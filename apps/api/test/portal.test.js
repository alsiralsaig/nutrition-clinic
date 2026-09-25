// اختبار المرحلة D عبر HTTP: بوابة المريض (QR) · العادات · قائمة الانتظار · إشارات مكالمات الفيديو
// node apps/api/test/portal.test.js         (PGlite مؤقت)
// DATABASE_URL=postgres://… node apps/api/test/portal.test.js   (Postgres حقيقي — قاعدة فارغة مخصصة للاختبار)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const PORT = 4700 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-portal-'));

const results = [];
let failures = 0;
function check(name, cond, extra = '') {
  results.push(name);
  if (!cond) { failures++; console.error(`  ✗ ${name} ${extra}`); } else console.log(`  ✓ ${name}`);
}
async function req(method, url, { body, token, headers = {} } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV */ }
  return { status: res.status, json, text, headers: res.headers };
}

let server = null;
let serverLog = '';
async function boot(extraEnv) {
  server = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT, HOST: '127.0.0.1', CLINIC_DATA_DIR: DATA, JWT_SECRET: 'portal-secret', SEED_DEMO: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 150; i++) {
    try { if ((await req('GET', '/api/health')).status === 200) return true; } catch { /* ليس جاهزاً */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
async function stop() {
  if (!server) return;
  server.kill('SIGTERM');
  await Promise.race([new Promise((r) => server.once('exit', r)), new Promise((r) => setTimeout(r, 5000))]);
  server = null;
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Khartoum', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const hmPlus = (mins) => {
  const d = new Date(Date.now() + mins * 60000);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Khartoum', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
};

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

try {
  check('الخادم يقلع (المخطط الإصدار 4)', await boot({ WHATSAPP_DRY_RUN: '1', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_ID: '' }), serverLog.slice(-500));
  const tk = (await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } })).json?.token;
  const viewer = (await req('POST', '/api/auth/login', { body: { username: 'reception', password: 'reception123' } })).json?.token;
  check('دخول المدير والاستقبال', !!tk && !!viewer);
  const mk = async (first, phone, w) => (await req('POST', '/api/patients', { token: tk, body: { first_name: first, last_name: 'بوابة', phone, gender: 'female', birth_date: '1990-01-01', height_cm: 165, start_weight: w, goal_weight: w - 10 } })).json;
  const A = await mk('أمل', '0911000001', 92);
  const B = await mk('بسمة', '0911000002', 80);
  const C = await mk('جنى', '0911000003', 70);
  const D = await mk('دينا', '0911000004', 75);
  check('إنشاء 4 مرضى اختبار', [A, B, C, D].every((p) => p?.id > 0));

  // ================= رمز QR والدخول =================
  const st0 = await req('GET', `/api/patients/${A.id}/portal-access`, { token: tk });
  check('لا رمز بوابة قبل الإصدار', st0.status === 200 && st0.json?.active === false && /#\/portal$/.test(st0.json?.portal_url || ''), JSON.stringify(st0.json));
  check('الاستقبال (قراءة فقط) لا يصدر رمزاً', (await req('POST', `/api/patients/${A.id}/portal-access`, { token: viewer })).status === 403);
  const acc = await req('POST', `/api/patients/${A.id}/portal-access`, { token: tk });
  check('إصدار رمز QR (201) برابط البوابة ورمز احتياطي', acc.status === 201 && /#\/portal\/login\?t=[A-Za-z0-9_-]{30,}$/.test(acc.json?.url || '') && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(acc.json?.code || ''), JSON.stringify(acc.json));
  const st1 = await req('GET', `/api/patients/${A.id}/portal-access`, { token: tk });
  check('حالة الرمز: نشط (بلا كشف الرمز نفسه)', st1.json?.active === true && !('token' in st1.json) && !('code' in st1.json));
  const qr = await req('POST', '/api/portal/auth/qr', { body: { token: acc.json.token } });
  check('مسح QR يسجّل دخول المريض مباشرة', qr.status === 200 && !!qr.json?.token && qr.json?.patient?.id === A.id, JSON.stringify(qr.json).slice(0, 200));
  const pA = qr.json.token;
  check('QR خاطئ → 401', (await req('POST', '/api/portal/auth/qr', { body: { token: 'x'.repeat(32) } })).status === 401);
  const byCode = await req('POST', '/api/portal/auth/code', { body: { file_no: A.file_no.toLowerCase(), code: acc.json.code.replace('-', '').toLowerCase() } });
  check('الدخول برقم الملف + الرمز (يتجاهل الحالة والشرطة)', byCode.status === 200 && byCode.json?.patient?.id === A.id, JSON.stringify(byCode.json).slice(0, 160));
  check('رمز خاطئ → 401', (await req('POST', '/api/portal/auth/code', { body: { file_no: A.file_no, code: 'AAAA-AAAA' } })).status === 401);
  check('توكن المريض لا يفتح مسارات العيادة (403)', (await req('GET', '/api/patients', { token: pA })).status === 403);
  check('توكن الموظف لا يفتح البوابة (403)', (await req('GET', '/api/portal/me', { token: tk })).status === 403);
  check('البوابة بلا توكن → 401', (await req('GET', '/api/portal/me')).status === 401);

  // ================= البوابة + العادات =================
  const me = await req('GET', '/api/portal/me', { token: pA });
  check('بوابة المريض: البيانات والخطة والمواعيد والعادات', me.status === 200 && me.json?.patient?.id === A.id && 'plan' in me.json && Array.isArray(me.json?.appointments?.upcoming) && me.json?.habits?.series?.length === 14, JSON.stringify(me.json).slice(0, 300));
  check('هدف الماء محسوب من الوزن (92 كغ × 35 مل ≈ 3250)', me.json?.habits?.targets?.water_ml === 3250, me.json?.habits?.targets?.water_ml);
  await req('PUT', `/api/portal/habits/${today}`, { token: pA, body: { add_water_ml: 250 } });
  const h2 = await req('PUT', `/api/portal/habits/${today}`, { token: pA, body: { add_water_ml: 250 } });
  check('زر «+ كوب» تراكمي (250 + 250 = 500)', h2.json?.log?.water_ml === 500, JSON.stringify(h2.json?.log));
  const h3 = await req('PUT', `/api/portal/habits/${today}`, { token: pA, body: { sleep_hours: 7, activity_min: 40, activity_type: 'walk', steps: 6500 } });
  check('تسجيل النوم والنشاط لا يمسح الماء', h3.json?.log?.water_ml === 500 && h3.json?.log?.sleep_hours === 7 && h3.json?.log?.activity_min === 40 && h3.json?.log?.source === 'portal');
  await req('PUT', `/api/portal/habits/${addDays(today, -1)}`, { token: pA, body: { water_ml: 3500, sleep_hours: 8, activity_min: 20 } });
  check('يوم مستقبلي مرفوض', (await req('PUT', `/api/portal/habits/${addDays(today, 1)}`, { token: pA, body: { water_ml: 100 } })).status === 400);
  check('البوابة تعدّل آخر 7 أيام فقط', (await req('PUT', `/api/portal/habits/${addDays(today, -10)}`, { token: pA, body: { water_ml: 100 } })).status === 400);
  check('قيم غير منطقية مرفوضة (نوم 30 ساعة)', (await req('PUT', `/api/portal/habits/${today}`, { token: pA, body: { sleep_hours: 30 } })).status === 400);
  const staffLog = await req('PUT', `/api/patients/${A.id}/habits/${addDays(today, -10)}`, { token: tk, body: { water_ml: 2000 } });
  check('العيادة تسجل يوماً أقدم (مصدر clinic)', staffLog.status === 200 && staffLog.json?.source === 'clinic');
  const hs = await req('GET', `/api/patients/${A.id}/habits?days=30`, { token: tk });
  const sm = hs.json?.summary || {};
  check('الملف السريري يرى سجلات البوابة فوراً (مزامنة)', hs.json?.today?.water_ml === 500 && hs.json?.today?.activity_type === 'walk', JSON.stringify(hs.json?.today));
  check('ملخص العادات: 3 أيام، سلسلة 2، نسب تحقيق الأهداف', sm.days_logged === 3 && sm.streak === 2 && sm.water_hit_pct === 33 && sm.sleep_hit_pct === 50 && sm.activity_hit_pct === 50, JSON.stringify(sm));
  const tg = await req('PUT', `/api/patients/${A.id}/habit-targets`, { token: tk, body: { water_ml: 2000, sleep_hours: 7, activity_min: 30 } });
  check('الأخصائي يخصّص الأهداف → تُعاد النسب', tg.json?.targets?.water_ml === 2000 && tg.json?.targets?.custom === true && tg.json?.summary?.water_hit_pct === 67, JSON.stringify(tg.json?.summary));
  check('الاستقبال لا يعدّل العادات', (await req('PUT', `/api/patients/${A.id}/habits/${today}`, { token: viewer, body: { water_ml: 1 } })).status === 403);

  // ================= إعادة الإصدار تلغي القديم =================
  const acc2 = await req('POST', `/api/patients/${A.id}/portal-access`, { token: tk });
  check('إعادة الإصدار: QR القديم لم يعد يعمل', (await req('POST', '/api/portal/auth/qr', { body: { token: acc.json.token } })).status === 401);
  check('إعادة الإصدار: جلسة المريض القديمة تسقط فوراً', (await req('GET', '/api/portal/me', { token: pA })).status === 401);
  const pA2 = (await req('POST', '/api/portal/auth/qr', { body: { token: acc2.json.token } })).json?.token;
  check('QR الجديد يعمل', !!pA2);

  // ================= قائمة الانتظار =================
  const accB = (await req('POST', `/api/patients/${B.id}/portal-access`, { token: tk })).json;
  const pB = (await req('POST', '/api/portal/auth/qr', { body: { token: accB.token } })).json?.token;
  const wlB = await req('POST', '/api/portal/waitlist', { token: pB, body: { time_pref: 'any', note: 'أي وقت' } });
  check('المريض يطلب مكاناً في قائمة الانتظار من البوابة', wlB.status === 201 && wlB.json?.status === 'waiting' && wlB.json?.source === 'portal', JSON.stringify(wlB.json).slice(0, 200));
  check('طلب مكرر من البوابة → 409', (await req('POST', '/api/portal/waitlist', { token: pB, body: {} })).status === 409);
  const wlC = await req('POST', '/api/waitlist', { token: tk, body: { patient_id: C.id, time_pref: 'morning' } });
  check('الاستقبال/الأخصائي يضيف مريضاً هاتفياً', wlC.status === 201 && wlC.json?.source === 'clinic');
  const wlD = await req('POST', '/api/waitlist', { token: tk, body: { patient_id: D.id, time_pref: 'evening' } });
  check('مريض يفضّل المساء', wlD.status === 201);

  const d2 = addDays(today, 2);
  const apptA = (await req('POST', '/api/appointments', { token: tk, body: { patient_id: A.id, date: d2, time: '07:40' } })).json;
  const cancel = await req('POST', `/api/appointments/${apptA.id}/status`, { token: tk, body: { status: 'cancelled' } });
  check('إلغاء موعد → عرض تلقائي لمرضى الانتظار المطابقين (الصباح/أي وقت، لا المساء)', cancel.json?.waitlist?.offered === 2 && !cancel.json.waitlist.offers.some((o) => o.patient_id === D.id), JSON.stringify(cancel.json?.waitlist));
  check('إشعار واتساب أُرسل لكل عرض', cancel.json?.waitlist?.offers?.every((o) => o.notify === 'sent'));
  const meB = await req('GET', '/api/portal/me', { token: pB });
  const offerB = meB.json?.offers?.[0];
  check('العرض يظهر في بوابة المريض', offerB?.slot_date === d2 && offerB?.slot_time === '07:40' && offerB?.status === 'pending', JSON.stringify(meB.json?.offers));
  const accepted = await req('POST', `/api/portal/offers/${offerB.id}/accept`, { token: pB });
  check('أول من يقبل يحجز (موعد مؤكد)', accepted.status === 200 && accepted.json?.appointment?.status === 'confirmed' && accepted.json.appointment.patient_id === B.id, JSON.stringify(accepted.json).slice(0, 200));
  const wl = await req('GET', '/api/waitlist', { token: tk });
  const offerC = wl.json?.offers?.find((o) => o.patient_id === C.id && o.slot_date === d2);
  check('عرض المريض الآخر أصبح «taken»', offerC?.status === 'taken', JSON.stringify(offerC));
  check('قبول متأخر → 409', (await req('POST', `/api/waitlist/offers/${offerC.id}/accept`, { token: tk })).status === 409);
  check('طلب الانتظار للمريض الأول = محجوز، والآخرون ما زالوا ينتظرون', !wl.json?.items?.some((w) => w.patient_id === B.id) && wl.json?.items?.some((w) => w.patient_id === C.id), JSON.stringify(wl.json?.items?.map((w) => w.patient_id)));
  check('المريض لا يقبل عرض غيره', (await req('POST', `/api/portal/offers/${offerC.id}/accept`, { token: pB })).status === 404);

  // حذف موعد → عرض → رفض → تسلسل
  const d3 = addDays(today, 3);
  const apptA2 = (await req('POST', '/api/appointments', { token: tk, body: { patient_id: A.id, date: d3, time: '07:20' } })).json;
  const del = await req('DELETE', `/api/appointments/${apptA2.id}`, { token: tk });
  check('حذف موعد نشط → يُعرض على قائمة الانتظار', del.json?.waitlist?.offered === 1 && del.json.waitlist.offers[0].patient_id === C.id, JSON.stringify(del.json?.waitlist));
  const off2 = (await req('GET', '/api/waitlist', { token: tk })).json?.offers?.find((o) => o.slot_date === d3 && o.status === 'pending');
  const dec = await req('POST', `/api/waitlist/offers/${off2.id}/decline`, { token: tk });
  check('رفض العرض (لا أحد غيره مطابق → لا تسلسل)', dec.status === 200 && dec.json?.cascaded === 0, JSON.stringify(dec.json));
  const eve = await req('POST', '/api/waitlist/offer-slot', { token: tk, body: { date: d3, time: '21:10' } });
  check('عرض فجوة مسائية يدوياً → لمريض المساء فقط', eve.json?.offered >= 1 && eve.json.offers.some((o) => o.patient_id === D.id) && !eve.json.offers.some((o) => o.patient_id === C.id), JSON.stringify(eve.json));
  const late = await req('POST', '/api/waitlist/offer-slot', { token: tk, body: { date: today, time: hmPlus(10) } });
  check('موعد بعد أقل من 30 دقيقة لا يُعرض', late.json?.offered === 0 && late.json?.reason === 'too_late', JSON.stringify(late.json));

  // المريض يلغي موعده من البوابة
  const cB = await req('POST', `/api/portal/appointments/${accepted.json.appointment.id}/cancel`, { token: pB });
  check('المريض يلغي موعده من البوابة (قبل 3 ساعات+)', cB.status === 200 && cB.json?.cancelled === true, JSON.stringify(cB.json));

  // ================= الاستشارة المرئية =================
  const d1 = addDays(today, 1);
  const vAppt = (await req('POST', '/api/appointments', { token: tk, body: { patient_id: A.id, date: d1, time: '13:40', mode: 'video' } })).json;
  check('موعد فيديو (mode=video)', vAppt?.mode === 'video', JSON.stringify(vAppt).slice(0, 200));
  const start = await req('POST', `/api/appointments/${vAppt.id}/call`, { token: tk, body: { notify: true } });
  check('بدء المكالمة من الموعد + رابط الانضمام + STUN', start.status === 201 && start.json?.call?.status === 'waiting' && /#\/portal\/call$/.test(start.json?.join_url || '') && start.json?.ice_servers?.[0]?.urls?.length > 0 && start.json?.message?.status === 'sent', JSON.stringify(start.json).slice(0, 300));
  const cid = start.json.call.id;
  const again = await req('POST', `/api/appointments/${vAppt.id}/call`, { token: tk, body: {} });
  check('إعادة الضغط تستأنف نفس المكالمة', again.json?.call?.id === cid);
  check('الاستقبال لا يبدأ مكالمة', (await req('POST', `/api/appointments/${vAppt.id}/call`, { token: viewer, body: {} })).status === 403);
  const act = await req('GET', '/api/portal/calls/active', { token: pA2 });
  check('بوابة المريض ترى المكالمة النشطة', act.json?.call?.id === cid && !!act.json?.ice_servers);
  const meA = await req('GET', '/api/portal/me', { token: pA2 });
  check('/portal/me يعرض شريط «انضم للمكالمة»', meA.json?.call?.id === cid);
  const p0 = await req('GET', `/api/portal/calls/${cid}/signals?after=-1`, { token: pA2 });
  check('الانضمام يتجاهل الإشارات القديمة (after=-1)', Array.isArray(p0.json?.items) && p0.json.items.length === 0 && typeof p0.json.last_id === 'number');
  await req('POST', `/api/calls/${cid}/signal`, { token: tk, body: { kind: 'hello' } });
  await req('POST', `/api/calls/${cid}/signal`, { token: tk, body: { kind: 'offer', payload: { type: 'offer', sdp: 'v=0 fake-offer' } } });
  const p1 = await req('GET', `/api/portal/calls/${cid}/signals?after=${p0.json.last_id}`, { token: pA2 });
  check('المريض يستلم hello + offer من الأخصائي فقط', p1.json?.items?.map((i) => i.kind).join(',') === 'hello,offer' && p1.json.items[1].payload.sdp === 'v=0 fake-offer', JSON.stringify(p1.json));
  await req('POST', `/api/portal/calls/${cid}/signal`, { token: pA2, body: { kind: 'answer', payload: { type: 'answer', sdp: 'v=0 fake-answer' } } });
  const d0 = await req('GET', `/api/calls/${cid}/signals?after=0`, { token: tk });
  check('الأخصائي يستلم الإجابة → المكالمة نشطة والطرف الآخر متصل', d0.json?.items?.some((i) => i.kind === 'answer') && d0.json?.status === 'active' && d0.json?.peer_online === true, JSON.stringify(d0.json).slice(0, 300));
  check('مريض آخر لا يصل لمكالمة غيره', (await req('GET', `/api/portal/calls/${cid}/signals?after=0`, { token: pB })).status === 404);
  check('نوع إشارة غير معروف → 400', (await req('POST', `/api/calls/${cid}/signal`, { token: tk, body: { kind: 'evil' } })).status === 400);
  const end = await req('POST', `/api/calls/${cid}/end`, { token: tk });
  check('إنهاء المكالمة', end.json?.ended === true);
  check('إشارات بعد الإنهاء مرفوضة (409)', (await req('POST', `/api/portal/calls/${cid}/signal`, { token: pA2, body: { kind: 'offer', payload: {} } })).status === 409);
  const p2 = await req('GET', `/api/portal/calls/${cid}/signals?after=${p1.json.last_id}`, { token: pA2 });
  check('المريض يستلم «bye» وحالة ended', p2.json?.status === 'ended' && p2.json?.items?.some((i) => i.kind === 'bye'));
  check('لا مكالمة نشطة بعد الإنهاء', (await req('GET', '/api/portal/calls/active', { token: pA2 })).json?.call === null);

  // ================= الإلغاء والنسخ والمهمة اليومية =================
  const rv = await req('DELETE', `/api/patients/${A.id}/portal-access`, { token: tk });
  check('إلغاء رمز البوابة يُسقط الجلسة', rv.json?.revoked === 1 && (await req('GET', '/api/portal/me', { token: pA2 })).status === 401);
  const bk = await req('GET', '/api/backup', { token: tk });
  check('النسخة الاحتياطية تشمل العادات وقائمة الانتظار والرموز', ['habit_logs', 'waitlist', 'waitlist_offers', 'patient_access'].every((t) => Array.isArray(bk.json?.tables?.[t])) && bk.json.tables.habit_logs.length >= 3);
  const run = await req('POST', '/api/cron/daily/run', { token: tk });
  check('المهمة اليومية تنظّف العروض المنتهية والمكالمات', run.status === 200 && 'waitlist' in run.json && run.json?.calls?.signals_deleted >= 1, JSON.stringify(run.json).slice(0, 300));
  const notif = await req('GET', '/api/notifications', { token: tk });
  check('التنبيهات: حجز من قائمة الانتظار + عروض معلّقة', notif.json?.items?.some((i) => i.type === 'waitlist_booked') && notif.json?.items?.some((i) => i.type === 'waitlist_pending'), JSON.stringify(notif.json?.items?.map((i) => i.type)));
  const off = await req('PUT', '/api/settings', { token: tk, body: { 'clinic.portal_enabled': false } });
  check('إيقاف البوابة من الإعدادات يمنع الدخول', off.status === 200 && (await req('POST', '/api/portal/auth/qr', { body: { token: accB.token } })).status === 403);
} catch (e) {
  failures++;
  console.error('EXCEPTION', e, serverLog.slice(-800));
} finally {
  await stop();
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(`\n${results.length - failures}/${results.length} نجحت${failures ? ` — ${failures} فشلت` : ''}`);
if (failures) process.exit(1);
