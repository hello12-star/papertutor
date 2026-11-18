import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE = path.resolve("e2e/fixtures/ten-pages.pdf");
const DEMO_HASH = "demo-attention-v1";

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

async function gotoLanding(page: Page) {
  await page.goto("/");
  await expect(page.getByText("没有 Key，也能先读 3 篇经典论文")).toBeVisible();
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