import { BUSINESS_STORES, all, applyRemoteOperations, exportSnapshot, getSetting, put, remove, seedIfEmpty } from "./db.js";
import { addDays, dateKey, expandLessons, latestProgress, pace, remainingLessons, weekdayOf } from "./engine.js";
import { appendOperations, configuredSpreadsheetId, connectGoogle, disconnectGoogle, extractSpreadsheetId, googleRemoteConfigured, isGoogleConnected, pullOperations } from "./remote.js";

const state = { classes: [], subjects: [], materials: [], periods: [], scheduleVersions: [], events: [], exceptions: [], records: [], targets: [], lessons: [], selectedDate: dateKey() };
const weekdays = ["", "一", "二", "三", "四", "五", "六", "日"];
const $ = (selector) => document.querySelector(selector);
const byId = (items, id) => items.find((item) => item.id === id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
let syncing = false;
let toastTimer;

async function load({ seed = true } = {}) {
  if (seed) await seedIfEmpty();
  [state.classes, state.subjects, state.materials, state.periods, state.scheduleVersions, state.events, state.exceptions, state.records, state.targets] = await Promise.all([
    all("classes"), all("subjects"), all("materials"), all("periods"), all("scheduleVersions"), all("calendarEvents"), all("exceptions"), all("records"), all("examTargets")
  ]);
  const start = state.scheduleVersions.map((item) => item.effectiveFrom).sort()[0] || state.selectedDate;
  const end = state.scheduleVersions.map((item) => item.effectiveTo).filter(Boolean).sort().at(-1) || state.selectedDate;
  state.lessons = expandLessons({ startDate: start, endDate: end, scheduleVersions: state.scheduleVersions, events: state.events, exceptions: state.exceptions });
  renderAll();
}

function showToast(message, icon = "✓") {
  $("#toast-icon").textContent = icon;
  $("#toast-message").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2400);
}

function setConnectionStatus(message) {
  $("#connection-state").textContent = message;
  $("#cloud-detail").textContent = message;
}

async function queueEntity(entityType, entity, operation = "upsert") {
  const createdAt = entity.updatedAt || new Date().toISOString();
  await put("syncQueue", { id: crypto.randomUUID(), entityType, entityId: entity.id, operation, payload: operation === "delete" ? null : entity, createdAt, status: "pending" });
}

function queueToOperation(item) {
  return { operationId: item.id, entityType: item.entityType, entityId: item.entityId, operation: item.operation, updatedAt: item.createdAt, payload: item.payload };
}

async function selectedSpreadsheetId() {
  return extractSpreadsheetId($("#spreadsheet-id").value || await getSetting("google-spreadsheet-id") || configuredSpreadsheetId());
}

async function syncGoogleSheet() {
  if (syncing || !navigator.onLine || !isGoogleConnected()) return;
  const spreadsheetId = await selectedSpreadsheetId();
  if (!spreadsheetId) return setConnectionStatus("請先填入 Google Sheet 網址");
  syncing = true;
  setConnectionStatus("同步中…");
  try {
    await put("settings", { id: "google-spreadsheet-id", value: spreadsheetId });
    const remoteOperations = await pullOperations(spreadsheetId);
    const queued = await all("syncQueue");
    const pendingOperations = queued.map(queueToOperation);
    if (!remoteOperations.length) {
      const snapshot = await exportSnapshot();
      const pendingKeys = new Set(pendingOperations.map((item) => `${item.entityType}:${item.entityId}`));
      const timestamp = new Date().toISOString();
      for (const store of BUSINESS_STORES) {
        for (const entity of snapshot[store]) {
          if (!pendingKeys.has(`${store}:${entity.id}`)) pendingOperations.push({ operationId: crypto.randomUUID(), entityType: store, entityId: entity.id, operation: "upsert", updatedAt: entity.updatedAt || timestamp, payload: entity });
        }
      }
    }
    await appendOperations(spreadsheetId, pendingOperations);
    for (const item of queued) await remove("syncQueue", item.id);
    await applyRemoteOperations([...remoteOperations, ...pendingOperations]);
    await load({ seed: false });
    setConnectionStatus("雲端已同步");
  } catch (error) {
    console.error(error);
    if (error.status === 401) setConnectionStatus("授權已到期");
    else if (error.status === 403) setConnectionStatus("Sheet 無存取權");
    else if (error.status === 404) setConnectionStatus("找不到 Sheet");
    else setConnectionStatus("同步失敗");
  } finally {
    syncing = false;
  }
}

