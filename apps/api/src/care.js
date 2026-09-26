// منطق بوابة المريض المشترك بين مسارات العيادة ومسارات المريض:
// رموز QR، متتبّع العادات، قائمة الانتظار وعروضها، وإشارات مكالمات الفيديو.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { db, audit, getSetting, getSettings } from './db.js';
import { badRequest, conflict, notFound, str, isDate, isTime, todayISO, nowTimeHM, addDaysISO, round } from './lib.js';
import { sendMessage, normalizePhone, waLink } from './whatsapp.js';
import { pushToPatient } from './push.js';

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

// ------------------------------------------------------------------
// عنوان الموقع العام (لروابط QR وواتساب)
// ------------------------------------------------------------------
export function publicUrl(req) {
  const env = process.env.PUBLIC_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  if (req) {
    const origin = req.get?.('origin');
    if (origin && /^https?:\/\//.test(origin)) return origin.replace(/\/$/, '');
    const host = req.get?.('x-forwarded-host') || req.get?.('host');
    if (host) return `${req.get('x-forwarded-proto') || req.protocol || 'https'}://${host}`.replace(/\/$/, '');
  }
  return env.replace(/\/$/, '');
}
export const portalLink = (base, path = '') => `${base}/#/portal${path}`;

// ------------------------------------------------------------------
// رموز الدخول (QR)
// ------------------------------------------------------------------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بلا 0/O/1/I لتجنّب الالتباس
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const codeKey = (fileNo, code) => sha(`${String(fileNo || '').trim().toUpperCase()}:${normCode(code)}`);

export async function issueAccess({ patientId, userId, base }) {
  const p = await db.get(`SELECT id, file_no, first_name, last_name FROM patients WHERE id=?`, patientId);
  if (!p) throw notFound('المريض غير موجود');
  const token = randomBytes(24).toString('base64url');
  const raw = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  let id;
  await db.tx(async () => {
    await db.run(`UPDATE patient_access SET revoked_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE patient_id=? AND revoked_at IS NULL`, patientId);
    id = await db.insert(`INSERT INTO patient_access (patient_id, token_hash, code_hash, created_by) VALUES (?,?,?,?)`,
      patientId, sha(token), codeKey(p.file_no, code), userId);
    await audit({ userId, action: 'portal.issue', entity: 'patients', entityId: patientId });
  });
  const row = await db.get(`SELECT created_at FROM patient_access WHERE id=?`, id);
  return { id, token, code, file_no: p.file_no, url: portalLink(base, `/login?t=${token}`), created_at: row.created_at };
}

export async function accessStatus(patientId) {
  const a = await db.get(`SELECT id, created_at, last_used_at, use_count FROM patient_access WHERE patient_id=? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`, patientId);
  return a ? { active: true, ...a } : { active: false };
}

export async function revokeAccess(patientId, userId) {
  const r = await db.run(`UPDATE patient_access SET revoked_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE patient_id=? AND revoked_at IS NULL`, patientId);
  await db.run(`DELETE FROM push_subscriptions WHERE patient_id=?`, patientId); // إلغاء الوصول يوقف الإشعارات على أجهزته
  await audit({ userId, action: 'portal.revoke', entity: 'patients', entityId: patientId });
  return r.changes;
}

/** تحقق من QR أو (رقم الملف + الرمز) → صف الوصول أو null */
export async function findAccess({ token, fileNo, code }) {
  let row = null;
  if (token) {
    row = await db.get(`SELECT a.*, p.status AS patient_status FROM patient_access a JOIN patients p ON p.id=a.patient_id WHERE a.token_hash=? AND a.revoked_at IS NULL`, sha(token));
  } else if (fileNo && code) {
    row = await db.get(`
      SELECT a.*, p.status AS patient_status FROM patient_access a JOIN patients p ON p.id=a.patient_id
      WHERE upper(p.file_no)=upper(?) AND a.code_hash=? AND a.revoked_at IS NULL`, String(fileNo).trim(), codeKey(fileNo, code));
  }
  if (!row) return null;
  await db.run(`UPDATE patient_access SET last_used_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'), use_count=use_count+1 WHERE id=?`, row.id);
  return row;
}

// ------------------------------------------------------------------
// متتبّع العادات
// ------------------------------------------------------------------
export const ACTIVITY_TYPES = ['walk', 'run', 'gym', 'cycling', 'swim', 'sport', 'home', 'other'];

/** أهداف افتراضية ذكية: الماء 35 مل/كغ (1.5–3.5 لتر)، النوم 7.5 س، الحركة 30 د */
export function habitTargets(patient, weightKg) {
  const w = weightKg ?? patient?.current_weight ?? patient?.start_weight ?? null;
  const water = w ? Math.min(3500, Math.max(1500, Math.round((w * 35) / 250) * 250)) : 2000;
  return {
    water_ml: patient?.water_target_ml ?? water,
    sleep_hours: patient?.sleep_target_h ?? 7.5,
    activity_min: patient?.activity_target_min ?? 30,
    custom: !!(patient?.water_target_ml || patient?.sleep_target_h || patient?.activity_target_min),
  };
}

const numOrNull = (v, min, max, int = false) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`قيمة خارج النطاق المسموح (${min}–${max})`);
  return int ? Math.round(n) : round(n, 2);
};

