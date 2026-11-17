export type QuoteRange = {
  start: number;
  end: number;
  method: "exact" | "case-insensitive" | "whitespace" | "prefix";
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function whitespacePattern(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join("\\s+");
}

export function findQuoteRange(markdown: string, quote: string): QuoteRange | null {
  const needle = quote.trim();
  if (!needle || !markdown) return null;

  const exact = markdown.indexOf(needle);
  if (exact >= 0) {
    return { start: exact, end: exact + needle.length, method: "exact" };
  }

  const lowerIndex = markdown.toLowerCase().indexOf(needle.toLowerCase());
  if (lowerIndex >= 0) {
    return {
      start: lowerIndex,
      end: lowerIndex + needle.length,
      method: "case-insensitive",
    };
  }

  const pattern = whitespacePattern(needle);
  if (pattern) {
    const match = new RegExp(pattern, "i").exec(markdown);
    if (match) {
      return { start: match.index, end: match.index + match[0].length, method: "whitespace" };
    }
  }

  const words = needle.split(/\s+/).filter(Boolean);
  if (words.length > 8) {
    const prefixPattern = words.slice(0, 8).map(escapeRegExp).join("\\s+");
    const match = new RegExp(prefixPattern, "i").exec(markdown);
    if (match) {
      return { start: match.index, end: match.index + match[0].length, method: "prefix" };
    }
  }

  return null;
}