function progressFor(classId) {
  return latestProgress(state.records.filter((record) => record.classId === classId));
}

function targetFor(classId) {
  return state.targets.find((target) => target.classId === classId) || state.targets[0];
}

function dateForWeekday(weekday) {
  const today = dateKey();
  return addDays(today, weekday - weekdayOf(today));
}

function formatHeaderDate(key) {
  const date = new Date(`${key}T12:00:00+08:00`);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 週${weekdays[weekdayOf(key)]}`;
}

function isNextLesson(lesson, dayLessons) {
  if (state.selectedDate !== dateKey()) return false;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const currentMinute = Number(time.replace(":", ""));
  const next = dayLessons.find((item) => Number(byId(state.periods, item.periodId)?.end?.replace(":", "") || 0) >= currentMinute);
  return next?.id === lesson.id;
}

function paceClass(value) {
  if (value === null || value > 4.5) return "pace-rose";
  if (value > 3) return "pace-amber";
  return "pace-green";
}

function renderToday() {
  const selectedWeekday = weekdayOf(state.selectedDate);
  $("#day-switcher-buttons").innerHTML = [1, 2, 3, 4, 5].map((weekday) => `<button class="day-button ${selectedWeekday === weekday ? "active" : ""}" data-weekday="${weekday}" type="button">週${weekdays[weekday]}</button>`).join("");
  $("#day-switcher-buttons").querySelectorAll(".day-button").forEach((button) => button.addEventListener("click", () => { state.selectedDate = dateForWeekday(Number(button.dataset.weekday)); renderAll(); }));
  const lessons = state.lessons.filter((lesson) => lesson.date === state.selectedDate && lesson.status === "scheduled");
  $("#header-date").textContent = formatHeaderDate(state.selectedDate);
  $("#today-list-title").textContent = `週${weekdays[selectedWeekday]}授課清單`;
  const container = $("#today-lessons");
  if (!lessons.length) {
    container.innerHTML = `<article class="tf-card empty-card"><span>☕</span><strong>本日沒有安排課堂</strong><p>好好備課、批改作業或休息一下！</p></article>`;
    return;
  }
  container.innerHTML = lessons.map((lesson) => {
    const klass = byId(state.classes, lesson.classId);
    const subject = byId(state.subjects, lesson.subjectId);
    const period = byId(state.periods, lesson.periodId);
    const record = state.records.find((item) => item.lessonId === lesson.id) || progressFor(lesson.classId);
    const target = targetFor(lesson.classId);
    const remaining = target ? remainingLessons(state.lessons, { classId: lesson.classId, subjectId: lesson.subjectId, cutoffDate: target.cutoffDate, fromDate: dateKey() }) : [];
    const result = target ? pace({ targetPage: target.targetPage, completedPage: record?.page || 0, remainingCount: remaining.length }) : { perLesson: null };
    const next = isNextLesson(lesson, lessons);
    return `<article class="tf-card lesson-card ${next ? "is-next" : ""}" data-lesson-id="${escapeHtml(lesson.id)}">
      ${lesson.source === "exception" || lesson.source === "added" ? '<span class="swap-tag">臨時調課</span>' : next ? '<span class="next-tag">當前／下一節</span>' : ""}
      <div class="lesson-heading"><div class="lesson-identity"><span class="period-pill">第 ${escapeHtml(period?.order || "—")} 節</span><span class="lesson-class">${escapeHtml(klass?.name)}</span><span class="lesson-subject">${escapeHtml(subject?.name)}</span></div><span class="pace-badge ${paceClass(result.perLesson)}">配速 ${result.perLesson === null ? "—" : result.perLesson.toFixed(1)} 頁／堂</span></div>
      <input class="chapter-input" data-field="chapter" value="${escapeHtml(record?.chapter || "")}" placeholder="點擊輸入當前進度單元／章節…">
      <div class="stepper-box"><div><span class="stepper-label">目前課本進度</span><div class="page-line"><span>P.</span><input class="page-input" data-field="page" type="number" min="0" value="${Number(record?.page || 0)}"><small>/ 目標 P.${Number(target?.targetPage || 0)}</small></div></div><div class="stepper-actions"><button class="step-button minus" data-step="-1" type="button">−</button><button class="step-button plus-one" data-step="1" type="button">+1</button><button class="step-button plus-two" data-step="2" type="button">+2</button></div></div>
      <input class="memo-input" data-field="memo" value="${escapeHtml(record?.memo || "")}" placeholder="下節備忘（如：抽查學習單、第 3 題待解）…">
    </article>`;
  }).join("");
  container.querySelectorAll(".lesson-card").forEach((card) => {
    const lessonId = card.dataset.lessonId;
    card.querySelectorAll("[data-field]").forEach((input) => input.addEventListener("change", () => saveInlineRecord(lessonId, { [input.dataset.field]: input.value })));
    card.querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", () => {
      const input = card.querySelector("[data-field='page']");
      input.value = Math.max(0, Number(input.value || 0) + Number(button.dataset.step));
      saveInlineRecord(lessonId, { page: input.value });
    }));
  });
}

function renderPace() {
  const firstTarget = state.targets[0];
  $("#exam-title").textContent = firstTarget?.title || "段考目標";
  $("#exam-date-label").textContent = firstTarget?.cutoffDate || "—";
  $("#exam-target-label").textContent = firstTarget?.targetPage || "—";
  const days = firstTarget ? Math.max(0, Math.ceil((new Date(`${firstTarget.cutoffDate}T12:00:00+08:00`) - new Date(`${dateKey()}T12:00:00+08:00`)) / 86400000)) : 0;
  $("#exam-days-label").textContent = days;
  $("#pace-list").innerHTML = state.targets.map((target) => {
    const klass = byId(state.classes, target.classId);
    const progress = progressFor(target.classId);
    const remaining = remainingLessons(state.lessons, { classId: target.classId, subjectId: target.subjectId, cutoffDate: target.cutoffDate, fromDate: dateKey() });
    const result = pace({ targetPage: target.targetPage, completedPage: progress?.page || 0, remainingCount: remaining.length });
    const percent = Math.min(100, Math.round(((progress?.page || 0) / target.targetPage) * 100));
    return `<article class="tf-card"><div class="pace-card-heading"><div><span class="period-pill">${escapeHtml(klass?.name)}</span><p>${escapeHtml(progress?.chapter || "尚未輸入單元")}</p></div><span class="pace-badge ${paceClass(result.perLesson)}">每堂需 ${result.perLesson === null ? "—" : result.perLesson.toFixed(1)} 頁</span></div><div class="progress-row"><span>進度 P.${progress?.page || 0}（${percent}%）</span><span>尚差 ${result.remainingPages} 頁</span></div><div class="progress-track"><div class="progress-bar" style="width:${percent}%"></div></div><div class="pace-footer"><span>考前實質尚有：<strong>${remaining.length} 堂</strong></span><span>備忘：${escapeHtml(progress?.memo || "無")}</span></div></article>`;
  }).join("");
}

function renderSchedule() {
  const version = state.scheduleVersions[0];
  let html = `<div class="grid-head">節</div>${[1, 2, 3, 4, 5].map((day) => `<div class="grid-head">${weekdays[day]}</div>`).join("")}`;
  for (const period of state.periods) {
    html += `<div class="grid-period">${period.order}</div>`;
    for (let weekday = 1; weekday <= 5; weekday += 1) {
      const assignment = version?.assignments.find((item) => item.weekday === weekday && item.periodId === period.id);
      html += `<button class="grid-cell ${assignment ? "filled" : "empty"}" data-weekday="${weekday}" data-period-id="${period.id}" type="button">${escapeHtml(assignment ? byId(state.classes, assignment.classId)?.name : "—")}</button>`;
    }
  }
  $("#schedule-grid").innerHTML = html;
  $("#schedule-grid").querySelectorAll(".grid-cell").forEach((cell) => cell.addEventListener("click", () => openScheduleDialog(Number(cell.dataset.weekday), cell.dataset.periodId)));
}

function renderAll() {
  renderToday();
  renderPace();
  renderSchedule();
}

async function saveInlineRecord(lessonId, patch) {
  const lesson = state.lessons.find((item) => item.id === lessonId);
  if (!lesson) return;
  const existing = state.records.find((record) => record.lessonId === lessonId);
  const previous = existing || progressFor(lesson.classId) || {};
  const record = {
    id: existing?.id || crypto.randomUUID(), lessonId: lesson.id, lessonDate: lesson.date, periodId: lesson.periodId,
    classId: lesson.classId, subjectId: lesson.subjectId, materialId: lesson.materialId,
    chapter: patch.chapter ?? previous.chapter ?? "", page: Math.max(0, Number(patch.page ?? previous.page ?? 0) || 0),
    status: existing?.status || "completed", memo: patch.memo ?? previous.memo ?? "", updatedAt: new Date().toISOString(), version: (existing?.version || 0) + 1
  };
  await put("records", record);
  await queueEntity("records", record);
  const index = state.records.findIndex((item) => item.id === record.id);
  if (index >= 0) state.records[index] = record; else state.records.push(record);
  renderAll();
  showToast(`${byId(state.classes, lesson.classId)?.name} 已自動存檔`, "📖");
  void syncGoogleSheet();
}

async function handleImport(event) {
  const files = [...event.target.files];
  const allowed = ["application/pdf", "image/jpeg", "image/png"];
  const maxBytes = 15 * 1024 * 1024;
  const invalid = files.find((file) => !allowed.includes(file.type) || file.size > maxBytes);
  if (invalid) {
    $("#import-result").innerHTML = `<div class="import-batch">無法建立批次：${escapeHtml(invalid.name)} 格式不符或超過 15 MB。</div>`;
    return;
  }
  const batch = { id: crypto.randomUUID(), kind: event.target.dataset.importKind, status: "pending-review", files: files.map((file) => ({ name: file.name, type: file.type, size: file.size })), createdAt: new Date().toISOString(), provider: null, result: null };
  await put("importBatches", batch);
  await queueEntity("importBatches", batch);
  $("#import-result").innerHTML = `<div class="import-batch"><strong>✓ 已建立待核對批次</strong><br>${files.map((file) => escapeHtml(file.name)).join("、")}<br>尚未套用正式資料；辨識服務待伺服器端憑證設定。</div>`;
  showToast("匯入批次已建立", "✨");
  void syncGoogleSheet();
}

function exportCsv() {
  const protect = (value) => {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const header = ["日期", "班級", "科目", "節次", "教材", "章節", "頁碼", "教學狀態", "備忘"];
  const rows = state.records.map((record) => [record.lessonDate, byId(state.classes, record.classId)?.name, byId(state.subjects, record.subjectId)?.name, byId(state.periods, record.periodId)?.label, byId(state.materials, record.materialId)?.name, record.chapter, record.page, record.status, record.memo]);
  const blob = new Blob(["\ufeff" + [header, ...rows].map((row) => row.map(protect).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = `TeachFlow_教學紀錄_${dateKey()}.csv`; link.click(); URL.revokeObjectURL(link.href);
  showToast("CSV 報表已匯出", "📊");
}

function openSwapDialog() {
  const lessons = state.lessons.filter((lesson) => lesson.date === state.selectedDate && lesson.status === "scheduled");
  $("#swap-period").innerHTML = state.periods.map((period) => {
    const lesson = lessons.find((item) => item.periodId === period.id);
    return `<option value="${period.id}">${period.label}（原定：${escapeHtml(lesson ? byId(state.classes, lesson.classId)?.name : "空堂")}）</option>`;
  }).join("");
  $("#swap-class").innerHTML = state.classes.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("") + `<option value="__cancel__">🚫 標記停課（公假／活動）</option>`;
  $("#swap-dialog").showModal();
}

async function saveSwap(event) {
  event.preventDefault();
  const periodId = $("#swap-period").value;
  const classId = $("#swap-class").value;
  const current = state.lessons.find((lesson) => lesson.date === state.selectedDate && lesson.periodId === periodId && lesson.status === "scheduled");
  const now = new Date().toISOString();
  const exception = { id: crypto.randomUUID(), date: state.selectedDate, periodId, updatedAt: now };
  if (classId === "__cancel__") Object.assign(exception, { type: "cancel", reason: "單次停課" });
  else {
    const klass = byId(state.classes, classId);
    const assignment = { id: `exception-assignment-${crypto.randomUUID()}`, weekday: weekdayOf(state.selectedDate), periodId, classId, grade: klass?.grade, subjectId: current?.subjectId || state.subjects[0]?.id, materialId: current?.materialId || state.materials[0]?.id };
    Object.assign(exception, { type: current ? "replace" : "add", assignment });
  }
  await put("exceptions", exception);
  await queueEntity("exceptions", exception);
  $("#swap-dialog").close();
  await load({ seed: false });
  showToast("單次課堂安排已更新", "🔄");
  void syncGoogleSheet();
}

function openScheduleDialog(weekday, periodId) {
  const version = state.scheduleVersions[0];
  const assignment = version?.assignments.find((item) => item.weekday === weekday && item.periodId === periodId);
  const period = byId(state.periods, periodId);
  $("#schedule-weekday").value = weekday;
  $("#schedule-period").value = periodId;
  $("#schedule-dialog-subtitle").textContent = `週${weekdays[weekday]} · ${period?.label}`;
  $("#schedule-class").innerHTML = `<option value="">設為空堂</option>` + state.classes.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  $("#schedule-class").value = assignment?.classId || "";
  $("#schedule-dialog").showModal();
}

async function saveSchedule(event) {
  event.preventDefault();
  const version = state.scheduleVersions[0];
  const weekday = Number($("#schedule-weekday").value);
  const periodId = $("#schedule-period").value;
  const classId = $("#schedule-class").value;
  const assignments = [...version.assignments];
  const index = assignments.findIndex((item) => item.weekday === weekday && item.periodId === periodId);
  if (!classId && index >= 0) assignments.splice(index, 1);
  if (classId) {
    const klass = byId(state.classes, classId);
    const next = { id: index >= 0 ? assignments[index].id : `assignment-${crypto.randomUUID()}`, weekday, periodId, classId, grade: klass?.grade, subjectId: assignments[index]?.subjectId || state.subjects[0]?.id, materialId: assignments[index]?.materialId || state.materials[0]?.id };
    if (index >= 0) assignments[index] = next; else assignments.push(next);
  }
  const updated = { ...version, assignments, updatedAt: new Date().toISOString() };
  await put("scheduleVersions", updated);
  await queueEntity("scheduleVersions", updated);
  $("#schedule-dialog").close();
  await load({ seed: false });
  showToast("常規課表已更新");
  void syncGoogleSheet();
}

function openExamDialog() {
  const target = state.targets[0];
  $("#exam-target").value = target?.targetPage || 1;
  $("#exam-date").value = target?.cutoffDate || dateKey();
  $("#exam-dialog").showModal();
}

async function saveExam(event) {
  event.preventDefault();
  const target = state.targets[0];
  if (!target) return;
  const updated = { ...target, targetPage: Math.max(1, Number($("#exam-target").value) || 1), cutoffDate: $("#exam-date").value, updatedAt: new Date().toISOString() };
  await put("examTargets", updated);
  await queueEntity("examTargets", updated);
  $("#exam-dialog").close();
  await load({ seed: false });
  showToast("段考目標已更新", "🎯");
  void syncGoogleSheet();
}

document.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("hidden", view.id !== `view-${button.dataset.view}`));
  renderAll();
}));
document.querySelectorAll("[data-import-kind]").forEach((input) => input.addEventListener("change", handleImport));
document.querySelectorAll(".dialog-close").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$("#export-button").addEventListener("click", exportCsv);
$("#swap-button").addEventListener("click", openSwapDialog);
$("#swap-form").addEventListener("submit", saveSwap);
$("#schedule-form").addEventListener("submit", saveSchedule);
$("#exam-config-button").addEventListener("click", openExamDialog);
$("#exam-form").addEventListener("submit", saveExam);
$("#connection-state").addEventListener("click", async () => {
  $("#spreadsheet-id").value = await selectedSpreadsheetId();
  if (!googleRemoteConfigured()) setConnectionStatus("尚未設定 Google OAuth");
  $("#cloud-dialog").showModal();
});
$("#close-cloud-dialog").addEventListener("click", () => $("#cloud-dialog").close());
$("#connect-google").addEventListener("click", async () => {
  try {
    setConnectionStatus("等待 Google 授權…");
    await connectGoogle();
    await syncGoogleSheet();
  } catch (error) {
    console.error(error);
    setConnectionStatus(error.message === "GOOGLE_CLIENT_NOT_CONFIGURED" ? "尚未設定 Google OAuth" : "Google 登入未完成");
  }
});
$("#disconnect-google").addEventListener("click", () => { disconnectGoogle(); setConnectionStatus("本機已儲存"); });
window.addEventListener("online", () => { setConnectionStatus(isGoogleConnected() ? "同步中…" : "本機已儲存"); void syncGoogleSheet(); });
window.addEventListener("offline", () => setConnectionStatus("離線 · 本機已儲存"));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncGoogleSheet(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
load().then(async () => {
  $("#spreadsheet-id").value = await selectedSpreadsheetId();
  setConnectionStatus(navigator.onLine ? (googleRemoteConfigured() ? "本機已儲存" : "尚未設定 Google OAuth") : "離線 · 本機已儲存");
}).catch((error) => { console.error(error); showToast("資料庫啟動失敗，請重新整理", "⚠️"); });
