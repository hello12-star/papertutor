import { ApiError, json } from "../http.ts";
import { getHelpProvider } from "./provider.ts";
import { getHelpEntry, HELP_PROMPT_VERSION, type HelpVariant } from "./registry.ts";

export async function handleHelpPredict(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const screen = body?.screen;
  if (screen !== "landing" && screen !== "result") {
    throw new ApiError("INVALID_REQUEST", "screen 必须是 landing 或 result", 400);
  }
  const provider = getHelpProvider();
  const items = await provider.predict(screen);
  return json({
    ok: true,
    provider: provider.id,
    promptVersion: HELP_PROMPT_VERSION,
    items,
  });
}

export async function handleHelpAnswer(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const helpId = typeof body?.helpId === "string" ? body.helpId : "";
  if (!getHelpEntry(helpId)) {
    throw new ApiError("UNKNOWN_HELP_ID", "未知的 helpId", 400);
  }
  const rawVariant = body?.variant;
  const variant: HelpVariant =
    rawVariant === "simpler" || rawVariant === "example" ? rawVariant : "default";
  const provider = getHelpProvider();
  const answer = await provider.answer(helpId, variant);
  return json({
    ok: true,
    provider: provider.id,
    promptVersion: HELP_PROMPT_VERSION,
    answer,
  });
}