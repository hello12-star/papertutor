import { mergeHistoryRecords, type HistoryRecord } from "./history-core.ts";

const DB_NAME = "papertutor-history";
const DB_VERSION = 2;
const STORE = "records";
const PROGRESS_STORE = "progress";
const MAX_PROGRESS = 20;

export type ReadingStep = "quickview" | "original" | "skeleton" | "selfTest";

export type ReadingProgress = {
  paperHash: string;
  activeStep: ReadingStep;
  revealedSelfTestIds: string[];
  updatedAt: number;
};

const VALID_STEPS = new Set<ReadingStep>([
  "quickview",
  "original",
  "skeleton",
  "selfTest",
]);

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
          db.createObjectStore(PROGRESS_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function normalizeProgress(value: unknown): ReadingProgress | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const paperHash = typeof record.paperHash === "string" ? record.paperHash : "";
  if (!paperHash) return null;
  const activeStep =
    typeof record.activeStep === "string" &&
    VALID_STEPS.has(record.activeStep as ReadingStep)
      ? (record.activeStep as ReadingStep)
      : "quickview";
  const revealed = Array.isArray(record.revealedSelfTestIds)
    ? record.revealedSelfTestIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    paperHash,
    activeStep,
    revealedSelfTestIds: Array.from(new Set(revealed)).slice(0, 50),
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

async function listProgress(): Promise<ReadingProgress[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(PROGRESS_STORE, "readonly");
      const request = tx.objectStore(PROGRESS_STORE).getAll();
      request.onsuccess = () => {
        const records = (request.result as unknown[] | undefined) ?? [];
        resolve(
          records
            .map(normalizeProgress)
            .filter((item): item is ReadingProgress => item !== null)
            .sort((a, b) => b.updatedAt - a.updatedAt),
        );
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function listHistory(): Promise<HistoryRecord[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => {
        const records = (request.result as HistoryRecord[] | undefined) ?? [];
        resolve(records.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10));
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function saveHistory(record: HistoryRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const existing = await listHistory();
  const merged = mergeHistoryRecords(existing, record);
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      for (const item of merged) store.put(item, item.paperHash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });

  const kept = new Set(merged.map((item) => item.paperHash));
  for (const item of existing) {
    if (!kept.has(item.paperHash)) {
      await deleteProgress(item.paperHash);
    }
  }
}

export async function deleteHistory(paperHash: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORE, PROGRESS_STORE], "readwrite");
      tx.objectStore(STORE).delete(paperHash);
      tx.objectStore(PROGRESS_STORE).delete(paperHash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearHistory(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORE, PROGRESS_STORE], "readwrite");
      tx.objectStore(STORE).clear();
      tx.objectStore(PROGRESS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getProgress(paperHash: string): Promise<ReadingProgress | null> {
  const db = await openDb();
  if (!db || !paperHash) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(PROGRESS_STORE, "readonly");
      const request = tx.objectStore(PROGRESS_STORE).get(paperHash);
      request.onsuccess = () => resolve(normalizeProgress(request.result));
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveProgress(progress: ReadingProgress): Promise<void> {
  const db = await openDb();
  if (!db || !progress.paperHash) return;
  const record: ReadingProgress = {
    paperHash: progress.paperHash,
    activeStep: progress.activeStep,
    revealedSelfTestIds: Array.from(new Set(progress.revealedSelfTestIds)).slice(0, 50),
    updatedAt: Date.now(),
  };
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(PROGRESS_STORE, "readwrite");
      tx.objectStore(PROGRESS_STORE).put(record, record.paperHash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });

  const all = await listProgress();
  if (all.length > MAX_PROGRESS) {
    for (const item of all.slice(MAX_PROGRESS)) {
      await deleteProgress(item.paperHash);
    }
  }
}

export async function deleteProgress(paperHash: string): Promise<void> {
  const db = await openDb();
  if (!db || !paperHash) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(PROGRESS_STORE, "readwrite");
      tx.objectStore(PROGRESS_STORE).delete(paperHash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearProgress(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(PROGRESS_STORE, "readwrite");
      tx.objectStore(PROGRESS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}