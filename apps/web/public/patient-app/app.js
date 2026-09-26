/* تطبيق المريض — PWA مرتبط بنظام العيادة (نفس قاعدة البيانات) */
"use strict";

const $ = (s) => document.querySelector(s);

const API = "/api";
const TOKEN_KEY = "pa_token";
const DAY_NAMES = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"]; // 0 = السبت (بنفس منطق النظام)
const ACTIVITY_LABELS = { walk: "مشي", run: "جري", gym: "جيم", cycling: "دراجة", swim: "سباحة", sport: "رياضة", home: "منزل", other: "أخرى" };
const SLOT_EMOJI = { "الفطور": "🌅", "سناك صباحي": "🍎", "الغداء": "🍲", "سناك عصري": "🥜", "العشاء": "🌙" };
const VISIT_TYPE_LABELS = { initial: "أول زيارة", followup: "متابعة", consult: "استشارة", plan_update: "تحديث البرنامج", lab_review: "مراجعة تحاليل" };
const TIME_PREF_LABELS = { any: "أي وقت", morning: "صباحاً", afternoon: "بعد الظهر", evening: "مساءً" };

const state = {
  token: null,
  me: null,
  weekSel: null,        // فهرس اليوم المختار (0=السبت)
  habitsCache: null,    // آخر تسجيل يومي من الخادم
  installEvt: null,
};

/* ================= API ================= */
async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new Error("لا يوجد اتصال بالإنترنت — تحقق من الشبكة وحاول مجدداً");
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* تجاهل */ }
  if (!res.ok) {
    if (res.status === 401 && auth) throw new Error("SESSION");
    throw new Error((data && data.error) || `حدث خطأ (${res.status})`);
  }
  return data;
}

function sessionExpired() {
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
}

/* ================= تواريخ ================= */
const parseISO = (iso) => new Date(`${iso}T12:00:00Z`);
const fmtDate = (iso, opts) => parseISO(iso).toLocaleDateString("ar", opts || { weekday: "long", day: "numeric", month: "long" });
const fmtShort = (iso) => parseISO(iso).toLocaleDateString("ar", { day: "numeric", month: "short" });
const addDays = (iso, n) => { const d = parseISO(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayIndexOf = (iso) => (parseISO(iso).getUTCDay() + 1) % 7; // 0=السبت

/* ================= الدخول ================= */
function extractTokenFromUrl(text) {
  try {
    const u = new URL(text.trim());
    const t = u.searchParams.get("t") || "";
    if (t) return t;
    const h = u.hash.split("?")[1] || "";
    const m = h.match(/[?&]t=([\w-]+)/);
    if (m) return m[1];
  } catch (e) { /* ليس رابطاً */ }
  return null;
}

async function doLogin(body) {
  const path = body.token ? "/portal/auth/qr" : "/portal/auth/code";
  const d = await api(path, { method: "POST", body, auth: false });
  state.token = d.token;
  localStorage.setItem(TOKEN_KEY, d.token);
  state.me = await api("/portal/me");
  enterApp();
}

function bindLogin() {
  const err = $("#login-error");
  const fileInput = $("#file-input");
  const codeInput = $("#code-input");
  const linkBox = $("#link-box");
  const linkInput = $("#link-input");

  codeInput.addEventListener("input", () => {
    // تنسيق تلقائي XXXX-XXXX
    let v = codeInput.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8);
    codeInput.value = v.length > 4 ? v.slice(0, 4) + "-" + v.slice(4) : v;
  });
  fileInput.addEventListener("input", () => { fileInput.value = fileInput.value.toUpperCase(); });

  $("#paste-link-btn").addEventListener("click", () => { linkBox.hidden = !linkBox.hidden; });

  async function submit() {
    const fileNo = fileInput.value.trim();
    const code = codeInput.value.trim();
    const link = linkInput.value.trim();
    if (link) {
      const t = extractTokenFromUrl(link);
      if (t) { showErr(""); return doLogin({ token: t }).catch((e) => showErr(e.message)); }
      return showErr("لم أجد رمزاً في الرابط — تأكد أنه الرابط الذي أرسلته العيادة");
    }
    if (!fileNo || !code) return showErr("أدخل رقم الملف والرمز");
    err.hidden = true;
    $("#login-btn").disabled = true;
    try { await doLogin({ file_no: fileNo, code }); }
    catch (e) { showErr(e.message); }
    finally { $("#login-btn").disabled = false; }
  }
  function showErr(msg) { err.textContent = msg; err.hidden = !msg; }

  $("#login-btn").addEventListener("click", submit);
  [fileInput, codeInput, linkInput].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }));
}

