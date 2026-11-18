import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE = path.resolve("e2e/fixtures/ten-pages.pdf");

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