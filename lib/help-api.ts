import type {
  HelpAnswer,
  HelpScreen,
  HelpVariant,
  PredictItem,
} from "../functions/help/registry.ts";

const BASE = "/functions/v1/app/api";

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(
      `${data?.code ?? `HTTP_${response.status}`}: ${data?.message ?? "帮助服务请求失败"}`,
    );
  }
  return data as T;
}

export async function fetchPredictions(
  screen: HelpScreen,
  paperHash: string,
): Promise<PredictItem[]> {
  const data = await post<{ items?: PredictItem[] }>("/help/predict", {
    screen,
    paperHash,
  });
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchHelpAnswer(
  helpId: string,
  variant: HelpVariant,
  paperHash: string,
): Promise<HelpAnswer> {
  const data = await post<{ answer?: HelpAnswer }>("/help/answer", {
    helpId,
    variant,
    paperHash,
  });
  if (!data.answer) throw new Error("EMPTY_HELP_ANSWER: 帮助服务没有返回内容");
  return data.answer;
}