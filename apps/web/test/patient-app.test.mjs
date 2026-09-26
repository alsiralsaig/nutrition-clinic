// اختبار دخاني لتطبيق المريض (PWA): يحمّل index.html + app.js في jsdom،
// يبدّل fetch بمحاكاة الـ API، ويتحقق من شاشة الدخول والعرض وتسجيل العادات.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, "..", "public", "patient-app");
const html = readFileSync(path.join(appDir, "index.html"), "utf8");
const appJs = readFileSync(path.join(appDir, "app.js"), "utf8");

/* محاكاة /api/portal/me — مريض له برنامج نشط وتاريخ طبي */
const ME = {
  patient: {
    id: 9, file_no: "NC-0009", first_name: "هند", last_name: "الكامل", gender: "female",
    birth_date: "1995-03-10", height_cm: 165, start_weight: 82, goal_weight: 72,
    phone: "0912345678", water_target_ml: 2500, sleep_target_h: 7.5, activity_target_min: 30,
    chronic_conditions: "ضغط خفيف", allergies: "لاكتوز", medications: null,
    forbidden_foods: null, blood_type: "A+",
  },
  clinic: { name: "عيادة تجريبية", phone: "+249912345678", address: "الخرطوم" },
  progress: {
    start_weight: 82, current_weight: 79.5, goal_weight: 72, bmi: 29.1, bmi_category: "زيادة وزن",
    last_measured: "2026-09-20",
    series: [
      { date: "2026-09-06", weight_kg: 82, waist_cm: 95, body_fat_pct: null },
      { date: "2026-09-13", weight_kg: 80.5, waist_cm: 93, body_fat_pct: null },
      { date: "2026-09-20", weight_kg: 79.5, waist_cm: 92, body_fat_pct: null },
    ],
  },
  plan: {
    id: 11, title: "برنامج إنقاص — مرحلة أولى", target_kcal: 1750, target_fiber_g: 28, target_water_ml: null,
    instructions: "اشرب كوب ماء قبل كل وجبة", today_index: 6,
    meals: [
      { id: 1, slot: "الفطور", slot_time: "08:00", title: "شوفان", items: "شوفان بالحليب الخالي + تمرتان", portions: "1 كوب", kcal: 340, fiber_g: 6, day_of_week: null },
      { id: 2, slot: "الغداء", slot_time: "14:00", title: "دجاج", items: "دجاج مشوي + أرز بني", portions: "150غ", kcal: 520, fiber_g: 4, day_of_week: null },
      { id: 3, slot: "العشاء", slot_time: "20:00", title: "سلاطة", items: "سلطة خضراء كبيرة", portions: "طبق", kcal: 180, fiber_g: 8, day_of_week: 0 },
    ],
  },
  habits: {
    targets: { water_ml: 2500, sleep_hours: 7.5, activity_min: 30, custom: false },
    series: [], today: { water_ml: 500, sleep_hours: 7, activity_min: 15, activity_type: "walk", steps: null, note: null },
    summary: { days_logged: 5, logging_rate: 36, avg_water_ml: 2100, avg_sleep_hours: 7, avg_activity_min: 25, avg_steps: null, water_hit_pct: 40, sleep_hit_pct: 80, activity_hit_pct: 60, habit_score: 60, streak: 2, last_log: "2026-09-25" },
  },
  appointments: {
    upcoming: [{ id: 501, date: "2026-10-02", time: "10:00", duration_min: 30, visit_type: "followup", status: "confirmed", mode: "in_person" }],
    past: [{ id: 500, date: "2026-09-20", time: "09:00", visit_type: "initial", status: "completed", mode: "in_person" }],
  },
  waitlist: [], offers: [], call: null,
  activity_types: ["walk", "run", "gym", "cycling", "swim", "sport", "home", "other"],
  now: { date: "2026-09-26", time: "02:00" },
};

const ME_WITH_PLAN_FOR_CODE = ME; // نفس البيانات

const calls = [];
let meState = { ...ME, habits: JSON.parse(JSON.stringify(ME.habits)) };
const config = { branding: { name: "عيادة تجريبية", phone: "+249912345678", address: "الخرطوم", logo: "", banner: "" } };

