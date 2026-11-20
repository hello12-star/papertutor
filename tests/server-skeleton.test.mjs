import test from "node:test";
import assert from "node:assert/strict";
import { handler } from "../functions/handler.ts";
import { resetBudgetForTests } from "../functions/budget.ts";

const BASE = "http://localhost/functions/v1/app";
const ENV_KEYS = [
  "SERVER_MODE",
  "PARSER_PROVIDER",
  "LLM_PROVIDER",
  "ALIYUN_ACCESS_KEY_ID",
  "ALIYUN_ACCESS_KEY_SECRET",
  "LLM_API_KEY",
  "DASHSCOPE_API_KEY",
  "OPENAI_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "PROMPT_VERSION",
  "MAX_UPLOAD_MB",
  "NODE_ENV",
  "SERVICE_ENABLED",
  "DAILY_BUDGET_CNY",
  "ESTIMATED_ANALYSIS_COST_CNY",
  "ESTIMATED_HELP_COST_CNY",
  "MAX_REQUESTS_PER_MINUTE",
];

function resetEnv(values = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  resetBudgetForTests();
}

async function call(path, init = {}) {
  const response = await handler(new Request(`${BASE}${path}`, init));
  const body = await response.json();
  return { response, body };
}

function pdfRequest(bytes, name = "qa-fixture.pdf") {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "x-file-name": name,
    },
    body: new Uint8Array(bytes),
  };
}

function callJson(path, payload) {
  return call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const HELP_REQUESTS = {
  predict: { screen: "landing", paperHash: "help-budget-paper" },
  answer: { helpId: "result.citationCheck", paperHash: "help-budget-paper" },
};

const API_ROUTES = [
  { name: "path", route: (action) => `/api/${action.replaceAll(".", "/")}` },
  { name: "query", route: (action) => `?action=api.${action}` },
];

function setupHelpBudgetTest(t, values = {}) {
  // Freeze the clock so rate-limit assertions never cross a real minute/day.
  t.mock.method(Date, "now", () => Date.UTC(2026, 0, 1));
  resetEnv({
    SERVER_MODE: "true",
    LLM_PROVIDER: "auto",
    LLM_API_KEY: "test-only-not-a-real-key",
    LLM_BASE_URL: "https://llm.invalid/v1",
    LLM_MODEL: "budget-test-llm",
    SERVICE_ENABLED: "true",
    DAILY_BUDGET_CNY: "1",
    MAX_REQUESTS_PER_MINUTE: "20",
    ...values,
  });
  t.after(() => resetEnv());

  // A local completion fixture valid for analyze, predict and answer; no network.
  const content = {
    items: [{ helpId: "landing.samplePaper", unfamiliarity: 0.8 }],
    what: "Test control",
    why: "Test explanation",
    effect: "Test effect",
    quickview: {
      meta: { title: "Budget regression paper" },
      coreQuestion: "Question",
      coreContribution: "Contribution",
      methodSummary: "Method",
      prerequisites: [],
      readingPath: { first: [], skip: [] },
    },
    skeleton: {
      problem: { summary: "Problem", limitations: [], citations: [] },
      insight: { summary: "Insight", citations: [] },
      modules: [],
      experiments: [],
      limitations: { stated: [], inferred: [], citations: [] },
    },
  };
  // Test-context mocks are restored automatically, including on assertion failure.
  return t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  );
}

function assertBudgetResponse({ response, body }, status, code) {
  assert.equal(response.status, status);
  assert.deepEqual(Object.keys(body).sort(), ["code", "message", "ok"]);
  assert.equal(body.ok, false);
  assert.equal(body.code, code);
  assert.equal(typeof body.message, "string");
  assert.ok(body.message.trim());
}

