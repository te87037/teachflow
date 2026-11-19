import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("參考介面的四分頁與卡片內快記控制已還原", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, />今日課堂<\/button>/);
  assert.match(html, />段考配速<\/button>/);
  assert.match(html, />常規課表<\/button>/);
  assert.match(html, />AI 匯入<\/button>/);
  assert.match(html, /id="manage-classes"/);
  assert.match(html, /id="classes-dialog"/);
  assert.match(html, /classes\.css\?v=23/);
  assert.match(html, /app\.js\?v=24/);
  assert.match(html, /id="header-class-count"/);
  assert.match(html, /id="exam-target-config-button"/);
  assert.match(html, /id="pace-grade-buttons"/);
  const app = await readFile(new URL("../dist/app.js", import.meta.url), "utf8");
  assert.match(app, /data-step="1"/);
  assert.match(app, /data-step="2"/);
  assert.match(app, /saveInlineRecord/);
  assert.match(app, /classSaveQueues/);
  assert.match(app, /optimisticPages/);
  assert.match(app, /enqueueInlineRecordUpdate/);
  assert.match(app, /saveClasses/);
  assert.match(app, /queueEntity\("classes"/);
  assert.match(app, /selectedPaceGrade/);
  assert.match(app, /grade-filter-button/);
  assert.match(app, /exam-target-config-button/);
  assert.match(app, /套用至此年級的所有班級/);
  assert.match(app, /remainingLessonCount/);
  assert.match(app, /考前實質尚有：/);
  assert.match(app, /remaining-count-step/);
  assert.match(app, /adjustRemainingLessonCount/);
  assert.match(app, /queueEntity\("examTargets", updated\)/);
  assert.match(app, /AUTO_SYNC_INTERVAL_MS\s*=\s*60\s*\*\s*1000/);
  assert.match(app, /setInterval\(\(\)\s*=>\s*\{\s*void syncGoogleSheet\(\)/);
  assert.match(app, /remoteFingerprint/);
  assert.match(app, /header-class-count/);
  assert.match(app, /當日 \$\{lessons\.length\} 堂課/);
});

test("介面會依手機、平板與桌機寬度切換欄數", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const responsive = await readFile(new URL("../dist/responsive.css", import.meta.url), "utf8");
  const ocr = await readFile(new URL("../dist/ocr.css", import.meta.url), "utf8");
  assert.match(html, /responsive\.css/);
  assert.match(responsive, /max-width:\s*430px/);
  assert.match(responsive, /overflow-x:\s*hidden/);
  assert.match(responsive, /safe-area-inset-bottom/);
  assert.match(ocr, /max-width:\s*430px/);
  assert.match(responsive, /min-width:\s*700px/);
  assert.match(responsive, /min-width:\s*1050px/);
  assert.match(responsive, /repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
});

test("Google Sheet 遠端儲存透過 Apps Script 安全橋接且不把 Google 憑證送到前端", async () => {
  const [html, remote, pagesWorkflow, appsScript, bridge, serviceWorker, classesCss] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/remote.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/Bridge.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/classes.css", import.meta.url), "utf8")
  ]);
  assert.match(html, /remote-config\.js/);
  assert.match(html, /Google Sheet 遠端儲存/);
  assert.match(html, /TeachFlow 同步存取碼/);
  assert.match(html, /自訂／變更同步存取碼/);
  assert.match(remote, /localStorage\.setItem/);
  assert.match(remote, /teachflow-sync-request/);
  assert.match(remote, /teachflow-secret-change-request/);
  assert.match(pagesWorkflow, /TEACHFLOW_SYNC_BRIDGE_URL/);
  assert.match(pagesWorkflow, /GOOGLE_SHEETS_SPREADSHEET_ID/);
  assert.match(appsScript, /PropertiesService\.getScriptProperties/);
  assert.match(appsScript, /changeTeachFlowSecret/);
  assert.match(appsScript, /setProperty\("TEACHFLOW_SYNC_SECRET"/);
  assert.match(appsScript, /SpreadsheetApp\.openById/);
  assert.match(appsScript, /LockService\.getScriptLock/);
  assert.match(bridge, /event\.origin !== PARENT_ORIGIN/);
  assert.match(bridge, /teachflow-secret-change-request/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
  assert.match(serviceWorker, /classes\.css/);
  assert.match(classesCss, /max-width:\s*430px/);
  assert.match(classesCss, /#exam-date-label/);
  assert.match(classesCss, /font-size:\s*15px/);
  assert.match(classesCss, /#exam-days-label/);
  assert.match(classesCss, /font-size:\s*36px/);
  assert.doesNotMatch(`${html}\n${remote}\n${pagesWorkflow}`, /client_secret|private_key|BEGIN PRIVATE KEY/i);
});

test("OCR 使用 PDF.js、Apps Script Drive OCR 與人工核對後套用", async () => {
  const [html, app, ocr, db, appsScript, bridge, manifest, serviceWorker] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/app.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/ocr.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/db.js", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/Bridge.html", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/appsscript.json", import.meta.url), "utf8"),
    readFile(new URL("../dist/sw.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /Google Drive OCR 已啟用/);
  assert.match(ocr, /pdf\.worker\.mjs/);
  assert.match(ocr, /MAX_PAGES_PER_BATCH/);
  assert.match(app, /pending-review/);
  assert.match(app, /commitImportBatch/);
  assert.match(db, /transaction\(stores, "readwrite"\)/);
  assert.match(appsScript, /recognizeTeachFlowPage/);
  assert.match(appsScript, /setTrashed\(true\)/);
  assert.match(bridge, /teachflow-ocr-request/);
  assert.match(manifest, /"serviceId": "drive"/);
  assert.match(serviceWorker, /ocr-parser\.js/);
});

test("移交指南包含初學者可完成的 Apps Script 部署與更新流程", async () => {
  const guide = await readFile(new URL("../TeachFlow-完整移交搬遷指南.html", import.meta.url), "utf8");
  assert.match(guide, /Apps Script 從零建立與部署（初學者版）/);
  assert.match(guide, /Code\.gs/);
  assert.match(guide, /Bridge\.html/);
  assert.match(guide, /appsscript\.json/);
  assert.match(guide, /GOOGLE_SHEETS_SPREADSHEET_ID/);
  assert.match(guide, /TEACHFLOW_SYNC_SECRET/);
  assert.match(guide, /新增部署作業/);
  assert.match(guide, /管理部署作業/);
  assert.match(guide, /新版本/);
  assert.match(guide, /ANYONE_ANONYMOUS/);
  assert.match(guide, /\/exec/);
  assert.match(guide, /Apps Script 常見錯誤對照/);
});
