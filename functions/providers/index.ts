import { readEnv, providerMode } from "./env.ts";
import { ProviderError } from "./errors.ts";
import { createDocmindProvider } from "./docmind.ts";
import { createOpenAiCompatibleProvider } from "./llm-openai.ts";
import { createMockLlm, createMockParser } from "./mock.ts";
import type { LlmProvider, ParserProvider } from "./types.ts";

export function assertMockProvidersAllowed(): void {
  if (readEnv("NODE_ENV") !== "production") return;
  if (providerMode("PARSER_PROVIDER") === "mock" || providerMode("LLM_PROVIDER") === "mock") {
    throw new ProviderError(
      "MOCK_PROVIDER_FORBIDDEN",
      "NODE_ENV=production 时禁止使用 mock provider，请配置真实解析/LLM。",
      500,
    );
  }
}

export function getParserProvider(): ParserProvider {
  assertMockProvidersAllowed();
  if (providerMode("PARSER_PROVIDER") === "mock") return createMockParser();
  return createDocmindProvider();
}

export function getLlmProvider(): LlmProvider {
  assertMockProvidersAllowed();
  if (providerMode("LLM_PROVIDER") === "mock") return createMockLlm();
  return createOpenAiCompatibleProvider();
}

export function promptVersion(): string {
  return readEnv("PROMPT_VERSION") || "v2";
}