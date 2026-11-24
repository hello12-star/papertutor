import test from "node:test";
import assert from "node:assert/strict";
import { isTransientServerError, ServerApiError } from "../lib/server-api.ts";

test("transient server errors are retried once", () => {
  assert.equal(isTransientServerError(new ServerApiError("HTTP_504", "timeout", 504)), true);
  assert.equal(isTransientServerError(new ServerApiError("DOCMIND_TIMEOUT", "timeout", 504)), true);
  assert.equal(isTransientServerError(new ServerApiError("LLM_UPSTREAM_ERROR", "upstream", 502)), true);
  assert.equal(isTransientServerError(new TypeError("Failed to fetch")), true);
});

test("limits, disabled service and user cancellation are not retried", () => {
  assert.equal(isTransientServerError(new ServerApiError("DAILY_BUDGET_EXCEEDED", "budget", 402)), false);
  assert.equal(isTransientServerError(new ServerApiError("SERVICE_DISABLED", "off", 503)), false);
  assert.equal(isTransientServerError(new ServerApiError("RATE_LIMITED", "rate", 429)), false);
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(isTransientServerError(abort), false);
});
