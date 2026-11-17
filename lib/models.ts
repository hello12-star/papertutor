import { LlmError } from "./llm";
import { matchPreset, type Settings } from "./settings";

export type ModelOption = {
  id: string;
  score: number;
  tags: string[];
  contextLength?: number;
};

export type ModelListStatus = {
  state: "idle" | "loading" | "ready" | "error";
  message: string;
  source?: "api" | "curated";
};

export type ModelListResult = {
  options: ModelOption[];
  source: "api" | "curated";
  message: string;
  availableCount?: number;
};

type ModelMeta = {
  contextLength?: number;
  promptPrice?: number;
  inputModalities?: string[];
  outputModalities?: string[];
};

const CURATED: Record<string, string[]> = {
  dashscope: [
    "qwen3.8-flash",
    "qwen-plus",
    "qwen3.8-max",
    "qwen3.7-plus",
    "qwen-long",
    "qwen-turbo",
    "qwen3-235b-a22b",
    "qwen3-32b",
  ],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  siliconflow: [
    "Qwen/Qwen2.5-72B-Instruct",
    "Qwen/Qwen2.5-32B-Instruct",
    "deepseek-ai/DeepSeek-V3",
    "deepseek-ai/DeepSeek-R1",
    "THUDM/GLM-4-9B-0414",
    "meta-llama/Meta-Llama-3.1-70B-Instruct",
  ],
  openrouter: [
    "openai/gpt-4.1",
    "openai/gpt-4o-mini",
    "anthropic/claude-sonnet-4",
    "google/gemini-2.5-pro",
    "deepseek/deepseek-chat",
  ],
  generic: ["qwen3.8-flash", "qwen-plus", "deepseek-chat", "gpt-4o-mini"],
};

const EXCLUDE = /(embedding|embed-|rerank|tts|asr|speech|audio|whisper|transcri|moderation|guard|bge-|gte-|m3e|cosyvoice|sambert|paraformer|sensevoice|ocr|cogview|wanx|wan2|cogvideo|flux|dall-e|stable-diffusion|sdxl|realtime|image-generation)/i;
const EXCLUDE_VL = /(^|[\/_-])(vl|vlm)([\/_-]|$)/i;

function scoreModel(id: string, meta?: ModelMeta): ModelOption {
  const lower = id.toLowerCase();
  const tags: string[] = [];
  let score = 10;

  if (lower.includes("qwen3.8-flash")) {
    score += 74;
    tags.push("综合推荐", "1M 上下文", "高性价比");
  } else if (/qwen3\.[5-8]-flash/.test(lower)) {
    score += 67;
    tags.push("高性价比", "长上下文");
  } else if (/^qwen-flash/.test(lower)) {
    score += 55;
    tags.push("低成本");
  } else if (/qwen3\.[78]-max/.test(lower)) {
    score += 70;
    tags.push("旗舰");
  } else if (/qwen3\.[78]-plus/.test(lower)) {
    score += 69;
    tags.push("综合推荐");
  } else if (lower.includes("qwen-plus")) {
    score += 64;
    tags.push("综合推荐");
  } else if (lower.includes("qwen-max")) {
    score += 58;
    tags.push("强推理");
  } else if (lower.includes("qwen-long")) {
    score += 52;
    tags.push("长上下文");
  } else if (lower.includes("qwen-turbo")) {
    score += 44;
    tags.push("速度快");
  } else if (/qwen3-(max|235b)/.test(lower)) {
    score += 60;
    tags.push("强推理");
  } else if (lower.includes("qwen3")) {
    score += 38;
  } else if (/qwen2\.5.*(72b|32b)/.test(lower)) {
    score += 48;
    tags.push("长上下文");
  } else if (lower.includes("qwen")) {
    score += 24;
  }

  if (lower.includes("deepseek-chat") || lower.includes("deepseek-v3")) {
    score += 60;
    tags.push("综合推荐");
  } else if (lower.includes("deepseek-reasoner") || lower.includes("deepseek-r1")) {
    score += 54;
    tags.push("推理模型");
  } else if (lower.includes("deepseek")) {
    score += 26;
  }

  if (/glm-4\.5|glm-4-plus|glm-4\b/.test(lower)) {
    score += 48;
  } else if (lower.includes("glm")) {
    score += 20;
  }

  if (/kimi|moonshot/.test(lower)) {
    score += 46;
    tags.push("长上下文");
  }

  if (lower.includes("gpt-4.1")) {
    score += 58;
    tags.push("强推理");
  } else if (/gpt-4o(?!-mini)/.test(lower)) {
    score += 54;
  } else if (lower.includes("gpt-4o-mini")) {
    score += 46;
    tags.push("低成本");
  } else if (/o[34]-(mini|preview)/.test(lower)) {
    score += 42;
    tags.push("推理模型");
  } else if (lower.includes("gpt-4")) {
    score += 34;
  }

  if (/claude.*(sonnet|opus)/.test(lower)) {
    score += 54;
  } else if (lower.includes("claude")) {
    score += 32;
  }

  if (lower.includes("gemini-2.5-pro")) {
    score += 56;
    tags.push("强推理");
  } else if (lower.includes("gemini-2.5-flash") || lower.includes("gemini-2")) {
    score += 46;
  } else if (lower.includes("gemini")) {
    score += 28;
  }

  if (/llama-4|llama-3\.[13].*70b|mistral-large/.test(lower)) score += 30;
  if (/instruct|chat/.test(lower)) score += 8;
  if (lower.includes("latest")) score += 4;
  if (/preview|experimental|beta|alpha/.test(lower)) score -= 6;

  if (meta?.contextLength) {
    if (meta.contextLength >= 100_000) {
      score += 8;
      if (!tags.includes("长上下文")) tags.push("长上下文");
    } else if (meta.contextLength >= 32_000) {
      score += 4;
    }
  }
  if (typeof meta?.promptPrice === "number") {
    if (meta.promptPrice === 0) {
      score += 4;
      tags.push("免费");
    } else if (meta.promptPrice > 0.00002) {
      score -= 5;
    }
  }
  if (!tags.includes("综合推荐") && (lower.includes("instruct") || lower.includes("chat"))) {
    tags.push("对话");
  }
  if (meta?.contextLength) {
    tags.push(`${Math.round(meta.contextLength / 1000)}k`);
  }
  return { id, score: Math.max(1, score), tags: Array.from(new Set(tags)) };
}

