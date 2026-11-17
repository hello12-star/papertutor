// 进程内计数、冷启动重置；上线前必须改为持久化存储。
import { readEnv } from "./providers/env.ts";

const DEFAULT_DAILY_BUDGET_CNY = 30;
const DEFAULT_REQUEST_COST_CNY = 0.05;
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 20;

export type BudgetConfig = {
  serviceEnabled: boolean;
  dailyBudgetCny: number;
  requestCostCny: number;
  maxRequestsPerMinute: number;
};

export type BudgetState = {
  day: string;
  spentCny: number;
  windowStartedAt: number;
  windowCount: number;
};

export type BudgetDecision =
  | { ok: true; code: "OK"; remainingCny: number }
  | { ok: false; status: 402 | 429 | 503; code: string; message: string };

function numberEnv(name: string, fallback: number): number {
  const raw = readEnv(name).trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function serviceEnabled(): boolean {
  const raw = readEnv("SERVICE_ENABLED").trim();
  return raw ? !/^(0|false|no|off)$/i.test(raw) : true;
}

export function loadBudgetConfig(): BudgetConfig {
  return {
    serviceEnabled: serviceEnabled(),
    dailyBudgetCny: numberEnv("DAILY_BUDGET_CNY", DEFAULT_DAILY_BUDGET_CNY),
    requestCostCny: numberEnv("ESTIMATED_ANALYSIS_COST_CNY", DEFAULT_REQUEST_COST_CNY),
    maxRequestsPerMinute: Math.max(
      1,
      Math.floor(numberEnv("MAX_REQUESTS_PER_MINUTE", DEFAULT_MAX_REQUESTS_PER_MINUTE)),
    ),
  };
}

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function roundCny(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function initialBudgetState(now = Date.now()): BudgetState {
  return { day: dayKey(now), spentCny: 0, windowStartedAt: now, windowCount: 0 };
}

export function checkBudget(
  state: BudgetState,
  config: BudgetConfig,
  now = Date.now(),
): { state: BudgetState; decision: BudgetDecision } {
  if (!config.serviceEnabled) {
    return {
      state,
      decision: {
        ok: false,
        status: 503,
        code: "SERVICE_DISABLED",
        message: "服务暂时关闭（SERVICE_ENABLED=false）。",
      },
    };
  }

  let next: BudgetState = state.day === dayKey(now) ? { ...state } : initialBudgetState(now);
  if (now - next.windowStartedAt >= 60_000) {
    next.windowStartedAt = now;
    next.windowCount = 0;
  }
  if (next.windowCount >= config.maxRequestsPerMinute) {
    return {
      state: next,
      decision: {
        ok: false,
        status: 429,
        code: "RATE_LIMITED",
        message: "请求过于频繁，请稍后再试。",
      },
    };
  }

  const nextSpent = roundCny(next.spentCny + config.requestCostCny);
  if (nextSpent > config.dailyBudgetCny) {
    return {
      state: next,
      decision: {
        ok: false,
        status: 402,
        code: "DAILY_BUDGET_EXCEEDED",
        message: `今日预算已用尽（${next.spentCny.toFixed(4)}/${config.dailyBudgetCny.toFixed(
          2,
        )} CNY）。`,
      },
    };
  }

  next.spentCny = nextSpent;
  next.windowCount += 1;
  return {
    state: next,
    decision: {
      ok: true,
      code: "OK",
      remainingCny: roundCny(config.dailyBudgetCny - next.spentCny),
    },
  };
}

let budgetState = initialBudgetState();

export function resetBudgetForTests(now = Date.now()): void {
  budgetState = initialBudgetState(now);
}

export function guardAnalysisBudget(now = Date.now()): BudgetDecision {
  const result = checkBudget(budgetState, loadBudgetConfig(), now);
  budgetState = result.state;
  return result.decision;
}
