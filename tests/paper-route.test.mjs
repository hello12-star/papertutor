import test from "node:test";
import assert from "node:assert/strict";
import {
  formatPaperHash,
  parsePaperHash,
  restorePaperResult,
} from "../lib/paper-route.ts";
import { buildQaFixture } from "../dev/qa-fixture.ts";

const { doc, record } = buildQaFixture();
const analysis = record.analysis;
const paperHash = doc.hash;
const historyRecord = {
  paperHash,
  title: analysis.quickview.meta.title,
  createdAt: record.createdAt,
  doc,
  analysis,
};
const controlCharacters = Array.from({ length: 32 }, (_, code) =>
  String.fromCharCode(code),
).concat("\u007f");

for (const hash of ["", "#", "#/"]) {
  test(`parsePaperHash recognizes home ${JSON.stringify(hash)}`, () => {
    assert.deepEqual(parsePaperHash(hash), { kind: "home" });
  });
}

for (const [label, id, expected] of [
  ["plain ID", "sha256-Ab_09", "#/paper/sha256-Ab_09"],
  ["encoded slash", "a/b", "#/paper/a%2Fb"],
  ["Unicode", "论文λ", "#/paper/%E8%AE%BA%E6%96%87%CE%BB"],
  ["leading, internal and trailing spaces", " a b ", "#/paper/%20a%20b%20"],
  ["question mark", "a?b=1", "#/paper/a%3Fb%3D1"],
  ["percent", "100%", "#/paper/100%25"],
  ["fragment character", "a#b", "#/paper/a%23b"],
  ["plus", "a+b", "#/paper/a%2Bb"],
  ["already encoded slash", "%2F", "#/paper/%252F"],
  ["encoded control text", "%00", "#/paper/%2500"],
  ["invalid percent text", "%ZZ", "#/paper/%25ZZ"],
  ["opaque dot segment", "..", "#/paper/.."],
  ["decomposed Unicode", "e\u0301", "#/paper/e%CC%81"],
]) {
  test(`paper hash roundtrips ${label} without normalization or double decoding`, () => {
    assert.equal(formatPaperHash(id), expected);
    assert.deepEqual(parsePaperHash(expected), { kind: "paper", paperHash: id });
    assert.deepEqual(parsePaperHash(formatPaperHash(id)), { kind: "paper", paperHash: id });
  });
}

test("parsePaperHash accepts lowercase escapes and preserves raw opaque characters", () => {
  for (const [hash, id] of [
    ["#/paper/a%2fb", "a/b"],
    ["#/paper/a+b", "a+b"],
    ["#/paper/论文", "论文"],
    ["#/paper/ a b ", " a b "],
  ]) {
    assert.deepEqual(parsePaperHash(hash), { kind: "paper", paperHash: id });
  }
});

for (const [label, hash] of [
  ["non-route", "paper/id"],
  ["path without hash", "/paper/id"],
  ["unsupported route", "#/other/id"],
  ["wrong route case", "#/Paper/id"],
  ["missing ID segment", "#/paper"],
  ["empty ID", "#/paper/"],
  ["multiple segments", "#/paper/id/extra"],
  ["trailing slash", "#/paper/id/"],
  ["raw query", "#/paper/id?x=1"],
  ["raw fragment", "#/paper/id#extra"],
  ["encoded whitespace-only ID", "#/paper/%20%20"],
  ["raw whitespace-only ID", "#/paper/  "],
  ["incomplete percent escape", "#/paper/%"],
  ["one-digit percent escape", "#/paper/%2"],
  ["invalid percent escape", "#/paper/%GG"],
  ["truncated UTF-8", "#/paper/%E0%A4"],
  ["invalid UTF-8 byte", "#/paper/%FF"],
  ["encoded lone surrogate", "#/paper/%ED%A0%80"],
]) {
  test(`parsePaperHash returns unknown for ${label}`, () => {
    assert.deepEqual(parsePaperHash(hash), { kind: "unknown" });
  });
}

test("parsePaperHash rejects every raw and encoded ASCII control character", () => {
  for (const character of controlCharacters) {
    const id = `before${character}after`;
    assert.deepEqual(parsePaperHash(`#/paper/${id}`), { kind: "unknown" }, JSON.stringify(id));
    assert.deepEqual(
      parsePaperHash(`#/paper/${encodeURIComponent(id)}`),
      { kind: "unknown" },
      JSON.stringify(id),
    );
  }
});

for (const id of ["", " ", "\t\n", "\u3000\u00a0"]) {
  test(`formatPaperHash rejects empty or whitespace-only ID ${JSON.stringify(id)}`, () => {
    assert.throws(() => formatPaperHash(id), /Invalid paper hash/);
  });
}

test("formatPaperHash rejects every ASCII control character inside a nonempty ID", () => {
  for (const character of controlCharacters) {
    assert.throws(
      () => formatPaperHash(`before${character}after`),
      /Invalid paper hash/,
      `control code ${character.charCodeAt(0)}`,
    );
  }
});

function blockFetch(t) {
  return t.mock.method(globalThis, "fetch", () => {
    throw new Error("Paper restoration must remain offline");
  });
}

function createStore(t, { history = [], cachedDoc = null, cachedAnalysis = null } = {}) {
  return {
    listHistory: t.mock.fn(async () => history),
    getCachedDoc: t.mock.fn(async () => cachedDoc),
    getCachedAnalysis: t.mock.fn(async () => cachedAnalysis),
  };
}

