import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("課堂紀錄的關閉與取消按鈕不會送出表單", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const closeButtons = [...html.matchAll(/<button[^>]*class="[^"]*close-record-dialog[^"]*"[^>]*>/g)].map((match) => match[0]);
  assert.equal(closeButtons.length, 2);
  for (const button of closeButtons) assert.match(button, /type="button"/);
  assert.match(html, /id="save-record"[^>]*type="submit"/);
});

test("Google Sheet 遠端儲存使用 OAuth 公開設定且不含私鑰", async () => {
  const [html, remote, workflow, serviceWorker] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/remote.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../dist/sw.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /remote-config\.js/);
  assert.match(html, /Google Sheet 遠端儲存/);
  assert.match(remote, /https:\/\/www\.googleapis\.com\/auth\/spreadsheets/);
  assert.match(remote, /valueInputOption=RAW/);
  assert.match(workflow, /GOOGLE_OAUTH_CLIENT_ID/);
  assert.match(workflow, /GOOGLE_SHEETS_SPREADSHEET_ID/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
  assert.doesNotMatch(`${html}\n${remote}\n${workflow}`, /client_secret|private_key|service[_-]role/i);
});
