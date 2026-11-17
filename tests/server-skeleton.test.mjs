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
