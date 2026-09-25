-- ============================================================
--  نظام إدارة عيادة التغذية — مخطط قاعدة البيانات (SQLite)
--  ملاحظة: الأعمدة المشتقة (BMI، المجاميع، الإيرادات) لا تُدخل
--  من العميل إطلاقاً؛ تُحسب في السيرفر = حماية للصيغ من العبث.
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- المستخدمون والصلاحيات ----------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  full_name     TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'staff'   -- admin | staff | viewer
                CHECK (role IN ('admin','staff','viewer')),
  active        INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------- المرضى ----------
CREATE TABLE IF NOT EXISTS patients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file_no      TEXT    NOT NULL UNIQUE,              -- رقم الملف التلقائي (مثال NC-0001)
  first_name   TEXT    NOT NULL,
  last_name    TEXT    NOT NULL,
  phone        TEXT,
  birth_date   TEXT,                                  -- YYYY-MM-DD
  gender       TEXT    CHECK (gender IN ('male','female')),
  height_cm    REAL,
  start_weight REAL,                                   -- وزن البداية (كيغرام)
  goal_weight  REAL,                                   -- الوزن المستهدف
  goal         TEXT,                                    -- الهدف الغذائي (نص)
  notes        TEXT,
  status       TEXT    NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','inactive','archived')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_patients_name  ON patients(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);

-- ---------- الزيارات (رأس لكل زيارة، ترتبط بها القياسات والمدفوعات) ----------
CREATE TABLE IF NOT EXISTS visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_date  TEXT    NOT NULL,                        -- YYYY-MM-DD
  visit_type  TEXT    NOT NULL DEFAULT 'followup'
              CHECK (visit_type IN ('initial','followup','consult','plan_update','lab_review')),
  reason      TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id, visit_date DESC);

-- ---------- القياسات / المتابعة (واحدة لكل زيارة) ----------
CREATE TABLE IF NOT EXISTS measurements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id      INTEGER REFERENCES visits(id) ON DELETE CASCADE,
  measured_on   TEXT    NOT NULL,                      -- YYYY-MM-DD
  weight_kg     REAL,
  height_cm     REAL,
  bmi           REAL,                                  -- محسوب آلياً — للحماية فقط
  waist_cm      REAL,
  chest_cm      REAL,
  hip_cm        REAL,
  body_fat_pct  REAL,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meas_patient ON measurements(patient_id, measured_on);

-- ---------- البرامج الغذائية ----------
CREATE TABLE IF NOT EXISTS diet_plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  start_date   TEXT,
  end_date     TEXT,
  target_kcal  REAL,
  target_protein_g REAL,
  target_carbs_g   REAL,
  target_fat_g     REAL,
  advice       TEXT,                                   -- ملاحظات وتعليمات عامة
  status       TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plans_patient ON diet_plans(patient_id, status);

-- ---------- وجبات البرنامج الغذائي ----------
CREATE TABLE IF NOT EXISTS diet_meals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    INTEGER NOT NULL REFERENCES diet_plans(id) ON DELETE CASCADE,
  slot       TEXT    NOT NULL,                         -- الفطور / سناك / الغداء ...
  slot_time  TEXT,                                     -- التوقيت المقترح
  title      TEXT    NOT NULL,
  items      TEXT,                                     -- الأصناف (نص متعدد السطور)
  portions   TEXT,                                     -- الكميات
  kcal       REAL,
  protein_g  REAL,
  carbs_g    REAL,
  fat_g      REAL,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_meals_plan ON diet_meals(plan_id, position);

-- ---------- المواعيد ----------
CREATE TABLE IF NOT EXISTS appointments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,                       -- YYYY-MM-DD
  time         TEXT    NOT NULL,                       -- HH:MM
  duration_min INTEGER NOT NULL DEFAULT 30,
  visit_type   TEXT    NOT NULL DEFAULT 'followup'
               CHECK (visit_type IN ('initial','followup','consult','plan_update','lab_review')),
  status       TEXT    NOT NULL DEFAULT 'scheduled'
               CHECK (status IN ('scheduled','confirmed','done','cancelled','no_show')),
  room         TEXT,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date, time);
CREATE UNIQUE INDEX IF NOT EXISTS uq_appt_slot ON appointments(date, time) WHERE status IN ('scheduled','confirmed');

-- ---------- المدفوعات ----------
CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  paid_on      TEXT    NOT NULL,                       -- YYYY-MM-DD
  service      TEXT    NOT NULL,
  amount       REAL    NOT NULL CHECK (amount >= 0),
  currency     TEXT    NOT NULL DEFAULT 'SDG',
  method       TEXT    NOT NULL DEFAULT 'cash'
               CHECK (method IN ('cash','card','bank_transfer','mobile_wallet','instalment')),
  invoice_no   TEXT,
  note         TEXT,
  voided       INTEGER NOT NULL DEFAULT 0,
  recorded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pay_date ON payments(paid_on);
CREATE INDEX IF NOT EXISTS idx_pay_patient ON payments(patient_id);

-- ---------- سجل التدقيق (من عدّل إيه ومתי) ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC);

-- ---------- إعدادات العيادة ----------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------- منظر: الملف المالي لكل مريض ----------
CREATE VIEW IF NOT EXISTS patient_financials AS
SELECT p.id AS patient_id,
       COALESCE(SUM(CASE WHEN pa.voided = 0 THEN pa.amount ELSE 0 END), 0) AS paid_total,
       COUNT(pa.id)                                                        AS payments_count
FROM patients p
LEFT JOIN payments pa ON pa.patient_id = p.id
GROUP BY p.id;
