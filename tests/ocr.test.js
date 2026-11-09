import test from "node:test";
import assert from "node:assert/strict";
import { parseImportCandidates } from "../dist/ocr-parser.js";

test("課表 OCR 候選保留來源頁並辨識星期節次班級", () => {
  const candidates = parseImportCandidates("schedule", [{ pageNumber: 2, text: "星期一 第2節 701班 公民" }], [{ id: "c701", name: "701 班" }]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].weekday, 1);
  assert.equal(candidates[0].period, 2);
  assert.equal(candidates[0].className, "701 班");
  assert.equal(candidates[0].sourcePage, 2);
  assert.equal(candidates[0].pendingReason, null);
});

test("校曆 OCR 候選辨識日期、考試與補課映射", () => {
  const candidates = parseImportCandidates("calendar", [{ pageNumber: 1, text: "2026/11/18 第一次段考\n2026/11/21 補課補週一" }]);
  assert.equal(candidates[0].date, "2026-11-18");
  assert.equal(candidates[0].eventType, "exam");
  assert.equal(candidates[1].eventType, "makeup");
  assert.equal(candidates[1].mappedWeekday, 1);
});

test("課表 OCR 可依星期標題與列順序拆成表格候選", () => {
  const candidates = parseImportCandidates("schedule", [{ pageNumber: 1, text: "星期一 星期二 星期三\n1 701 703 705" }], [
    { name: "701 班" }, { name: "703 班" }, { name: "705 班" }
  ]);
  assert.deepEqual(candidates.map((item) => [item.weekday, item.period, item.className]), [[1, 1, "701 班"], [2, 1, "703 班"], [3, 1, "705 班"]]);
});

test("無法辨識的文件建立 null 待確認候選，不自行套用", () => {
  const [candidate] = parseImportCandidates("schedule", [{ pageNumber: 1, text: "模糊內容" }], []);
  assert.equal(candidate.weekday, null);
  assert.equal(candidate.period, null);
  assert.equal(candidate.className, null);
  assert.match(candidate.pendingReason, /待確認/);
});
