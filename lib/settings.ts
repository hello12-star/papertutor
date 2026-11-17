const STORAGE_KEY = "papertutor.settings.v1";

export type Settings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  mineruToken: string;
};

export type ProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  note: string;
};

export const PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    note: "国内直连，长上下文，性价比高",
  },
  {
    id: "dashscope",
    label: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    note: "通义千问 OpenAI 兼容接口",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen2.5-72B-Instruct",
    note: "模型选择多，可作为备用通道",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    note: "海外聚合接口，需可访问外网",
  },
];

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-chat",
  mineruToken: "",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl ? parsed.baseUrl : DEFAULT_SETTINGS.baseUrl,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : DEFAULT_SETTINGS.model,
      mineruToken: typeof parsed.mineruToken === "string" ? parsed.mineruToken : "",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage 不可用时仍允许本次会话使用内存中的设置
  }
}

export function matchPreset(baseUrl: string): ProviderPreset | undefined {
  const normalized = baseUrl.replace(/\/+$/, "").toLowerCase();
  return PRESETS.find((preset) => preset.baseUrl.toLowerCase() === normalized);
}