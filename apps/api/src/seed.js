// بذرة النظام: مستخدم افتراضي + بيانات تجريبية واقعية لعيادة تغذية
import { db, migrate, DEFAULT_SETTINGS } from './db.js';
import { hashPassword } from './auth.js';
import { calcBMI } from './lib.js';

/** مولّد عشوائي ثابت البذرة (نفس البيانات في كل تشغيل نظيف) */
function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const FIRST_M = ['أحمد', 'محمد', 'خالد', 'عمر', 'ياسر', 'طارق', 'سيف', 'وليد', 'بلال', 'عامر'];
const FIRST_F = ['مريم', 'نور', 'سارة', 'هند', 'ريم', 'لمى', 'جنى', 'أسماء', 'شهد', 'دعاء'];
const LAST = ['الطيب', 'الحسن', 'محمد أحمد', 'عبد الله', 'الكامل', 'سعد الدين', 'الماحي', 'يوسف', 'البدري', 'زكريا'];
const GOALS = [
  'إنزال 12 كجم دهون مع الحفاظ على الكتلة العضلية',
  'زيادة الوزن 6 كجم كتلة عضلية',
  'ضبط السكر والدهون الثلاثة وتقليل الخبز',
  'حمية ما بعد الولادة مع رضاعة طبيعية',
  'تحضير لمباريات الموسم — تغذية رياضية',
  'علاج تكيس المبايض وتنظيم الشهية',
];
const SERVICES = [
  ['استشارة أولى', 1500],
  ['متابعة أسبوعية', 800],
  ['برنامج غذائي جديد', 1200],
  ['تحليل قياسات متقدمة', 1000],
  ['متابعة شهرية', 2500],
  ['خطة رياضية غذائية', 1800],
];
const MEAL_LIB = {
  'الفطور': [
    ['شريحة توست أسمر + بيضة مسلوقة + جبن قريش', '30غ / 1 حبة / 50غ', 260, 18, 20, 10],
    ['فول مدمس بزيت زيتون + ليمون', 'كوب / ملعقة صغيرة', 300, 16, 34, 10],
    ['شوفت بالحليب وزبادي يوناني', '40غ / 150مل / 100غ', 340, 22, 40, 8],
  ],
  'سناك صباحي': [
    ['تفاحة + 10 حبات لوز', '150غ / 15غ', 190, 5, 22, 9],
    ['زبادي طبيعي + رشة قرفة', 'كوب', 150, 9, 11, 5],
    ['خيار وجزر + حمص', 'كوب / 3ملاعق', 130, 6, 14, 5],
  ],
  'الغداء': [
    ['صدر دجاج مشوي + أرز بني + سلطة', '150غ / ¾ كوب / كوب', 480, 45, 42, 10],
    ['سمك مشوي + خضار سوتيه + بطاطس', '200غ / كوب / حبة وسط', 500, 44, 40, 12],
    ['عدس بالرز + سلطة خضراء', 'كوب / كوب', 430, 22, 60, 6],
  ],
  'سناك عصري': [
    ['زبادي يوناني بالعسل', '150غ / ملعقة', 190, 15, 22, 5],
    ['بروتين سموزي', 'كوب', 220, 25, 14, 6],
    ['تمر 3 حبات + مكسرات', '60غ / 15غ', 230, 5, 30, 10],
  ],
  'العشاء': [
    ['سلطة تونة بالذرة', 'علبة / ½ كوب', 320, 30, 20, 12],
    ['جبن قريش + خيار + زيتون', '100غ / كوب / 5 حبات', 240, 16, 8, 14],
    ['شوربة خضار + توست', 'كوب / شريحتان', 210, 8, 26, 7],
  ],
};

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const daysAhead = (n) => daysAgo(-n);

