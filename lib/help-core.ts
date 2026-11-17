import {
  getHelpEntry,
  HELP_PROMPT_VERSION,
  predictionsForScreen,
  staticHelpAnswer,
  type HelpAnswer,
  type HelpScreen,
  type HelpVariant,
  type PredictItem,
} from "../functions/help/registry.ts";

export type HelpSource = "cache" | "api" | "fallback";

export type HelpCache = {
  get(key: string): Promise<HelpAnswer | null>;
  put(key: string, answer: HelpAnswer): Promise<void>;
};

export type AnswerFetcher = (
  helpId: string,
  variant: HelpVariant,
  paperHash: string,
) => Promise<HelpAnswer>;

export type PredictFetcher = (screen: HelpScreen, paperHash: string) => Promise<PredictItem[]>;

export const MAX_PRECOMPUTE_PER_SCREEN = 5;
export const MAX_PRECOMPUTE_PER_SESSION = 20;
export const MAX_REGENERATE_PER_CONTROL = 1;

const screenDone = new Map<string, Set<string>>();
const regenerated = new Set<string>();
const session = { count: 0 };

export function resetHelpLimits(): void {
  screenDone.clear();
  regenerated.clear();
  session.count = 0;
}

export function helpCacheKey(
  helpId: string,
  paperHash: string,
  variant: HelpVariant,
): string {
  return `help:answer:v2:${helpId}:${paperHash}:${variant}:${HELP_PROMPT_VERSION}`;
}

export function helpSourceLabel(source: HelpSource): string {
  if (source === "cache") return "缓存";
  if (source === "api") return "现场生成";
  return "内置说明";
}

export async function loadHelpAnswer(options: {
  helpId: string;
  variant: HelpVariant;
  paperHash: string;
  cache: HelpCache;
  fetcher: AnswerFetcher;
}): Promise<{ answer: HelpAnswer; source: HelpSource; error?: string }> {
  const key = helpCacheKey(options.helpId, options.paperHash, options.variant);
  try {
    const cached = await options.cache.get(key);
    if (cached) return { answer: cached, source: "cache" };
  } catch {
    // cache failures should not block help
  }

  try {
    const answer = await options.fetcher(
      options.helpId,
      options.variant,
      options.paperHash,
    );
    try {
      await options.cache.put(key, answer);
    } catch {
      // ignore cache write failures
    }
    return { answer, source: "api" };
  } catch (error) {
    const fallback = staticHelpAnswer(options.helpId, options.variant);
    if (!fallback) throw error;
    return {
      answer: fallback,
      source: "fallback",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function sanitizePredictions(items: PredictItem[], screen: HelpScreen): PredictItem[] {
  const allowed = new Set(
    predictionsForScreen(screen).map((item) => item.helpId),
  );
  const sanitized = items
    .filter((item) => allowed.has(item.helpId) && getHelpEntry(item.helpId)?.screen === screen)
    .map((item) => {
      const score = Number(item.unfamiliarity);
      return {
        ...item,
        unfamiliarity: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0.5,
      };
    })
    .sort((a, b) => b.unfamiliarity - a.unfamiliarity);
  return sanitized.length > 0 ? sanitized : predictionsForScreen(screen);
}

export async function predictHelp(options: {
  screen: HelpScreen;
  paperHash: string;
  fetcher: PredictFetcher;
}): Promise<{ items: PredictItem[]; source: "api" | "fallback" }> {
  try {
    const items = await options.fetcher(options.screen, options.paperHash);
    return { items: sanitizePredictions(items, options.screen), source: "api" };
  } catch {
    return { items: predictionsForScreen(options.screen), source: "fallback" };
  }
}

export function canRegenerate(helpId: string): boolean {
  if (regenerated.has(helpId)) return false;
  regenerated.add(helpId);
  return true;
}

export async function bootstrapHelp(options: {
  screen: HelpScreen;
  paperHash: string;
  cache: HelpCache;
  predictFetcher: PredictFetcher;
  answerFetcher: AnswerFetcher;
  isCancelled?: () => boolean;
}): Promise<void> {
  const key = `${options.screen}:${options.paperHash}`;
  const done = screenDone.get(key) ?? new Set<string>();
  screenDone.set(key, done);
  if (done.size >= MAX_PRECOMPUTE_PER_SCREEN || session.count >= MAX_PRECOMPUTE_PER_SESSION) {
    return;
  }

  const { items } = await predictHelp({
    screen: options.screen,
    paperHash: options.paperHash,
    fetcher: options.predictFetcher,
  });
  if (options.isCancelled?.()) return;

  const limit = options.screen === "landing" ? 3 : 5;
  const selected = items
    .filter((item) => item.unfamiliarity >= 0.55)
    .slice(0, limit);
  if (selected.length === 0 && items[0]) selected.push(items[0]);

  for (const item of selected) {
    if (options.isCancelled?.()) return;
    if (
      session.count >= MAX_PRECOMPUTE_PER_SESSION ||
      done.size >= MAX_PRECOMPUTE_PER_SCREEN
    ) {
      break;
    }
    if (done.has(item.helpId)) continue;
    done.add(item.helpId);
    session.count += 1;
    await loadHelpAnswer({
      helpId: item.helpId,
      variant: "default",
      paperHash: options.paperHash,
      cache: options.cache,
      fetcher: options.answerFetcher,
    });
  }
}