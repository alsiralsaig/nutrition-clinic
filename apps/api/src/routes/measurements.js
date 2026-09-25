// المتابعة والقياسات + الزيارات (BMI والـ WHR تُحسب في السيرفر)
import { Router } from 'express';
import { db, audit } from '../db.js';
import { badRequest, notFound, requiredStr, str, wrap, calcBMI, bmiCategory, isDate, toNum, round } from '../lib.js';
import { canWrite } from '../auth.js';

export const router = Router();

const VISIT_TYPES = ['initial', 'followup', 'consult', 'plan_update', 'lab_review'];

function assertDate(v, label = 'التاريخ') {
  if (!isDate(String(v || ''))) throw badRequest(`${label} مطلوب بصيغة YYYY-MM-DD`);
  return String(v);
}

// ---------------- الزيارات ----------------
router.get('/visits', wrap((req, res) => {
  const pid = req.query.patient_id ? Number(req.query.patient_id) : null;
  const rows = db.prepare(`
    SELECT v.*, p.first_name, p.last_name, p.file_no, u.full_name AS staff_name,
           (SELECT COUNT(*) FROM measurements m WHERE m.visit_id = v.id) AS measurements_count,
           (SELECT COUNT(*) FROM payments pa WHERE pa.appointment_id IN
              (SELECT id FROM appointments a WHERE a.date = v.visit_date AND a.patient_id = v.patient_id)) AS payments_count
    FROM visits v
    JOIN patients p ON p.id = v.patient_id
    LEFT JOIN users u ON u.id = v.created_by
    ${pid ? 'WHERE v.patient_id = ?' : ''}
    ORDER BY v.visit_date DESC, v.id DESC
    LIMIT 500
  `).all(...(pid ? [pid] : []));
  res.json({ items: rows });
}));

router.post('/visits', canWrite(), wrap((req, res) => {
  const patientId = Number(req.body.patient_id);
  if (!patientId) throw badRequest('patient_id مطلوب');
  const visitDate = assertDate(req.body.visit_date, 'تاريخ الزيارة');
  const type = VISIT_TYPES.includes(req.body.visit_type) ? req.body.visit_type : 'followup';
  const info = db.prepare(`
    INSERT INTO visits (patient_id, visit_date, visit_type, reason, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(patientId, visitDate, type, str(req.body.reason, 1000), req.user.id);
  audit({ userId: req.user.id, action: 'visit.create', entity: 'visits', entityId: info.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT * FROM visits WHERE id = ?`).get(info.lastInsertRowid));
}));

router.delete('/visits/:id(\\d+)', canWrite(), wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare(`SELECT id FROM visits WHERE id=?`).get(id)) throw notFound();
  db.prepare(`DELETE FROM visits WHERE id=?`).run(id);
  audit({ userId: req.user.id, action: 'visit.delete', entity: 'visits', entityId: id });
  res.json({ deleted: true, id });
}));

// ---------------- القياسات ----------------
function decorate(m) {
  const bmi = calcBMI(m.weight_kg, m.height_cm);
  return {
    ...m,
    bmi,
    bmi_category: bmiCategory(bmi)?.label ?? null,
    waist_hip_ratio: m.waist_cm && m.hip_cm ? round(m.waist_cm / m.hip_cm, 2) : null,
  };
}

