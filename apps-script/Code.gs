const SHEET_NAME = "TeachFlow資料";
const HEADER = ["操作ID", "資料類型", "資料ID", "動作", "修改時間", "JSON資料"];
const MAX_OPERATIONS = 500;
const MAX_PAYLOAD_CHARS = 900000;
const MAX_OCR_BASE64_CHARS = 6000000;
const OCR_MIME_TYPES = ["image/jpeg", "image/png"];

function doGet() {
  return HtmlService.createHtmlOutputFromFile("Bridge")
    .setTitle("TeachFlow Sync Bridge")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function digest_(value) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ""), Utilities.Charset.UTF_8)
  );
}

function digestBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
  );
}

function authorize_(request) {
  const properties = PropertiesService.getScriptProperties();
  const expectedSecret = properties.getProperty("TEACHFLOW_SYNC_SECRET");
  if (!expectedSecret) throw new Error("BACKEND_NOT_CONFIGURED");
  if (digest_(request && request.secret) !== digest_(expectedSecret)) throw new Error("INVALID_SYNC_SECRET");
  return properties;
}

function validOperations_(operations) {
  return Array.isArray(operations) && operations.length <= MAX_OPERATIONS && operations.every(function(item) {
    return item && typeof item === "object" &&
      typeof item.operationId === "string" && item.operationId.length <= 100 &&
      typeof item.entityType === "string" && item.entityType.length <= 80 &&
      typeof item.entityId === "string" && item.entityId.length <= 120 &&
      (item.operation === "upsert" || item.operation === "delete") &&
      typeof item.updatedAt === "string" && item.updatedAt.length <= 40;
  });
}

function readOperations_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const seen = {};
  return rows.reduce(function(result, row) {
    const operationId = String(row[0] || "");
    if (!operationId || seen[operationId]) return result;
    seen[operationId] = true;
    try {
      result.push({
        operationId: operationId,
        entityType: String(row[1] || ""),
        entityId: String(row[2] || ""),
        operation: String(row[3] || ""),
        updatedAt: String(row[4] || ""),
        payload: row[5] ? JSON.parse(String(row[5])) : null
      });
    } catch (error) {
      console.warn("Skipped malformed TeachFlow operation", operationId);
    }
    return result;
  }, []);
}

function ensureSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function syncTeachFlow(request) {
  const properties = authorize_(request);
  const spreadsheetId = properties.getProperty("GOOGLE_SHEETS_SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("BACKEND_NOT_CONFIGURED");

  const operations = request && request.operations ? request.operations : [];
  if (!validOperations_(operations)) throw new Error("INVALID_OPERATIONS");
  if (JSON.stringify(operations).length > MAX_PAYLOAD_CHARS) throw new Error("PAYLOAD_TOO_LARGE");
  if (request.spreadsheetId && request.spreadsheetId !== spreadsheetId) throw new Error("SPREADSHEET_NOT_ALLOWED");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ensureSheet_(spreadsheet);
    const remoteOperations = readOperations_(sheet);
    const existing = {};
    remoteOperations.forEach(function(item) { existing[item.operationId] = true; });
    const additions = operations.filter(function(item) { return !existing[item.operationId]; });
    if (additions.length) {
      const values = additions.map(function(item) {
        return [
          item.operationId,
          item.entityType,
          item.entityId,
          item.operation,
          item.updatedAt,
          item.payload ? JSON.stringify(item.payload) : ""
        ];
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 6).setValues(values);
      SpreadsheetApp.flush();
    }
    return { operations: remoteOperations.concat(additions) };
  } finally {
    lock.releaseLock();
  }
}

function recognizeTeachFlowPage(request) {
  authorize_(request);
  const page = request && request.page;
  if (!page || typeof page !== "object") throw new Error("INVALID_OCR_PAGE");
  if (OCR_MIME_TYPES.indexOf(page.mimeType) < 0) throw new Error("INVALID_OCR_MIME");
  if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1 || page.pageNumber > 100) throw new Error("INVALID_OCR_PAGE_NUMBER");
  if (typeof page.base64 !== "string" || !page.base64.length || page.base64.length > MAX_OCR_BASE64_CHARS) throw new Error("OCR_PAGE_TOO_LARGE");

  let bytes;
  try {
    bytes = Utilities.base64Decode(page.base64);
  } catch (error) {
    throw new Error("INVALID_OCR_BASE64");
  }
  const safeName = String(page.fileName || "TeachFlow-page").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  const blob = Utilities.newBlob(bytes, page.mimeType, safeName);
  let documentId;
  try {
    const documentFile = Drive.Files.create({
      name: "TeachFlow OCR - " + Utilities.getUuid(),
      mimeType: "application/vnd.google-apps.document"
    }, blob, {
      ocrLanguage: "zh-TW",
      fields: "id"
    });
    documentId = documentFile.id;
    const text = DocumentApp.openById(documentId).getBody().getText();
    return {
      pageNumber: page.pageNumber,
      text: text || "",
      provider: "google-drive-ocr",
      digest: digestBytes_(bytes)
    };
  } finally {
    if (documentId) {
      try { DriveApp.getFileById(documentId).setTrashed(true); }
      catch (cleanupError) { console.warn("OCR temporary document cleanup failed", documentId); }
    }
  }
}
