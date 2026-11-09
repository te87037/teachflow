import { BUSINESS_STORES, all, applyRemoteOperations, exportSnapshot, getSetting, put, remove, seedIfEmpty } from "./db.js";
import { dateKey, expandLessons, latestProgress, pace, remainingLessons } from "./engine.js";
import { appendOperations, configuredSpreadsheetId, connectGoogle, disconnectGoogle, extractSpreadsheetId, googleRemoteConfigured, isGoogleConnected, pullOperations } from "./remote.js";

const state = { classes: [], subjects: [], materials: [], periods: [], scheduleVersions: [], events: [], exceptions: [], records: [], targets: [], lessons: [], selectedDate: dateKey(), activeLesson: null };
const byId = (items, id) => items.find((item) => item.id === id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const formatDate = (key, options = {}) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "long", day: "numeric", weekday: "short", ...options }).format(new Date(`${key}T12:00:00+08:00`));
const $ = (selector) => document.querySelector(selector);
let syncing = false;

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

function setConnectionStatus(message) {
  $("#connection-state").textContent = message;
  $("#cloud-detail").textContent = message;
}

function queueToOperation(item) {
  return {
    operationId: item.id,
    entityType: item.entityType,
    entityId: item.entityId,
    operation: item.operation,
    updatedAt: item.createdAt,
    payload: item.payload
  };
}

async function selectedSpreadsheetId() {
  return extractSpreadsheetId($("#spreadsheet-id").value || await getSetting("google-spreadsheet-id") || configuredSpreadsheetId());
}

async function syncGoogleSheet() {
  if (syncing || !navigator.onLine || !isGoogleConnected()) return;
  const spreadsheetId = await selectedSpreadsheetId();
  if (!spreadsheetId) {
    setConnectionStatus("請先填入 Google Sheet 網址");
    return;
  }
  syncing = true;
  setConnectionStatus("Google Sheet 同步中…");
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
          if (pendingKeys.has(`${store}:${entity.id}`)) continue;
          pendingOperations.push({ operationId: crypto.randomUUID(), entityType: store, entityId: entity.id, operation: "upsert", updatedAt: entity.updatedAt || timestamp, payload: entity });
        }
      }
    }
    await appendOperations(spreadsheetId, pendingOperations);
    for (const item of queued) await remove("syncQueue", item.id);
    await applyRemoteOperations([...remoteOperations, ...pendingOperations]);
    await load({ seed: false });
    setConnectionStatus(`Google Sheet 已同步 · ${new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`);
  } catch (error) {
    console.error(error);
    if (error.status === 401) setConnectionStatus("Google 授權已到期，請重新登入");
    else if (error.status === 403) setConnectionStatus("無權限存取這份 Google Sheet");
    else if (error.status === 404) setConnectionStatus("找不到指定的 Google Sheet");
    else setConnectionStatus(`同步失敗：${error.message}`);
  } finally {
    syncing = false;
  }
}

function progressFor(classId) {
  return latestProgress(state.records.filter((record) => record.classId === classId));
}

function isNextLesson(lesson, lessons) {
  if (state.selectedDate !== dateKey()) return false;
  const now = new Date();
  const minute = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).replace(":", ""));
  const future = lessons.find((item) => Number(byId(state.periods, item.periodId)?.end?.replace(":", "") || 0) >= minute);
  return future?.id === lesson.id;
}

function renderToday() {
  const lessons = state.lessons.filter((lesson) => lesson.date === state.selectedDate && lesson.status === "scheduled");
  $("#today-label").textContent = formatDate(state.selectedDate);
  $("#lesson-count").textContent = `${lessons.length} 堂有效課堂`;
  $("#selected-date").value = state.selectedDate;
  const container = $("#today-lessons");
  if (!lessons.length) {
    container.innerHTML = `<div class="empty-state"><strong>今天沒有有效課堂</strong>可以備課、批改，或到設定頁核對課表。</div>`;
    return;
  }
  container.innerHTML = lessons.map((lesson) => {
    const klass = byId(state.classes, lesson.classId);
    const subject = byId(state.subjects, lesson.subjectId);
    const period = byId(state.periods, lesson.periodId);
    const progress = state.records.find((record) => record.lessonId === lesson.id) || progressFor(lesson.classId);
    const recorded = state.records.some((record) => record.lessonId === lesson.id);
    return `<article class="lesson-card ${isNextLesson(lesson, lessons) ? "is-next" : ""}">
      <div class="lesson-top"><span class="period-badge">${escapeHtml(period?.order || "—")}</span><div><h3 class="lesson-title">${escapeHtml(klass?.name)}</h3><p class="lesson-meta">${escapeHtml(subject?.name)} · ${escapeHtml(period?.start)}–${escapeHtml(period?.end)}</p></div></div>
      <div class="progress-preview"><strong>${escapeHtml(progress?.chapter || "尚未建立進度")}</strong><p>${progress ? `已完成至 P.${progress.page} · ${escapeHtml(progress.memo || "無下次備忘")}` : "完成本堂紀錄後，這裡會顯示上次進度。"}</p></div>
      <div class="lesson-actions"><span class="tag">${recorded ? "本堂已記錄" : `來源：${lesson.source === "routine" ? "常規課表" : "單次異動"}`}</span><button class="primary-button record-button" data-lesson-id="${lesson.id}">${recorded ? "修正紀錄" : "記錄這堂"}</button></div>
    </article>`;
  }).join("");
  container.querySelectorAll(".record-button").forEach((button) => button.addEventListener("click", () => openRecord(button.dataset.lessonId)));
}