async function boot() {
  bindLogin();
  bindTabs();
  bindSettings();
  bindTodayControls();
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installEvt = e; updateInstallBtns(); });

  // 1) رابط QR/واتساب من العيادة
  const t = new URLSearchParams(location.search).get("t");
  if (t) {
    try { await doLogin({ token: t }); history.replaceState(null, "", location.pathname); return; }
    catch (e) { /* ننتقل للدخول اليدوي مع رسالة */ showLoginHint("تعذر الدخول بالرابط — أدخل رقم الملف والرمز"); }
  }
  // 2) جلسة محفوظة
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) {
    state.token = saved;
    try { state.me = await api("/portal/me"); return enterApp(); }
    catch (e) { localStorage.removeItem(TOKEN_KEY); }
  }
}

function showLoginHint(msg) {
  const err = $("#login-error");
  err.textContent = msg;
  err.hidden = false;
}

function enterApp() {
  const m = state.me;
  $("#login-screen").hidden = true;
  $("#app").hidden = false;
  $("#header-clinic").textContent = m.clinic.name;
  $("#header-hello").textContent = `مرحباً، ${m.patient.first_name} 👋`;
  state.weekSel = dayIndexOf(m.now.date);
  renderProgram();
  renderToday();
  renderAppts();
  renderProgress();
  renderProfile();
  updateInstallBtns();
}

/* ================= التبويبات ================= */
function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      document.querySelectorAll(".tab").forEach((t) => (t.hidden = true));
      $(`#tab-${b.dataset.tab}`).hidden = false;
    });
  });
}

