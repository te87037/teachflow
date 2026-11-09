const CONFIG = window.__TEACHFLOW_GOOGLE_CONFIG__ || {};
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEET_NAME = "TeachFlow資料";
const HEADER = ["操作ID", "資料類型", "資料ID", "動作", "修改時間", "JSON資料"];

let accessToken = "";
let tokenClient;
let googleScriptPromise;

export function googleRemoteConfigured() {
  return Boolean(CONFIG.clientId);
}

export function configuredSpreadsheetId() {
  return CONFIG.spreadsheetId || "";
}

export function extractSpreadsheetId(value) {
  const text = String(value || "").trim();
  return text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] || text;
}

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("GOOGLE_SCRIPT_FAILED"));
    document.head.append(script);
  });
  return googleScriptPromise;
}

export async function connectGoogle() {
  if (!googleRemoteConfigured()) throw new Error("GOOGLE_CLIENT_NOT_CONFIGURED");
  await loadGoogleIdentityServices();
  return new Promise((resolve, reject) => {
    tokenClient ||= window.google.accounts.oauth2.initTokenClient({ client_id: CONFIG.clientId, scope: SCOPE, callback: () => {} });
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      accessToken = response.access_token;
      resolve(response);
    };
    tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  });
}

export function disconnectGoogle() {
  if (accessToken && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(accessToken);
  accessToken = "";
}

export function isGoogleConnected() {
  return Boolean(accessToken);
}

async function googleApi(url, options = {}) {
  if (!accessToken) throw new Error("GOOGLE_AUTH_REQUIRED");
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (response.status === 401) accessToken = "";
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    const error = new Error(details.error?.message || `GOOGLE_API_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function ensureDataSheet(spreadsheetId) {
  const id = encodeURIComponent(spreadsheetId);
  const metadata = await googleApi(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`);
  if (metadata.sheets?.some((sheet) => sheet.properties?.title === SHEET_NAME)) return;
  await googleApi(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_NAME, frozenRowCount: 1 } } }] })
  });
  const range = encodeURIComponent(`${SHEET_NAME}!A1:F1`);
  await googleApi(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ range: `${SHEET_NAME}!A1:F1`, majorDimension: "ROWS", values: [HEADER] })
  });
}

export async function pullOperations(spreadsheetId) {
  await ensureDataSheet(spreadsheetId);
  const id = encodeURIComponent(spreadsheetId);
  const range = encodeURIComponent(`${SHEET_NAME}!A2:F`);
  const result = await googleApi(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?majorDimension=ROWS`);
  const seen = new Set();
  return (result.values || []).flatMap((row) => {
    const [operationId, entityType, entityId, operation, updatedAt, payloadText] = row;
    if (!operationId || seen.has(operationId)) return [];
    seen.add(operationId);
    try {
      return [{ operationId, entityType, entityId, operation, updatedAt, payload: payloadText ? JSON.parse(payloadText) : null }];
    } catch {
      return [];
    }
  });
}

export async function appendOperations(spreadsheetId, operations) {
  if (!operations.length) return;
  await ensureDataSheet(spreadsheetId);
  const id = encodeURIComponent(spreadsheetId);
  const range = encodeURIComponent(`${SHEET_NAME}!A:F`);
  const values = operations.map((item) => [item.operationId, item.entityType, item.entityId, item.operation, item.updatedAt, item.payload ? JSON.stringify(item.payload) : ""]);
  await googleApi(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ range: `${SHEET_NAME}!A:F`, majorDimension: "ROWS", values })
  });
}
