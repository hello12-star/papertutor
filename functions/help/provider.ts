import { providerMode } from "../providers/env.ts";
import { ProviderError } from "../providers/errors.ts";
import { assertMockProvidersAllowed, getLlmProvider } from "../providers/index.ts";
import {
  getHelpEntry,
  HELP_REGISTRY,
  predictionsForScreen,
  staticHelpAnswer,
  type HelpAnswer,
  type HelpScreen,
  type HelpVariant,
  type PredictItem,
} from "./registry.ts";

export type HelpProvider = {
  id: string;
  predict(screen: HelpScreen): Promise<PredictItem[]>;
  answer(helpId: string, variant: HelpVariant): Promise<HelpAnswer>;
};

function parseJson(raw: string): any {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new ProviderError("INVALID_HELP_JSON", "模型输出不是 JSON 对象", 502);
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new ProviderError(
      "INVALID_HELP_JSON",
      error instanceof Error ? error.message : "JSON 解析失败",
      502,
    );
  }
}

function sanitizePredictions(value: any, screen: HelpScreen): PredictItem[] {
  const allowed = new Set(
    HELP_REGISTRY.filter((entry) => entry.screen === screen).map((entry) => entry.id),
  );
  const raw = Array.isArray(value?.items) ? value.items : [];
  const items = raw
    .map((item: any): PredictItem | null => {
      const helpId = typeof item?.helpId === "string" ? item.helpId : "";
      if (!allowed.has(helpId)) return null;
      const score = Number(item?.unfamiliarity);
      const unfamiliarity = Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0.5;
      return {
        helpId,
        unfamiliarity,
        reason: typeof item?.reason === "string" ? item.reason : "模型未给出原因",
        suggestedQuestion:
          typeof item?.suggestedQuestion === "string"
            ? item.suggestedQuestion
            : `这个「${getHelpEntry(helpId)?.label ?? helpId}」是做什么的？`,
      };
    })
    .filter((item: PredictItem | null): item is PredictItem => item !== null);

  if (items.length === 0) return predictionsForScreen(screen);
  return items.sort((a: PredictItem, b: PredictItem) => b.unfamiliarity - a.unfamiliarity);
}

function sanitizeAnswer(value: any, helpId: string, variant: HelpVariant): HelpAnswer {
  const base = staticHelpAnswer(helpId, variant);
  if (!base) {
    throw new ProviderError("INVALID_HELP_JSON", `未知的 helpId: ${helpId}`, 400);
  }
  return {
    helpId,
    variant,
    what: typeof value?.what === "string" && value.what.trim() ? value.what : base.what,
    why: typeof value?.why === "string" && value.why.trim() ? value.why : base.why,
    effect:
      typeof value?.effect === "string" && value.effect.trim() ? value.effect : base.effect,
    example:
      typeof value?.example === "string" && value.example.trim()
        ? value.example
        : base.example,
  };
}

function createMockHelpProvider(): HelpProvider {
  return {
    id: "mock-help",
    async predict(screen) {
      return predictionsForScreen(screen);
    },
    async answer(helpId, variant) {
      const answer = staticHelpAnswer(helpId, variant);
      if (!answer) throw new ProviderError("INVALID_HELP_JSON", `未知的 helpId: ${helpId}`, 400);
      return answer;
    },
  };
}

function createLlmHelpProvider(): HelpProvider {
  const llm = getLlmProvider();
  return {
    id: "llm-help",
    async predict(screen) {
      const controls = HELP_REGISTRY.filter((entry) => entry.screen === screen).map((entry) => ({
        helpId: entry.id,
        label: entry.label,
        description: entry.description,
      }));
      const result = await llm.complete({
        messages: [
          {
            role: "system",
            content:
              "You are a help predictor for a paper-reading tool. Return only JSON with an items array. Each item has helpId, unfamiliarity (0-1), reason, suggestedQuestion.",
          },
          {
            role: "user",
            content: `Screen: ${screen}\nControls: ${JSON.stringify(controls)}\nEstimate which controls a first-time learner may need help with. Return JSON only.`,
          },
        ],
        maxTokens: 1200,
        temperature: 0.2,
      });
      return sanitizePredictions(parseJson(result.text), screen);
    },
    async answer(helpId, variant) {
      const entry = getHelpEntry(helpId);
      if (!entry) throw new ProviderError("INVALID_HELP_JSON", `未知的 helpId: ${helpId}`, 400);
      const result = await llm.complete({
        messages: [
          {
            role: "system",
            content:
              "You are PaperTutor's help writer. Explain a UI control to a beginner. Return only JSON with what, why, effect, and optional example. Each value must be concrete and short. Do not say the learner may not understand.",
          },
          {
            role: "user",
            content: `Control: ${entry.label}\nDescription: ${entry.description}\nVariant: ${variant}\nReturn the three-part help JSON.`,
          },
        ],
        maxTokens: 800,
        temperature: 0.2,
      });
      return sanitizeAnswer(parseJson(result.text), helpId, variant);
    },
  };
}

export function getHelpProvider(): HelpProvider {
  assertMockProvidersAllowed();
  if (providerMode("LLM_PROVIDER") === "mock") return createMockHelpProvider();
  return createLlmHelpProvider();
}