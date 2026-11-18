import fs from "node:fs";
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:6392/";
const PAPER_HASH = "demo-attention-v1";
const OUT_DIR = "docs/m1e5";
const HIT = { helpId: "result.citationCheck", label: "引用校验" };
const MISS = { helpId: "result.export", label: "导出" };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function measure({ helpId, label }) {
  await page.evaluate((helpLabel) => {
    const button = [...document.querySelectorAll("button")].find(
      (element) => element.getAttribute("aria-label") === `需要的话，可以看这里：${helpLabel}`,
    );
    if (!button) throw new Error(`help button not found: ${helpLabel}`);
    window.__helpLatencyStart = performance.now();
    button.click();
  }, label);

  const panel = page.locator(`[data-help-id="${helpId}"]`);
  await panel.waitFor({ state: "visible", timeout: 6000 });
  await panel.getByText("这是什么", { exact: true }).waitFor({ timeout: 6000 });
  const elapsedMs = await page.evaluate(() => performance.now() - window.__helpLatencyStart);
  const source = await panel.getAttribute("data-source");
  const fallbackNote = await panel
    .getByText("帮助服务暂时不可用，以上是内置说明。")
    .count();
  await panel.getByRole("button", { name: "关闭" }).click();
  await panel.waitFor({ state: "hidden", timeout: 3000 });
  return {
    helpId,
    label,
    source,
    elapsedMs: Math.round(elapsedMs * 10) / 10,
    fallbackNote: fallbackNote > 0,
  };
}

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.getByText("没有 Key，也能先读 3 篇经典论文").waitFor({ timeout: 15000 });
const card = page.locator("article").filter({ hasText: "Attention Is All You Need" }).first();
await card.getByRole("button", { name: /打开示例/ }).click();
await page.getByText("30 秒速览：这篇论文值不值得深读").waitFor({ timeout: 5000 });

// HelpScope bootstraps after 700ms; wait for its cache writes before measuring.
await page.waitForTimeout(2600);

const hit = {
  ...(await measure(HIT)),
  thresholdMs: 200,
  pass: false,
};
hit.pass = hit.source === "cache" && hit.elapsedMs < 200;

const miss = {
  ...(await measure(MISS)),
  thresholdMs: 6000,
  pass: false,
};
miss.pass = miss.elapsedMs < 6000;

const output = {
  capturedAt: new Date().toISOString(),
  url: BASE,
  paperHash: PAPER_HASH,
  method: "performance.now() from help button click to answer visible",
  hit,
  miss,
  notes:
    "Local dev; help API mock/fallback only. No paid API, no LLM, no deployment.",
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(`${OUT_DIR}/help-latency.json`, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
await browser.close();