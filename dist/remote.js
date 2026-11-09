const CONFIG = window.__TEACHFLOW_GOOGLE_CONFIG__ || {};
const ACCESS_CODE_KEY = "teachflow-sync-access-code";
let bridgeFrame;
let bridgeReady;
let bridgeWindow;
const pendingRequests = new Map();

export function googleRemoteConfigured() {
  return Boolean(CONFIG.apiUrl && CONFIG.spreadsheetId);
}

export function configuredSpreadsheetId() {
  return CONFIG.spreadsheetId || "";
}

export function extractSpreadsheetId(value) {
  const text = String(value || "").trim();
  return text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] || text;
}

function accessCode() {
  try { return localStorage.getItem(ACCESS_CODE_KEY) || ""; } catch { return ""; }
}

function saveAccessCode(value) {
  try { localStorage.setItem(ACCESS_CODE_KEY, value); } catch { /* Persistence may be blocked by the browser. */ }
}

function clearAccessCode() {
  try { localStorage.removeItem(ACCESS_CODE_KEY); } catch { /* Nothing else to clear. */ }
}

function ensureBridge() {
  if (bridgeReady) return bridgeReady;
  bridgeReady = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("BRIDGE_LOAD_TIMEOUT")), 30000);
    const onMessage = (event) => {
      if (event.data?.type === "teachflow-bridge-ready") {
        if (!event.origin.endsWith(".googleusercontent.com")) return;
        bridgeWindow = event.source;
        window.clearTimeout(timeout);
        resolve();
        return;
      }
      if (event.source !== bridgeWindow) return;
      if (event.data?.type !== "teachflow-sync-response") return;
      const pending = pendingRequests.get(event.data.requestId);
      if (!pending) return;
      pendingRequests.delete(event.data.requestId);
      window.clearTimeout(pending.timeout);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.result || {});
    };
    window.addEventListener("message", onMessage);
    bridgeFrame = document.createElement("iframe");
    bridgeFrame.src = CONFIG.apiUrl;
    bridgeFrame.title = "TeachFlow 安全同步";
    bridgeFrame.hidden = true;
    bridgeFrame.referrerPolicy = "no-referrer";
    bridgeFrame.addEventListener("error", () => reject(new Error("BRIDGE_LOAD_FAILED")), { once: true });
    document.body.append(bridgeFrame);
  });
  return bridgeReady;
}

async function remoteApi(spreadsheetId, operations = []) {
  if (!googleRemoteConfigured()) throw new Error("REMOTE_NOT_CONFIGURED");
  const secret = accessCode();
  if (!secret) throw Object.assign(new Error("REMOTE_AUTH_REQUIRED"), { status: 401 });
  await ensureBridge();
  const requestId = crypto.randomUUID();
  const response = await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("SYNC_TIMEOUT"));
    }, 60000);
    pendingRequests.set(requestId, { resolve, reject, timeout });
    bridgeWindow.postMessage({
      type: "teachflow-sync-request",
      requestId,
      payload: { secret, spreadsheetId, operations }
    }, "*");
  });
  return response.operations || [];
}

export async function connectGoogle(code) {
  const normalized = String(code || "").trim();
  if (!normalized) throw new Error("REMOTE_AUTH_REQUIRED");
  saveAccessCode(normalized);
  try {
    await remoteApi(configuredSpreadsheetId(), []);
  } catch (error) {
    clearAccessCode();
    if (String(error.message).includes("INVALID_SYNC_SECRET")) error.status = 401;
    throw error;
  }
}

export function disconnectGoogle() {
  clearAccessCode();
}

export function isGoogleConnected() {
  return Boolean(accessCode());
}

export async function pullOperations(spreadsheetId) {
  return remoteApi(spreadsheetId, []);
}

export async function appendOperations(spreadsheetId, operations) {
  if (!operations.length) return;
  await remoteApi(spreadsheetId, operations);
}
