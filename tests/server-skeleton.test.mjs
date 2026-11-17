import test from "node:test";
import assert from "node:assert/strict";
import { handler } from "../functions/handler.ts";

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
];

function resetEnv(values = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
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