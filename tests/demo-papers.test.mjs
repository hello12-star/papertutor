import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyCitations } from "../lib/analysis.ts";

const demoDir = join(process.cwd(), "public", "demo");
const index = JSON.parse(readFileSync(join(demoDir, "index.json"), "utf8"));
const papers = index.papers.map((meta) =>
  JSON.parse(readFileSync(join(demoDir, meta.file), "utf8")),
);

test("demo index contains the three approved papers", () => {
  assert.equal(index.version, 1);
  assert.deepEqual(
    papers.map((paper) => paper.meta.id),
    ["attention", "resnet", "lora"],
  );
  for (const meta of index.papers) {
    assert.match(meta.sourceUrl, /^https:\/\/arxiv\.org\//);
    assert.match(meta.file, /^[a-z0-9-]+\.json$/);
  }
});

test("demo papers keep only citation excerpts, not full text", () => {
  for (const paper of papers) {
    assert.equal(paper.version, 1);
    assert.ok(["draft", "approved"].includes(paper.reviewStatus));
    assert.equal(paper.doc.mode, "demo");
    assert.ok(paper.doc.markdown.includes("示例节选"));
    assert.ok(paper.doc.markdown.length >= 200);
    assert.ok(paper.doc.markdown.length <= 20_000);
    assert.match(paper.doc.sourceUrl, /^https:\/\/arxiv\.org\//);
    assert.doesNotMatch(
      JSON.stringify(paper),
      /ALIYUN_ACCESS_KEY|DASHSCOPE_API_KEY|OPENAI_API_KEY|api[_-]?key/i,
    );
  }
});

test("demo papers provide complete study material", () => {
  for (const paper of papers) {
    const { analysis } = paper;
    assert.ok(analysis.quickview.coreQuestion.length > 10);
    assert.ok(analysis.quickview.coreContribution.length > 10);
    assert.ok(analysis.quickview.prerequisites.length >= 3);
    assert.ok(analysis.skeleton.modules.length >= 3);
    assert.ok(analysis.skeleton.experiments.length >= 3);
    assert.ok(analysis.skeleton.limitations.stated.length >= 1);
    assert.ok(Array.isArray(analysis.formulas));
    assert.ok(analysis.formulas.length >= 2);
    for (const formula of analysis.formulas) {
      assert.ok(formula.name);
      assert.ok(formula.formula);
      assert.ok(formula.meaning);
    }
  }
});

test("every demo citation verifies against its excerpt", () => {
  for (const paper of papers) {
    const stats = verifyCitations(paper.doc.markdown, paper.analysis);
    assert.ok(stats.total > 0, `${paper.meta.id} should contain citations`);
    assert.equal(
      stats.verified,
      stats.total,
      `${paper.meta.id} has unverified citations: ${stats.total - stats.verified}`,
    );
  }
});
