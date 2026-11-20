import type { AnalysisRecord, ParsedDoc } from "./types";

const DB_NAME = "papertutor-cache";
const DB_VERSION = 1;
const DOC_STORE = "docs";
const ANALYSIS_STORE = "analyses";

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
        if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE);
        if (!db.objectStoreNames.contains(ANALYSIS_STORE)) db.createObjectStore(ANALYSIS_STORE);
      };
      let blocked = false;
      request.onblocked = () => {
        blocked = true;
        resolve(null);
      };
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else resolve(request.result);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function readValue<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readonly");
      tx.onabort = () => resolve(null);
      tx.onerror = () => resolve(null);
      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeValue(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function getCachedDoc(hash: string): Promise<ParsedDoc | null> {
  return readValue<ParsedDoc>(DOC_STORE, hash);
}

export function cacheDoc(doc: ParsedDoc): Promise<void> {
  return writeValue(DOC_STORE, doc.hash, doc);
}

export function getCachedAnalysis(hash: string): Promise<AnalysisRecord | null> {
  return readValue<AnalysisRecord>(ANALYSIS_STORE, hash);
}

export function cacheAnalysis(hash: string, record: AnalysisRecord): Promise<void> {
  return writeValue(ANALYSIS_STORE, hash, record);
}

export async function clearCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([DOC_STORE, ANALYSIS_STORE], "readwrite");
      tx.objectStore(DOC_STORE).clear();
      tx.objectStore(ANALYSIS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}