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

function trackFunctionRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/functions/v1/app")) {
      requests.push(request.url());
    }
  });
  return requests;
}

async function expectNoRestoreRequests(page: Page, requests: string[], before: number) {
  await page.waitForTimeout(1100);
  expect(requests.slice(before)).toEqual([]);
}

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

test("in-page study navigation preserves the paper route", async ({ page }) => {
  await gotoLanding(page, true);
  const card = page.locator("article").filter({ hasText: "Attention Is All You Need" }).first();
  await card.getByRole("button", { name: /打开示例/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/paper/${DEMO_HASH}$`));
  if (page.viewportSize()!.width >= 1024) {
    await page.locator("aside").getByRole("button", { name: /问题与动机/ }).click();
    await expect.poll(async () => page.locator("#problem").evaluate((element) => Math.abs(element.getBoundingClientRect().top))).toBeLessThan(200);
    await page.locator("aside").getByRole("button", { name: "解析原文" }).click();
  } else {
    const nav = page.locator("nav:visible").filter({ has: page.getByRole("button", { name: /拆论证/ }) });
    await nav.getByRole("button", { name: /拆论证/ }).click();
    await expect(nav.getByRole("button", { name: /拆论证/ })).toHaveAttribute("aria-current", "step");
  }
  await expect(page).toHaveURL(new RegExp(`#/paper/${DEMO_HASH}$`));
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Attention Is All You Need", exact: true })).toBeAttached();
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
  await expect(page).toHaveURL(new RegExp(`#/paper/${DEMO_HASH}$`));
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
  const requests = trackFunctionRequests(page);
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

  await expect(page).toHaveURL(new RegExp(`#/paper/${DEMO_HASH}$`));
  const beforeReload = requests.length;
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#/paper/${DEMO_HASH}$`));
  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toBeVisible();
  await expectNoRestoreRequests(page, requests, beforeReload);

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
  await expect(page).toHaveURL(/\/$/);
  const history = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "最近分析" }) });
  await history.locator("button").filter({ hasText: "Attention Is All You Need" }).first().click();
  await expect(page).toHaveURL(new RegExp(`#/paper/${DEMO_HASH}$`));
  await expect(
    page.locator("#selfTest").getByRole("button", { name: "收起参考答案" }),
  ).toHaveCount(2);
  await expect(restoredNav.getByRole("button", { name: /自测/ })).toHaveAttribute("aria-current", "step");

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