function makeFetch() {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
    if (url.includes("/portal/branding")) return json(config.branding);
    if (url.includes("/portal/manifest")) return json({ name: config.branding.name });
    if (url.includes("/portal/auth/code")) {
      const ok = meState.patient && init.body && JSON.parse(init.body).file_no === "NC-0009" && JSON.parse(init.body).code === "ABCD-1234";
      if (!ok) return json({ error: "رمز الدخول غير صالح أو أُلغي — اطلب رمزاً جديداً من العيادة" }, 401);
      return json({ token: "PATIENT-TOKEN", patient: meState.patient, clinic: meState.clinic });
    }
    if (url.includes("/portal/auth/qr")) return json({ token: "PATIENT-TOKEN", patient: meState.patient, clinic: meState.clinic });
    if (url.endsWith("/portal/me")) {
      if (!String(init.headers?.Authorization || "").includes("PATIENT-TOKEN")) return json({ error: "جلسة غير صالحة" }, 401);
      return json(meState);
    }
    const m = url.match(/\/portal\/habits\/(\d{4}-\d{2}-\d{2})$/);
    if (m && method === "PUT") {
      const body = init.body ? JSON.parse(init.body) : {};
      const log = {
        water_ml: body.water_ml ?? null, sleep_hours: body.sleep_hours ?? null,
        activity_min: body.activity_min ?? null, activity_type: body.activity_type ?? null,
        steps: null, note: null,
      };
      meState.habits = { ...meState.habits, today: log, summary: { ...meState.habits.summary, streak: 3, days_logged: 6 } };
      return json({ log, summary: meState.habits.summary });
    }
    if (url.includes("/portal/appointments/") && method === "POST") return json({ cancelled: true, waitlist: { offered: false } });
    if (url.endsWith("/portal/waitlist") && method === "POST") return json({ id: 1, status: "waiting" });
    return json({ error: "غير موجود" }, 404);
  };
}