test("SERVER_MODE=false keeps old health path and disables API", async () => {
  resetEnv();
  const health = await call("?action=health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);

  const api = await call("/api/jobs/missing", { method: "GET" });
  assert.equal(api.response.status, 404);
  assert.equal(api.body.code, "SERVER_MODE_DISABLED");
});

test("missing DocMind env returns code without outbound fetch", async () => {
  resetEnv({ SERVER_MODE: "true", PARSER_PROVIDER: "docmind" });
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected outbound fetch");
  };
  try {
    const { response, body } = await call("/api/parse", pdfRequest([1, 2, 3]));
    assert.equal(response.status, 503);
    assert.equal(body.code, "DOCMIND_NOT_CONFIGURED");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing LLM env returns code without outbound fetch", async () => {
  resetEnv({ SERVER_MODE: "true", PARSER_PROVIDER: "mock", LLM_PROVIDER: "auto" });
  const parsed = await call("/api/parse", pdfRequest([4, 5, 6]));
  assert.equal(parsed.response.status, 202);
  assert.equal(parsed.body.ok, true);
  assert.match(parsed.body.cacheKey, /^parse:v1:[0-9a-f]{64}$/);

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected outbound fetch");
  };
  try {
    const analyzed = await call("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId: parsed.body.docId, mode: "quick" }),
    });
    assert.equal(analyzed.response.status, 503);
    assert.equal(analyzed.body.code, "LLM_NOT_CONFIGURED");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mock parser and mock LLM run end to end with cache keys", async () => {
  resetEnv({
    SERVER_MODE: "true",
    PARSER_PROVIDER: "mock",
    LLM_PROVIDER: "mock",
    PROMPT_VERSION: "v2",
  });
  const parsed = await call("/api/parse", pdfRequest([7, 8, 9]));
  assert.equal(parsed.response.status, 202);
  assert.equal(parsed.body.status, "succeeded");
  assert.ok(parsed.body.docId);
  assert.match(parsed.body.cacheKey, /^parse:v1:[0-9a-f]{64}$/);

  const job = await call(`/api/jobs/${parsed.body.jobId}`, { method: "GET" });
  assert.equal(job.response.status, 200);
  assert.equal(job.body.job.status, "succeeded");
  assert.ok(job.body.job.markdown.includes("Sparse Attention for Long Documents"));

  const analyzed = await call("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: parsed.body.docId, mode: "quick" }),
  });
  assert.equal(analyzed.response.status, 200);
  assert.equal(analyzed.body.ok, true);
  assert.equal(analyzed.body.model, "mock-llm");
  assert.equal(
    analyzed.body.cacheKey,
    `analysis:v1:${parsed.body.docId}:quick:v2:mock-llm`,
  );
  assert.ok(analyzed.body.analysis.quickview.meta.title.includes("QA 夹具"));
  assert.ok(Array.isArray(analyzed.body.analysis.skeleton.modules));

  const again = await call("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: parsed.body.docId, mode: "quick" }),
  });
  assert.equal(again.body.cached, true);
});

test("error codes cover bad input, missing job and missing doc", async () => {
  resetEnv({ SERVER_MODE: "true", PARSER_PROVIDER: "mock", LLM_PROVIDER: "mock" });

  const empty = await call("/api/parse", pdfRequest([]));
  assert.equal(empty.response.status, 400);
  assert.equal(empty.body.code, "INVALID_FILE");

  const nonPdf = await call("/api/parse", pdfRequest([1, 2], "notes.txt"));
  assert.equal(nonPdf.response.status, 400);
  assert.equal(nonPdf.body.code, "INVALID_FILE");

  const parsed = await call("/api/parse", pdfRequest([10, 11, 12]));
  assert.equal(parsed.response.status, 202);

  const badMode = await call("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: parsed.body.docId, mode: "slow" }),
  });
  assert.equal(badMode.response.status, 400);
  assert.equal(badMode.body.code, "INVALID_MODE");

  const missingDoc = await call("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: "missing-doc", mode: "quick" }),
  });
  assert.equal(missingDoc.response.status, 404);
  assert.equal(missingDoc.body.code, "DOC_NOT_FOUND");

  const missingJob = await call("/api/jobs/missing-job", { method: "GET" });
  assert.equal(missingJob.response.status, 404);
  assert.equal(missingJob.body.code, "JOB_NOT_FOUND");
});
test("help predict returns scores in range and sorted", async () => {
  resetEnv({ SERVER_MODE: "true", LLM_PROVIDER: "mock" });
  const landing = await call("/api/help/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ screen: "landing", paperHash: "paper-1" }),
  });
  assert.equal(landing.response.status, 200);
  assert.ok(landing.body.items.length > 0);
  assert.ok(landing.body.items.some((item) => item.helpId === "landing.samplePaper"));
  for (const item of landing.body.items) {
    assert.ok(item.unfamiliarity >= 0 && item.unfamiliarity <= 1);
  }
  const scores = landing.body.items.map((item) => item.unfamiliarity);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));

  const result = await call("/api/help/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ screen: "result", paperHash: "paper-1" }),
  });
  assert.equal(result.response.status, 200);
  assert.ok(result.body.items.some((item) => item.helpId === "result.citationCheck"));
  assert.ok(result.body.items.every((item) => item.helpId.startsWith("result.")));
});