export async function upsertHabit({ patientId, date, body, source }) {
  if (!isDate(date)) throw badRequest('التاريخ بصيغة YYYY-MM-DD');
  const today = todayISO();
  if (date > today) throw badRequest('لا يمكن تسجيل يوم في المستقبل');
  if (source === 'portal' && date < addDaysISO(today, -7)) throw badRequest('يمكن تعديل آخر 7 أيام فقط من البوابة');
  const f = {
    water_ml: numOrNull(body.water_ml, 0, 10000, true),
    sleep_hours: numOrNull(body.sleep_hours, 0, 24),
    activity_min: numOrNull(body.activity_min, 0, 1440, true),
    steps: numOrNull(body.steps, 0, 150000, true),
    activity_type: body.activity_type === undefined ? undefined : (ACTIVITY_TYPES.includes(body.activity_type) ? body.activity_type : null),
    note: body.note === undefined ? undefined : str(body.note, 500),
  };
  // إضافة تراكمية للماء (زر «+ كوب») دون سباق بين جهازين
  const addWater = body.add_water_ml !== undefined ? numOrNull(body.add_water_ml, -2000, 2000, true) : 0;
  const existing = await db.get(`SELECT * FROM habit_logs WHERE patient_id=? AND log_date=?`, patientId, date);
  const merged = {};
  for (const k of Object.keys(f)) merged[k] = f[k] === undefined ? (existing?.[k] ?? null) : f[k];
  if (addWater) merged.water_ml = Math.min(10000, Math.max(0, (merged.water_ml ?? 0) + addWater));
  await db.run(`
    INSERT INTO habit_logs (patient_id, log_date, water_ml, sleep_hours, activity_min, activity_type, steps, note, source)
    VALUES (@pid, @date, @water_ml, @sleep_hours, @activity_min, @activity_type, @steps, @note, @source)
    ON CONFLICT (patient_id, log_date) DO UPDATE SET
      water_ml=EXCLUDED.water_ml, sleep_hours=EXCLUDED.sleep_hours, activity_min=EXCLUDED.activity_min,
      activity_type=EXCLUDED.activity_type, steps=EXCLUDED.steps, note=EXCLUDED.note, source=EXCLUDED.source,
      updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`,
  { pid: patientId, date, source, ...merged });
  return db.get(`SELECT * FROM habit_logs WHERE patient_id=? AND log_date=?`, patientId, date);
}

