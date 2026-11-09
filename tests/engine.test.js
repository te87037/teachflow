import test from "node:test";
import assert from "node:assert/strict";
import { browserDateKey, classProgress, currentOrNextLessonId, expandLessons, latestProgress, lessonInstanceId, pace, remainingLessons } from "../dist/engine.js";

const assignment = (id, weekday, periodId = "p1", classId = "c1", grade = "七年級") => ({ id, weekday, periodId, classId, grade, subjectId: "s1", materialId: "m1" });

test("同班同日兩節課有不同授課實例 ID", () => {
  assert.notEqual(lessonInstanceId("2026-11-09", "p1", "a1"), lessonInstanceId("2026-11-09", "p2", "a2"));
});

test("課表版本依有效日期切換，不回寫過去", () => {
  const lessons = expandLessons({ startDate: "2026-11-09", endDate: "2026-11-16", scheduleVersions: [
    { id: "v1", effectiveFrom: "2026-09-01", effectiveTo: "2026-11-10", assignments: [assignment("old", 1)] },
    { id: "v2", effectiveFrom: "2026-11-11", effectiveTo: null, assignments: [assignment("new", 1)] }
  ] });
  assert.equal(lessons.find((item) => item.date === "2026-11-09").id.includes("old"), true);
  assert.equal(lessons.find((item) => item.date === "2026-11-16").id.includes("new"), true);
});

test("週六可映射週一補課", () => {
  const lessons = expandLessons({ startDate: "2026-11-14", endDate: "2026-11-14", scheduleVersions: [{ id: "v1", effectiveFrom: "2026-09-01", assignments: [assignment("a1", 1)] }], events: [{ id: "e1", type: "makeup", startDate: "2026-11-14", endDate: "2026-11-14", mappedWeekday: 1 }] });
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].source, "makeup");
});

test("年級與節次範圍只取消適用課堂", () => {
  const lessons = expandLessons({ startDate: "2026-11-09", endDate: "2026-11-09", scheduleVersions: [{ id: "v1", effectiveFrom: "2026-09-01", assignments: [assignment("a1", 1, "p1", "c1", "七年級"), assignment("a2", 1, "p2", "c2", "八年級")] }], events: [{ id: "exam", type: "exam", title: "七年級模擬考", startDate: "2026-11-09", endDate: "2026-11-09", grades: ["七年級"], periodIds: ["p1"], blocksTeaching: true }] });
  assert.equal(lessons.find((item) => item.id.includes("a1")).status, "cancelled");
  assert.equal(lessons.find((item) => item.id.includes("a2")).status, "scheduled");
});

test("單次停課不改變下一週常規課堂", () => {
  const lessons = expandLessons({ startDate: "2026-11-09", endDate: "2026-11-16", scheduleVersions: [{ id: "v1", effectiveFrom: "2026-09-01", assignments: [assignment("a1", 1)] }], exceptions: [{ id: "x1", type: "cancel", date: "2026-11-09", periodId: "p1", reason: "演講" }] });
  assert.equal(lessons.find((item) => item.date === "2026-11-09").status, "cancelled");
  assert.equal(lessons.find((item) => item.date === "2026-11-16").status, "scheduled");
});

test("剩餘堂數排除停課且不包含考試日", () => {
  const lessons = [{ date: "2026-11-10", classId: "c1", subjectId: "s1", status: "scheduled" }, { date: "2026-11-11", classId: "c1", subjectId: "s1", status: "cancelled" }, { date: "2026-11-12", classId: "c1", subjectId: "s1", status: "scheduled" }];
  assert.equal(remainingLessons(lessons, { classId: "c1", subjectId: "s1", fromDate: "2026-11-10", cutoffDate: "2026-11-12" }).length, 1);
});

test("配速公式與零堂警示", () => {
  assert.deepEqual(pace({ targetPage: 52, completedPage: 20, remainingCount: 8 }), { remainingPages: 32, perLesson: 4, warning: null });
  assert.equal(pace({ targetPage: 52, completedPage: 20, remainingCount: 0 }).warning, "已無剩餘課堂");
});

test("目前進度以班級最後一次修改為準，任何日期都能更新", () => {
  const current = latestProgress([
    { id: "late-edit", lessonDate: "2026-11-01", periodId: "p1", status: "completed", updatedAt: "2026-11-20" },
    { id: "latest-lesson", lessonDate: "2026-11-02", periodId: "p1", status: "completed", updatedAt: "2026-11-02" }
  ]);
  assert.equal(current.id, "late-edit");
});

test("同班所有節次共用最新進度且不受單元或教材影響", () => {
  const current = classProgress([
    { id: "old-unit", classId: "c1", lessonDate: "2026-11-09", periodId: "p1", chapter: "第一單元", materialId: "m1", page: 20, status: "completed" },
    { id: "new-unit", classId: "c1", lessonDate: "2026-11-10", periodId: "p2", chapter: "第二單元", materialId: "m2", page: 35, status: "completed" },
    { id: "other-class", classId: "c2", lessonDate: "2026-11-11", periodId: "p3", chapter: "第三單元", materialId: "m3", page: 99, status: "completed" }
  ], "c1");
  assert.equal(current.id, "new-unit");
  assert.equal(current.page, 35);
});

test("當前或下一節依瀏覽器本地日期與時間判斷", () => {
  const now = new Date(2026, 10, 10, 9, 5);
  const lessons = [{ id: "lesson-1", periodId: "p1" }, { id: "lesson-2", periodId: "p2" }];
  const periods = [
    { id: "p1", start: "08:10", end: "09:00" },
    { id: "p2", start: "09:10", end: "10:00" }
  ];
  assert.equal(browserDateKey(now), "2026-11-10");
  assert.equal(currentOrNextLessonId({ lessons, periods, selectedDate: "2026-11-10", now }), "lesson-2");
  assert.equal(currentOrNextLessonId({ lessons, periods, selectedDate: "2026-11-11", now }), null);
});

test("最後一節下課後不再標示當前或下一節", () => {
  const lessons = [{ id: "lesson-7", periodId: "p7" }];
  const periods = [{ id: "p7", start: "15:10", end: "16:00" }];
  assert.equal(currentOrNextLessonId({ lessons, periods, selectedDate: "2026-11-10", now: new Date(2026, 10, 10, 16, 1) }), null);
});