/* ================= البرنامج ================= */
function renderProgram() {
  const m = state.me;
  const p = m.patient;

  /* تنبيه الحساسية/المحظورات */
  const alerts = [];
  if (p.allergies) alerts.push(`حساسية: ${p.allergies}`);
  if (p.forbidden_foods) alerts.push(`محظورات: ${p.forbidden_foods}`);
  if (p.medications) alerts.push(`أدوية: ${p.medications}`);
  $("#alert-box").innerHTML = alerts.length
    ? `<div class="alert-card">⚠️ ${alerts.join(" · ")}</div>`
    : "";

  /* ملخص البرنامج */
  const plan = m.plan;
  if (plan) {
    const macro = [
      plan.target_protein_g != null && `بروتين ${Math.round(plan.target_protein_g)} جم`,
      plan.target_carbs_g != null && `كربوهيدرات ${Math.round(plan.target_carbs_g)} جم`,
      plan.target_fat_g != null && `دهون ${Math.round(plan.target_fat_g)} جم`,
    ].filter(Boolean).join(" · ");
    $("#plan-summary").innerHTML = `
      <div class="card">
        <div class="card-head"><span class="card-title">🍽️ ${plan.title}</span></div>
        <p class="muted small">${fmtShort(plan.start_date || m.now.date)} ← ${fmtShort(plan.end_date || m.now.date)}
          ${plan.target_kcal ? ` · ${Math.round(plan.target_kcal)} سعرة/يوم` : ""}</p>
        ${macro ? `<p class="muted small" style="margin-top:4px">${macro}${plan.target_fiber_g ? ` · ألياف ${plan.target_fiber_g} جم` : ""}</p>` : ""}
        ${plan.instructions ? `<p class="advice">💡 ${plan.instructions}</p>` : ""}
      </div>`;
  } else {
    $("#plan-summary").innerHTML = `<div class="card empty-note">لا يوجد برنامج غذائي نشط حالياً.<br>سيظهر هنا فور تفعيله من العيادة.</div>`;
  }

  /* منتقي أيام الأسبوع (أسبوع يبدأ بالسبت) */
  const todayISO = m.now.date;
  const weekStart = addDays(todayISO, -dayIndexOf(todayISO));
  let wp = "";
  for (let d = 0; d < 7; d++) {
    const iso = addDays(weekStart, d);
    wp += `<button class="day-btn ${d === state.weekSel ? "active" : ""} ${iso === todayISO ? "today" : ""}" data-day="${d}">
      <span class="d-name">${DAY_NAMES[d]}</span><span class="d-date">${fmtShort(iso)}</span></button>`;
  }
  $("#week-picker").innerHTML = wp;
  $("#week-picker").querySelectorAll(".day-btn").forEach((b) =>
    b.addEventListener("click", () => { state.weekSel = Number(b.dataset.day); renderProgram(); }));

  /* الوجبات */
  const sel = state.weekSel;
  const todayIdx = dayIndexOf(todayISO);
  $("#meals-title").textContent = sel === todayIdx ? "وجبات اليوم" : `وجبات ${DAY_NAMES[sel]}`;
  if (!plan) { $("#meals-list").innerHTML = ""; return; }
  const meals = plan.meals.filter((x) => x.day_of_week == null || x.day_of_week === sel);
  if (!meals.length) {
    $("#meals-list").innerHTML = `<div class="card empty-note">لا توجد وجبات مخصصة لهذا اليوم في البرنامج.</div>`;
    return;
  }
  $("#meals-list").innerHTML = meals.map((x) => `
    <div class="meal-card">
      <div class="meal-emoji">${SLOT_EMOJI[x.slot] || "🍽️"}</div>
      <div class="meal-info">
        <div class="meal-head"><span class="meal-name">${x.slot}${x.title && x.title !== x.items ? ` — ${x.title}` : ""}</span>
          <span class="meal-time">${x.slot_time || ""}</span></div>
        ${x.items ? `<ul class="meal-items"><li>${x.items}</li></ul>` : ""}
        ${x.portions ? `<p class="meal-portions"> ${x.portions}</p>` : ""}
        <div class="meal-macros">${x.kcal ? `<span>🔥 ${Math.round(x.kcal)} سعرة</span>` : ""}${x.fiber_g ? `<span>🌾 ${x.fiber_g} جم ألياف</span>` : ""}</div>
      </div>
    </div>`).join("");
}

/* ================= اليوم (العادات) ================= */
function targets() {
  const m = state.me;
  const t = m.habits.targets;
  return {
    water: t.water_ml ?? m.plan?.target_water_ml ?? 2000,
    sleep: t.sleep_hours ?? 7.5,
    activity: t.activity_min ?? 30,
  };
}

function curHabit() {
  return state.habitsCache ?? state.me.habits.today ?? {};
}

function saveHabit(patch) {
  if (!state.me) return;
  const body = { ...curHabit(), ...patch };
  flashSave("جارٍ الحفظ…");
  api(`/portal/habits/${state.me.now.date}`, { method: "PUT", body })
    .then((d) => {
      state.habitsCache = d.log;
      state.me.habits = { ...state.me.habits, today: d.log, summary: d.summary };
      renderToday();
      flashSave("✓ تم الحفظ في ملفك");
    })
    .catch((e) => {
      if (e.message === "SESSION") return sessionExpired();
      flashSave("⚠️ " + e.message);
    });
}

function flashSave(msg) {
  const el = $("#save-flash");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), 2200);
}

