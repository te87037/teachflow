export const TAIPEI_TZ = "Asia/Taipei";

export function dateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function browserDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeToMinutes(value) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

export function currentOrNextLessonId({ lessons, periods, selectedDate, now = new Date() }) {
  if (selectedDate !== browserDateKey(now)) return null;
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  return [...lessons]
    .map((lesson) => ({ lesson, period: periods.find((item) => item.id === lesson.periodId) }))
    .filter(({ period }) => timeToMinutes(period?.end) !== null)
    .sort((a, b) => timeToMinutes(a.period.start) - timeToMinutes(b.period.start))
    .find(({ period }) => timeToMinutes(period.end) >= currentMinute)?.lesson.id || null;
}

export function weekdayOf(key) {
  const [year, month, day] = key.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function addDays(key, amount) {
  const [year, month, day] = key.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return value.toISOString().slice(0, 10);
}

export function lessonInstanceId(date, periodId, assignmentId) {
  return `${date}:${periodId}:${assignmentId}`;
}

function applies(event, lesson) {
  const inDates = lesson.date >= event.startDate && lesson.date <= event.endDate;
  const gradeOk = !event.grades?.length || event.grades.includes(lesson.grade);
  const classOk = !event.classIds?.length || event.classIds.includes(lesson.classId);
  const periodOk = !event.periodIds?.length || event.periodIds.includes(lesson.periodId);
  return inDates && gradeOk && classOk && periodOk;
}

export function expandLessons({ startDate, endDate, scheduleVersions, events = [], exceptions = [] }) {
  const lessons = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
    const mapping = events.find((event) => event.type === "makeup" && event.startDate === cursor)?.mappedWeekday;
    const weekday = mapping || weekdayOf(cursor);
    const version = scheduleVersions
      .filter((item) => item.effectiveFrom <= cursor && (!item.effectiveTo || item.effectiveTo >= cursor))
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    if (!version) continue;
    const assignments = version.assignments.filter((item) => item.weekday === weekday);
    for (const assignment of assignments) {
      const lesson = {
        ...assignment,
        date: cursor,
        id: lessonInstanceId(cursor, assignment.periodId, assignment.id),
        source: mapping ? "makeup" : "routine",
        status: "scheduled",
        exclusionReason: null
      };
      const blocking = events.find((event) => event.type !== "makeup" && event.blocksTeaching && applies(event, lesson));
      if (blocking) {
        lesson.status = "cancelled";
        lesson.exclusionReason = blocking.title;
      }
      lessons.push(lesson);
    }
  }

  for (const exception of exceptions.filter((item) => !item.revokedAt)) {
    const indexes = lessons
      .map((lesson, index) => ({ lesson, index }))
      .filter(({ lesson }) => lesson.date === exception.date && lesson.periodId === exception.periodId);
    if (exception.type === "cancel") {
      for (const { lesson } of indexes) {
        lesson.status = "cancelled";
        lesson.exclusionReason = exception.reason || "單次停課";
      }
    }
    if (exception.type === "add") {
      const assignment = exception.assignment;
      lessons.push({
        ...assignment,
        date: exception.date,
        id: lessonInstanceId(exception.date, assignment.periodId, assignment.id),
        source: "added",
        status: "scheduled",
        exclusionReason: null
      });
    }
    if (exception.type === "replace" && indexes[0]) {
      Object.assign(indexes[0].lesson, exception.assignment, {
        source: "exception",
        id: lessonInstanceId(exception.date, exception.assignment.periodId, exception.assignment.id),
        status: "scheduled",
        exclusionReason: null
      });
    }
  }
  return lessons.sort((a, b) => a.date.localeCompare(b.date) || String(a.periodId).localeCompare(String(b.periodId)));
}

export function remainingLessons(lessons, { classId, subjectId, cutoffDate, fromDate = dateKey() }) {
  return lessons.filter((lesson) =>
    lesson.classId === classId &&
    lesson.subjectId === subjectId &&
    lesson.status === "scheduled" &&
    lesson.date >= fromDate &&
    lesson.date < cutoffDate
  );
}

export function pace({ targetPage, completedPage, remainingCount }) {
  const remainingPages = Math.max(Number(targetPage) - Number(completedPage), 0);
  return {
    remainingPages,
    perLesson: remainingCount > 0 ? remainingPages / remainingCount : null,
    warning: remainingCount === 0 && remainingPages > 0 ? "已無剩餘課堂" : null
  };
}

export function latestProgress(records) {
  return [...records]
    .filter((record) => record.status === "completed")
    .sort((a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")) || a.lessonDate.localeCompare(b.lessonDate) || String(a.periodId).localeCompare(String(b.periodId)))
    .at(-1) || null;
}

export function classProgress(records, classId) {
  return latestProgress(records.filter((record) => record.classId === classId));
}
