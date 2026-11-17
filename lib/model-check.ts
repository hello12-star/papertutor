import { LlmError } from "./llm";
import type { Settings } from "./settings";

export type ModelCheck = {
  state: "ok" | "error";
  message?: string;
  detail?: string;
  latencyMs?: number;
  checkedAt: number;
};

const cache = new Map<string, ModelCheck>();
const inFlight = new Map<string, Promise<ModelCheck>>();

function cacheKey(settings: Settings, model: string): string {
  return `${settings.baseUrl.replace(/\/+$/, "")}\u0000${settings.apiKey.trim()}\u0000${model.trim()}`;
}

export function cachedModelCheck(settings: Settings, model: string): ModelCheck | undefined {
  if (!model.trim()) return undefined;
  const entry = cache.get(cacheKey(settings, model));
  if (!entry) return undefined;
  const ttl = entry.state === "ok" ? 10 * 60_000 : 30_000;
  if (Date.now() - entry.checkedAt > ttl) return undefined;
  return entry;
}

export function recordModelCheck(settings: Settings, model: string, check: ModelCheck): void {
  if (!model.trim()) return;
  cache.set(cacheKey(settings, model), check);
}

function httpMessage(status: number, detail: string): string {
  if (status === 401) return "Key 无效（401）";
  if (status === 403) return "没有访问权限（403）";
  if (status === 404) return "模型或接口不存在（404）";
  if (status === 429) return "限流或余额不足（429）";
  if (status >= 500) return `服务商异常（${status}）`;
  if (status === 400) {
    if (/model|access|not\s*exist|not\s*found|permission|开通|无权/i.test(detail)) {
      return "模型不可用或未开通（400）";
    }
    return "请求参数被拒绝（400）";
  }
  return `服务商返回 ${status}`;
}

function supportsThinkingSwitch(settings: Settings, model: string): boolean {
  return /dashscope|bailian/i.test(settings.baseUrl) && /^qwen3/i.test(model);
}

async function postPing(
  settings: Settings,
  model: string,
  minimal: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  const body: Record<string, unknown> = minimal
    ? { model, messages: [{ role: "user", content: "ping" }], stream: false }
    : {
        model,
        messages: [{ role: "user", content: "只回复 OK" }],
        max_tokens: 24,
        temperature: 0,
        stream: false,
        ...(supportsThinkingSwitch(settings, model) ? { enable_thinking: false } : {}),
      };
  return await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey.trim()}`,
    },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(30_000),
  });
}

async function runCheck(settings: Settings, model: string, signal?: AbortSignal): Promise<ModelCheck> {
  const target = model.trim();
  const started = performance.now();
  if (!settings.apiKey.trim()) {
    return { state: "error", message: "没有填入 API Key", checkedAt: Date.now() };
  }
  if (!target) {
    return { state: "error", message: "没有选择模型", checkedAt: Date.now() };
  }

  let response: Response;
  try {
    response = await postPing(settings, target, false, signal);
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "模型响应超时（30 秒）"
        : "网络或跨域失败";
    const check: ModelCheck = {
      state: "error",
      message,
      detail: error instanceof Error ? error.message : String(error),
      checkedAt: Date.now(),
    };
    cache.set(cacheKey(settings, target), check);
    return check;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (
      response.status === 400 &&
      /max_tokens|temperature|enable_thinking|unsupported|invalid.?parameter/i.test(detail)
    ) {
      try {
        const retry = await postPing(settings, target, true, signal);
        if (retry.ok) {
          const check: ModelCheck = {
            state: "ok",
            latencyMs: Math.round(performance.now() - started),
            checkedAt: Date.now(),
          };
          cache.set(cacheKey(settings, target), check);
          return check;
        }
        const retryDetail = await retry.text().catch(() => "");
        const check: ModelCheck = {
          state: "error",
          message: httpMessage(retry.status, retryDetail),
          detail: (retryDetail || detail).slice(0, 600),
          checkedAt: Date.now(),
        };
        cache.set(cacheKey(settings, target), check);
        return check;
      } catch (error) {
        const check: ModelCheck = {
          state: "error",
          message: "网络或跨域失败",
          detail: error instanceof Error ? error.message : String(error),
          checkedAt: Date.now(),
        };
        cache.set(cacheKey(settings, target), check);
        return check;
      }
    }
    const check: ModelCheck = {
      state: "error",
      message: httpMessage(response.status, detail),
      detail: detail.slice(0, 600),
      checkedAt: Date.now(),
    };
    cache.set(cacheKey(settings, target), check);
    return check;
  }

  const check: ModelCheck = {
    state: "ok",
    latencyMs: Math.round(performance.now() - started),
    checkedAt: Date.now(),
  };
  cache.set(cacheKey(settings, target), check);
  return check;
}

export async function verifyModel(
  settings: Settings,
  model: string,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<ModelCheck> {
  const target = model.trim();
  if (!options?.force) {
    const cached = cachedModelCheck(settings, target);
    if (cached) return cached;
  }
  const key = cacheKey(settings, target);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = runCheck(settings, target, options?.signal).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export async function verifyModels(
  settings: Settings,
  models: string[],
  onResult: (model: string, check: ModelCheck) => void,
  options?: { concurrency?: number; signal?: AbortSignal },
): Promise<void> {
  const queue = Array.from(new Set(models.map((item) => item.trim()).filter(Boolean)));
  const workers = Array.from(
    { length: Math.max(1, Math.min(options?.concurrency ?? 3, queue.length)) },
    async () => {
      while (queue.length > 0) {
        if (options?.signal?.aborted) return;
        const model = queue.shift();
        if (!model) return;
        const check = await verifyModel(settings, model, { force: true, signal: options?.signal });
        if (options?.signal?.aborted) return;
        onResult(model, check);
      }
    },
  );
  await Promise.all(workers);
}

export function assertModelUsable(check: ModelCheck): void {
  if (check.state === "ok") return;
  throw new LlmError("model_unavailable", check.message ?? "模型不可用");
}