function bindTodayControls() {
  document.querySelectorAll("[data-water]").forEach((b) =>
    b.addEventListener("click", () => {
      const v = b.dataset.water;
      const cur = curHabit().water_ml ?? 0;
      if (v === "done") return saveHabit({ water_ml: Math.max(cur, targets().water) });
      saveHabit({ water_ml: Math.max(0, cur + Number(v)) });
    }));
  document.querySelectorAll("[data-activity]").forEach((b) =>
    b.addEventListener("click", () => {
      const cur = curHabit().activity_min ?? 0;
      saveHabit({ activity_min: Math.max(0, cur + Number(b.dataset.activity)) });
    }));
  document.querySelectorAll("[data-sleep]").forEach((b) =>
    b.addEventListener("click", () => {
      const cur = curHabit().sleep_hours ?? 0;
      saveHabit({ sleep_hours: Math.max(0, Math.min(24, Math.round((cur + Number(b.dataset.sleep)) * 2) / 2)) });
    }));
  // أنواع النشاط — تُبنى عند العرض
}

function renderToday() {
  const m = state.me;
  const h = curHabit();
  const t = targets();

  $("#water-count").textContent = `${(h.water_ml ?? 0).toLocaleString("ar")} / ${t.water.toLocaleString("ar")} مل`;
  $("#water-bar").style.width = Math.min(100, ((h.water_ml ?? 0) / t.water) * 100) + "%";
  $("#water-goal-label").textContent = `هدفك: ${t.water.toLocaleString("ar")} مل يومياً (${Math.round(t.water / 250)} أكواب)`;

  $("#activity-count").textContent = `${h.activity_min ?? 0} / ${t.activity} دقيقة`;
  $("#activity-goal-label").textContent = `هدفك: ${t.activity} دقائق نشاط يومياً${h.activity_type ? " · " + (ACTIVITY_LABELS[h.activity_type] || "") : ""}`;
  const chips = document.createElement("div");
  chips.innerHTML = (m.activity_types || []).map((k) =>
    `<button class="chip ${h.activity_type === k ? "active" : ""}" data-type="${k}">${ACTIVITY_LABELS[k] || k}</button>`).join("");
  $("#activity-types").innerHTML = "";
  $("#activity-types").appendChild(chips);
  chips.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => saveHabit({ activity_type: c.dataset.type })));

  $("#sleep-count").textContent = `${h.sleep_hours ?? "—"} ساعة`;
  $("#sleep-goal-label").textContent = `الهدف: ${t.sleep} ساعات`;

  const s = m.habits.summary;
  const cell = (label, val, good) =>
    `<div class="sum-cell"><div class="sum-val ${good ? "good" : ""}">${val}</div><div class="sum-lbl">${label}</div></div>`;
  $("#habit-summary").innerHTML =
    cell("أيام متتالية 🔥", s.streak ?? 0) +
    cell("أيام مسجّلة", `${s.days_logged ?? 0} من 14`) +
    cell("بلوغ هدف الماء", s.water_hit_pct != null ? s.water_hit_pct + "%" : "—", s.water_hit_pct >= 70) +
    cell("بلوغ هدف النشاط", s.activity_hit_pct != null ? s.activity_hit_pct + "%" : "—", s.activity_hit_pct >= 70) +
    cell("متوسط الماء", s.avg_water_ml ? `${Math.round(s.avg_water_ml / 100) / 10} لتر` : "—") +
    cell("درجة العادات", s.habit_score != null ? `${s.habit_score}٪` : "—", s.habit_score >= 70);
}