function usable(id: string, meta?: ModelMeta): boolean {
  if (!id || typeof id !== "string") return false;
  if (EXCLUDE.test(id) || EXCLUDE_VL.test(id)) return false;
  if (meta?.outputModalities && !meta.outputModalities.includes("text")) return false;
  if (meta?.inputModalities && !meta.inputModalities.includes("text")) return false;
  return true;
}

export function rankModels(ids: string[], metaById?: Map<string, ModelMeta>): ModelOption[] {
  const unique = Array.from(new Set(ids.filter((id) => usable(id, metaById?.get(id)))));
  const options = unique.map((id) => scoreModel(id, metaById?.get(id)));
  options.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const top = options.slice(0, 120);
  top.slice(0, 3).forEach((option) => {
    if (!option.tags.includes("推荐") && !option.tags.includes("综合推荐")) {
      option.tags.unshift("推荐");
    }
  });
  return top;
}

export function curatedModels(baseUrl: string): ModelOption[] {
  const preset = matchPreset(baseUrl);
  const ids = CURATED[preset?.id ?? "generic"] ?? CURATED.generic;
  return rankModels(ids);
}

export function providerLabel(baseUrl: string): string {
  return matchPreset(baseUrl)?.label ?? "自定义服务商";
}

export async function loadModelOptions(
  settings: Settings,
  signal?: AbortSignal,
): Promise<ModelListResult> {
  const curated = curatedModels(settings.baseUrl);
  const label = providerLabel(settings.baseUrl);

  if (!settings.apiKey.trim()) {
    return {
      options: curated,
      source: "curated",
      message: "填入 API Key 后，可拉取这个 Key 实际可用的模型",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${settings.apiKey.trim()}` },
      signal,
    });
  } catch {
    return {
      options: curated,
      source: "curated",
      message: "无法连接模型列表接口（网络或跨域），已展示常用模型",
    };
  }

  if (response.status === 401) throw new LlmError("invalid_key");
  if (!response.ok) {
    return {
      options: curated,
      source: "curated",
      message: `模型列表接口返回 ${response.status}，已展示 ${label} 常用模型`,
    };
  }

  const body = await response.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];

  const metaById = new Map<string, ModelMeta>();
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      ids.push(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, any>;
    const id = typeof record.id === "string" ? record.id : "";
    if (!id) continue;
    ids.push(id);
    const contextLength =
      typeof record.context_length === "number"
        ? record.context_length
        : typeof record.top_provider?.context_length === "number"
          ? record.top_provider.context_length
          : typeof record.max_context_length === "number"
            ? record.max_context_length
            : undefined;
    const promptPrice =
      typeof record.pricing?.prompt === "string"
        ? Number(record.pricing.prompt)
        : typeof record.pricing?.prompt === "number"
          ? record.pricing.prompt
          : undefined;
    const inputModalities = Array.isArray(record.architecture?.input_modalities)
      ? record.architecture.input_modalities
      : undefined;
    const outputModalities = Array.isArray(record.architecture?.output_modalities)
      ? record.architecture.output_modalities
      : undefined;
    metaById.set(id, {
      contextLength: Number.isFinite(contextLength) ? contextLength : undefined,
      promptPrice: Number.isFinite(promptPrice) ? promptPrice : undefined,
      inputModalities,
      outputModalities,
    });
  }

  if (ids.length === 0) {
    return {
      options: curated,
      source: "curated",
      message: `${label} 没有返回模型列表，已展示常用模型`,
    };
  }

  const options = rankModels(ids, metaById);
  return {
    options,
    source: "api",
    message: `已获取 ${ids.length} 个模型，已按适合论文精读的程度排序`,
    availableCount: ids.length,
  };
}