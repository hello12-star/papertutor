import test from "node:test";
import assert from "node:assert/strict";
import { buildQaFixture } from "../dev/qa-fixture.ts";
import { buildSelfTestItems, buildSelfTestQuestions } from "../lib/self-test.ts";
import { buildLearningReport, learningReportFileName } from "../lib/report.ts";
import { extractFormulaCards } from "../lib/formulas.ts";

const { doc, record } = buildQaFixture();
const analysis = record.analysis;

test("self test items include answers and citations", () => {
  const items = buildSelfTestItems(analysis);
  assert.ok(items.length >= 3);
  assert.ok(items.every((item) => item.question.length > 8));
  assert.ok(items.every((item) => item.answer.length > 8));
  assert.ok(items.some((item) => item.question.includes("块稀疏注意力层")));
  assert.ok(items.some((item) => item.question.includes("主实验")));
  assert.ok(items.some((item) => item.citations.length > 0));
  assert.deepEqual(
    buildSelfTestQuestions(analysis),
    items.map((item) => item.question),
  );
});

test("learning report reflects local progress without model calls", () => {
  const items = buildSelfTestItems(analysis);
  const report = buildLearningReport({
    doc,
    analysis,
    stats: { total: 3, verified: 2, units: 5, unitsWithCitation: 4, unitsWithVerified: 3 },
    selfTest: { revealedIds: [items[0].id], total: items.length },
  });
  assert.match(report, /^# 学习报告：/);
  assert.match(report, /## 速览要点/);
  assert.match(report, /## 引用校验/);
  assert.match(report, /已验证引用：2\/3/);
  assert.match(report, /## 自测进度/);
  assert.match(report, /本次会话已展开参考答案：1\//);
  assert.match(report, /## 建议复习/);
  assert.match(report, /不包含模型调用或密钥/);
  assert.match(learningReportFileName(doc, analysis), /^学习报告-.*\.md$/);
});

test("formula cards are extracted from display math", () => {
  const markdown = [
    "# Method",
    "",
    "The objective is defined below.",
    "",
    "$$E = mc^2$$",
    "",
    "## Loss",
    "",
    "\\[ L = (y - f(x))^2 \\]",
  ].join("\n");
  const cards = extractFormulaCards(markdown);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].where, "Method");
  assert.equal(cards[1].where, "Loss");
  assert.equal(cards[0].formula, "E = mc^2");
  assert.match(cards[1].formula, /L =/);
  assert.ok(cards[0].meaning.length > 0);
});

test("lazy generation imports offline and preserves normalized study materials", async (t) => {
  const replies = [analysis.quickview, analysis.skeleton];
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://127.0.0.1:0/mock/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "test-model");
    assert.equal(body.stream, false);
    assert.ok(body.messages.some((message) => message.content.includes(doc.markdown)));
    return Response.json({ choices: [{ message: { content: JSON.stringify(replies.shift()) }, finish_reason: "stop" }] });
  });
  const { generateQuickview, generateSkeleton } = await import("../lib/generation.ts");
  assert.equal(fetchMock.mock.callCount(), 0);
  const settings = { baseUrl: "http://127.0.0.1:0/mock", apiKey: "test-only", model: "test-model", mineruToken: "" };
  const quickview = await generateQuickview(doc.markdown, settings);
  const skeleton = await generateSkeleton(doc.markdown, settings);
  assert.equal(quickview.meta.title, analysis.quickview.meta.title);
  assert.equal(quickview.coreQuestion, analysis.quickview.coreQuestion);
  assert.deepEqual(skeleton.modules.map((module) => module.name), analysis.skeleton.modules.map((module) => module.name));
  assert.deepEqual(skeleton.experiments.map((experiment) => experiment.verdict), analysis.skeleton.experiments.map((experiment) => experiment.verdict));
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("lazy generation preserves provider authentication errors without retry", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("invalid test key", { status: 401 }));
  const { generateQuickview } = await import("../lib/generation.ts");
  await assert.rejects(
    generateQuickview(doc.markdown, { baseUrl: "http://127.0.0.1:0/mock", apiKey: "test-only", model: "test-model", mineruToken: "" }),
    (error) => error.code === "invalid_key",
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});
