import type {
  Analysis,
  Citation,
  CitationStats,
  QuickView,
  Skeleton,
} from "./types";

export function assembleAnalysis(quickview: QuickView, skeleton: Skeleton, markdown: string): Analysis {
  const analysis: Analysis = { quickview, skeleton };
  verifyCitations(markdown, analysis);
  return analysis;
}

function normalizeForMatch(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matches(quote: string, normalizedMarkdown: string): boolean {
  const normalized = normalizeForMatch(quote);
  if (normalized.length < 8) return false;
  if (normalizedMarkdown.includes(normalized)) return true;
  if (normalized.length <= 110) return false;
  const slices = [
    normalized.slice(0, 110),
    normalized.slice(Math.floor((normalized.length - 110) / 2), Math.floor((normalized.length - 110) / 2) + 110),
    normalized.slice(-110),
  ];
  return slices.some((slice) => slice.length > 40 && normalizedMarkdown.includes(slice));
}

function visit(citations: Citation[] | undefined, markdown: string, stats: CitationStats): void {
  const list = citations ?? [];
  stats.units += 1;
  if (list.length > 0) stats.unitsWithCitation += 1;
  let anyVerified = false;
  for (const citation of list) {
    stats.total += 1;
    citation.verified = matches(citation.quote, markdown);
    if (citation.verified) {
      stats.verified += 1;
      anyVerified = true;
    }
  }
  if (anyVerified) stats.unitsWithVerified += 1;
}

export function verifyCitations(markdown: string, analysis: Analysis): CitationStats {
  const normalized = normalizeForMatch(markdown);
  const stats: CitationStats = {
    total: 0,
    verified: 0,
    units: 0,
    unitsWithCitation: 0,
    unitsWithVerified: 0,
  };
  const { skeleton } = analysis;

  visit(skeleton.problem.citations, normalized, stats);
  visit(skeleton.insight.citations, normalized, stats);
  skeleton.modules.forEach((module) => visit(module.citations, normalized, stats));
  skeleton.experiments.forEach((experiment) => visit(experiment.citations, normalized, stats));
  visit(skeleton.limitations.citations, normalized, stats);

  return stats;
}