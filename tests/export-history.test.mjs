import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExportMarkdown,
  buildOutline,
  buildSelfTestQuestions,
  exportFileName,
} from "../lib/export.ts";
import { historyTitle, mergeHistoryRecords, MAX_HISTORY } from "../lib/history-core.ts";
import { buildQaFixture } from "../dev/qa-fixture.ts";

const { doc, record } = buildQaFixture();
const analysis = record.analysis;
analysis.skeleton.problem.citations[0].verified = true;

test("export markdown contains all required study sections", () => {
  const markdown = buildExportMarkdown(doc, analysis);
  assert.match(markdown, /^# Sparse Attention for Long Documents/);
  assert.match(markdown, /Paper Hash/);
  assert.match(markdown, /## 速览卡/);
  assert.match(markdown, /## 前置知识 \/ 术语/);
  assert.match(markdown, /## 论证骨架/);
  assert.match(markdown, /### 方法模块/);
  assert.match(markdown, /块稀疏注意力层/);
  assert.match(markdown, /We propose a block-sparse attention layer/);
  assert.match(markdown, /原文已验证/);
  assert.match(markdown, /## 引用清单/);
  assert.match(markdown, /## 自测题/);
});

test("outline contains sections and module names", () => {
  const outline = buildOutline(doc, analysis);
  assert.match(outline, /^# Sparse Attention/);
  assert.match(outline, /速览卡/);
  assert.match(outline, /前置知识/);
  assert.match(outline, /方法模块：块稀疏注意力层/);
  assert.match(outline, /自测题：\d+ 题/);
});

test("self test questions are generated offline", () => {
  const questions = buildSelfTestQuestions(analysis);
  assert.ok(questions.length >= 3);
  assert.ok(questions.some((question) => question.includes("块稀疏注意力层")));
  assert.ok(questions.some((question) => question.includes("主实验")));
});

test("export filename is sanitized", () => {
  assert.match(exportFileName(doc, analysis), /\.md$/);
  assert.ok(!exportFileName(doc, analysis).includes("/"));
});

test("history merge dedupes by hash and keeps newest 10", () => {
  const records = Array.from({ length: 12 }, (_, index) => ({
    paperHash: `p${index}`,
    title: `t${index}`,
    createdAt: index,
    doc,
    analysis,
  }));
  const merged = mergeHistoryRecords(
    records,
    {
      paperHash: "p5",
      title: "updated",
      createdAt: 100,
      doc,
      analysis,
    },
    MAX_HISTORY,
  );
  assert.equal(merged.length, 10);
  assert.equal(merged[0].paperHash, "p5");
  assert.equal(merged[0].createdAt, 100);
  assert.equal(new Set(merged.map((item) => item.paperHash)).size, 10);
  assert.ok(merged.every((item) => item.paperHash !== "p0"));
});

test("history title falls back to filename", () => {
  const fallbackDoc = { ...doc, fileName: "fallback.pdf" };
  const fallbackAnalysis = {
    ...analysis,
    quickview: { ...analysis.quickview, meta: { ...analysis.quickview.meta, title: "未识别" } },
  };
  assert.equal(historyTitle(fallbackDoc, fallbackAnalysis), "fallback");
});