/** ملخص N يوماً: سلسلة كاملة (أيام فارغة = null)، متوسطات، نسبة تحقيق الأهداف، أيام متتالية */
export async function habitSummary(patientId, { days = 30, patient = null, weightKg = null } = {}) {
  const p = patient ?? await db.get(`SELECT * FROM patients WHERE id=?`, patientId);
  const targets = habitTargets(p, weightKg);
  const today = todayISO();
  const from = addDaysISO(today, -(days - 1));
  const rows = await db.all(`SELECT * FROM habit_logs WHERE patient_id=? AND log_date BETWEEN ? AND ? ORDER BY log_date`, patientId, from, today);
  const byDate = new Map(rows.map((r) => [r.log_date, r]));
  const series = [];
  for (let i = 0; i < days; i++) {
    const d = addDaysISO(from, i);
    const r = byDate.get(d);
    series.push({ date: d, water_ml: r?.water_ml ?? null, sleep_hours: r?.sleep_hours ?? null, activity_min: r?.activity_min ?? null,
      steps: r?.steps ?? null, activity_type: r?.activity_type ?? null, note: r?.note ?? null, source: r?.source ?? null });
  }
  const avg = (k) => { const v = rows.map((r) => r[k]).filter((x) => x != null); return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 1) : null; };
  const hit = (k, t) => { const v = rows.filter((r) => r[k] != null); return v.length ? Math.round((v.filter((r) => r[k] >= t).length / v.length) * 100) : null; };
  // الأيام المتتالية حتى اليوم (أو حتى أمس إن لم يُسجَّل اليوم بعد)
  let streak = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    const s = series[i];
    const any = s.water_ml != null || s.sleep_hours != null || s.activity_min != null;
    if (any) streak++;
    else if (i === series.length - 1) continue;
    else break;
  }
  const scores = [hit('water_ml', targets.water_ml), hit('sleep_hours', targets.sleep_hours), hit('activity_min', targets.activity_min)].filter((x) => x != null);
  return {
    days, from, to: today, targets, series,
    today: series.at(-1),
    summary: {
      days_logged: rows.length,
      logging_rate: Math.round((rows.length / days) * 100),
      avg_water_ml: avg('water_ml'), avg_sleep_hours: avg('sleep_hours'), avg_activity_min: avg('activity_min'), avg_steps: avg('steps'),
      water_hit_pct: hit('water_ml', targets.water_ml), sleep_hit_pct: hit('sleep_hours', targets.sleep_hours), activity_hit_pct: hit('activity_min', targets.activity_min),
      habit_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      streak,
      last_log: rows.at(-1)?.log_date ?? null,
    },
  };
}

// ------------------------------------------------------------------
// قائمة الانتظار
// ------------------------------------------------------------------
export const TIME_PREFS = ['any', 'morning', 'afternoon', 'evening'];
const VISIT_TYPES = ['initial', 'followup', 'consult', 'plan_update', 'lab_review'];
const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const localNow = () => `${todayISO()} ${nowTimeHM()}`;
/** جمع دقائق على «YYYY-MM-DD HH:MM» محلياً (حساب نصّي بلا مناطق زمنية) */
const addMinutesLocal = (dt, mins) => new Date(new Date(`${dt.replace(' ', 'T')}:00Z`).getTime() + mins * 60000).toISOString().slice(0, 16).replace('T', ' ');

function timeMatches(pref, time) {
  if (!pref || pref === 'any') return true;
  if (pref === 'morning') return time < '12:00';
  if (pref === 'afternoon') return time >= '12:00' && time < '17:00';
  return time >= '17:00';
}
export function entryMatches(e, slot) {
  if (e.date_from && slot.date < e.date_from) return false;
  if (e.date_to && slot.date > e.date_to) return false;
  if (e.days) {
    const set = String(e.days).split(',').filter(Boolean).map(Number);
    if (set.length && !set.includes(dow(slot.date))) return false;
  }
  return timeMatches(e.time_pref, slot.time);
}