/* ================= المواعيد ================= */
function renderAppts() {
  const m = state.me;
  const up = m.appointments.upcoming;
  $("#upcoming-list").innerHTML = up.length
    ? up.map((a) => `
      <div class="appt-card">
        <div class="appt-date"><span class="appt-day">${fmtDate(a.date, { day: "numeric", month: "short" })}</span>
          <span class="appt-time">${a.time} ${a.mode === "video" ? "📹" : "📍"}</span></div>
        <div class="appt-info">
          <div class="appt-type">${VISIT_TYPE_LABELS[a.visit_type] || a.visit_type}</div>
          <div class="muted small">${a.mode === "video" ? "استشارة فيديو" : "حضورياً"} · ${fmtDate(a.date)}</div>
          <button class="btn-cancel" data-id="${a.id}">إلغاء الموعد</button>
        </div>
      </div>`).join("")
    : `<div class="card empty-note">لا مواعيد قادمة — يمكنك طلب موعد من قائمة الانتظار بالأسفل.</div>`;
  $("#upcoming-list").querySelectorAll(".btn-cancel").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("هل تريد إلغاء هذا الموعد؟")) return;
      try {
        const r = await api(`/portal/appointments/${b.dataset.id}/cancel`, { method: "POST", body: {} });
        if (r.waitlist && r.waitlist.offered) alert("تم الإلغاء ✓ وسيتم عرض موعدك على قائمة الانتظار");
        state.me = await api("/portal/me");
        renderAppts();
      } catch (e) { if (e.message !== "SESSION") alert(e.message); }
    }));

  /* قائمة الانتظار */
  const wl = (m.waitlist || [])[0];
  if (wl) {
    $("#waitlist-box").innerHTML = `
      <div class="card">
        <div class="card-head"><span class="card-title">طلبك الحالي</span></div>
        <p class="muted small">من ${fmtShort(wl.date_from)} · ${TIME_PREF_LABELS[wl.time_pref] || ""} · ${VISIT_TYPE_LABELS[wl.visit_type] || ""}${wl.status === "booked" ? " · ✓ حُجز موعد" : ""}</p>
        ${wl.status === "waiting" ? `<button class="btn-cancel" id="wl-cancel">سحب الطلب</button>` : ""}
      </div>`;
    const cb = $("#wl-cancel");
    if (cb) cb.addEventListener("click", async () => {
      if (!confirm("سحب طلب قائمة الانتظار؟")) return;
      try {
        await api(`/portal/waitlist/${wl.id}`, { method: "DELETE" });
        state.me = await api("/portal/me");
        renderAppts();
      } catch (e) { if (e.message !== "SESSION") alert(e.message); }
    });
  } else {
    $("#waitlist-box").innerHTML = `
      <div class="card">
        <div class="card-head"><span class="card-title">اطلب موعداً (قائمة الانتظار)</span></div>
        <p class="muted small">حدد المرونة المناسبة وسيقوم فريق العيادة باختيار أفضل وقت متاح.</p>
        <div class="wl-form">
          <label>من تاريخ <input type="date" id="wl-from" value="${m.now.date}"></label>
          <label>عدد الأيام <select id="wl-days"><option>1</option><option selected>3</option><option>7</option></select></label>
          <label>التوقيت <select id="wl-pref"><option value="any">أي وقت</option><option value="morning">صباحاً</option><option value="afternoon">بعد الظهر</option><option value="evening">مساءً</option></select></label>
          <label>نوع الزيارة <select id="wl-type"><option value="followup">متابعة</option><option value="consult">استشارة</option><option value="initial">أول زيارة</option></select></label>
          <label>الطريقة <select id="wl-mode"><option value="in_person">حضورياً</option><option value="video">فيديو</option></select></label>
          <button class="btn-primary" id="wl-add" style="width:100%">إرسال الطلب</button>
        </div>
      </div>`;
    $("#wl-add").addEventListener("click", async () => {
      try {
        await api("/portal/waitlist", {
          method: "POST",
          body: { date_from: $("#wl-from").value, days: Number($("#wl-days").value), time_pref: $("#wl-pref").value, visit_type: $("#wl-type").value, mode: $("#wl-mode").value },
        });
        state.me = await api("/portal/me");
        renderAppts();
      } catch (e) { if (e.message !== "SESSION") alert(e.message); }
    });
  }

  const past = (m.appointments.past || []).slice(0, 6);
  $("#past-list").innerHTML = past.length
    ? past.map((a) => `<div class="past-row"><span>${fmtShort(a.date)}</span><span>${a.time}</span><span class="past-status s-${a.status}">${statusLabel(a.status)}</span></div>`).join("")
    : `<div class="card empty-note">لا زيارات سابقة.</div>`;
}
function statusLabel(s) {
  return { completed: "تم", cancelled: "ملغي", no_show: "لم يحضر", scheduled: "مجدول", confirmed: "مؤكد" }[s] || s;
}

