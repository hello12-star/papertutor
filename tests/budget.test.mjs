import test from "node:test";
import assert from "node:assert/strict";
import {
  checkBudget,
  guardAnalysisBudget,
  guardHelpBudget,
  initialBudgetState,
  loadBudgetConfig,
  resetBudgetForTests,
} from "../functions/budget.ts";

const base = {
  serviceEnabled: true,
  dailyBudgetCny: 0.1,
  requestCostCny: 0.06,
  maxRequestsPerMinute: 10,
};

const BUDGET_ENV_KEYS = [
  "SERVICE_ENABLED",
  "DAILY_BUDGET_CNY",
  "ESTIMATED_ANALYSIS_COST_CNY",
  "ESTIMATED_HELP_COST_CNY",
  "MAX_REQUESTS_PER_MINUTE",
];

function withBudgetEnv(values, run) {
  // Only snapshot non-sensitive budget settings, never provider credentials.
  const previous = new Map(BUDGET_ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of BUDGET_ENV_KEYS) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    resetBudgetForTests(0);
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetBudgetForTests();
  }
}

function assertAllowed(decision, remainingCny) {
  assert.deepEqual(decision, { ok: true, code: "OK", remainingCny });
}

function assertDenied(decision, status, code) {
  assert.equal(decision.ok, false);
  assert.equal(decision.status, status);
  assert.equal(decision.code, code);
  assert.equal(typeof decision.message, "string");
  assert.ok(decision.message.trim());
}

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

test("help guard defaults to 0.002 CNY independently of analysis cost", () => {
  withBudgetEnv(
    { DAILY_BUDGET_CNY: "0.006", ESTIMATED_ANALYSIS_COST_CNY: "0.05" },
    () => {
      assertAllowed(guardHelpBudget(0), 0.004);
      assertAllowed(guardHelpBudget(1), 0.002);
      assertAllowed(guardHelpBudget(2), 0);
      assertDenied(guardHelpBudget(3), 402, "DAILY_BUDGET_EXCEEDED");
    },
  );
});

test("help guard uses custom ESTIMATED_HELP_COST_CNY", () => {
  withBudgetEnv(
    {
      DAILY_BUDGET_CNY: "0.06",
      ESTIMATED_ANALYSIS_COST_CNY: "0.05",
      ESTIMATED_HELP_COST_CNY: "0.03",
    },
    () => {
      assertAllowed(guardHelpBudget(0), 0.03);
      assertAllowed(guardHelpBudget(1), 0);
      assertDenied(guardHelpBudget(2), 402, "DAILY_BUDGET_EXCEEDED");
    },
  );
});

test("help and analysis guards share daily spend in both directions", () => {
  withBudgetEnv(
    {
      DAILY_BUDGET_CNY: "0.054",
      ESTIMATED_ANALYSIS_COST_CNY: "0.05",
      ESTIMATED_HELP_COST_CNY: "0.002",
    },
    () => {
      assertAllowed(guardHelpBudget(0), 0.052);
      assertAllowed(guardAnalysisBudget(1), 0.002);
      assertAllowed(guardHelpBudget(2), 0);
      assertDenied(guardHelpBudget(3), 402, "DAILY_BUDGET_EXCEEDED");
      assertDenied(guardAnalysisBudget(4), 402, "DAILY_BUDGET_EXCEEDED");
    },
  );
});

test("help and analysis share a minute limit without resetting daily spend", () => {
  withBudgetEnv(
    {
      DAILY_BUDGET_CNY: "0.2",
      ESTIMATED_ANALYSIS_COST_CNY: "0.05",
      ESTIMATED_HELP_COST_CNY: "0.002",
      MAX_REQUESTS_PER_MINUTE: "2",
    },
    () => {
      assertAllowed(guardAnalysisBudget(0), 0.15);
      assertAllowed(guardHelpBudget(1), 0.148);
      assertDenied(guardHelpBudget(59_999), 429, "RATE_LIMITED");
      assertDenied(guardAnalysisBudget(59_999), 429, "RATE_LIMITED");
      assertAllowed(guardHelpBudget(60_000), 0.146);
      assertAllowed(guardAnalysisBudget(60_001), 0.096);
      assertDenied(guardHelpBudget(60_002), 429, "RATE_LIMITED");
    },
  );
});

test("new UTC day resets shared help and analysis spend and minute count", () => {
  withBudgetEnv(
    {
      DAILY_BUDGET_CNY: "0.052",
      ESTIMATED_ANALYSIS_COST_CNY: "0.05",
      ESTIMATED_HELP_COST_CNY: "0.002",
      MAX_REQUESTS_PER_MINUTE: "2",
    },
    () => {
      const beforeMidnight = Date.UTC(2026, 0, 1, 23, 59, 59);
      resetBudgetForTests(beforeMidnight);
      assertAllowed(guardAnalysisBudget(beforeMidnight), 0.002);
      assertAllowed(guardHelpBudget(beforeMidnight + 1), 0);
      assertDenied(guardHelpBudget(beforeMidnight + 2), 429, "RATE_LIMITED");
      assertAllowed(guardHelpBudget(beforeMidnight + 1_000), 0.05);
      assertAllowed(guardAnalysisBudget(beforeMidnight + 1_001), 0);
    },
  );
});

test("disabled help guard returns 503 without spending or consuming rate quota", () => {
  withBudgetEnv(
    {
      SERVICE_ENABLED: "false",
      DAILY_BUDGET_CNY: "0.002",
      ESTIMATED_HELP_COST_CNY: "0.002",
      MAX_REQUESTS_PER_MINUTE: "1",
    },
    () => {
      assertDenied(guardHelpBudget(0), 503, "SERVICE_DISABLED");
      process.env.SERVICE_ENABLED = "true";
      assertAllowed(guardHelpBudget(1), 0);
    },
  );
});
