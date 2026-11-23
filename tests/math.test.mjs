import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLatex } from "../lib/math.ts";

test("collapses OCR-spaced letters in text commands", () => {
  assert.equal(
    normalizeLatex("\\mathrm{A t t e n t i o n}(Q,K,V)"),
    "\\mathrm{Attention}(Q,K,V)",
  );
  assert.equal(
    normalizeLatex("\\mathrm{s o f t m a x}(x)"),
    "\\mathrm{softmax}(x)",
  );
  assert.equal(normalizeLatex("\\mathrm{F F N}(x)"), "\\mathrm{FFN}(x)");
});

test("normalizes spaced operatorname max and min", () => {
  assert.equal(
    normalizeLatex("\\operatorname*{m a x}(0, x)"),
    "\\max(0, x)",
  );
  assert.equal(
    normalizeLatex("\\operatorname{m i n}(x)"),
    "\\min(x)",
  );
});

test("keeps meaningful spaces, strips tags and marks where as text", () => {
  assert.equal(normalizeLatex("\\text{Layer Norm}(x)"), "\\text{Layer Norm}(x)");
  assert.equal(normalizeLatex("x = 1 \\tag{2}"), "x = 1");
  assert.equal(
    normalizeLatex("\\begin{aligned}a&=b\\\\ where c&=d\\end{aligned}"),
    "\\begin{aligned}a&=b\\\\ \\text{where }c&=d\\end{aligned}",
  );
});
