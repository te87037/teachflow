import { GlobalWorkerOptions, getDocument } from "./vendor/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", import.meta.url).href;

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_PAGES_PER_BATCH = 30;
const OCR_IMAGE_MAX_EDGE = 2200;

function bytesMatch(bytes, expected) {
  return expected.every((value, index) => bytes[index] === value);
}

async function validateFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超過 15 MB`);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const signatures = {
    "application/pdf": bytesMatch(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]),
    "image/jpeg": bytesMatch(bytes, [0xff, 0xd8, 0xff]),
    "image/png": bytesMatch(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  };
  if (!signatures[file.type]) throw new Error(`${file.name} 的實際檔案格式不符`);
}

function textFromItems(items) {
  let text = "";
  let previousY = null;
  for (const item of items) {
    const y = Math.round(item.transform?.[5] || 0);
    if (previousY !== null && Math.abs(y - previousY) > 3) text += "\n";
    else if (text && !text.endsWith("\n")) text += " ";
    text += item.str || "";
    previousY = y;
  }
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

function canvasBlob(canvas, type = "image/jpeg", quality = 0.88) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("IMAGE_ENCODE_FAILED")), type, quality));
}

function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function renderPdfPage(page, fileName, pageNumber) {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, OCR_IMAGE_MAX_EDGE / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale: Math.max(0.25, scale) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const blob = await canvasBlob(canvas);
  return { pageNumber, fileName: `${fileName}-p${pageNumber}.jpg`, mimeType: "image/jpeg", base64: await blobBase64(blob) };
}

async function preparePdf(file, remainingPages, onProgress) {
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  if (pdf.numPages > remainingPages) throw new Error(`批次最多 ${MAX_PAGES_PER_BATCH} 頁`);
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(`讀取 ${file.name} 第 ${pageNumber}/${pdf.numPages} 頁…`);
    const page = await pdf.getPage(pageNumber);
    const text = textFromItems((await page.getTextContent()).items);
    if (text.replace(/\s/g, "").length >= 40) {
      pages.push({ pageNumber, fileName: file.name, text, provider: "pdf-text" });
    } else {
      pages.push(await renderPdfPage(page, file.name, pageNumber));
    }
    page.cleanup();
  }
  return pages;
}

async function prepareImage(file, pageNumber, onProgress) {
  onProgress?.(`準備 ${file.name}…`);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, OCR_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvasBlob(canvas);
  return { pageNumber, fileName: file.name, mimeType: "image/jpeg", base64: await blobBase64(blob) };
}

export async function prepareImportPages(files, onProgress) {
  const pages = [];
  for (const file of files) {
    await validateFile(file);
    if (file.type === "application/pdf") pages.push(...await preparePdf(file, MAX_PAGES_PER_BATCH - pages.length, onProgress));
    else pages.push(await prepareImage(file, pages.length + 1, onProgress));
    if (pages.length > MAX_PAGES_PER_BATCH) throw new Error(`批次最多 ${MAX_PAGES_PER_BATCH} 頁`);
  }
  return pages.map((page, index) => ({ ...page, pageNumber: index + 1 }));
}

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
  for (const page of pages) {
    for (const line of lineList(page.text)) {
      const weekday = weekdayNumber(line);
      const period = periodNumber(line);
      const klass = className(line.replace(/\s/g, ""), knownClasses);
      if (!weekday && !period && !klass) continue;
      const fields = { weekday, period, className: klass };
      candidates.push({ id: crypto.randomUUID(), type: "schedule", ...fields, sourcePage: page.pageNumber, sourceText: line.slice(0, 500), pendingReason: pendingReason(fields) });
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
