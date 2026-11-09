const DB_NAME = "teachflow";
const DB_VERSION = 1;
const STORES = ["classes", "subjects", "materials", "periods", "scheduleVersions", "calendarEvents", "exceptions", "records", "examTargets", "importBatches", "syncQueue", "settings"];
export const BUSINESS_STORES = STORES.filter((name) => !["syncQueue", "settings"].includes(name));

let databasePromise;

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

export async function all(storeName) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function put(storeName, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function putMany(storeName, values) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    for (const value of values) transaction.objectStore(storeName).put(value);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getSetting(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("settings").objectStore("settings").get(id);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}

export async function exportSnapshot() {
  const entries = await Promise.all(BUSINESS_STORES.map(async (name) => [name, await all(name)]));
  return Object.fromEntries(entries);
}

export async function applyRemoteOperations(operations) {
  const latest = new Map();
  for (const item of operations) {
    if (!BUSINESS_STORES.includes(item.entityType) || !item.entityId) continue;
    const key = `${item.entityType}:${item.entityId}`;
    const current = latest.get(key);
    if (!current || String(item.updatedAt).localeCompare(String(current.updatedAt)) > 0 || (item.updatedAt === current.updatedAt && item.operationId > current.operationId)) latest.set(key, item);
  }
  const db = await openDatabase();
  const transaction = db.transaction(BUSINESS_STORES, "readwrite");
  for (const item of latest.values()) {
    const store = transaction.objectStore(item.entityType);
    if (item.operation === "delete") store.delete(item.entityId);
    else if (item.payload) store.put(item.payload);
  }
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(latest.size);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function remove(storeName, id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearDatabase() {
  const db = await openDatabase();
  const transaction = db.transaction(STORES, "readwrite");
  for (const store of STORES) transaction.objectStore(store).clear();
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function seedIfEmpty() {
  const settings = await all("settings");
  if (settings.some((item) => item.id === "seeded")) return;
  const classes = [
    { id: "class-701", name: "701 班", grade: "七年級" },
    { id: "class-703", name: "703 班", grade: "七年級" },
    { id: "class-705", name: "705 班", grade: "七年級" }
  ];
  const periods = [
    { id: "p1", order: 1, label: "第 1 節", start: "08:10", end: "09:00" },
    { id: "p2", order: 2, label: "第 2 節", start: "09:10", end: "10:00" },
    { id: "p3", order: 3, label: "第 3 節", start: "10:10", end: "11:00" },
    { id: "p4", order: 4, label: "第 4 節", start: "11:10", end: "12:00" },
    { id: "p5", order: 5, label: "第 5 節", start: "13:10", end: "14:00" },
    { id: "p6", order: 6, label: "第 6 節", start: "14:10", end: "15:00" },
    { id: "p7", order: 7, label: "第 7 節", start: "15:10", end: "16:00" }
  ];
  const subject = { id: "subject-civics", name: "公民與社會" };
  const material = { id: "material-civics-1", name: "七上公民課本" };
  const slots = [
    [1, "p1", "class-701"], [1, "p3", "class-703"], [1, "p5", "class-705"],
    [2, "p2", "class-701"], [2, "p4", "class-703"],
    [3, "p1", "class-705"], [3, "p3", "class-701"],
    [4, "p2", "class-703"], [4, "p4", "class-705"], [4, "p5", "class-701"],
    [5, "p1", "class-703"], [5, "p3", "class-705"]
  ];
  const assignments = slots.map(([weekday, periodId, classId], index) => ({
    id: `assignment-${index + 1}`,
    weekday,
    periodId,
    classId,
    grade: "七年級",
    subjectId: subject.id,
    materialId: material.id
  }));
  await Promise.all([
    putMany("classes", classes), put("subjects", subject), put("materials", material), putMany("periods", periods),
    put("scheduleVersions", { id: "schedule-2026-1", name: "115 學年度上學期", effectiveFrom: "2026-09-01", effectiveTo: "2027-01-20", assignments }),
    putMany("examTargets", classes.map((item) => ({ id: `target-${item.id}`, classId: item.id, subjectId: subject.id, materialId: material.id, title: "第二次段考", cutoffDate: "2026-11-26", targetPage: 52 }))),
    putMany("records", [
      { id: "record-701", lessonId: "2026-11-05:p5:assignment-10", lessonDate: "2026-11-05", periodId: "p5", classId: "class-701", subjectId: subject.id, materialId: material.id, chapter: "第一單元 憲法與權利保障", page: 24, status: "completed", memo: "抽查課本重點", updatedAt: "2026-11-05T08:00:00.000Z" },
      { id: "record-703", lessonId: "2026-11-06:p1:assignment-11", lessonDate: "2026-11-06", periodId: "p1", classId: "class-703", subjectId: subject.id, materialId: material.id, chapter: "第一單元 權利保障體系", page: 20, status: "completed", memo: "習題第 3 題待檢討", updatedAt: "2026-11-06T08:00:00.000Z" },
      { id: "record-705", lessonId: "2026-11-06:p3:assignment-12", lessonDate: "2026-11-06", periodId: "p3", classId: "class-705", subjectId: subject.id, materialId: material.id, chapter: "第一單元 人權概念演進", page: 18, status: "completed", memo: "分組學習單繳交", updatedAt: "2026-11-06T08:00:00.000Z" }
    ]),
    put("settings", { id: "seeded", value: true, demo: true })
  ]);
}