/* ================= تقدمي ================= */
function renderProgress() {
  const m = state.me;
  const pr = m.progress;
  const start = pr.start_weight, cur = pr.current_weight, goal = pr.goal_weight;
  const lost = start != null && cur != null ? Math.max(0, Math.round((start - cur) * 10) / 10) : null;
  const remain = goal != null && cur != null ? Math.max(0, Math.round((cur - goal) * 10) / 10) : null;
  const pct = start != null && goal != null && goal < start ? Math.min(100, Math.max(0, ((start - cur) / (start - goal)) * 100)) : null;

  let html = `
    <div class="card">
      <div class="progress-big">
        <div class="pb-num"><b>${cur != null ? cur : "—"}</b><span>كجم الآن</span></div>
        <div class="pb-arrow">←</div>
        <div class="pb-num goal"><b>${goal != null ? goal : "—"}</b><span>الهدف</span></div>
      </div>
      ${pct != null ? `<div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
      <p class="muted small" style="text-align:center">${Math.round(pct)}٪ من الطريق${lost ? ` · خسيت ${lost} كجم` : ""}${remain ? ` · باقي ${remain} كجم` : ""}</p>` : ""}
    </div>`;

  const series = (pr.series || []).filter((s) => s.weight_kg != null);
  if (series.length >= 2) {
    html += `<div class="card"><span class="card-title">منحنى الوزن</span>${weightChart(series, goal)}</div>`;
  }

  html += `<div class="card">
    <div class="macro-grid">
      <div class="m-cell"><div class="m-val">${pr.bmi != null ? pr.bmi : "—"}</div><div class="m-lbl">مؤشر كتلة الجسم</div></div>
      <div class="m-cell"><div class="m-val">${pr.bmi_category || "—"}</div><div class="m-lbl">التصنيف</div></div>
      <div class="m-cell"><div class="m-val">${pr.last_measured ? fmtShort(pr.last_measured) : "—"}</div><div class="m-lbl">آخر قياس</div></div>
    </div>
  </div>`;
  $("#progress-box").innerHTML = html;
}

