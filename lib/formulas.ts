import type { FormulaCard } from "./types";

const MAX_FORMULAS = 6;
const MAX_FORMULA_CHARS = 600;

function cleanFormula(raw: string): string {
  return raw.replace(/\r/g, "").replace(/^\s+|\s+$/g, "");
}

function nearestHeading(markdown: string, offset: number): string {
  const lines = markdown.slice(0, offset).split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (/^#{1,6}\s+/.test(line)) {
      return line.replace(/^#+\s+/, "").slice(0, 80);
    }
  }
  return "原文";
}

function nearestContext(markdown: string, start: number, end: number): string {
  const before = markdown.slice(0, start);
  const after = markdown.slice(end);
  const previousBreak = Math.max(
    before.lastIndexOf(". "),
    before.lastIndexOf("。"),
    before.lastIndexOf("\n"),
  );
  const nextBreaks = [after.indexOf(". "), after.indexOf("。"), after.indexOf("\n")].filter(
    (value) => value >= 0,
  );
  const nextBreak = nextBreaks.length ? Math.min(...nextBreaks) : after.length;
  return `${before.slice(Math.max(0, previousBreak - 180))} ${after.slice(
    0,
    Math.min(nextBreak + 1, 180),
  )}`
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFormulaCards(markdown: string): FormulaCard[] {
  const results: FormulaCard[] = [];
  const seen = new Set<string>();
  const patterns = [
    /\$\$([\s\S]+?)\$\$/g,
    /\\\[([\s\S]+?)\\\]/g,
    /\\begin\{(?:equation|align)\}([\s\S]+?)\\end\{(?:equation|align)\}/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(markdown))) {
      const raw = cleanFormula(match[1]);
      if (raw.length < 3 || raw.length > MAX_FORMULA_CHARS) continue;
      const key = raw.replace(/\s+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const context = nearestContext(markdown, match.index, match.index + match[0].length);
      results.push({
        name: `原文公式 ${results.length + 1}`,
        formula: raw,
        latex: raw,
        meaning: context ? `公式所在上下文：${context}` : "原文中的公式，建议结合所在章节阅读。",
        where: nearestHeading(markdown, match.index),
      });
      if (results.length >= MAX_FORMULAS) return results;
    }
  }

  return results;
}
