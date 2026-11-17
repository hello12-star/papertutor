import { QA_ANALYSIS, QA_META, QA_PAGES, QA_PAPER_MARKDOWN } from "../fixtures/qa.ts";
import type { LlmProvider, ParserProvider } from "./types.ts";

export function createMockParser(): ParserProvider {
  return {
    id: "mock-parser",
    async parse() {
      return {
        markdown: QA_PAPER_MARKDOWN,
        pages: QA_PAGES,
        meta: QA_META,
      };
    },
  };
}

export function createMockLlm(): LlmProvider {
  return {
    id: "mock-llm",
    async complete() {
      return {
        text: JSON.stringify(QA_ANALYSIS),
        model: "mock-llm",
      };
    },
  };
}