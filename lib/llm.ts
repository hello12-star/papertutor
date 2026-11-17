import type { Settings } from "./settings";

export class LlmError extends Error {
  code: string;
  detail?: string;
  raw?: string;

  constructor(code: string, detail?: string, raw?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "LlmError";
    this.code = code;
    this.detail = detail;
    this.raw = raw;
  }
}

type ChatOptions = {
  settings: Settings;
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
};

type BodyVariant = "default" | "completionTokens" | "minimal";

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

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

function extractJson(raw: string): unknown {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new LlmError("invalid_json", raw.slice(0, 300), raw.slice(0, 3000));
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new LlmError(
      "invalid_json",
      error instanceof Error ? error.message : String(error),
      raw.slice(0, 3000),
    );
  }
}

function buildRequestBody(
  settings: Settings,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  variant: BodyVariant,
): Record<string, unknown> {
  const model = settings.model.trim();
  const body: Record<string, unknown> = { model, messages, stream: false };
  if (variant === "minimal") return body;
  body.temperature = 0.2;
  if (variant === "completionTokens") {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
  }
  // 百炼的 Qwen3 系列默认开启思考；结构化 JSON 任务关闭思考更稳、更快
  if (/dashscope|bailian/i.test(settings.baseUrl) && /^qwen3/i.test(model)) {
    body.enable_thinking = false;
  }
  return body;
}

function httpError(status: number, detail: string): LlmError {
  const trimmed = detail.slice(0, 500);
  const raw = detail.slice(0, 3000);
  if (status === 401) return new LlmError("invalid_key", trimmed, raw);
  if (status === 403) return new LlmError("forbidden", trimmed, raw);
  if (status === 404) return new LlmError("model_not_found", trimmed, raw);
  if (status === 429) {
    if (/quota|balance|insufficient|余额|欠费|arrears|billing/i.test(detail)) {
      return new LlmError("quota_exceeded", trimmed, raw);
    }
    return new LlmError("rate_limited", trimmed, raw);
  }
  if (status === 400) {
    if (/context|too\s*long|maximum.*token|token.*(exceed|limit)|超出.*(长度|token)|长度.*超/i.test(detail)) {
      return new LlmError("context_too_long", trimmed, raw);
    }
    if (/model|access|not\s*exist|not\s*found|permission|开通|无权/i.test(detail)) {
      return new LlmError("model_unavailable", trimmed, raw);
    }
    return new LlmError("invalid_parameter", trimmed, raw);
  }
  return new LlmError(`provider_http_${status}`, trimmed, raw);
}

async function chat(
  options: ChatOptions,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const { settings } = options;
  if (!settings.apiKey.trim()) throw new LlmError("missing_key");
  if (!settings.baseUrl.trim()) throw new LlmError("missing_base_url");
  if (!settings.model.trim()) throw new LlmError("missing_model");

  const signals: AbortSignal[] = [AbortSignal.timeout(300_000)];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);

  const send = async (variant: BodyVariant): Promise<{ response: Response; text?: string }> => {
    let response: Response;
    try {
      response = await fetch(endpoint(settings.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey.trim()}`,
        },
        body: JSON.stringify(buildRequestBody(settings, messages, options.maxTokens, variant)),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new LlmError("timeout");
      }
      throw new LlmError("network_or_cors", error instanceof Error ? error.message : String(error));
    }
    if (response.ok || response.status !== 400) {
      return { response };
    }
    const text = await response.text().catch(() => "");
    return { response, text };
  };

  let attempt = await send("default");
  let response = attempt.response;

  if (!response.ok && response.status === 400) {
    const firstText = attempt.text ?? "";
    let retryVariant: BodyVariant | null = null;
    if (/max_tokens/i.test(firstText) && !/max_completion_tokens/i.test(firstText)) {
      retryVariant = "completionTokens";
    } else if (/temperature|enable_thinking|stream|unsupported|invalid.?parameter/i.test(firstText)) {
      retryVariant = "minimal";
    }

    if (!retryVariant) {
      throw httpError(400, firstText);
    }

    attempt = await send(retryVariant);
    response = attempt.response;
    if (!response.ok) {
      const secondText = attempt.text ?? "";
      if (
        retryVariant !== "minimal" &&
        /temperature|enable_thinking|stream|unsupported|invalid.?parameter|max_completion_tokens/i.test(
          secondText,
        )
      ) {
        attempt = await send("minimal");
        response = attempt.response;
        if (!response.ok) {
          throw httpError(response.status, (attempt.text || secondText || firstText));
        }
      } else if (response.status === 400) {
        throw httpError(400, secondText || firstText);
      }
    }
  }

  if (!response.ok) {
    const text = attempt.text ?? (await response.text().catch(() => ""));
    throw httpError(response.status, text);
  }

  const body = await response.json().catch(() => null);
  const choice = body?.choices?.[0];
  const text =
    contentText(choice?.message) ||
    (typeof choice?.message?.reasoning_content === "string"
      ? choice.message.reasoning_content
      : "") ||
    (typeof choice?.text === "string" ? choice.text : "");

  if (!text.trim()) {
    throw new LlmError(
      "empty_response",
      `finish_reason=${choice?.finish_reason ?? "unknown"}`,
      JSON.stringify(body).slice(0, 3000),
    );
  }

  if (choice?.finish_reason === "length") {
    let complete = false;
    try {
      extractJson(text);
      complete = true;
    } catch {
      complete = false;
    }
    if (!complete) {
      throw new LlmError(
        "output_truncated",
        "模型输出达到上限，JSON 没有闭合",
        text.slice(0, 3000),
      );
    }
  }

  return text;
}

export async function chatJson(options: ChatOptions): Promise<unknown> {
  const messages = [
    { role: "system", content: options.system },
    { role: "user", content: options.user },
  ];
  const first = await chat(options, messages);
  try {
    return extractJson(first);
  } catch (error) {
    if (!(error instanceof LlmError) || error.code !== "invalid_json") throw error;
  }

  const repaired = await chat(options, [
    ...messages,
    { role: "assistant", content: first },
    {
      role: "user",
      content:
        "你上面的输出不是合法 JSON。请修复格式问题，只输出一个合法的 JSON 对象，不要代码块标记，不要任何解释。",
    },
  ]);
  return extractJson(repaired);
}

export async function testConnection(settings: Settings): Promise<void> {
  if (!settings.apiKey.trim()) throw new LlmError("missing_key");
  const url = `${settings.baseUrl.replace(/\/+$/, "")}/models`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${settings.apiKey.trim()}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new LlmError("network_or_cors", error instanceof Error ? error.message : String(error));
  }
  if (response.status === 401) throw new LlmError("invalid_key");
  if (response.status === 403) throw new LlmError("forbidden");
  if (!response.ok && response.status !== 404) {
    throw new LlmError(`provider_http_${response.status}`);
  }
}