function renderPace() {
  const container = $("#pace-list");
  container.innerHTML = state.targets.map((target) => {
    const klass = byId(state.classes, target.classId);
    const progress = progressFor(target.classId);
    const remaining = remainingLessons(state.lessons, { classId: target.classId, subjectId: target.subjectId, cutoffDate: target.cutoffDate, fromDate: dateKey() });
    const result = pace({ targetPage: target.targetPage, completedPage: progress?.page || 0, remainingCount: remaining.length });
    const percent = Math.min(100, Math.round(((progress?.page || 0) / target.targetPage) * 100));
    return `<article class="pace-card"><header><div><span class="tag">${escapeHtml(target.title)}</span><h3>${escapeHtml(klass?.name)}</h3></div><div class="pace-number">${result.perLesson === null ? "—" : result.perLesson.toFixed(1)}<small>頁／堂</small></div></header>
      <div class="meter"><span style="width:${percent}%"></span></div>
      <div class="pace-stats"><div>目前進度<strong>P.${progress?.page || 0}</strong></div><div>尚差<strong>${result.remainingPages} 頁</strong></div><div>有效堂數<strong>${remaining.length} 堂</strong></div></div>
      ${result.warning ? `<p class="section-note">${result.warning}</p>` : ""}
      <details><summary>展開堂次明細</summary><ol>${remaining.map((lesson) => `<li>${formatDate(lesson.date)} · ${escapeHtml(byId(state.periods, lesson.periodId)?.label)}</li>`).join("") || "<li>沒有可計入堂次</li>"}</ol></details></article>`;
  }).join("");
}

function renderHistory() {
  const selected = $("#history-class").value;
  const query = $("#history-search").value.trim().toLowerCase();
  const records = [...state.records].filter((record) => (!selected || record.classId === selected) && (!query || [byId(state.classes, record.classId)?.name, record.chapter, record.memo].join(" ").toLowerCase().includes(query))).sort((a, b) => b.lessonDate.localeCompare(a.lessonDate) || String(b.periodId).localeCompare(String(a.periodId)));
  $("#history-list").innerHTML = records.map((record) => `<article class="record-card"><h3>${escapeHtml(byId(state.classes, record.classId)?.name)} · P.${record.page}</h3><p>${escapeHtml(record.chapter)}</p><p>${escapeHtml(record.memo || "無備忘")}</p><footer>${formatDate(record.lessonDate)} · ${escapeHtml(byId(state.periods, record.periodId)?.label)} · ${record.status === "completed" ? "已講完" : record.status === "review" ? "待檢討" : "進行中"}</footer></article>`).join("") || `<div class="empty-state"><strong>找不到紀錄</strong>請調整搜尋條件。</div>`;
}

function renderSchedule() {
  const weekdays = ["一", "二", "三", "四", "五"];
  const version = state.scheduleVersions[0];
  let html = `<div class="schedule-cell head">節</div>${weekdays.map((day) => `<div class="schedule-cell head">${day}</div>`).join("")}`;
  for (const period of state.periods) {
    html += `<div class="schedule-cell">${period.order}</div>`;
    for (let weekday = 1; weekday <= 5; weekday += 1) {
      const assignment = version?.assignments.find((item) => item.weekday === weekday && item.periodId === period.id);
      html += `<div class="schedule-cell ${assignment ? "filled" : ""}">${escapeHtml(assignment ? byId(state.classes, assignment.classId)?.name : "—")}</div>`;
    }
  }
  $("#schedule-grid").innerHTML = html;
}

function renderAll() {
  renderToday(); renderPace(); renderHistory(); renderSchedule();
}