test("help answer mock returns three parts and supports variants", async () => {
  resetEnv({ SERVER_MODE: "true", LLM_PROVIDER: "mock" });
  const answer = await call("/api/help/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      helpId: "result.citationCheck",
      variant: "default",
      paperHash: "paper-1",
    }),
  });
  assert.equal(answer.response.status, 200);
  assert.equal(answer.body.provider, "mock-help");
  assert.ok(answer.body.answer.what.length > 0);
  assert.ok(answer.body.answer.why.length > 0);
  assert.ok(answer.body.answer.effect.length > 0);

  const example = await call("/api/help/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      helpId: "result.deepMode",
      variant: "example",
      paperHash: "paper-1",
    }),
  });
  assert.equal(example.response.status, 200);
  assert.ok(example.body.answer.example.length > 0);

  const unknown = await call("/api/help/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ helpId: "nope", paperHash: "paper-1" }),
  });
  assert.equal(unknown.response.status, 400);
  assert.equal(unknown.body.code, "UNKNOWN_HELP_ID");
});

test("help predict with missing LLM env never calls outbound fetch", async () => {
  resetEnv({ SERVER_MODE: "true", LLM_PROVIDER: "auto" });
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected outbound fetch");
  };
  try {
    const { response, body } = await call("/api/help/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screen: "landing", paperHash: "paper-1" }),
    });
    assert.equal(response.status, 503);
    assert.equal(body.code, "LLM_NOT_CONFIGURED");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("help mock performs 0 outbound calls", async () => {
  resetEnv({ SERVER_MODE: "true", LLM_PROVIDER: "mock" });
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected outbound fetch");
  };
  try {
    const predicted = await call("/api/help/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screen: "result", paperHash: "paper-1" }),
    });
    assert.equal(predicted.response.status, 200);
    const answered = await call("/api/help/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ helpId: "result.citationCheck", paperHash: "paper-1" }),
    });
    assert.equal(answered.response.status, 200);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const { name, route } of API_ROUTES) {
  for (const [kind, payload] of Object.entries(HELP_REQUESTS)) {
    test(`${name} help ${kind}: exhausted budget returns 402 without LLM fetch`, async (t) => {
      const fetch = setupHelpBudgetTest(t, {
        DAILY_BUDGET_CNY: "0.001",
        ESTIMATED_HELP_COST_CNY: "0.002",
      });
      const result = await callJson(route(`help.${kind}`), payload);
      assertBudgetResponse(result, 402, "DAILY_BUDGET_EXCEEDED");
      assert.equal(fetch.mock.callCount(), 0);
    });

    test(`${name} help ${kind}: rate limit returns 429 without another LLM fetch`, async (t) => {
      const fetch = setupHelpBudgetTest(t, { MAX_REQUESTS_PER_MINUTE: "1" });
      const first = await callJson(route(`help.${kind}`), payload);
      assert.equal(first.response.status, 200);
      assert.equal(first.body.ok, true);
      assert.equal(first.body.provider, "llm-help");
      assert.equal(fetch.mock.callCount(), 1);

      const blocked = await callJson(route(`help.${kind}`), payload);
      assertBudgetResponse(blocked, 429, "RATE_LIMITED");
      assert.equal(fetch.mock.callCount(), 1);
    });

    test(`${name} help ${kind}: disabled service returns 503 without LLM fetch`, async (t) => {
      const fetch = setupHelpBudgetTest(t, { SERVICE_ENABLED: "false" });
      const result = await callJson(route(`help.${kind}`), payload);
      assertBudgetResponse(result, 503, "SERVICE_DISABLED");
      assert.equal(fetch.mock.callCount(), 0);
    });
  }

  for (const limit of [
    {
      name: "daily budget",
      env: { DAILY_BUDGET_CNY: "0.014" },
      status: 402,
      code: "DAILY_BUDGET_EXCEEDED",
    },
    {
      name: "minute limit",
      env: { MAX_REQUESTS_PER_MINUTE: "3" },
      status: 429,
      code: "RATE_LIMITED",
    },
  ]) {
    test(`${name} analyze and both help routes share the ${limit.name}`, async (t) => {
      const fetch = setupHelpBudgetTest(t, {
        ESTIMATED_ANALYSIS_COST_CNY: "0.01",
        ESTIMATED_HELP_COST_CNY: "0.002",
        ...limit.env,
      });
      const requests = [
        ["help.predict", HELP_REQUESTS.predict],
        ["analyze", {
          docId: `help-budget-${name}-${limit.code}`,
          mode: "quick",
          markdown: "# Budget regression paper\n\nA local test fixture.",
        }],
        ["help.answer", HELP_REQUESTS.answer],
      ];
      for (const [index, [action, payload]] of requests.entries()) {
        const allowed = await callJson(route(action), payload);
        assert.equal(allowed.response.status, 200, action);
        assert.equal(allowed.body.ok, true, action);
        assert.equal(fetch.mock.callCount(), index + 1, action);
      }
      for (const [action, payload] of requests) {
        const blocked = await callJson(route(action), payload);
        assertBudgetResponse(blocked, limit.status, limit.code);
        assert.equal(fetch.mock.callCount(), requests.length, action);
      }
    });
  }
}

