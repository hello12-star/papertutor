import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { predictionsForScreen, staticHelpAnswer } from "../functions/help/registry";

const FIXTURE = path.resolve("e2e/fixtures/ten-pages.pdf");
const DEMO_HASH = "demo-attention-v1";
const DEMO_PAPER = JSON.parse(
  fs.readFileSync("public/demo/attention.json", "utf8"),
);

test.beforeEach(async ({ page }) => {
  await page.route("**/functions/v1/app*", (route) => route.fulfill({
    status: 404,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, code: "E2E_UNMOCKED_REQUEST" }),
  }));
});

async function mockHelp(page: Page, status = 200) {
  const calls = { predict: 0, answer: 0 };
  await page.route(/\/functions\/v1\/app\?action=api\.help\./, async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const body = route.request().postDataJSON();
    if (action === "api.help.predict") calls.predict += 1;
    else calls.answer += 1;
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 200
        ? action === "api.help.predict"
          ? { ok: true, items: predictionsForScreen(body.screen) }
          : { ok: true, answer: staticHelpAnswer(body.helpId, body.variant ?? "default") }
        : { ok: false, code: "DAILY_BUDGET_EXCEEDED", message: "今日预算已用尽" }),
    });
  });
  return calls;
}

async function mockMineru(page: Page, mode: "failure" | "running") {
  await page.route("**/functions/v1/app*", async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action");

    if (action === "mineru.submit") {
      if (mode === "failure") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: "mineru_submit_failed",
            detail: "e2e mock failure",
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, taskId: "e2e-task", mode: "flash" }),
      });
      return;
    }

    if (action === "mineru.status") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          state: "running",
          progress: { extracted: 3, total: 10 },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "unknown_action" }),
    });
  });
}

async function gotoLanding(page: Page, serverMode = false) {
  await page.route("**/functions/v1/app/api/health*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        serverMode,
        serviceEnabled: serverMode,
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByText("没有 Key，也能先读 3 篇经典论文")).toBeVisible();
  await expect(page.locator("[data-server-mode]")).toHaveAttribute(
    "data-server-mode",
    serverMode ? "true" : "false",
  );
}

async function readProgress(page: Page) {
  return page.evaluate(async (paperHash) => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open("papertutor-history");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db) return null;
    try {
      const progress = await new Promise<any>((resolve) => {
        const request = db
          .transaction("progress", "readonly")
          .objectStore("progress")
          .get(paperHash);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      });
      return progress
        ? {
            activeStep: progress.activeStep as string,
            revealedSelfTestIds: progress.revealedSelfTestIds as string[],
          }
        : null;
    } catch {
      return null;
    }
  }, DEMO_HASH);
}

test("demo opens with pre-generated study tools", async ({ page }) => {
  await gotoLanding(page);
  const card = page.locator("article").filter({ hasText: "Attention Is All You Need" }).first();
  await card.getByRole("button", { name: /打开示例/ }).click();

  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toBeVisible();
  await expect(page.getByText("预生成示例").first()).toBeVisible();
  await expect(page.getByText("方法流程图：从问题到验证")).toBeVisible();
  await expect(page.locator("#formulas article")).toHaveCount(3);
  await expect(page.locator("#selfTest")).toBeVisible();
  await expect(page.locator("#report")).toBeVisible();
});

test("parse failure shows retry without real MinerU", async ({ page }) => {
  await mockMineru(page, "failure");
  await gotoLanding(page);
  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);

  await expect(page.getByText("MinerU 拒绝了这次解析请求")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
});

test("parse progress shows cancel and returns to upload", async ({ page }) => {
  await mockMineru(page, "running");
  await gotoLanding(page);
  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);

  await expect(page.getByText(/第 3\/10 页/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "取消解析" })).toBeVisible();
  await page.getByRole("button", { name: "取消解析" }).click();

  await expect(page.getByText("没有 Key，也能先读 3 篇经典论文")).toBeVisible();
  await expect(page.getByText("正在把这篇论文重构成学习材料")).toHaveCount(0);
});

test("server mode uses /api/parse and /api/analyze without MinerU", async ({ page }) => {
  const helpCalls = await mockHelp(page);
  const calls = { parse: 0, analyze: 0, mineru: 0 };
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("action=api.parse")) calls.parse += 1;
    if (url.includes("action=api.analyze")) calls.analyze += 1;
    if (url.includes("mineru.submit")) calls.mineru += 1;
  });
  await page.route(/\/functions\/v1\/app\?action=api\.parse(?:&|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        jobId: "server-job",
        docId: DEMO_HASH,
        status: "succeeded",
        pages: 1,
        markdown: DEMO_PAPER.doc.markdown,
        cached: false,
      }),
    });
  });
  await page.route(/\/functions\/v1\/app\?action=api\.analyze(?:&|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        jobId: "server-analysis",
        status: "succeeded",
        analysis: DEMO_PAPER.analysis,
        model: "qwen-plus",
        cached: false,
      }),
    });
  });

  await gotoLanding(page, true);
  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("服务端 DocMind 解析")).toBeVisible();
  expect(calls.parse).toBe(1);
  expect(calls.analyze).toBe(1);
  expect(calls.mineru).toBe(0);
  await page.waitForTimeout(1000);
  expect(helpCalls).toEqual({ predict: 0, answer: 0 });
  await page.getByRole("button", { name: "需要的话，可以看这里：引用校验", exact: true }).click();
  await expect(page.locator('[data-help-id="result.citationCheck"]')).toHaveAttribute("data-source", "api");
  expect(helpCalls).toEqual({ predict: 0, answer: 1 });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator('[data-help-id="result.citationCheck"]')).toHaveCount(0);
  await page.getByRole("button", { name: "需要的话，可以看这里：引用校验", exact: true }).click();
  await expect(page.locator('[data-help-id="result.citationCheck"]')).toHaveAttribute("data-source", "cache");
  expect(helpCalls).toEqual({ predict: 0, answer: 1 });
});