function assertCacheReads(store, hash = paperHash) {
  assert.deepEqual(store.listHistory.mock.calls.map((call) => call.arguments), [[]]);
  assert.deepEqual(store.getCachedDoc.mock.calls.map((call) => call.arguments), [[hash]]);
  assert.deepEqual(store.getCachedAnalysis.mock.calls.map((call) => call.arguments), [[hash]]);
}

test("restorePaperResult prefers a matching history record and never calls either cache", async (t) => {
  const fetch = blockFetch(t);
  const store = createStore(t, {
    history: [
      { ...historyRecord, paperHash: "other", doc: { ...doc, hash: "other" } },
      { ...historyRecord, paperHash: "other" },
      { ...historyRecord, doc: { ...doc, hash: "other" } },
      historyRecord,
    ],
  });
  store.getCachedDoc = t.mock.fn(() => assert.fail("History hit must not read cached document"));
  store.getCachedAnalysis = t.mock.fn(() => assert.fail("History hit must not read cached analysis"));

  const result = await restorePaperResult(paperHash, store);

  assert.deepEqual(result, { doc, analysis });
  assert.equal(result.doc, doc);
  assert.equal(result.analysis, analysis);
  assert.deepEqual(store.listHistory.mock.calls.map((call) => call.arguments), [[]]);
  assert.equal(store.getCachedDoc.mock.callCount(), 0);
  assert.equal(store.getCachedAnalysis.mock.callCount(), 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test("restorePaperResult falls back to a complete local cache after empty history", async (t) => {
  const fetch = blockFetch(t);
  const store = createStore(t, { cachedDoc: doc, cachedAnalysis: record });

  const result = await restorePaperResult(paperHash, store);

  assert.deepEqual(result, { doc, analysis });
  assert.equal(result.doc, doc);
  assert.equal(result.analysis, analysis);
  assertCacheReads(store);
  assert.equal(fetch.mock.callCount(), 0);
});

for (const [label, mismatchedHistory] of [
  ["history paperHash mismatch", { ...historyRecord, paperHash: "other" }],
  ["history doc.hash mismatch", { ...historyRecord, doc: { ...doc, hash: "other" } }],
]) {
  for (const hasCache of [true, false]) {
    test(`restorePaperResult ignores ${label} with ${hasCache ? "complete" : "missing"} cache`, async (t) => {
      const fetch = blockFetch(t);
      const cachedDoc = hasCache ? { ...doc, fileName: "cached-copy.pdf" } : null;
      const cachedAnalysis = hasCache
        ? {
            ...record,
            analysis: {
              ...analysis,
              quickview: { ...analysis.quickview, coreQuestion: "Cached analysis fixture" },
            },
          }
        : null;
      const store = createStore(t, {
        history: [mismatchedHistory],
        cachedDoc,
        cachedAnalysis,
      });

      const result = await restorePaperResult(paperHash, store);

      assert.deepEqual(result, hasCache ? { doc: cachedDoc, analysis: cachedAnalysis.analysis } : null);
      assertCacheReads(store);
      assert.equal(fetch.mock.callCount(), 0);
    });
  }
}

for (const [label, cachedDoc, cachedAnalysis] of [
  ["both cache entries missing", null, null],
  ["document missing", null, record],
  ["analysis missing", doc, null],
  ["cached document hash mismatch", { ...doc, hash: "other" }, record],
]) {
  test(`restorePaperResult returns null for ${label}`, async (t) => {
    const fetch = blockFetch(t);
    const store = createStore(t, { cachedDoc, cachedAnalysis });

    assert.equal(await restorePaperResult(paperHash, store), null);
    assertCacheReads(store);
    assert.equal(fetch.mock.callCount(), 0);
  });
}

test("restorePaperResult uses the exact opaque ID from the hash route as both cache keys", async (t) => {
  const fetch = blockFetch(t);
  const id = " 论文/%2F?100% ";
  const route = parsePaperHash(formatPaperHash(id));
  const cachedDoc = { ...doc, hash: id };
  const store = createStore(t, { cachedDoc, cachedAnalysis: record });

  assert.deepEqual(route, { kind: "paper", paperHash: id });
  assert.deepEqual(await restorePaperResult(route.paperHash, store), { doc: cachedDoc, analysis });
  assertCacheReads(store, id);
  assert.equal(fetch.mock.callCount(), 0);
});

for (const method of ["listHistory", "getCachedDoc", "getCachedAnalysis"]) {
  for (const failureMode of ["throws", "rejects"]) {
    test(`restorePaperResult returns null when ${method} ${failureMode}`, async (t) => {
      const fetch = blockFetch(t);
      const store = createStore(t, { cachedDoc: doc, cachedAnalysis: record });
      const error = new Error(`${method} read failed`);
      store[method] = t.mock.fn(() => {
        if (failureMode === "rejects") return Promise.reject(error);
        throw error;
      });

      assert.equal(await restorePaperResult(paperHash, store), null);
      assert.equal(store[method].mock.callCount(), 1);
      assert.equal(store.listHistory.mock.callCount(), 1);
      if (method === "listHistory") {
        assert.equal(store.getCachedDoc.mock.callCount(), 0);
        assert.equal(store.getCachedAnalysis.mock.callCount(), 0);
      }
      assert.equal(fetch.mock.callCount(), 0);
    });
  }
}

test("restorePaperResult uses the real default stores safely without IndexedDB", async (t) => {
  const fetch = blockFetch(t);
  assert.equal(typeof globalThis.indexedDB, "undefined");

  assert.equal(await restorePaperResult(paperHash), null);
  assert.equal(fetch.mock.callCount(), 0);
});