function weightChart(series, goal) {
  const vals = series.map((s) => s.weight_kg);
  const all = goal != null ? vals.concat([goal]) : vals;
  const min = Math.min(...all), max = Math.max(...all);
  const W = 330, H = 150, P = 30;
  const span = max - min || 1;
  const x = (i) => P + (i * (W - 2 * P)) / (vals.length - 1);
  const y = (v) => H - P - ((v - min) * (H - 2 * P)) / span;
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  let circles = "";
  series.forEach((s, i) => {
    circles += `<circle cx="${x(i).toFixed(1)}" cy="${y(s.weight_kg).toFixed(1)}" r="${i === 0 || i === vals.length - 1 ? 4 : 2.5}" fill="${i === vals.length - 1 ? "#0e7c66" : "#7fb8a9"}"/>`;
  });
  const goalLine = goal != null
    ? `<line x1="${P}" y1="${y(goal).toFixed(1)}" x2="${W - P}" y2="${y(goal).toFixed(1)}" stroke="#d9a441" stroke-dasharray="5 4" stroke-width="1.5"/>
       <text x="${W - P}" y="${(y(goal) - 6).toFixed(1)}" text-anchor="end" font-size="10" fill="#a07c22">الهدف ${goal}</text>`
    : "";
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="منحنى الوزن">
    <text x="${P}" y="${H - 8}" font-size="10" fill="#8aa39c">${fmtShort(series[0].date)}</text>
    <text x="${W - P}" y="${H - 8}" font-size="10" fill="#8aa39c" text-anchor="end">${fmtShort(series[vals.length - 1].date)}</text>
    <text x="${P}" y="${y(max) - 8}" font-size="10" fill="#8aa39c">${max}</text>
    ${goalLine}
    <polyline points="${pts}" fill="none" stroke="#0e7c66" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${circles}
  </svg>`;
}

/* ================= ملفي ================= */
function renderProfile() {
  const m = state.me;
  const p = m.patient;
  $("#profile-card").innerHTML = `
    <div class="profile-row"><span class="pr-ico"></span><div><div class="pr-name">${p.first_name} ${p.last_name}</div>
    <div class="muted small">${p.gender === "female" ? "أنثى" : "ذكر"}${p.birth_date ? " · " + fmtShort(p.birth_date) : ""}</div></div></div>
    <div class="profile-row"><span class="pr-ico">🗂️</span><div><div>رقم الملف</div><div class="muted small">${p.file_no}</div></div></div>
    ${p.phone ? `<div class="profile-row"><span class="pr-ico">📱</span><div><div>رقمك المسجل</div><div class="muted small">${p.phone}</div></div></div>` : ""}`;

  const rows = [
    ["🩺", "أمراض مزمنة", p.chronic_conditions],
    ["🥜", "حساسية غذائية", p.allergies],
    ["💊", "أدوية", p.medications],
    ["🚫", "أطعمة محظورة", p.forbidden_foods],
    ["🩸", "فصيلة الدم", p.blood_type],
  ].filter((r) => r[2]);
  $("#history-list").innerHTML = rows.length
    ? rows.map((r) => `<div class="hist-card"><span class="hist-type">${r[0]} ${r[1]}</span><span class="hist-val">${r[2]}</span></div>`).join("")
    : `<div class="card empty-note">لا بيانات مسجلة — تُدخلها العيادة في ملفك.</div>`;

  const c = m.clinic;
  $("#clinic-info").textContent = `${c.name}${c.address ? " — " + c.address : ""}`;
  const phoneDigits = (c.phone || "").replace(/[^\d+]/g, "");
  const waNum = phoneDigits.startsWith("+") ? phoneDigits.slice(1) : (c.phone ? "249" + phoneDigits.replace(/^0+/, "") : "");
  const waText = encodeURIComponent(`مرحباً، أنا ${p.first_name} ${p.last_name} (الملف ${p.file_no}). `);
  $("#whatsapp-btn").href = waNum ? `https://wa.me/${waNum}?text=${waText}` : "#";
  $("#phone-btn").href = `tel:${phoneDigits}`;
}

/* ================= الخيارات ================= */
function updateInstallBtns() {
  const show = !!state.installEvt;
  ["#install-btn", "#sheet-install"].forEach((s) => ($(s).style.display = show ? "block" : "none"));
}
async function promptInstall() {
  if (!state.installEvt) return;
  state.installEvt.prompt();
  await state.installEvt.userChoice;
  state.installEvt = null;
  updateInstallBtns();
  $("#settings-overlay").hidden = true;
}
function doLogout() {
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
}
function bindSettings() {
  $("#settings-btn").addEventListener("click", () => {
    const p = state.me?.patient;
    if (p) $("#sheet-patient-name").textContent = `${p.first_name} ${p.last_name} — الملف ${p.file_no}`;
    $("#settings-overlay").hidden = false;
  });
  $("#close-sheet").addEventListener("click", () => ($("#settings-overlay").hidden = true));
  $("#settings-overlay").addEventListener("click", (e) => { if (e.target.id === "settings-overlay") $("#settings-overlay").hidden = true; });
  $("#sheet-install").addEventListener("click", promptInstall);
  $("#sheet-logout").addEventListener("click", doLogout);
  $("#install-btn").addEventListener("click", promptInstall);
  $("#logout-btn").addEventListener("click", doLogout);
}

/* ================= Worker ================= */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

boot();
