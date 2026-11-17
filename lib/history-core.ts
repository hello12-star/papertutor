import type { Analysis, ParsedDoc } from "./types";

export type HistoryRecord = {
  paperHash: string;
  title: string;
  createdAt: number;
  doc: ParsedDoc;
  analysis: Analysis;
};

export const MAX_HISTORY = 10;

export function historyTitle(doc: ParsedDoc, analysis: Analysis): string {
  const title = analysis.quickview.meta.title?.trim();
  if (title && title !== "未识别") return title;
  return doc.fileName.replace(/\.pdf$/i, "") || "未命名论文";
}

export function mergeHistoryRecords(
  existing: HistoryRecord[],
  incoming: HistoryRecord,
  max = MAX_HISTORY,
): HistoryRecord[] {
  const withoutSame = existing.filter((record) => record.paperHash !== incoming.paperHash);
  return [incoming, ...withoutSame]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, max);
}