test("direct encoded paper URL restores cache-only data without Function requests", async ({ page }) => {
  const requests = trackFunctionRequests(page);
  await gotoLanding(page, true);
  const paperHash = "cached/论文 ?#%";
  await page.evaluate(async ({ paper, paperHash }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("papertutor-cache", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("docs");
        request.result.createObjectStore("analyses");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["docs", "analyses"], "readwrite");
        tx.objectStore("docs").put({ ...paper.doc, hash: paperHash }, paperHash);
        tx.objectStore("analyses").put({ analysis: paper.analysis, model: "fixture", createdAt: 1 }, paperHash);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, { paper: DEMO_PAPER, paperHash });
  const before = requests.length;
  const hash = `#/paper/${encodeURIComponent(paperHash)}`;
  await page.goto(`/?qa=server${hash}`);
  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toBeVisible();
  expect(new URL(page.url()).hash).toBe(hash);
  await expectNoRestoreRequests(page, requests, before);
  await page.reload();
  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toBeVisible();
  await expectNoRestoreRequests(page, requests, before);
});

for (const hash of ["#/paper/not-cached", "#/paper/%ZZ", "#/unrecognized"]) {
  test(`unknown hash ${hash} shows local notice and can return home`, async ({ page }) => {
    const requests = trackFunctionRequests(page);
    await page.goto(`/${hash}`);
    await expect(page.getByRole("status")).toHaveText("本地没有这篇论文的缓存，请重新上传");
    await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toHaveCount(0);
    await expectNoRestoreRequests(page, requests, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "回首页", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByText("没有 Key，也能先读 3 篇经典论文")).toBeVisible();
  });
}

test("browser back and forward switch home and restored paper without requests", async ({ page }) => {
  const requests = trackFunctionRequests(page);
  await gotoLanding(page, true);
  const card = page.locator("article").filter({ hasText: "Attention Is All You Need" }).first();
  await card.getByRole("button", { name: /打开示例/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/paper/${DEMO_HASH}$`));
  const nav = page.locator("nav:visible").filter({ has: page.getByRole("button", { name: /拆论证/ }) });
  await nav.getByRole("button", { name: /拆论证/ }).click();
  await expect.poll(async () => (await readProgress(page))?.activeStep).toBe("skeleton");
  const before = requests.length;

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("没有 Key，也能先读 3 篇经典论文")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`#/paper/${DEMO_HASH}$`));
  await expect(nav.getByRole("button", { name: /拆论证/ })).toHaveAttribute("aria-current", "step");
  await expectNoRestoreRequests(page, requests, before);

  await page.getByRole("button", { name: "← 换一篇论文" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/paper/${DEMO_HASH}$`));
  await page.goForward();
  await expect(page.getByText("没有 Key，也能先读 3 篇经典论文")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expectNoRestoreRequests(page, requests, before);
});

for (const failure of ["unavailable", "open-error", "open-blocked", "read-error", "read-abort"] as const) {
  test(`IndexedDB ${failure} falls back to home without requests or dialogs`, async ({ page }) => {
    const requests = trackFunctionRequests(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", async (dialog) => {
      errors.push(dialog.message());
      await dialog.dismiss();
    });
    await page.addInitScript((failure) => {
      if (failure === "unavailable") {
        Object.defineProperty(window, "indexedDB", { value: undefined });
      } else if (failure === "open-error") {
        IDBFactory.prototype.open = () => { throw new DOMException("Storage disabled", "SecurityError"); };
      } else if (failure === "open-blocked") {
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (...args) {
          const request = open.apply(this, args);
          queueMicrotask(() => request.dispatchEvent(new Event("blocked")));
          return request;
        };
      } else {
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (...args) {
          if (args[1] === "readonly" && failure === "read-error") {
            throw new DOMException("Read failed", "InvalidStateError");
          }
          const tx = transaction.apply(this, args);
          if (args[1] === "readonly") queueMicrotask(() => tx.abort());
          return tx;
        };
      }
    }, failure);
    await page.goto(`/#/paper/${DEMO_HASH}`);
    await expect(page.getByRole("status")).toHaveText("本地没有这篇论文的缓存，请重新上传");
    await expect(page.getByText("没有 Key，也能先读 3 篇经典论文")).toBeVisible();
    await expectNoRestoreRequests(page, requests, 0);
    expect(errors).toEqual([]);
    await page.getByRole("button", { name: "回首页", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });
}

test("late IndexedDB restoration cannot override a newer hash or home navigation", async ({ page }) => {
  const requests = trackFunctionRequests(page);
  await gotoLanding(page, true);
  const card = page.locator("article").filter({ hasText: "Attention Is All You Need" }).first();
  await card.getByRole("button", { name: /打开示例/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/paper/${DEMO_HASH}$`));
  await page.getByRole("button", { name: "← 换一篇论文" }).click();
  const before = requests.length;
  await page.evaluate(() => {
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      const request = getAll.apply(this, args);
      if (this.name === "records") {
        Object.defineProperty(request, "onsuccess", {
          set(handler) {
            request.addEventListener("success", (event) => {
              window.setTimeout(() => handler.call(request, event), 500);
            });
          },
        });
      }
      return request;
    };
  });
  await page.evaluate((hash) => { window.location.hash = `#/paper/${hash}`; }, DEMO_HASH);
  await expect(page.getByRole("status")).toHaveText("正在从本地恢复论文…");
  await page.evaluate(() => { window.location.hash = "#/invalid"; });
  await expect(page.getByRole("status")).toHaveText("本地没有这篇论文的缓存，请重新上传");
  await expectNoRestoreRequests(page, requests, before);
  await expect(page).toHaveURL(/#\/invalid$/);
  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toHaveCount(0);

  await page.evaluate((hash) => { window.location.hash = `#/paper/${hash}`; }, DEMO_HASH);
  await expect(page.getByRole("status")).toHaveText("正在从本地恢复论文…");
  await page.getByRole("button", { name: "回首页", exact: true }).click();
  await expectNoRestoreRequests(page, requests, before);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("没有 Key，也能先读 3 篇经典论文")).toBeVisible();
  await expect(page.getByText("30 秒速览：这篇论文值不值得深读")).toHaveCount(0);
});