test("server help waits for health and falls back on budget rejection without background calls", async ({ page }) => {
  const calls = await mockHelp(page, 402);
  let releaseHealth!: () => void;
  const healthReady = new Promise<void>((resolve) => { releaseHealth = resolve; });
  await page.route("**/functions/v1/app/api/health*", async (route) => {
    await healthReady;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, serverMode: true, serviceEnabled: true }),
    });
  });
  await page.goto("/");
  await expect(page.getByText("没有 Key，也能先读 3 篇经典论文")).toBeVisible();
  await page.waitForTimeout(1000);
  expect(calls).toEqual({ predict: 0, answer: 0 });
  releaseHealth();
  await expect(page.locator("[data-server-mode]")).toHaveAttribute("data-server-mode", "true");
  await page.waitForTimeout(1000);
  expect(calls).toEqual({ predict: 0, answer: 0 });

  await page.getByRole("button", { name: "需要的话，可以看这里：PDF 上传", exact: true }).click();
  await expect(page.locator('[data-help-id="landing.upload"]')).toHaveAttribute("data-source", "fallback");
  await expect(page.getByText("帮助服务暂时不可用，以上是内置说明。")).toBeVisible();
  expect(calls).toEqual({ predict: 0, answer: 1 });
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  const card = page.locator("article").filter({ hasText: "Attention Is All You Need" }).first();
  await card.getByRole("button", { name: /打开示例/ }).click();
  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toBeVisible();
  await page.waitForTimeout(1000);
  expect(calls).toEqual({ predict: 0, answer: 1 });
  await page.getByRole("button", { name: "需要的话，可以看这里：引用校验", exact: true }).click();
  await expect(page.locator('[data-help-id="result.citationCheck"]')).toHaveAttribute("data-source", "fallback");
  await expect(page.getByText("帮助服务暂时不可用，以上是内置说明。")).toBeVisible();
  await page.waitForTimeout(1000);
  expect(calls).toEqual({ predict: 0, answer: 2 });
});

test("non-server mode keeps automatic help precomputation", async ({ page }) => {
  const calls = await mockHelp(page);
  await gotoLanding(page);
  await expect.poll(() => calls.answer).toBe(3);
  expect(calls.predict).toBe(1);
  const card = page.locator("article").filter({ hasText: "Attention Is All You Need" }).first();
  await card.getByRole("button", { name: /打开示例/ }).click();
  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toBeVisible();
  await expect.poll(() => calls.answer).toBe(8);
  expect(calls.predict).toBe(2);
});

test("restores progress after reload and clears it with history delete", async ({ page }) => {
  await gotoLanding(page);
  const card = page.locator("article").filter({ hasText: "Attention Is All You Need" }).first();
  await card.getByRole("button", { name: /打开示例/ }).click();
  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toBeVisible();

  const stepNav = page
    .locator("nav:visible")
    .filter({ has: page.getByRole("button", { name: /自测/ }) });
  await stepNav.getByRole("button", { name: /自测/ }).click();

  const answers = page.locator("#selfTest").getByRole("button", { name: "展开参考答案" });
  await answers.first().click();
  await answers.first().click();
  await expect(page.getByText(/已展开 2 题/)).toBeVisible();

  await expect
    .poll(
      async () => (await readProgress(page))?.revealedSelfTestIds.length ?? 0,
      { timeout: 5_000 },
    )
    .toBe(2);
  const saved = await readProgress(page);
  expect(saved?.activeStep).toBe("selfTest");

  await page.reload();
  const history = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "最近分析" }) });
  const historyButton = history
    .locator("button")
    .filter({ hasText: "Attention Is All You Need" })
    .first();
  await expect(historyButton).toBeVisible({ timeout: 15_000 });
  await historyButton.click();
  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toBeVisible();

  const restoredNav = page
    .locator("nav:visible")
    .filter({ has: page.getByRole("button", { name: /自测/ }) });
  await expect(restoredNav.getByRole("button", { name: /自测/ })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(
    page.locator("#selfTest").getByRole("button", { name: "收起参考答案" }),
  ).toHaveCount(2);
  await expect(page.getByText(/已展开 2 题/)).toBeVisible();

  await page.getByRole("button", { name: "← 换一篇论文" }).click();
  const historyForDelete = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "最近分析" }) });
  const deleteButton = historyForDelete
    .getByRole("button", { name: /删除 Attention Is All You Need/ })
    .first();
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();
  await expect.poll(async () => await readProgress(page)).toBeNull();
});