function buildDom(url, { skipWelcome = true } = {}) {
  const dom = new JSDOM(html.replace("<head>", "<head><base href=\"/patient-app/\">"), {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.localStorage.clear();
  if (skipWelcome) w.localStorage.setItem("tg_welcomed", "1");
  w.fetch = makeFetch();
  w.Response = Response;
  w.confirm = () => true;
  w.alert = () => {};
  w.scrollTo = () => {};
  return w;
}

const results = [];
function check(name, cond) {
  results.push({ name, ok: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
}

/* ---------- 1) الدخول بالرمز ---------- */
{
  const w = buildDom("http://localhost/patient-app/");
  w.eval(appJs);
  await new Promise((r) => setTimeout(r, 50));
  check("شاشة الدخول ظاهرة في البداية", !w.document.querySelector("#login-screen").hidden);
  check("اسم العيادة من الإعدادات (نصاً) + عنوان الصفحة",
    w.document.querySelector("#login-name")?.textContent === "عيادة تجريبية" &&
    w.document.title.includes("عيادة تجريبية"));
  const file = w.document.querySelector("#file-input");
  const code = w.document.querySelector("#code-input");
  file.value = "NC-0009";
  code.value = "ABCD1234";
  code.dispatchEvent(new w.Event("input", { bubbles: true }));
  check("تنسيق الرمز تلقائياً (XXXX-XXXX)", code.value === "ABCD-1234");
  w.document.querySelector("#login-btn").dispatchEvent(new w.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 100));
  check("تسجيل دخول ناجح والتطبيق ظاهر", !w.document.querySelector("#app").hidden);
  check("الترويسة تعرض اسم العيادة والمريض",
    w.document.querySelector("#header-clinic").textContent === "عيادة تجريبية" &&
    w.document.querySelector("#header-hello").textContent.includes("هند"));
  check("الوجبات ظهرت (3 وجبات)", w.document.querySelectorAll("#meals-list .meal-card").length === 3);
  check("ملخص البرنامج مع النصيحة", w.document.querySelector("#plan-summary .card")?.textContent.includes("برنامج إنقاص") &&
    w.document.querySelector("#plan-summary .advice") !== null);
  check("تنبيه الحساسية الأحمر", w.document.querySelector("#alert-box .alert-card")?.textContent.includes("لاكتوز"));
  check("هدف الماء يظهر", w.document.querySelector("#water-goal-label").textContent.includes("2,500 مل"));
  check("الماء المسجل اليوم 500", w.document.querySelector("#water-count").textContent.includes("500"));
  check("ملخص العادات (2 أيام متتالية)", w.document.querySelector("#habit-summary")?.textContent.includes("2"));
  check("موعد قادم يظهر", w.document.querySelector("#upcoming-list .appt-card") !== null);
  check("منحنى الوزن مرسوم (SVG)", w.document.querySelector("#progress-box svg polyline") !== null);
  check("التاريخ الطبي (ضغط خفيف)", w.document.querySelector("#history-list .hist-card")?.textContent.includes("ضغط خفيف"));
  check("زر واتساب برقم العيادة", w.document.querySelector("#whatsapp-btn").getAttribute("href").startsWith("https://wa.me/249912345678"));

  /* تسجيل ماء: +500 → 1000 */
  w.document.querySelector('[data-water="500"]').dispatchEvent(new w.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  const put = calls.filter((c) => c.url.includes("/portal/habits/") && c.method === "PUT").at(-1);
  check("تسجيل الماء يُرسل PUT للـ API", put && put.body.water_ml === 1000 && put.auth === "Bearer PATIENT-TOKEN");
  check("الواجهة تحدّث بعد الحفظ", w.document.querySelector("#water-count").textContent.includes("1,000"));

  /* اليوم (السبت = 0) يظهر فيه العشاء + اليوميان؛ يوم الثلاثاء (3) يظهر اليوميان فقط */
  const namesToday = [...w.document.querySelectorAll("#meals-list .meal-name")].map((n) => n.textContent);
  check("وجبات اليوم تتضمن الوجبة الخاصة به", namesToday.some((n) => n.includes("العشاء")));
  w.document.querySelector('.day-btn[data-day="3"]').dispatchEvent(new w.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  check("تصفية وجبات اليوم المحدد", w.document.querySelectorAll("#meals-list .meal-card").length === 2 &&
    ![...w.document.querySelectorAll("#meals-list .meal-name")].some((n) => n.textContent.includes("العشاء")));
}

/* ---------- 1ح) لوجو مخصص من الإعدادات ---------- */
{
  config.branding = { ...config.branding, logo: "images/brand-band.jpg" };
  const w = buildDom("http://localhost/patient-app/");
  w.eval(appJs);
  await new Promise((r) => setTimeout(r, 80));
  check("لوجو مخصص يظهر بدلاً من النص",
    !w.document.querySelector("#login-band").hidden && w.document.querySelector("#login-textbrand").hidden);
  config.branding = { ...config.branding, logo: "" };
}

/* ---------- 1ب) شاشة الترحيب في أول استخدام ---------- */
{
  const w = buildDom("http://localhost/patient-app/", { skipWelcome: false });
  w.eval(appJs);
  await new Promise((r) => setTimeout(r, 50));
  check("أول استخدام: شاشة الترحيب ظاهرة وشاشة الدخول مخفية",
    !w.document.querySelector("#welcome-screen").hidden && w.document.querySelector("#login-screen").hidden);
  w.document.querySelector("#welcome-btn").dispatchEvent(new w.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  check("زر «ابدأ» ينقل لشاشة الدخول", !w.document.querySelector("#login-screen").hidden);
  check("لا تظهر الترحيب مرة ثانية", w.localStorage.getItem("tg_welcomed") === "1");
}

/* ---------- 2) الدخول عبر رابط QR (?t=) ---------- */
{
  // حتى دون علم الترحيب: رابط العيادة يجب أن يدخل التطبيق مباشرة
  const w = buildDom("http://localhost/patient-app/?t=QR-TOKEN-123", { skipWelcome: false });
  w.eval(appJs);
  await new Promise((r) => setTimeout(r, 120));
  check("رابط QR يسجّل الدخول مباشرة (دون شاشة ترحيب)",
    !w.document.querySelector("#app").hidden && w.document.querySelector("#welcome-screen").hidden);
  check("الرابط يُنظّف من العنوان", !w.location.search.includes("t="));
}

/* ---------- 3) جلسة محفوظة ---------- */
{
  const w = buildDom("http://localhost/patient-app/");
  w.localStorage.setItem("pa_token", "PATIENT-TOKEN");
  w.eval(appJs);
  await new Promise((r) => setTimeout(r, 100));
  check("الجلسة المحفوظة تفتح التطبيق مباشرة", !w.document.querySelector("#app").hidden);
}

/* ---------- 4) رمز خاطئ ---------- */
{
  const w = buildDom("http://localhost/patient-app/");
  w.eval(appJs);
  w.document.querySelector("#file-input").value = "NC-9999";
  w.document.querySelector("#code-input").value = "XXXX-9999";
  w.document.querySelector("#login-btn").dispatchEvent(new w.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  check("رمز خاطئ → رسالة خطأ والتطبيق لا يفتح",
    !w.document.querySelector("#login-error").hidden && w.document.querySelector("#app").hidden);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} نجحت` + (failed.length ? ` — ${failed.length} فشلت` : ""));
process.exit(failed.length ? 1 : 0);