function openRecord(lessonId) {
  const lesson = state.lessons.find((item) => item.id === lessonId);
  const existing = state.records.find((record) => record.lessonId === lessonId);
  const previous = existing || progressFor(lesson.classId);
  state.activeLesson = lesson;
  $("#record-title").textContent = `${byId(state.classes, lesson.classId)?.name} · ${byId(state.periods, lesson.periodId)?.label}`;
  $("#record-lesson-id").value = lesson.id;
  $("#record-chapter").value = previous?.chapter || "";
  $("#record-page").value = previous?.page || 0;
  $("#record-status").value = existing?.status || "completed";
  $("#record-memo").value = existing?.memo || previous?.memo || "";
  $("#record-dialog").showModal();
}

async function saveRecord(event) {
  event.preventDefault();
  const lesson = state.activeLesson;
  if (!lesson) return;
  const page = Math.max(0, Number($("#record-page").value) || 0);
  const existing = state.records.find((record) => record.lessonId === lesson.id);
  const record = {
    id: existing?.id || crypto.randomUUID(), lessonId: lesson.id, lessonDate: lesson.date, periodId: lesson.periodId,
    classId: lesson.classId, subjectId: lesson.subjectId, materialId: lesson.materialId,
    chapter: $("#record-chapter").value.trim(), page, status: $("#record-status").value,
    memo: $("#record-memo").value.trim(), updatedAt: new Date().toISOString(), version: (existing?.version || 0) + 1
  };
  await put("records", record);
  await put("syncQueue", { id: crypto.randomUUID(), entityType: "records", entityId: record.id, operation: "upsert", payload: record, createdAt: record.updatedAt, status: "pending" });
  const index = state.records.findIndex((item) => item.id === record.id);
  if (index >= 0) state.records[index] = record; else state.records.push(record);
  $("#record-dialog").close();
  showToast(isGoogleConnected() ? "本機已儲存，正在同步 Google Sheet" : "本機已儲存，連線後會同步 Google Sheet");
  renderAll();
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
  const batch = { id: crypto.randomUUID(), status: "pending-review", files: files.map((file) => ({ name: file.name, type: file.type, size: file.size })), createdAt: new Date().toISOString(), provider: null, result: null };
  await put("importBatches", batch);
  await put("syncQueue", { id: crypto.randomUUID(), entityType: "importBatches", entityId: batch.id, operation: "upsert", payload: batch, createdAt: batch.createdAt, status: "pending" });
  $("#import-result").innerHTML = `<div class="import-batch"><strong>已建立待核對批次</strong><br>${files.map((file) => escapeHtml(file.name)).join("、")}<br>原始資料尚未套用；此部署未設定辨識服務。</div>`;
  showToast("已驗證檔案並建立匯入批次");
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
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `TeachFlow_教學紀錄_${dateKey()}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

let toastTimer;
function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("is-visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2500);
}

document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav-button").forEach((item) => item.classList.toggle("is-active", item === button));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("is-hidden", view.id !== `view-${button.dataset.view}`));
}));
$("#selected-date").addEventListener("change", (event) => { state.selectedDate = event.target.value; renderToday(); });
$("#record-form").addEventListener("submit", saveRecord);
document.querySelectorAll(".close-record-dialog").forEach((button) => button.addEventListener("click", () => {
  state.activeLesson = null;
  $("#record-dialog").close();
}));
$("#record-form").querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", () => { $("#record-page").value = Math.max(0, Number($("#record-page").value || 0) + Number(button.dataset.step)); }));
$("#history-search").addEventListener("input", renderHistory);
$("#history-class").addEventListener("change", renderHistory);
$("#import-file").addEventListener("change", handleImport);
$("#export-button").addEventListener("click", exportCsv);
$("#cloud-button").addEventListener("click", async () => {
  $("#spreadsheet-id").value = await selectedSpreadsheetId();
  if (!googleRemoteConfigured()) setConnectionStatus("部署尚未設定 Google OAuth 用戶端 ID");
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
    setConnectionStatus(error.message === "GOOGLE_CLIENT_NOT_CONFIGURED" ? "部署尚未設定 Google OAuth 用戶端 ID" : "Google 登入未完成");
  }
});
$("#disconnect-google").addEventListener("click", () => {
  disconnectGoogle();
  setConnectionStatus("Google 已中斷；本機資料仍保留");
});
window.addEventListener("online", () => {
  setConnectionStatus(isGoogleConnected() ? "已連線，準備同步…" : "連線中 · Google 尚未登入");
  void syncGoogleSheet();
});
window.addEventListener("offline", () => setConnectionStatus("離線 · 本機可編輯，稍後同步"));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
load().then(async () => {
  $("#history-class").innerHTML += state.classes.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  $("#spreadsheet-id").value = await selectedSpreadsheetId();
  setConnectionStatus(navigator.onLine ? (googleRemoteConfigured() ? "Google 尚未登入" : "部署尚未設定 Google OAuth") : "離線 · 本機可編輯，稍後同步");
  renderHistory();
}).catch((error) => { console.error(error); showToast("資料庫啟動失敗，請重新整理"); });