test("SERVICE_ENABLED=false returns 503 before any provider call", async () => {
  resetEnv({
    SERVER_MODE: "true",
    PARSER_PROVIDER: "mock",
    LLM_PROVIDER: "mock",
    SERVICE_ENABLED: "false",
  });
  const { response, body } = await call("/api/parse", pdfRequest([30, 31, 32]));
  assert.equal(response.status, 503);
  assert.equal(body.code, "SERVICE_DISABLED");
});

test("daily budget exhaustion returns 402 before LLM fetch", async () => {
  resetEnv({
    SERVER_MODE: "true",
    PARSER_PROVIDER: "mock",
    LLM_PROVIDER: "mock",
    DAILY_BUDGET_CNY: "0.01",
    ESTIMATED_ANALYSIS_COST_CNY: "0.02",
  });
  const parsed = await call("/api/parse", pdfRequest([33, 34, 35]));
  assert.equal(parsed.response.status, 202);

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected outbound fetch");
  };
  try {
    const analyzed = await call("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId: parsed.body.docId, mode: "quick" }),
    });
    assert.equal(analyzed.response.status, 402);
    assert.equal(analyzed.body.code, "DAILY_BUDGET_EXCEEDED");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("health reports server mode without requiring it", async () => {
  resetEnv({ SERVER_MODE: "false" });
  const off = await call("/api/health");
  assert.equal(off.response.status, 200);
  assert.equal(off.body.ok, true);
  assert.equal(off.body.serverMode, false);

  resetEnv({ SERVER_MODE: "true" });
  const on = await call("/api/health");
  assert.equal(on.response.status, 200);
  assert.equal(on.body.serverMode, true);
});

test("query API actions route to server handlers", async () => {
  resetEnv({
    SERVER_MODE: "true",
    PARSER_PROVIDER: "mock",
    LLM_PROVIDER: "mock",
  });
  const health = await call("?action=api.health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.serverMode, true);

  const parsed = await call("?action=api.parse", pdfRequest([41, 42, 43]));
  assert.equal(parsed.response.status, 202);
  const analyzed = await call("?action=api.analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: parsed.body.docId, mode: "quick" }),
  });
  assert.equal(analyzed.response.status, 200);
  assert.equal(analyzed.body.model, "mock-llm");
});

test("analyze accepts client-provided markdown when docs map misses", async () => {
  resetEnv({ SERVER_MODE: "true", LLM_PROVIDER: "mock" });
  const analyzed = await call("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      docId: "provided-doc",
      mode: "quick",
      markdown: "# Provided Paper\n\n## Abstract\nThis is a provided markdown.",
    }),
  });
  assert.equal(analyzed.response.status, 200);
  assert.equal(analyzed.body.ok, true);
  assert.equal(analyzed.body.model, "mock-llm");
});

test("production rejects mock providers", async () => {
  resetEnv({
    SERVER_MODE: "true",
    PARSER_PROVIDER: "mock",
    LLM_PROVIDER: "mock",
    NODE_ENV: "production",
  });
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected outbound fetch");
  };
  try {
    const parsed = await call("/api/parse", pdfRequest([21, 22, 23]));
    assert.equal(parsed.response.status, 500);
    assert.equal(parsed.body.code, "MOCK_PROVIDER_FORBIDDEN");

    const help = await call("/api/help/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screen: "landing", paperHash: "paper-1" }),
    });
    assert.equal(help.response.status, 500);
    assert.equal(help.body.code, "MOCK_PROVIDER_FORBIDDEN");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
