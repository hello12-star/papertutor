import { readEnv, providerMode } from "./env.ts";
import { createDocmindProvider } from "./docmind.ts";
import { createOpenAiCompatibleProvider } from "./llm-openai.ts";
import { createMockLlm, createMockParser } from "./mock.ts";
import type { LlmProvider, ParserProvider } from "./types.ts";

export function getParserProvider(): ParserProvider {
  if (providerMode("PARSER_PROVIDER") === "mock") return createMockParser();
  return createDocmindProvider();
}

export function getLlmProvider(): LlmProvider {
  if (providerMode("LLM_PROVIDER") === "mock") return createMockLlm();
  return createOpenAiCompatibleProvider();
}

export function promptVersion(): string {
  return readEnv("PROMPT_VERSION") || "v2";
}