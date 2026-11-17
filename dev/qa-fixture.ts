import type { Analysis, ParsedDoc } from "../lib/types";
import {
  QA_ANALYSIS,
  QA_META,
  QA_PAGES,
  QA_PAPER_MARKDOWN,
} from "../functions/fixtures/qa.ts";

export function buildQaFixture() {
  const doc: ParsedDoc = {
    hash: "qa-m1a-fixture",
    fileName: "qa-fixture.pdf",
    fileSize: 0,
    pages: QA_PAGES,
    mode: "flash",
    markdown: QA_PAPER_MARKDOWN,
    parsedAt: Date.now(),
  };

  return {
    doc,
    record: {
      analysis: QA_ANALYSIS as unknown as Analysis,
      model: "qa-fixture",
      createdAt: Date.now(),
    },
    meta: QA_META,
  };
}