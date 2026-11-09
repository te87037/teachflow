function lineList(text) {
  return String(text || "").replace(/\r/g, "").split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function weekdayNumber(text) {
  const match = text.match(/(?:星期|週)\s*([一二三四五六日])/);
  return match ? "一二三四五六日".indexOf(match[1]) + 1 : null;
}

function periodNumber(text) {
  const match = text.match(/(?:第\s*)?(10|[1-9])\s*(?:節|堂)/);
  return match ? Number(match[1]) : null;
}

function className(text, knownClasses) {
  return knownClasses.find((name) => text.includes(name.replace(/\s/g, ""))) || text.match(/(?:^|\D)(\d{3})(?:班)?(?:\D|$)/)?.[1] || null;
}

function pendingReason(fields) {
  const missing = Object.entries(fields).filter(([, value]) => value === null || value === "").map(([key]) => key);
  return missing.length ? `待確認：${missing.join("、")}` : null;
}

function scheduleCandidates(pages, knownClasses) {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (page, line, weekday, period, klass) => {
    const key = `${page.pageNumber}:${weekday || ""}:${period || ""}:${klass || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    const fields = { weekday, period, className: klass };
    candidates.push({ id: crypto.randomUUID(), type: "schedule", ...fields, sourcePage: page.pageNumber, sourceText: line.slice(0, 500), pendingReason: pendingReason(fields) });
  };
  for (const page of pages) {
    const lines = lineList(page.text);
    let tableWeekdays = null;
    for (const line of lines) {
      const headerDays = [...line.matchAll(/(?:星期|週)\s*([一二三四五六日])/g)].map((match) => "一二三四五六日".indexOf(match[1]) + 1);
      if (headerDays.length >= 2) {
        tableWeekdays = headerDays;
        continue;
      }
      const weekday = weekdayNumber(line);
      const period = periodNumber(line) || Number(line.match(/^\s*(10|[1-9])(?:\s|[、.:：])/u)?.[1] || 0) || null;
      const compact = line.replace(/\s/g, "");
      const knownMatches = knownClasses.filter((name) => compact.includes(name.replace(/\s/g, ""))).sort((a, b) => compact.indexOf(a.replace(/\s/g, "")) - compact.indexOf(b.replace(/\s/g, "")));
      const numericMatches = [...line.matchAll(/(?:^|\D)(\d{3})(?:班)?(?=\D|$)/g)].map((match) => knownClasses.find((name) => name.match(/\d{3}/)?.[0] === match[1]) || match[1]);
      const classes = knownMatches.length ? knownMatches : numericMatches;
      if (tableWeekdays && period && classes.length) {
        classes.slice(0, tableWeekdays.length).forEach((klass, index) => addCandidate(page, line, tableWeekdays[index], period, klass));
        continue;
      }
      const klass = className(compact, knownClasses);
      if ([weekday, period, klass].filter(Boolean).length < 2) continue;
      addCandidate(page, line, weekday, period, klass);
    }
  }
  if (!candidates.length) candidates.push({ id: crypto.randomUUID(), type: "schedule", weekday: null, period: null, className: null, sourcePage: pages[0]?.pageNumber || 1, sourceText: pages[0]?.text?.slice(0, 500) || "未辨識到文字", pendingReason: "待確認：weekday、period、className" });
  return candidates;
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateFromLine(line, defaultYear) {
  const full = line.match(/(20\d{2})[年\/-]\s*(\d{1,2})[月\/-]\s*(\d{1,2})/);
  if (full) return isoDate(Number(full[1]), Number(full[2]), Number(full[3]));
  const short = line.match(/(?:^|\D)(\d{1,2})[月\/-]\s*(\d{1,2})(?:日)?(?:\D|$)/);
  return short ? isoDate(defaultYear, Number(short[1]), Number(short[2])) : null;
}

function eventType(line) {
  if (/補課/.test(line)) return "makeup";
  if (/段考|考試|模擬考/.test(line)) return "exam";
  if (/放假|停課|休業/.test(line)) return "holiday";
  return "event";
}

function mappedWeekday(line) {
  const match = line.match(/補(?:行)?(?:星期|週)\s*([一二三四五])/);
  return match ? "一二三四五".indexOf(match[1]) + 1 : null;
}

function calendarCandidates(pages) {
  const candidates = [];
  const defaultYear = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Taipei", year: "numeric" }).format(new Date()));
  for (const page of pages) {
    for (const line of lineList(page.text)) {
      const date = dateFromLine(line, defaultYear);
      const relevant = /補課|段考|考試|模擬考|放假|停課|活動|休業|校慶/.test(line);
      if (!date && !relevant) continue;
      const fields = { date, title: relevant ? line.slice(0, 120) : "" };
      candidates.push({ id: crypto.randomUUID(), type: "calendar", ...fields, eventType: eventType(line), mappedWeekday: mappedWeekday(line), sourcePage: page.pageNumber, sourceText: line.slice(0, 500), pendingReason: pendingReason(fields) });
    }
  }
  if (!candidates.length) candidates.push({ id: crypto.randomUUID(), type: "calendar", date: null, title: "", eventType: "event", sourcePage: pages[0]?.pageNumber || 1, sourceText: pages[0]?.text?.slice(0, 500) || "未辨識到文字", pendingReason: "待確認：date、title" });
  return candidates;
}

export function parseImportCandidates(kind, pages, classes = []) {
  const knownClasses = classes.map((item) => item.name).filter(Boolean);
  return kind === "schedule" ? scheduleCandidates(pages, knownClasses) : calendarCandidates(pages);
}