export function ensureSeed({ quiet = false, forceDemo = false } = {}) {
  migrate();
  const log = (...a) => { if (!quiet) console.log(...a); };

  // 1) المستخدمون
  const users = db.prepare(`SELECT COUNT(*) n FROM users`).get().n;
  if (users === 0) {
    const ins = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, active) VALUES (?,?,?,?,1)`);
    ins.run('admin', hashPassword(process.env.ADMIN_PASSWORD || 'admin123'), 'مدير العيادة', 'admin');
    ins.run('doctor', hashPassword('doctor123'), 'أخصائية التغذية — د. سارة', 'staff');
    ins.run('reception', hashPassword('reception123'), 'موظفة الاستقبال', 'viewer');
    log('  ✓ مستخدمون: admin / doctor / reception (كلمات المرور في README)');
  }

  // 2) الإعدادات الافتراضية
  const setIns = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`);
  for (const [k, v] of DEFAULT_SETTINGS) setIns.run(k, typeof v === 'string' ? v : JSON.stringify(v));

  // 3) بيانات تجريبية
  const patients = db.prepare(`SELECT COUNT(*) n FROM patients`).get().n;
  if (patients > 0 && !forceDemo) return log('  • توجد بيانات بالفعل — تم تجاهل بذرة المرضى');

  const r = rng(7);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const adminId = db.prepare(`SELECT id FROM users WHERE username='admin'`).get().id;

  const insPatient = db.prepare(`
    INSERT INTO patients (file_no, first_name, last_name, phone, birth_date, gender, height_cm,
      start_weight, goal_weight, goal, notes, status, created_at, created_by)
    VALUES (@file_no, @first_name, @last_name, @phone, @birth_date, @gender, @height_cm,
      @start_weight, @goal_weight, @goal, @notes, @status, @created_at, @created_by)
  `);
  const insVisit = db.prepare(`INSERT INTO visits (patient_id, visit_date, visit_type, reason, created_by, created_at) VALUES (?,?,?,?,?,?)`);
  const insMeas = db.prepare(`
    INSERT INTO measurements (patient_id, visit_id, measured_on, weight_kg, height_cm, bmi, waist_cm, chest_cm, hip_cm, body_fat_pct, notes, created_by)
    VALUES (@patient_id, @visit_id, @measured_on, @weight_kg, @height_cm, @bmi, @waist_cm, @chest_cm, @hip_cm, @body_fat_pct, @notes, @created_by)
  `);
  const insPlan = db.prepare(`
    INSERT INTO diet_plans (patient_id, title, start_date, end_date, target_kcal, target_protein_g, target_carbs_g, target_fat_g, advice, status, created_by, created_at)
    VALUES (@patient_id, @title, @start_date, @end_date, @target_kcal, @target_protein_g, @target_carbs_g, @target_fat_g, @advice, @status, @created_by, @created_at)
  `);
  const insMeal = db.prepare(`
    INSERT INTO diet_meals (plan_id, slot, slot_time, title, items, portions, kcal, protein_g, carbs_g, fat_g, position)
    VALUES (@plan_id, @slot, @slot_time, @title, @items, @portions, @kcal, @protein_g, @carbs_g, @fat_g, @position)
  `);
  const insAppt = db.prepare(`
    INSERT INTO appointments (patient_id, date, time, duration_min, visit_type, status, notes, created_by)
    VALUES (@patient_id, @date, @time, @duration_min, @visit_type, @status, @notes, @created_by)
  `);
  const insPay = db.prepare(`
    INSERT INTO payments (patient_id, paid_on, service, amount, method, invoice_no, recorded_by)
    VALUES (@patient_id, @paid_on, @service, @amount, @method, @invoice_no, @recorded_by)
  `);
  const fileNo = (i) => `NC-${String(i).padStart(4, '0')}`;

  db.transaction(() => {
    const N = 14;
    for (let i = 1; i <= N; i++) {
      const gender = r() > 0.42 ? 'female' : 'male';
      const height = Math.round((155 + r() * 30) * 10) / 10;
      const start = Math.round((gender === 'female' ? 62 : 78) + r() * 38);
      const losing = start > (gender === 'female' ? 58 : 72) && r() > 0.18;
      const goalWeight = Math.round(losing ? start - (6 + r() * 16) : start + (3 + r() * 6));
      const born = new Date(2026 - Math.round(18 + r() * 38), Math.floor(r() * 12), 1 + Math.floor(r() * 27));
      const createdAt = daysAgo(Math.round(30 + r() * 300));
      const pid = insPatient.run({
        file_no: fileNo(i),
        first_name: gender === 'female' ? pick(FIRST_F) : pick(FIRST_M),
        last_name: pick(LAST),
        phone: `09${String(Math.floor(r() * 9e8) + 1e8).slice(0, 8)}`,
        birth_date: iso(born),
        gender,
        height_cm: height,
        start_weight: start,
        goal_weight: goalWeight,
        goal: pick(GOALS),
        notes: r() > 0.5 ? pick([
          'حساسية من المكسرات — تجنب الفول السوداني.',
          'تعمل بنظام الورديات، وجبات متقطعة.',
          'مصابة بغدة درقية وتحت علاج الثيروكسين.',
          'تفضل الوجبات المنزلية ورفض المكملات.',
          'ضغط مرتفع — تقليل الملح أولوية.',
        ]) : null,
        status: r() > 0.88 ? 'inactive' : 'active',
        created_at: `${iso(createdAt)} ${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}:00`,
        created_by: adminId,
      }).lastInsertRowid;

      // سلسلة زيارات ومتابعة عبر الأسابيع
      const visits = Math.round(3 + r() * 6);
      let w = start;
      let waist = Math.round((gender === 'female' ? 84 : 94) + r() * 22);
      const hip = Math.round(waist + (gender === 'female' ? 18 : 6) + r() * 6);
      const chest = Math.round(waist + 12 + r() * 14);
      let fat = Math.round((losing ? 30 : 24) + r() * 10);
      for (let v = 0; v < visits; v++) {
        const when = new Date(createdAt.getTime() + v * (7 + Math.round(r() * 10)) * 864e5);
        if (when > new Date()) break;
        const visitType = v === 0 ? 'initial' : (r() > 0.7 ? 'plan_update' : 'followup');
        const vid = insVisit.run(pid, iso(when), visitType, v === 0 ? 'تقييم شامل وتخطيط برنامج' : 'متابعة الوزن والقياسات', adminId,
          `${iso(when)} 10:00:00`).lastInsertRowid;
        if (v > 0) w = Math.round((w + (losing ? -(0.3 + r() * 1.6) : (0.15 + r() * 0.8))) * 10) / 10;
        waist = Math.max(60, Math.round(waist + (losing ? -(0.4 + r() * 1.3) : (0.2 + r() * 0.5))));
        fat = Math.max(8, Math.round(fat + (losing ? -(0.3 + r() * 0.9) : (0.15 + r() * 0.4))));
        insMeas.run({
          patient_id: pid, visit_id: vid, measured_on: iso(when), weight_kg: w, height_cm: height,
          bmi: calcBMI(w, height), waist_cm: waist, chest_cm: chest, hip_cm: hip, body_fat_pct: fat,
          notes: r() > 0.6 ? pick(['التزام جيد، شكوى من الجوع المسائي.', 'نوم غير منتظم — تنظيم الوجبات.', 'شرب ماء كافٍ 2.5 لتر.', 'توقف عن المشروبات الغازية تماماً.', 'تحسن في النشاط والهضم.']) : null,
          created_by: adminId,
        });
        if (r() > 0.25) {
          const [service, base] = pick(SERVICES);
          insPay.run({
            patient_id: pid, paid_on: iso(when), service,
            amount: Math.round(base * (0.9 + r() * 0.3) / 50) * 50,
            method: pick(['cash', 'mobile_wallet', 'bank_transfer', 'card']),
            invoice_no: `INV-${1000 + i * 20 + v}`, recorded_by: adminId,
          });
        }
      }

      // برنامج غذائي (نشط غالباً)
      const kcal = Math.round((losing ? 1500 + r() * 500 : 2100 + r() * 600) / 10) * 10;
      const protein = Math.round(w * (1.6 + r() * 0.4));
      const fat_g = Math.round(kcal * (0.25 + r() * 0.06) / 9);
      const carbs = Math.round((kcal - protein * 4 - fat_g * 9) / 4);
      const planStart = daysAgo(Math.round(r() * 40));
      const planId = insPlan.run({
        patient_id: pid,
        title: losing ? 'برنامج إنقاص — مرحلة أولى' : 'برنامج زيادة عضلية',
        start_date: iso(planStart),
        end_date: iso(new Date(planStart.getTime() + 42 * 864e5)),
        target_kcal: kcal, target_protein_g: protein, target_carbs_g: Math.max(60, carbs), target_fat_g: fat_g,
        advice: 'شرب 2–3 لتر ماء يومياً • النوم 7 ساعات • لا حذف للوجبات • استبدال الخبز الأبيض بالأسمر • مشروب خالي السكر عند الحاجة.',
        status: r() > 0.2 ? 'active' : 'draft',
        created_by: adminId,
        created_at: `${iso(planStart)} 12:00:00`,
      }).lastInsertRowid;
      let pos = 0;
      for (const [slot, time] of [['الفطور', '08:00'], ['سناك صباحي', '11:00'], ['الغداء', '14:00'], ['سناك عصري', '17:00'], ['العشاء', '20:00']]) {
        const [title, portions, k, p, c, f] = pick(MEAL_LIB[slot]);
        insMeal.run({
          plan_id: planId, slot, slot_time: time, title, items: title, portions,
          kcal: k, protein_g: p, carbs_g: c, fat_g: f, position: pos++,
        });
      }

      // مواعيد: بعضها اليوم، بعضها قادم (فتلك محجوزة مسبقاً تُتجنب لئلا تكسر القيد الفريد)
      const times = ['09:00', '10:00', '11:00', '13:00', '15:30', '17:00', '18:30', '19:30'];
      const addAppt = (obj) => {
        try { insAppt.run(obj); return true; } catch { return false; }
      };
      if (r() > 0.45) {
        for (const t of times.sort(() => r() - 0.5)) {
          if (addAppt({
            patient_id: pid, date: iso(daysAgo(0)), time: t, duration_min: pick([30, 45]),
            visit_type: 'followup', status: pick(['scheduled', 'confirmed', 'done']),
            notes: r() > 0.5 ? 'طلب تقرير متابعة لمدرب الصالة.' : null, created_by: adminId,
          })) break;
        }
      }
      if (r() > 0.5) {
        const day = iso(daysAhead(1 + Math.round(r() * 9)));
        for (const t of times) {
          if (addAppt({
            patient_id: pid, date: day, time: t, duration_min: 30,
            visit_type: pick(['followup', 'plan_update', 'initial']), status: 'scheduled', notes: null, created_by: adminId,
          })) break;
        }
      }
      for (const back of [7, 14]) {
        if (r() > 0.7) {
          addAppt({
            patient_id: pid, date: iso(daysAgo(back)), time: pick(times), duration_min: 30,
            visit_type: 'followup', status: pick(['done', 'cancelled', 'no_show']), notes: null, created_by: adminId,
          });
        }
      }
    }
  })();

  const counts = {
    patients: db.prepare(`SELECT COUNT(*) n FROM patients`).get().n,
    measurements: db.prepare(`SELECT COUNT(*) n FROM measurements`).get().n,
    appointments: db.prepare(`SELECT COUNT(*) n FROM appointments`).get().n,
    payments: db.prepare(`SELECT COUNT(*) n FROM payments`).get().n,
    plans: db.prepare(`SELECT COUNT(*) n FROM diet_plans`).get().n,
  };
  log('  ✓ بيانات تجريبية:', JSON.stringify(counts));
}

// تشغيل مباشر:  node src/seed.js  [--force]
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  ensureSeed({ forceDemo: process.argv.includes('--force') });
  console.log('تمت البذرة.');
}
