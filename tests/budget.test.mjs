import test from "node:test";
import assert from "node:assert/strict";
import { checkBudget, initialBudgetState, loadBudgetConfig } from "../functions/budget.ts";

const base = {
  serviceEnabled: true,
  dailyBudgetCny: 0.1,
  requestCostCny: 0.06,
  maxRequestsPerMinute: 10,
};

test("service disabled returns 503", () => {
  const { decision } = checkBudget(
    initialBudgetState(0),
    { ...base, serviceEnabled: false },
    0,
  );
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 503);
  assert.equal(decision.code, "SERVICE_DISABLED");
});

test("budget exhaustion returns 402 and never overspends", () => {
  const first = checkBudget(initialBudgetState(0), base, 0);
  assert.equal(first.decision.ok, true);
  const second = checkBudget(first.state, base, 1000);
  assert.equal(second.decision.ok, false);
  assert.equal(second.decision.status, 402);
  assert.equal(second.decision.code, "DAILY_BUDGET_EXCEEDED");
  assert.equal(second.state.spentCny, 0.06);
});

test("rate limit returns 429 and resets after one minute", () => {
  const config = {
    ...base,
    dailyBudgetCny: 10,
    requestCostCny: 0,
    maxRequestsPerMinute: 2,
  };
  const first = checkBudget(initialBudgetState(0), config, 0);
  const second = checkBudget(first.state, config, 1);
  const third = checkBudget(second.state, config, 2);
  assert.equal(first.decision.ok, true);
  assert.equal(second.decision.ok, true);
  assert.equal(third.decision.ok, false);
  assert.equal(third.decision.status, 429);
  assert.equal(third.decision.code, "RATE_LIMITED");
  const afterWindow = checkBudget(third.state, config, 61_000);
  assert.equal(afterWindow.decision.ok, true);
});

test("new UTC day resets daily spend", () => {
  const first = checkBudget(initialBudgetState(0), base, 0);
  assert.equal(first.state.spentCny, 0.06);
  const nextDay = checkBudget(first.state, base, 86_400_000);
  assert.equal(nextDay.decision.ok, true);
  assert.equal(nextDay.state.spentCny, 0.06);
  assert.equal(nextDay.state.day, "1970-01-02");
});

test("default daily budget is 1 CNY when env is not set", () => {
  const previous = process.env.DAILY_BUDGET_CNY;
  delete process.env.DAILY_BUDGET_CNY;
  try {
    assert.equal(loadBudgetConfig().dailyBudgetCny, 1);
  } finally {
    if (previous === undefined) delete process.env.DAILY_BUDGET_CNY;
    else process.env.DAILY_BUDGET_CNY = previous;
  }
});
