import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("參考介面的四分頁與卡片內快記控制已還原", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, />今日課堂<\/button>/);
  assert.match(html, />段考配速<\/button>/);
  assert.match(html, />常規課表<\/button>/);
  assert.match(html, />AI 匯入<\/button>/);
  const app = await readFile(new URL("../dist/app.js", import.meta.url), "utf8");
  assert.match(app, /data-step="1"/);
  assert.match(app, /data-step="2"/);
  assert.match(app, /saveInlineRecord/);
});

test("介面會依手機、平板與桌機寬度切換欄數", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const responsive = await readFile(new URL("../dist/responsive.css", import.meta.url), "utf8");
  assert.match(html, /responsive\.css/);
  assert.match(responsive, /min-width:\s*700px/);
  assert.match(responsive, /min-width:\s*1050px/);
  assert.match(responsive, /repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
});

test("Google Sheet 遠端儲存透過 Apps Script 安全橋接且不把 Google 憑證送到前端", async () => {
  const [html, remote, pagesWorkflow, appsScript, bridge, serviceWorker] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/remote.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/Bridge.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/sw.js", import.meta.url), "utf8")
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
  assert.doesNotMatch(`${html}\n${remote}\n${pagesWorkflow}`, /client_secret|private_key|BEGIN PRIVATE KEY/i);
});
