import test from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapHelp,
  canRegenerate,
  helpCacheKey,
  loadHelpAnswer,
  predictHelp,
  resetHelpLimits,
  sanitizePredictions,
} from "../lib/help-core.ts";
import { staticHelpAnswer } from "../functions/help/registry.ts";

function createCache(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    async get(key) {
      return map.get(key) ?? null;
    },
    async put(key, value) {
      map.set(key, value);
    },
  };
}

const answer = {
  helpId: "result.citationCheck",
  variant: "default",
  what: "这是引用校验",
  why: "防止编造",
  effect: "打开原文并定位",
};

test("help cache key uses required prefix and version", () => {
  assert.equal(
    helpCacheKey("result.citationCheck", "paper-1", "default"),
    "help:answer:v2:result.citationCheck:paper-1:default:v2",
  );
});

test("cache hit returns immediately without fetcher", async () => {
  const key = helpCacheKey("result.citationCheck", "paper-1", "default");
  const cache = createCache({ [key]: answer });
  let calls = 0;
  const result = await loadHelpAnswer({
    helpId: "result.citationCheck",
    variant: "default",
    paperHash: "paper-1",
    cache,
    fetcher: async () => {
      calls += 1;
      throw new Error("should not fetch");
    },
  });
  assert.equal(result.source, "cache");
  assert.equal(result.answer.what, answer.what);
  assert.equal(calls, 0);
});

test("cache miss fetches and stores the answer", async () => {
  const cache = createCache();
  const result = await loadHelpAnswer({
    helpId: "result.citationCheck",
    variant: "default",
    paperHash: "paper-2",
    cache,
    fetcher: async () => answer,
  });
  assert.equal(result.source, "api");
  assert.equal(
    (await cache.get(helpCacheKey("result.citationCheck", "paper-2", "default"))).what,
    answer.what,
  );
});

test("timeout or offline falls back to static help", async () => {
  const cache = createCache();
  const result = await loadHelpAnswer({
    helpId: "result.deepMode",
    variant: "default",
    paperHash: "paper-3",
    cache,
    fetcher: async () => {
      throw new Error("TIMEOUT");
    },
  });
  assert.equal(result.source, "fallback");
  assert.match(result.error, /TIMEOUT/);
  assert.equal(
    result.answer.what,
    staticHelpAnswer("result.deepMode", "default").what,
  );
});

test("predictions are clamped and filtered by screen", async () => {
  const items = sanitizePredictions(
    [
      {
        helpId: "result.citationCheck",
        unfamiliarity: 1.7,
        reason: "r",
        suggestedQuestion: "q",
      },
      {
        helpId: "landing.upload",
        unfamiliarity: 0.9,
        reason: "r",
        suggestedQuestion: "q",
      },
      {
        helpId: "result.deepMode",
        unfamiliarity: -0.4,
        reason: "r",
        suggestedQuestion: "q",
      },
    ],
    "result",
  );
  assert.ok(items.every((item) => item.helpId.startsWith("result.")));
  assert.ok(items.every((item) => item.unfamiliarity >= 0 && item.unfamiliarity <= 1));
  assert.deepEqual(
    items.map((item) => item.unfamiliarity),
    [...items.map((item) => item.unfamiliarity)].sort((a, b) => b - a),
  );
});

test("predict fallback works when API fails", async () => {
  const result = await predictHelp({
    screen: "landing",
    paperHash: "paper-4",
    fetcher: async () => {
      throw new Error("OFFLINE");
    },
  });
  assert.equal(result.source, "fallback");
  assert.ok(result.items.length > 0);
  assert.ok(result.items.every((item) => item.helpId.startsWith("landing.")));
});

test("bootstrap pre-generates top items into cache", async () => {
  resetHelpLimits();
  const cache = createCache();
  await bootstrapHelp({
    screen: "landing",
    paperHash: "paper-5",
    cache,
    predictFetcher: async () => [
      { helpId: "landing.samplePaper", unfamiliarity: 0.9, reason: "r", suggestedQuestion: "q" },
      { helpId: "landing.upload", unfamiliarity: 0.8, reason: "r", suggestedQuestion: "q" },
      { helpId: "landing.parseMode", unfamiliarity: 0.7, reason: "r", suggestedQuestion: "q" },
      { helpId: "landing.privacy", unfamiliarity: 0.6, reason: "r", suggestedQuestion: "q" },
    ],
    answerFetcher: async (helpId, variant) => ({
      helpId,
      variant,
      what: "w",
      why: "y",
      effect: "e",
    }),
  });
  assert.ok(await cache.get(helpCacheKey("landing.samplePaper", "paper-5", "default")));
  assert.ok(await cache.get(helpCacheKey("landing.upload", "paper-5", "default")));
  assert.ok(await cache.get(helpCacheKey("landing.parseMode", "paper-5", "default")));
  assert.equal(await cache.get(helpCacheKey("landing.privacy", "paper-5", "default")), null);
});

test("same control can regenerate at most once", () => {
  resetHelpLimits();
  assert.equal(canRegenerate("result.citationCheck"), true);
  assert.equal(canRegenerate("result.citationCheck"), false);
  assert.equal(canRegenerate("result.deepMode"), true);
});