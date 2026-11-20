import { getCachedAnalysis, getCachedDoc } from "./cache.ts";
import { listHistory } from "./history-db.ts";
import type { HistoryRecord } from "./history-core.ts";

export type PaperRoute =
  | { kind: "home" }
  | { kind: "paper"; paperHash: string }
  | { kind: "unknown" };

function validPaperHash(paperHash: string): boolean {
  return paperHash.trim().length > 0 && !Array.from(paperHash).some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
}

export function formatPaperHash(paperHash: string): string {
  if (!validPaperHash(paperHash)) throw new Error("Invalid paper hash");
  return `#/paper/${encodeURIComponent(paperHash)}`;
}

export function parsePaperHash(hash: string): PaperRoute {
  if (hash === "" || hash === "#" || hash === "#/") return { kind: "home" };
  const match = /^#\/paper\/([^/?#]+)$/.exec(hash);
  if (!match) return { kind: "unknown" };
  try {
    const paperHash = decodeURIComponent(match[1]);
    return validPaperHash(paperHash)
      ? { kind: "paper", paperHash }
      : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

const localStore = { listHistory, getCachedDoc, getCachedAnalysis };

export async function restorePaperResult(
  paperHash: string,
  store: typeof localStore = localStore,
): Promise<Pick<HistoryRecord, "doc" | "analysis"> | null> {
  try {
    const history = (await store.listHistory()).find(
      (record) => record.paperHash === paperHash && record.doc.hash === paperHash,
    );
    if (history) return { doc: history.doc, analysis: history.analysis };
    const [doc, record] = await Promise.all([
      store.getCachedDoc(paperHash),
      store.getCachedAnalysis(paperHash),
    ]);
    return doc?.hash === paperHash && record ? { doc, analysis: record.analysis } : null;
  } catch {
    return null;
  }
}
