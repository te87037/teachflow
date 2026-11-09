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