function normalizeMeasure(body, existing = {}) {
  const out = {
    patient_id: body.patient_id !== undefined ? Number(body.patient_id) || existing.patient_id : existing.patient_id,
    visit_id: body.visit_id !== undefined ? (body.visit_id ? Number(body.visit_id) : null) : (existing.visit_id ?? null),
    measured_on: assertDate(body.measured_on ?? existing.measured_on, 'تاريخ القياس'),
    weight_kg: existing.weight_kg ?? null,
    height_cm: existing.height_cm ?? null,
    waist_cm: existing.waist_cm ?? null,
    chest_cm: existing.chest_cm ?? null,
    hip_cm: existing.hip_cm ?? null,
    body_fat_pct: existing.body_fat_pct ?? null,
    notes: body.notes !== undefined ? str(body.notes, 2000) : (existing.notes ?? null),
  };
  for (const k of ['weight_kg', 'height_cm', 'waist_cm', 'chest_cm', 'hip_cm', 'body_fat_pct']) {
    if (body[k] === undefined) continue;
    const v = toNum(body[k]);
    if (v !== null && (v <= 0 || v > 500)) throw badRequest(`قيمة «${k}» غير منطقية`);
    out[k] = v;
  }
  if (!out.patient_id) throw badRequest('patient_id مطلوب');
  if (out.weight_kg == null && out.body_fat_pct == null)
    throw badRequest('الوزن مطلوب في كل زيارة متابعة (أو نسبة دهون على الأقل)');
  return out;
}

router.get('/measurements', wrap((req, res) => {
  const pid = req.query.patient_id ? Number(req.query.patient_id) : null;
  const rows = db.prepare(`
    SELECT m.*, v.visit_type FROM measurements m
    LEFT JOIN visits v ON v.id = m.visit_id
    ${pid ? 'WHERE m.patient_id = ?' : ''}
    ORDER BY m.measured_on DESC, m.id DESC LIMIT 1000
  `).all(...(pid ? [pid] : []));
  res.json({ items: rows.map(decorate) });
}));

router.post('/measurements', canWrite(), wrap((req, res) => {
  const data = normalizeMeasure(req.body);
  const heightCm = data.height_cm ?? db.prepare(`SELECT height_cm FROM patients WHERE id=?`).get(data.patient_id)?.height_cm;
  data.height_cm = heightCm ?? null;
  data.bmi = calcBMI(data.weight_kg, heightCm); // يُخزَّن للعرض فقط — المصدر دائماً الحساب
  const info = db.prepare(`
    INSERT INTO measurements (patient_id, visit_id, measured_on, weight_kg, height_cm, bmi, waist_cm,
      chest_cm, hip_cm, body_fat_pct, notes, created_by)
    VALUES (@patient_id, @visit_id, @measured_on, @weight_kg, @height_cm, @bmi, @waist_cm,
            @chest_cm, @hip_cm, @body_fat_pct, @notes, @created_by)
  `).run({ ...data, created_by: req.user.id });
  audit({ userId: req.user.id, action: 'measurement.create', entity: 'measurements', entityId: info.lastInsertRowid });
  res.status(201).json(decorate(db.prepare(`SELECT * FROM measurements WHERE id=?`).get(info.lastInsertRowid)));
}));

router.put('/measurements/:id(\\d+)', canWrite(), wrap((req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM measurements WHERE id=?`).get(id);
  if (!existing) throw notFound();
  const data = normalizeMeasure(req.body, existing);
  data.bmi = calcBMI(data.weight_kg, data.height_cm);
  db.prepare(`
    UPDATE measurements SET visit_id=@visit_id, measured_on=@measured_on, weight_kg=@weight_kg,
      height_cm=@height_cm, bmi=@bmi, waist_cm=@waist_cm, chest_cm=@chest_cm, hip_cm=@hip_cm,
      body_fat_pct=@body_fat_pct, notes=@notes WHERE id=@id
  `).run({ ...data, id });
  audit({ userId: req.user.id, action: 'measurement.update', entity: 'measurements', entityId: id });
  res.json(decorate(db.prepare(`SELECT * FROM measurements WHERE id=?`).get(id)));
}));

router.delete('/measurements/:id(\\d+)', canWrite(), wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare(`SELECT id FROM measurements WHERE id=?`).get(id)) throw notFound();
  db.prepare(`DELETE FROM measurements WHERE id=?`).run(id);
  audit({ userId: req.user.id, action: 'measurement.delete', entity: 'measurements', entityId: id });
  res.json({ deleted: true, id });
}));
