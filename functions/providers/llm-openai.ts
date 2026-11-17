import { readEnv } from "./env.ts";
import { ProviderError } from "./errors.ts";
import type { LlmProvider, LlmRequest, LlmResult } from "./types.ts";

function contentText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === "string" ? part : part?.text ?? ""))
      .join("");
  }
  return "";
}

export function createOpenAiCompatibleProvider(): LlmProvider {
  return {
    id: "openai-compatible",
    async complete(request: LlmRequest): Promise<LlmResult> {
      const apiKey =
        readEnv("LLM_API_KEY") || readEnv("DASHSCOPE_API_KEY") || readEnv("OPENAI_API_KEY");
      const baseUrl = (
        readEnv("LLM_BASE_URL") || "https://dashscope.aliyuncs.com/compatible-mode/v1"
      ).replace(/\/+$/, "");
      const model = request.model || readEnv("LLM_MODEL") || "qwen-plus";

      if (!apiKey) {
        throw new ProviderError(
          "LLM_NOT_CONFIGURED",
          "缺少 LLM_API_KEY / DASHSCOPE_API_KEY，未发起外网请求。",
          503,
        );
      }

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: request.messages,
            temperature: request.temperature ?? 0.2,
            max_tokens: request.maxTokens ?? 4000,
            stream: false,
          }),
          signal: request.signal ?? AbortSignal.timeout(120_000),
        });
      } catch (error) {
        throw new ProviderError(
          "LLM_UPSTREAM_ERROR",
          error instanceof Error ? error.message : String(error),
          502,
        );
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new ProviderError(
          "LLM_UPSTREAM_ERROR",
          `HTTP ${response.status}: ${detail.slice(0, 300)}`,
          502,
        );
      }

      const body = await response.json().catch(() => null);
      const text = contentText(body?.choices?.[0]?.message);
      if (!text.trim()) {
        throw new ProviderError("LLM_EMPTY_RESPONSE", "模型返回了空内容", 502);
      }
      return {
        text,
        model,
        usage: body?.usage,
      };
    },
  };
}