export function normalizeWaitlist(b = {}) {
  const out = {
    date_from: isDate(String(b.date_from || '')) ? b.date_from : null,
    date_to: isDate(String(b.date_to || '')) ? b.date_to : null,
    days: Array.isArray(b.days) ? [...new Set(b.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort().join(',') || null
      : (typeof b.days === 'string' && /^[0-6](,[0-6])*$/.test(b.days) ? b.days : null),
    time_pref: TIME_PREFS.includes(b.time_pref) ? b.time_pref : 'any',
    visit_type: VISIT_TYPES.includes(b.visit_type) ? b.visit_type : 'followup',
    mode: b.mode === 'video' ? 'video' : 'in_person',
    note: str(b.note, 500),
  };
  if (out.date_from && out.date_to && out.date_to < out.date_from) throw badRequest('تاريخ النهاية قبل البداية');
  if (out.date_to && out.date_to < todayISO()) throw badRequest('نطاق التواريخ انتهى بالفعل');
  return out;
}

export async function addToWaitlist({ patientId, body, source, userId = null }) {
  const dup = await db.get(`SELECT id FROM waitlist WHERE patient_id=? AND status='waiting'`, patientId);
  if (dup && source === 'portal') throw conflict('لديك طلب قائم في قائمة الانتظار بالفعل — عدّله أو ألغِه أولاً');
  const d = normalizeWaitlist(body);
  const id = await db.insert(`
    INSERT INTO waitlist (patient_id, date_from, date_to, days, time_pref, visit_type, mode, note, source, created_by)
    VALUES (@pid, @date_from, @date_to, @days, @time_pref, @visit_type, @mode, @note, @source, @uid)`,
  { pid: patientId, ...d, source, uid: userId });
  await audit({ userId, action: 'waitlist.add', entity: 'waitlist', entityId: id, detail: { patient_id: patientId, source } });
  // ربما يوجد موعد شاغر الآن بالفعل (ملغى وعرضه انتهى بلا قبول)
  return id;
}

const WL_SELECT = `
  SELECT w.*, p.first_name, p.last_name, p.file_no, p.phone,
    (SELECT COUNT(*) FROM waitlist w2 WHERE w2.status='waiting' AND w2.created_at <= w.created_at AND w2.id <= w.id) AS position,
    (SELECT COUNT(*) FROM waitlist_offers o WHERE o.waitlist_id=w.id AND o.status='pending') AS pending_offers
  FROM waitlist w JOIN patients p ON p.id=w.patient_id`;
export const listWaitlist = (where = `w.status='waiting'`, ...params) =>
  db.all(`${WL_SELECT} WHERE ${where} ORDER BY w.created_at, w.id`, ...params);

const OFFER_SELECT = `
  SELECT o.*, p.first_name, p.last_name, p.file_no, w.visit_type, w.mode
  FROM waitlist_offers o JOIN patients p ON p.id=o.patient_id JOIN waitlist w ON w.id=o.waitlist_id`;

async function slotTaken(date, time) {
  return !!(await db.get(`SELECT id FROM appointments WHERE date=? AND time=? AND status IN ('scheduled','confirmed')`, date, time));
}

async function clinicName() {
  const s = await getSettings();
  return s['clinic.name'] || 'العيادة';
}

/**
 * موعد أصبح شاغراً → يُعرض على أول N مرضى مطابقين في قائمة الانتظار مع إشعار واتساب.
 * يُستدعى عند: إلغاء موعد، حذفه، تغيير وقته، رفض/انتهاء عرض سابق (تسلسل تلقائي).
 */
export async function offerSlot({ date, time, duration = 30, sourceAppointmentId = null, excludePatientId = null, base = '', userId = null }) {
  const s = await getSettings();
  if (s['clinic.waitlist_enabled'] === false) return { offered: 0, reason: 'disabled' };
  if (!isDate(date) || !isTime(time)) return { offered: 0 };
  const now = localNow();
  if (`${date} ${time}` <= addMinutesLocal(now, 30)) return { offered: 0, reason: 'too_late' };
  if (await slotTaken(date, time)) return { offered: 0, reason: 'taken' };
  if (await db.get(`SELECT id FROM waitlist_offers WHERE slot_date=? AND slot_time=? AND status='pending'`, date, time)) return { offered: 0, reason: 'in_progress' };

  const batch = Math.max(1, Math.min(10, Number(s['clinic.waitlist_batch']) || 3));
  const minutes = Math.max(10, Math.min(24 * 60, Number(s['clinic.waitlist_offer_minutes']) || 120));
  const slot = { date, time };
  const already = new Set((await db.all(`SELECT patient_id FROM waitlist_offers WHERE slot_date=? AND slot_time=?`, date, time)).map((r) => r.patient_id));
  const busy = new Set((await db.all(`SELECT patient_id FROM appointments WHERE date=? AND status IN ('scheduled','confirmed')`, date)).map((r) => r.patient_id));
  const candidates = (await listWaitlist(`w.status='waiting' AND (w.date_to IS NULL OR w.date_to >= ?)`, todayISO()))
    .filter((e) => e.patient_id !== excludePatientId && !already.has(e.patient_id) && !busy.has(e.patient_id) && entryMatches(e, slot))
    .slice(0, batch);
  if (!candidates.length) return { offered: 0, reason: 'no_match' };

  // العرض ينتهي بعد N دقيقة، أو قبل الموعد بساعة — أيهما أقرب
  let expires = addMinutesLocal(now, minutes);
  const cutoff = addMinutesLocal(`${date} ${time}`, -60);
  if (cutoff < expires) expires = cutoff > now ? cutoff : addMinutesLocal(now, 15);
  const name = await clinicName();
  const offers = [];
  for (const e of candidates) {
    const id = await db.insert(`
      INSERT INTO waitlist_offers (waitlist_id, patient_id, slot_date, slot_time, duration_min, source_appointment_id, expires_at)
      VALUES (?,?,?,?,?,?,?)`, e.id, e.patient_id, date, time, duration, sourceAppointmentId, expires);
    const link = base ? portalLink(base, '/appointments') : '';
    const text = `مرحباً ${e.first_name} 👋\nتوفر موعد في ${name}: ${date} الساعة ${time}.\nأنت في قائمة الانتظار — أول من يؤكد يحصل عليه.\n${link ? `للتأكيد من البوابة: ${link}\n` : ''}العرض صالح حتى ${expires.slice(11)} (${expires.slice(0, 10)}).`;
    const r = await sendMessage({ patient: e, kind: 'waitlist_offer', text, refId: id, userId });
    await db.run(`UPDATE waitlist_offers SET notify_status=? WHERE id=?`, r.status, id);
    await pushToPatient(e.patient_id, {
      title: '🗓️ توفر موعد لك الآن', body: `${date} الساعة ${time} — أول من يؤكد يحصل عليه. العرض حتى ${expires.slice(11)}`,
      url: '/#/portal/appointments', kind: 'waitlist_offer', tag: `offer-${id}`, refId: id, userId, urgency: 'high',
    });
    offers.push({ id, patient_id: e.patient_id, name: `${e.first_name} ${e.last_name}`, notify: r.status, link: r.link });
  }
  await audit({ userId, action: 'waitlist.offer', entity: 'waitlist_offers', detail: { date, time, patients: offers.map((o) => o.patient_id) } });
  return { offered: offers.length, offers, expires_at: expires };
}

/** انتهاء صلاحية العروض + تسلسل العرض للتالي. آمن للاستدعاء المتكرر (من القراءات والمهمة اليومية) */
export async function sweepOffers({ base = '' } = {}) {
  const now = localNow();
  const expired = await db.all(`
    UPDATE waitlist_offers SET status='expired', responded_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
    WHERE status='pending' AND expires_at < ? RETURNING slot_date, slot_time, duration_min, source_appointment_id`, now);
  await db.run(`UPDATE waitlist SET status='expired', updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE status='waiting' AND date_to IS NOT NULL AND date_to < ?`, todayISO());
  const slots = new Map();
  for (const e of expired) slots.set(`${e.slot_date} ${e.slot_time}`, e);
  let cascaded = 0;
  for (const e of slots.values()) {
    const r = await offerSlot({ date: e.slot_date, time: e.slot_time, duration: e.duration_min, sourceAppointmentId: e.source_appointment_id, base });
    cascaded += r.offered;
  }
  return { expired: expired.length, cascaded };
}

/** قبول عرض: الأسبق يحجز (قفل + الفهرس الفريد uq_appt_slot يمنع الحجز المزدوج) */
export async function acceptOffer({ offerId, patientId = null, userId = null }) {
  return db.tx(async () => {
    await db.get(`SELECT pg_advisory_xact_lock(724402)`);
    const o = await db.get(`SELECT o.*, w.visit_type, w.mode FROM waitlist_offers o JOIN waitlist w ON w.id=o.waitlist_id WHERE o.id=?`, offerId);
    if (!o || (patientId && o.patient_id !== patientId)) throw notFound('العرض غير موجود');
    if (o.status === 'taken') throw conflict('للأسف حجز مريض آخر هذا الموعد قبلك — ما زلت في قائمة الانتظار');
    if (o.status !== 'pending') throw conflict('هذا العرض لم يعد متاحاً');
    if (o.expires_at < localNow()) {
      await db.run(`UPDATE waitlist_offers SET status='expired' WHERE id=?`, offerId);
      throw conflict('انتهت صلاحية العرض');
    }
    if (await slotTaken(o.slot_date, o.slot_time)) {
      await db.run(`UPDATE waitlist_offers SET status='taken' WHERE id=?`, offerId);
      throw conflict('للأسف حُجز هذا الموعد — ما زلت في قائمة الانتظار');
    }
    const apptId = await db.insert(`
      INSERT INTO appointments (patient_id, date, time, duration_min, visit_type, status, notes, mode, created_by)
      VALUES (?,?,?,?,?, 'confirmed', ?, ?, ?)`,
    o.patient_id, o.slot_date, o.slot_time, o.duration_min, o.visit_type, 'حُجز من قائمة الانتظار', o.mode || 'in_person', userId);
    const stamp = `to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`;
    await db.run(`UPDATE waitlist_offers SET status='accepted', appointment_id=?, responded_at=${stamp} WHERE id=?`, apptId, offerId);
    await db.run(`UPDATE waitlist_offers SET status='taken', responded_at=${stamp} WHERE slot_date=? AND slot_time=? AND status='pending' AND id<>?`, o.slot_date, o.slot_time, offerId);
    await db.run(`UPDATE waitlist SET status='booked', appointment_id=?, updated_at=${stamp} WHERE id=?`, apptId, o.waitlist_id);
    // عروض أخرى معلّقة لنفس المريض (لمواعيد أخرى) لم تعد لازمة
    await db.run(`UPDATE waitlist_offers SET status='declined', responded_at=${stamp} WHERE waitlist_id=? AND status='pending'`, o.waitlist_id);
    await audit({ userId, action: 'waitlist.accept', entity: 'appointments', entityId: apptId, detail: { offer_id: offerId, by: userId ? 'staff' : 'patient' } });
    return db.get(`SELECT * FROM appointments WHERE id=?`, apptId);
  });
}

export async function declineOffer({ offerId, patientId = null, userId = null, base = '' }) {
  const o = await db.get(`SELECT * FROM waitlist_offers WHERE id=?`, offerId);
  if (!o || (patientId && o.patient_id !== patientId)) throw notFound('العرض غير موجود');
  if (o.status !== 'pending') throw conflict('هذا العرض لم يعد متاحاً');
  await db.run(`UPDATE waitlist_offers SET status='declined', responded_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id=?`, offerId);
  await audit({ userId, action: 'waitlist.decline', entity: 'waitlist_offers', entityId: offerId });
  // إن لم يبقَ عرض معلّق لهذا الموعد → يُعرض على التالي
  const next = await offerSlot({ date: o.slot_date, time: o.slot_time, duration: o.duration_min, sourceAppointmentId: o.source_appointment_id, base });
  return { declined: true, cascaded: next.offered };
}

export const offersFor = (where, ...params) => db.all(`${OFFER_SELECT} WHERE ${where} ORDER BY o.slot_date, o.slot_time, o.id`, ...params);

// ------------------------------------------------------------------
// مكالمات الفيديو (إشارات WebRTC عبر الاستطلاع)
// ------------------------------------------------------------------
const SIGNAL_KINDS = ['hello', 'offer', 'answer', 'ice', 'bye', 'state'];

export function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    list.push({ urls: process.env.TURN_URL.split(',').map((x) => x.trim()), username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
  }
  return list;
}

export async function startCall({ appointmentId, userId }) {
  const a = await db.get(`SELECT * FROM appointments WHERE id=?`, appointmentId);
  if (!a) throw notFound('الموعد غير موجود');
  if (a.status === 'cancelled') throw badRequest('الموعد ملغى');
  let call = await db.get(`SELECT * FROM call_sessions WHERE appointment_id=? AND status<>'ended' ORDER BY id DESC LIMIT 1`, appointmentId);
  if (!call) {
    // مكالمة واحدة مفتوحة لكل مريض — أي جلسة قديمة معلّقة تُغلق
    await db.run(`UPDATE call_sessions SET status='ended', ended_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE patient_id=? AND status<>'ended'`, a.patient_id);
    const id = await db.insert(`INSERT INTO call_sessions (appointment_id, patient_id, started_by) VALUES (?,?,?)`, appointmentId, a.patient_id, userId);
    if (a.mode !== 'video') await db.run(`UPDATE appointments SET mode='video' WHERE id=?`, appointmentId);
    await audit({ userId, action: 'call.start', entity: 'call_sessions', entityId: id, detail: { appointment_id: appointmentId } });
    call = await db.get(`SELECT * FROM call_sessions WHERE id=?`, id);
  }
  return call;
}

export async function callFor(callId, { patientId = null } = {}) {
  const c = await db.get(`
    SELECT c.*, p.first_name, p.last_name, p.file_no, p.phone, a.date, a.time, a.visit_type, u.full_name AS doctor_name
    FROM call_sessions c JOIN patients p ON p.id=c.patient_id
    LEFT JOIN appointments a ON a.id=c.appointment_id LEFT JOIN users u ON u.id=c.started_by WHERE c.id=?`, callId);
  if (!c || (patientId && c.patient_id !== patientId)) throw notFound('المكالمة غير موجودة');
  return c;
}

export async function postSignal({ callId, sender, kind, payload }) {
  if (!SIGNAL_KINDS.includes(kind)) throw badRequest('نوع إشارة غير معروف');
  const c = await db.get(`SELECT status FROM call_sessions WHERE id=?`, callId);
  if (!c) throw notFound('المكالمة غير موجودة');
  if (c.status === 'ended' && kind !== 'bye') throw conflict('انتهت المكالمة');
  const body = payload === undefined || payload === null ? null : JSON.stringify(payload);
  if (body && body.length > 60_000) throw badRequest('الإشارة كبيرة جداً');
  const id = await db.insert(`INSERT INTO call_signals (call_id, sender, kind, payload) VALUES (?,?,?,?)`, callId, sender, kind, body);
  if (kind === 'answer' && c.status === 'waiting') {
    await db.run(`UPDATE call_sessions SET status='active', connected_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id=?`, callId);
  }
  return { id };
}

/** إشارات الطرف الآخر بعد رقم معيّن. after=-1 → آخر رقم فقط (لتجاهل التاريخ عند الانضمام) */
export async function pullSignals({ callId, reader, after }) {
  const seenCol = reader === 'doctor' ? 'doctor_seen_at' : 'patient_seen_at';
  await db.run(`UPDATE call_sessions SET ${seenCol}=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id=?`, callId);
  const c = await db.get(`SELECT id, status, doctor_seen_at, patient_seen_at, connected_at FROM call_sessions WHERE id=?`, callId);
  if (!c) throw notFound('المكالمة غير موجودة');
  const last = (await db.get(`SELECT COALESCE(MAX(id),0) AS m FROM call_signals WHERE call_id=?`, callId)).m;
  const other = reader === 'doctor' ? 'patient' : 'doctor';
  const peerSeen = reader === 'doctor' ? c.patient_seen_at : c.doctor_seen_at;
  const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const peerOnline = !!peerSeen && (new Date(`${nowUtc.replace(' ', 'T')}Z`) - new Date(`${peerSeen.replace(' ', 'T')}Z`)) < 15_000;
  if (Number(after) < 0) return { items: [], last_id: last, status: c.status, peer_online: peerOnline };
  const items = (await db.all(`SELECT id, sender, kind, payload, created_at FROM call_signals WHERE call_id=? AND id>? AND sender=? ORDER BY id LIMIT 50`,
    callId, Number(after) || 0, other)).map((s) => ({ ...s, payload: s.payload ? JSON.parse(s.payload) : null }));
  return { items, last_id: Math.max(last, items.at(-1)?.id ?? 0), status: c.status, peer_online: peerOnline };
}

export async function endCall({ callId, sender, userId = null }) {
  await db.run(`UPDATE call_sessions SET status='ended', ended_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id=? AND status<>'ended'`, callId);
  await db.insert(`INSERT INTO call_signals (call_id, sender, kind) VALUES (?,?, 'bye')`, callId, sender);
  if (userId) await audit({ userId, action: 'call.end', entity: 'call_sessions', entityId: callId });
  return { ended: true };
}

/** تنظيف: إشارات المكالمات المنتهية (SDP كبيرة ولا حاجة لها) + جلسات معلّقة منذ ساعات */
export async function cleanupCalls() {
  await db.run(`UPDATE call_sessions SET status='ended', ended_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
    WHERE status<>'ended' AND created_at < to_char((now() AT TIME ZONE 'UTC') - interval '6 hours','YYYY-MM-DD HH24:MI:SS')`);
  const r = await db.run(`DELETE FROM call_signals WHERE call_id IN (SELECT id FROM call_sessions WHERE status='ended')`);
  return { signals_deleted: r.changes };
}

export { normalizePhone, waLink, getSetting };
