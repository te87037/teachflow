import { BUSINESS_STORES, all, applyRemoteOperations, commitImportBatch, exportSnapshot, getSetting, put, remove, seedIfEmpty } from "./db.js";
import { addDays, browserDateKey, classProgress, currentOrNextLessonId, dateKey, expandLessons, pace, remainingLessons, weekdayOf } from "./engine.js?v=14";
import { prepareImportPages } from "./ocr.js";
import { parseImportCandidates } from "./ocr-parser.js";
import { appendOperations, configuredSpreadsheetId, connectGoogle, disconnectGoogle, extractSpreadsheetId, googleRemoteConfigured, isGoogleConnected, pullOperations, recognizeOcrPage } from "./remote.js";

const state = { classes: [], subjects: [], materials: [], periods: [], scheduleVersions: [], events: [], exceptions: [], records: [], targets: [], importBatches: [], lessons: [], selectedDate: browserDateKey(), selectedPaceGrade: null };
const weekdays = ["", "一", "二", "三", "四", "五", "六", "日"];
const $ = (selector) => document.querySelector(selector);
const byId = (items, id) => items.find((item) => item.id === id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
let syncing = false;
let toastTimer;
let lastBrowserDate = browserDateKey();
let lastRemoteFingerprint = null;
const AUTO_SYNC_INTERVAL_MS = 60 * 1000;
const classSaveQueues = new Map();
const optimisticPages = new Map();

async function load({ seed = true } = {}) {
  if (seed) await seedIfEmpty();
  [state.classes, state.subjects, state.materials, state.periods, state.scheduleVersions, state.events, state.exceptions, state.records, state.targets, state.importBatches] = await Promise.all([
    all("classes"), all("subjects"), all("materials"), all("periods"), all("scheduleVersions"), all("calendarEvents"), all("exceptions"), all("records"), all("examTargets"), all("importBatches")
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
    const lastRemoteOperation = remoteOperations.at(-1);
    const remoteFingerprint = `${remoteOperations.length}:${lastRemoteOperation?.operationId || ""}:${lastRemoteOperation?.updatedAt || ""}`;
    const remoteChanged = remoteFingerprint !== lastRemoteFingerprint;
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
    if (remoteChanged || pendingOperations.length) {
      await applyRemoteOperations([...remoteOperations, ...pendingOperations]);
      await load({ seed: false });
    }
    lastRemoteFingerprint = remoteFingerprint;
    setConnectionStatus("雲端已同步");
  } catch (error) {
    console.error(error);
    if (error.status === 401) setConnectionStatus("同步存取碼無效");
    else if (error.status === 403) setConnectionStatus("Sheet 無存取權");
    else if (error.status === 404) setConnectionStatus("找不到 Sheet");
    else setConnectionStatus("同步失敗");
  } finally {
    syncing = false;
  }
}

function progressFor(classId) {
  return classProgress(state.records, classId);
}

function targetFor(classId) {
  return state.targets.find((target) => target.classId === classId) || state.targets[0];
}

function dateForWeekday(weekday) {
  const today = browserDateKey();
  return addDays(today, weekday - weekdayOf(today));
}

function formatHeaderDate(key) {
  const date = new Date(`${key}T12:00:00+08:00`);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 週${weekdays[weekdayOf(key)]}`;
}

function isNextLesson(lesson, dayLessons) {
  return currentOrNextLessonId({ lessons: dayLessons, periods: state.periods, selectedDate: state.selectedDate }) === lesson.id;
}

function refreshCurrentLessonIndicator() {
  const today = browserDateKey();
  if (state.selectedDate === lastBrowserDate && today !== lastBrowserDate) {
    state.selectedDate = today;
    lastBrowserDate = today;
    renderToday();
    return;
  }
  lastBrowserDate = today;
  const lessons = state.lessons.filter((lesson) => lesson.date === state.selectedDate && lesson.status === "scheduled");
  const activeId = currentOrNextLessonId({ lessons, periods: state.periods, selectedDate: state.selectedDate });
  document.querySelectorAll("#today-lessons .lesson-card").forEach((card) => {
    const active = card.dataset.lessonId === activeId;
    card.classList.toggle("is-next", active);
    const tag = card.querySelector(".next-tag");
    if (active && !tag && !card.querySelector(".swap-tag")) card.insertAdjacentHTML("afterbegin", '<span class="next-tag">當前／下一節</span>');
    if (!active && tag) tag.remove();
  });
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
    const sharedRecord = progressFor(lesson.classId);
    const optimisticPage = optimisticPages.get(lesson.classId);
    const record = optimisticPage === undefined ? sharedRecord : { ...(sharedRecord || {}), page: optimisticPage };
    const target = targetFor(lesson.classId);
    const remaining = target ? remainingLessons(state.lessons, { classId: lesson.classId, subjectId: lesson.subjectId, cutoffDate: target.cutoffDate, fromDate: dateKey() }) : [];
    const result = target ? pace({ targetPage: target.targetPage, completedPage: record?.page || 0, remainingCount: remaining.length }) : { perLesson: null };
    const next = isNextLesson(lesson, lessons);
    return `<article class="tf-card lesson-card ${next ? "is-next" : ""}" data-lesson-id="${escapeHtml(lesson.id)}" data-class-id="${escapeHtml(lesson.classId)}">
      ${lesson.source === "exception" || lesson.source === "added" ? '<span class="swap-tag">臨時調課</span>' : next ? '<span class="next-tag">當前／下一節</span>' : ""}
      <div class="lesson-heading"><div class="lesson-identity"><span class="period-pill">第 ${escapeHtml(period?.order || "—")} 節</span><span class="lesson-class">${escapeHtml(klass?.name)}</span><span class="lesson-subject">${escapeHtml(subject?.name)}</span></div><span class="pace-badge ${paceClass(result.perLesson)}">配速 ${result.perLesson === null ? "—" : result.perLesson.toFixed(1)} 頁／堂</span></div>
      <input class="chapter-input" data-field="chapter" value="${escapeHtml(record?.chapter || "")}" placeholder="點擊輸入當前進度單元／章節…">
      <div class="stepper-box"><div><span class="stepper-label">目前課本進度</span><div class="page-line"><span>P.</span><input class="page-input" data-field="page" type="number" min="0" value="${Number(record?.page || 0)}"><small>/ 目標 P.${Number(target?.targetPage || 0)}</small></div></div><div class="stepper-actions"><button class="step-button minus" data-step="-1" type="button">−</button><button class="step-button plus-one" data-step="1" type="button">+1</button><button class="step-button plus-two" data-step="2" type="button">+2</button></div></div>
      <input class="memo-input" data-field="memo" value="${escapeHtml(record?.memo || "")}" placeholder="下節備忘（如：抽查學習單、第 3 題待解）…">
    </article>`;
  }).join("");
  container.querySelectorAll(".lesson-card").forEach((card) => {
    const lessonId = card.dataset.lessonId;
    card.querySelectorAll("[data-field]").forEach((input) => input.addEventListener("change", () => { void enqueueInlineRecordUpdate(lessonId, { [input.dataset.field]: input.value }); }));
    card.querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", () => {
      const lesson = state.lessons.find((item) => item.id === lessonId);
      if (!lesson) return;
      const input = card.querySelector("[data-field='page']");
      const currentPage = optimisticPages.get(lesson.classId) ?? Number(progressFor(lesson.classId)?.page || input.value || 0);
      const nextPage = Math.max(0, currentPage + Number(button.dataset.step));
      optimisticPages.set(lesson.classId, nextPage);
      container.querySelectorAll(".lesson-card").forEach((item) => {
        if (item.dataset.classId === lesson.classId) item.querySelector("[data-field='page']").value = nextPage;
      });
      void enqueueInlineRecordUpdate(lessonId, { page: nextPage });
    }));
  });
}

function renderPace() {
  const grades = [...new Set(state.classes.map((item) => item.grade).filter(Boolean))];
  if (!grades.includes(state.selectedPaceGrade)) state.selectedPaceGrade = grades[0] || null;
  $("#pace-grade-buttons").innerHTML = grades.map((grade) => `<button class="grade-filter-button ${grade === state.selectedPaceGrade ? "active" : ""}" data-grade="${escapeHtml(grade)}" type="button">${escapeHtml(grade)}</button>`).join("");
  $("#pace-grade-buttons").querySelectorAll("[data-grade]").forEach((button) => button.addEventListener("click", () => {
    state.selectedPaceGrade = button.dataset.grade;
    renderPace();
  }));
  const targets = state.targets.filter((target) => byId(state.classes, target.classId)?.grade === state.selectedPaceGrade);
  const firstTarget = targets[0];
  $("#exam-title").textContent = firstTarget?.title || "段考目標";
  $("#exam-date-label").textContent = firstTarget?.cutoffDate || "—";
  $("#exam-target-label").textContent = firstTarget?.targetPage || "—";
  const days = firstTarget ? Math.max(0, Math.ceil((new Date(`${firstTarget.cutoffDate}T12:00:00+08:00`) - new Date(`${dateKey()}T12:00:00+08:00`)) / 86400000)) : 0;
  $("#exam-days-label").textContent = days;
  $("#pace-list").innerHTML = targets.map((target) => {
    const klass = byId(state.classes, target.classId);
    const progress = progressFor(target.classId);
    const remaining = remainingLessons(state.lessons, { classId: target.classId, subjectId: target.subjectId, cutoffDate: target.cutoffDate, fromDate: dateKey() });
    const result = pace({ targetPage: target.targetPage, completedPage: progress?.page || 0, remainingCount: remaining.length });
    const percent = Math.min(100, Math.round(((progress?.page || 0) / target.targetPage) * 100));
    return `<article class="tf-card"><div class="pace-card-heading"><div><span class="period-pill">${escapeHtml(klass?.name)}</span><p>${escapeHtml(progress?.chapter || "尚未輸入單元")}</p></div><span class="pace-badge ${paceClass(result.perLesson)}">每堂需 ${result.perLesson === null ? "—" : result.perLesson.toFixed(1)} 頁</span></div><div class="progress-row"><span>進度 P.${progress?.page || 0}（${percent}%）</span><span>尚差 ${result.remainingPages} 頁</span></div><div class="progress-track"><div class="progress-bar" style="width:${percent}%"></div></div><div class="pace-footer"><span>考前實質尚有：<strong>${remaining.length} 堂</strong></span><span>備忘：${escapeHtml(progress?.memo || "無")}</span></div></article>`;
  }).join("") || `<article class="tf-card empty-card"><span>📚</span><strong>此年級尚無班級進度</strong><p>請先到常規課表管理班級。</p></article>`;
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

function selectedOption(value, current) {
  return String(value) === String(current ?? "") ? " selected" : "";
}

function renderImport() {
  const container = $("#import-result");
  const batch = [...state.importBatches].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!batch) {
    container.innerHTML = `<div class="import-empty">上傳後會在這裡顯示逐頁原文與待核對欄位。</div>`;
    return;
  }
  if (batch.status === "processing") {
    container.innerHTML = `<div class="import-batch import-processing"><strong>正在辨識 ${escapeHtml(batch.files?.map((file) => file.name).join("、") || "文件")}…</strong><span>${escapeHtml(batch.progress || "準備檔案")}</span></div>`;
    return;
  }
  if (batch.status === "failed") {
    container.innerHTML = `<div class="import-batch import-error"><strong>辨識失敗</strong><span>${escapeHtml(batch.error || "請重新選擇檔案")}</span></div>`;
    return;
  }
  if (batch.status !== "pending-review") {
    container.innerHTML = `<div class="import-batch"><strong>${batch.status === "applied" ? "✓ 最近一次匯入已套用" : "最近一次匯入已取消"}</strong><span>${escapeHtml(batch.files?.map((file) => file.name).join("、") || "")}</span></div>`;
    return;
  }
  const candidates = batch.result?.candidates || [];
  const cards = candidates.map((candidate) => {
    if (batch.kind === "schedule") {
      const matchedClass = state.classes.find((item) => item.name.replace(/\s/g, "").includes(String(candidate.className || "").replace(/\s/g, "")));
      candidate.classId ||= matchedClass?.id || null;
      candidate.periodId ||= state.periods.find((item) => item.order === candidate.period)?.id || null;
      return `<article class="review-item" data-candidate-id="${candidate.id}">
        <div class="review-source"><b>第 ${candidate.sourcePage} 頁</b><span>${escapeHtml(candidate.sourceText)}</span></div>
        <div class="review-fields three-columns">
          <label>星期<select data-field="weekday"><option value="">請選擇</option>${[1,2,3,4,5,6,7].map((day) => `<option value="${day}"${selectedOption(day, candidate.weekday)}>週${weekdays[day]}</option>`).join("")}</select></label>
          <label>節次<select data-field="periodId"><option value="">請選擇</option>${state.periods.map((period) => `<option value="${period.id}"${selectedOption(period.id, candidate.periodId)}>${escapeHtml(period.label)}</option>`).join("")}</select></label>
          <label>班級<select data-field="classId"><option value="">請選擇</option>${state.classes.map((item) => `<option value="${item.id}"${selectedOption(item.id, candidate.classId)}>${escapeHtml(item.name)}</option>`).join("")}</select></label>
        </div>
      </article>`;
    }
    return `<article class="review-item" data-candidate-id="${candidate.id}">
      <div class="review-source"><b>第 ${candidate.sourcePage} 頁</b><span>${escapeHtml(candidate.sourceText)}</span></div>
      <div class="review-fields calendar-fields">
        <label>日期<input data-field="date" type="date" value="${escapeHtml(candidate.date || "")}"></label>
        <label>類型<select data-field="eventType"><option value="event"${selectedOption("event", candidate.eventType)}>活動／停課</option><option value="exam"${selectedOption("exam", candidate.eventType)}>考試</option><option value="holiday"${selectedOption("holiday", candidate.eventType)}>放假</option><option value="makeup"${selectedOption("makeup", candidate.eventType)}>補課</option></select></label>
        <label class="title-field">名稱<input data-field="title" value="${escapeHtml(candidate.title || "")}" placeholder="例如：第一次段考"></label>
        <label>補課對應<select data-field="mappedWeekday"><option value="">不適用</option>${[1,2,3,4,5].map((day) => `<option value="${day}"${selectedOption(day, candidate.mappedWeekday)}>週${weekdays[day]}</option>`).join("")}</select></label>
      </div>
    </article>`;
  }).join("");
  container.innerHTML = `<div class="import-review-heading"><div><strong>待核對 ${candidates.length} 筆</strong><span>OCR 可能有誤，確認後才會修改正式資料。</span></div><span>${escapeHtml(batch.provider || "混合辨識")}</span></div>${cards}<div class="import-actions"><button class="cancel-button" data-import-action="cancel" type="button">取消批次</button><button class="primary-button" data-import-action="apply" type="button">確認並套用</button></div>`;
}

function renderAll() {
  renderToday();
  renderPace();
  renderSchedule();
  renderImport();
}

async function saveInlineRecord(lessonId, patch) {
  const lesson = state.lessons.find((item) => item.id === lessonId);
  if (!lesson) return;
  const existing = state.records.find((record) => record.lessonId === lessonId);
  const previous = progressFor(lesson.classId) || existing || {};
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

function enqueueInlineRecordUpdate(lessonId, patch) {
  const lesson = state.lessons.find((item) => item.id === lessonId);
  if (!lesson) return Promise.resolve();
  const previous = classSaveQueues.get(lesson.classId) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => saveInlineRecord(lessonId, patch)).catch((error) => {
    console.error(error);
    showToast("進度儲存失敗，請再試一次", "⚠️");
  });
  classSaveQueues.set(lesson.classId, task);
  void task.finally(() => {
    if (classSaveQueues.get(lesson.classId) !== task) return;
    classSaveQueues.delete(lesson.classId);
    optimisticPages.delete(lesson.classId);
    renderAll();
  });
  return task;
}

async function handleImport(event) {
  const files = [...event.target.files];
  event.target.value = "";
  if (!files.length) return;
  const batch = { id: crypto.randomUUID(), kind: event.target.dataset.importKind, status: "processing", files: files.map((file) => ({ name: file.name, type: file.type, size: file.size })), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), provider: "Google Drive OCR + PDF.js", progress: "驗證檔案", result: null };
  await put("importBatches", batch);
  state.importBatches.push(batch);
  renderImport();
  const updateProgress = async (message) => {
    batch.progress = message;
    batch.updatedAt = new Date().toISOString();
    await put("importBatches", batch);
    renderImport();
  };
  try {
    const preparedPages = await prepareImportPages(files, (message) => { void updateProgress(message); });
    const pages = [];
    for (const page of preparedPages) {
      if (page.text) {
        pages.push({ pageNumber: page.pageNumber, fileName: page.fileName, text: page.text, provider: page.provider });
        continue;
      }
      await updateProgress(`Google Drive OCR：第 ${page.pageNumber}/${preparedPages.length} 頁…`);
      const result = await recognizeOcrPage(page);
      pages.push({ pageNumber: page.pageNumber, fileName: page.fileName, text: result.text || "", provider: result.provider, digest: result.digest });
    }
    batch.status = "pending-review";
    batch.progress = null;
    batch.updatedAt = new Date().toISOString();
    batch.result = { pages, candidates: parseImportCandidates(batch.kind, pages, state.classes) };
    await put("importBatches", batch);
    await queueEntity("importBatches", batch);
    renderImport();
    showToast(`辨識完成，請核對 ${batch.result.candidates.length} 筆`, "✨");
    void syncGoogleSheet();
  } catch (error) {
    console.error(error);
    batch.status = "failed";
    batch.error = ({ REMOTE_AUTH_REQUIRED: "圖片 OCR 前請先按上方雲端狀態，輸入同步存取碼。", INVALID_SYNC_SECRET: "同步存取碼無效。", OCR_PAGE_TOO_LARGE: "單頁影像過大，請降低解析度。" })[error.message] || error.message || "辨識失敗";
    batch.updatedAt = new Date().toISOString();
    await put("importBatches", batch);
    renderImport();
    showToast("OCR 辨識失敗", "⚠️");
  }
}

function activeImportBatch() {
  return [...state.importBatches].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).find((item) => item.status === "pending-review");
}

async function updateImportCandidate(target) {
  const batch = activeImportBatch();
  const card = target.closest("[data-candidate-id]");
  if (!batch || !card) return;
  const candidate = batch.result.candidates.find((item) => item.id === card.dataset.candidateId);
  if (!candidate) return;
  const field = target.dataset.field;
  candidate[field] = ["weekday", "mappedWeekday"].includes(field) ? (target.value ? Number(target.value) : null) : target.value;
  candidate.pendingReason = null;
  batch.updatedAt = new Date().toISOString();
  await put("importBatches", batch);
}

async function cancelImportBatch() {
  const batch = activeImportBatch();
  if (!batch) return;
  batch.status = "cancelled";
  batch.updatedAt = new Date().toISOString();
  await put("importBatches", batch);
  await queueEntity("importBatches", batch);
  renderImport();
  showToast("匯入批次已取消");
  void syncGoogleSheet();
}

async function applyImportBatch() {
  const batch = activeImportBatch();
  if (!batch) return;
  const candidates = batch.result?.candidates || [];
  let changes = [];
  if (batch.kind === "schedule") {
    if (candidates.some((item) => !item.weekday || !item.periodId || !item.classId)) return showToast("請完成所有星期、節次與班級欄位", "⚠️");
    const version = state.scheduleVersions[0];
    if (!version) return showToast("找不到可更新的課表版本", "⚠️");
    const assignments = [...version.assignments];
    for (const candidate of candidates) {
      const index = assignments.findIndex((item) => item.weekday === candidate.weekday && item.periodId === candidate.periodId);
      const klass = byId(state.classes, candidate.classId);
      const next = {
        id: index >= 0 ? assignments[index].id : `assignment-${crypto.randomUUID()}`,
        weekday: candidate.weekday,
        periodId: candidate.periodId,
        classId: candidate.classId,
        grade: klass?.grade,
        subjectId: assignments[index]?.subjectId || state.subjects[0]?.id,
        materialId: assignments[index]?.materialId || state.materials[0]?.id
      };
      if (index >= 0) assignments[index] = next; else assignments.push(next);
    }
    changes = [{ store: "scheduleVersions", entity: { ...version, assignments, updatedAt: new Date().toISOString() } }];
  } else {
    if (candidates.some((item) => !item.date || !item.title)) return showToast("請完成所有日期與名稱欄位", "⚠️");
    changes = candidates.map((candidate) => ({
      store: "calendarEvents",
      entity: {
        id: `import-event-${candidate.id}`,
        type: candidate.eventType || "event",
        title: candidate.title,
        startDate: candidate.date,
        endDate: candidate.date,
        mappedWeekday: candidate.eventType === "makeup" ? candidate.mappedWeekday || null : null,
        blocksTeaching: candidate.eventType !== "makeup",
        sourceImportBatchId: batch.id,
        updatedAt: new Date().toISOString()
      }
    }));
  }
  await commitImportBatch(batch, changes);
  await load({ seed: false });
  showToast(`已套用 ${candidates.length} 筆匯入資料`, "✓");
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

function classRowTemplate(klass = {}) {
  return `<div class="class-row" data-class-id="${escapeHtml(klass.id || crypto.randomUUID())}">
    <label>班級名稱<input data-class-field="name" required maxlength="30" value="${escapeHtml(klass.name || "")}" placeholder="例如：801 班"></label>
    <label>年級<input data-class-field="grade" required maxlength="30" value="${escapeHtml(klass.grade || "")}" placeholder="例如：八年級"></label>
    <button class="remove-class-button" data-remove-class type="button" aria-label="移除班級">×</button>
  </div>`;
}

function openClassesDialog() {
  $("#class-list").innerHTML = state.classes.map(classRowTemplate).join("");
  $("#classes-dialog").showModal();
}

function classUsage(classId) {
  const scheduled = state.scheduleVersions.some((version) => version.assignments.some((item) => item.classId === classId));
  const recorded = state.records.some((record) => record.classId === classId);
  const exceptional = state.exceptions.some((item) => !item.revokedAt && item.assignment?.classId === classId);
  return { scheduled, recorded, exceptional, inUse: scheduled || recorded || exceptional };
}

async function saveClasses(event) {
  event.preventDefault();
  const rows = [...$("#class-list").querySelectorAll(".class-row")];
  if (!rows.length) return showToast("請至少保留一個班級", "⚠️");
  const now = new Date().toISOString();
  const classes = rows.map((row) => ({
    id: row.dataset.classId,
    name: row.querySelector("[data-class-field='name']").value.trim(),
    grade: row.querySelector("[data-class-field='grade']").value.trim()
  }));
  if (classes.some((item) => !item.name || !item.grade)) return showToast("請填寫所有班級名稱與年級", "⚠️");
  const normalizedNames = classes.map((item) => item.name.replace(/\s/g, "").toLocaleLowerCase());
  if (new Set(normalizedNames).size !== normalizedNames.length) return showToast("班級名稱不可重複", "⚠️");

  const retainedIds = new Set(classes.map((item) => item.id));
  const removedClasses = state.classes.filter((item) => !retainedIds.has(item.id));
  const blocked = removedClasses.find((item) => classUsage(item.id).inUse);
  if (blocked) return showToast(`${blocked.name} 仍被課表或進度使用，無法移除`, "⚠️");

  const existingIds = new Set(state.classes.map((item) => item.id));
  const savedClasses = classes.map((item) => {
    const existing = byId(state.classes, item.id);
    return existing && existing.name === item.name && existing.grade === item.grade ? existing : { ...existing, ...item, updatedAt: now };
  });
  for (const item of savedClasses) {
    const existing = byId(state.classes, item.id);
    if (existing === item) continue;
    await put("classes", item);
    await queueEntity("classes", item);
  }

  const classMap = new Map(savedClasses.map((item) => [item.id, item]));
  for (const version of state.scheduleVersions) {
    let changed = false;
    const assignments = version.assignments.map((assignment) => {
      const grade = classMap.get(assignment.classId)?.grade;
      if (!grade || grade === assignment.grade) return assignment;
      changed = true;
      return { ...assignment, grade };
    });
    if (!changed) continue;
    const updated = { ...version, assignments, updatedAt: now };
    await put("scheduleVersions", updated);
    await queueEntity("scheduleVersions", updated);
  }

  for (const exception of state.exceptions) {
    const grade = classMap.get(exception.assignment?.classId)?.grade;
    if (!grade || grade === exception.assignment.grade) continue;
    const updated = { ...exception, assignment: { ...exception.assignment, grade }, updatedAt: now };
    await put("exceptions", updated);
    await queueEntity("exceptions", updated);
  }

  const baseTarget = state.targets[0];
  for (const item of savedClasses.filter((klass) => !existingIds.has(klass.id))) {
    const target = {
      id: `target-${item.id}`,
      classId: item.id,
      subjectId: baseTarget?.subjectId || state.subjects[0]?.id,
      materialId: baseTarget?.materialId || state.materials[0]?.id,
      title: baseTarget?.title || "段考目標",
      cutoffDate: baseTarget?.cutoffDate || addDays(browserDateKey(), 30),
      targetPage: baseTarget?.targetPage || 1,
      updatedAt: now
    };
    await put("examTargets", target);
    await queueEntity("examTargets", target);
  }

  for (const item of removedClasses) {
    const target = state.targets.find((candidate) => candidate.classId === item.id);
    if (target) {
      await queueEntity("examTargets", { ...target, updatedAt: now }, "delete");
      await remove("examTargets", target.id);
    }
    await queueEntity("classes", { ...item, updatedAt: now }, "delete");
    await remove("classes", item.id);
  }

  $("#classes-dialog").close();
  await load({ seed: false });
  showToast("班級設定已更新", "🏫");
  void syncGoogleSheet();
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

function openExamDialog(event) {
  const target = state.targets.find((item) => byId(state.classes, item.classId)?.grade === state.selectedPaceGrade);
  $("#exam-target").value = target?.targetPage || 1;
  $("#exam-date").value = target?.cutoffDate || dateKey();
  $("#exam-dialog-grade").textContent = `${state.selectedPaceGrade || "目前年級"} · 套用至此年級的所有班級`;
  $("#exam-dialog").showModal();
  const focusTarget = event?.currentTarget?.id === "exam-target-config-button" ? $("#exam-target") : $("#exam-date");
  requestAnimationFrame(() => focusTarget.focus());
}

async function saveExam(event) {
  event.preventDefault();
  const targets = state.targets.filter((item) => byId(state.classes, item.classId)?.grade === state.selectedPaceGrade);
  if (!targets.length) return;
  const targetPage = Math.max(1, Number($("#exam-target").value) || 1);
  const cutoffDate = $("#exam-date").value;
  const updatedAt = new Date().toISOString();
  for (const target of targets) {
    const updated = { ...target, targetPage, cutoffDate, updatedAt };
    await put("examTargets", updated);
    await queueEntity("examTargets", updated);
  }
  $("#exam-dialog").close();
  await load({ seed: false });
  showToast(`${state.selectedPaceGrade || "目前年級"}段考目標已更新`, "🎯");
  void syncGoogleSheet();
}

document.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("hidden", view.id !== `view-${button.dataset.view}`));
  renderAll();
}));
document.querySelectorAll("[data-import-kind]").forEach((input) => input.addEventListener("change", handleImport));
$("#import-result").addEventListener("change", (event) => { if (event.target.matches("[data-field]")) void updateImportCandidate(event.target); });
$("#import-result").addEventListener("click", (event) => {
  const action = event.target.closest("[data-import-action]")?.dataset.importAction;
  if (action === "cancel") void cancelImportBatch();
  if (action === "apply") void applyImportBatch();
});
document.querySelectorAll(".dialog-close").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$("#export-button").addEventListener("click", exportCsv);
$("#swap-button").addEventListener("click", openSwapDialog);
$("#swap-form").addEventListener("submit", saveSwap);
$("#schedule-form").addEventListener("submit", saveSchedule);
$("#manage-classes").addEventListener("click", openClassesDialog);
$("#add-class-row").addEventListener("click", () => $("#class-list").insertAdjacentHTML("beforeend", classRowTemplate()));
$("#class-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-class]");
  if (!button) return;
  button.closest(".class-row").remove();
});
$("#classes-form").addEventListener("submit", saveClasses);
$("#exam-config-button").addEventListener("click", openExamDialog);
$("#exam-target-config-button").addEventListener("click", openExamDialog);
$("#exam-form").addEventListener("submit", saveExam);
$("#connection-state").addEventListener("click", async () => {
  $("#spreadsheet-id").value = await selectedSpreadsheetId();
  $("#sync-access-code").value = "";
  if (!googleRemoteConfigured()) setConnectionStatus("尚未設定雲端後端");
  $("#cloud-dialog").showModal();
});
$("#close-cloud-dialog").addEventListener("click", () => $("#cloud-dialog").close());
$("#connect-google").addEventListener("click", async () => {
  try {
    setConnectionStatus("正在連接安全後端…");
    await connectGoogle($("#sync-access-code").value);
    $("#sync-access-code").value = "";
    await syncGoogleSheet();
  } catch (error) {
    console.error(error);
    const messages = {
      REMOTE_NOT_CONFIGURED: "尚未設定雲端後端",
      REMOTE_AUTH_REQUIRED: "請輸入同步存取碼",
      INVALID_SYNC_SECRET: "同步存取碼錯誤"
    };
    setConnectionStatus(messages[error.message] || (error.status === 401 ? "同步存取碼錯誤" : "後端連線失敗"));
  }
});
$("#disconnect-google").addEventListener("click", () => { disconnectGoogle(); $("#sync-access-code").value = ""; setConnectionStatus("本機已儲存"); });
window.addEventListener("online", () => { setConnectionStatus(isGoogleConnected() ? "同步中…" : "本機已儲存"); void syncGoogleSheet(); });
window.addEventListener("offline", () => setConnectionStatus("離線 · 本機已儲存"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  refreshCurrentLessonIndicator();
  void syncGoogleSheet();
});
setInterval(refreshCurrentLessonIndicator, 30000);
setInterval(() => { void syncGoogleSheet(); }, AUTO_SYNC_INTERVAL_MS);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
load().then(async () => {
  $("#spreadsheet-id").value = await selectedSpreadsheetId();
  const connected = isGoogleConnected();
  setConnectionStatus(navigator.onLine ? (connected ? "同步中…" : googleRemoteConfigured() ? "本機已儲存" : "尚未設定雲端後端") : "離線 · 本機已儲存");
  if (connected) void syncGoogleSheet();
}).catch((error) => { console.error(error); showToast("資料庫啟動失敗，請重新整理", "⚠️"); });
