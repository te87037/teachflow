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
  assert.match(html, /classes\.css\?v=20/);
  assert.match(html, /app\.js\?v=20/);
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
  assert.match(app, /AUTO_SYNC_INTERVAL_MS\s*=\s*60\s*\*\s*1000/);
  assert.match(app, /setInterval\(\(\)\s*=>\s*\{\s*void syncGoogleSheet\(\)/);
  assert.match(app, /remoteFingerprint/);
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
  assert.match(remote, /localStorage\.setItem/);
  assert.match(remote, /teachflow-sync-request/);
  assert.match(pagesWorkflow, /TEACHFLOW_SYNC_BRIDGE_URL/);
  assert.match(pagesWorkflow, /GOOGLE_SHEETS_SPREADSHEET_ID/);
  assert.match(appsScript, /PropertiesService\.getScriptProperties/);
  assert.match(appsScript, /SpreadsheetApp\.openById/);
  assert.match(appsScript, /LockService\.getScriptLock/);
  assert.match(bridge, /event\.origin !== PARENT_ORIGIN/);
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
