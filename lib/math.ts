const SPACED_TEXT_COMMANDS = /(\\(?:mathrm|mathbf|mathit|mathsf|mathtt|text|textrm|textbf)\{)([^{}]*)(\})/g;

function collapseSpacedLetters(body: string): string {
  const tokens = body.trim().split(/\s+/);
  if (tokens.length > 2 && tokens.every((token) => token.length === 1)) {
    return tokens.join("");
  }
  return body;
}

export function normalizeLatex(input: string): string {
  let tex = String(input ?? "").trim();
  tex = tex.replace(/\\tag\{[^{}]*\}/g, "");
  tex = tex.replace(/\\operatorname\*?\{\s*m\s*a\s*x\s*\}/gi, "\\max");
  tex = tex.replace(/\\operatorname\*?\{\s*m\s*i\s*n\s*\}/gi, "\\min");
  tex = tex.replace(
    SPACED_TEXT_COMMANDS,
    (_match, open: string, body: string, close: string) =>
      `${open}${collapseSpacedLetters(body)}${close}`,
  );
  tex = tex.replace(/\\\\\s*where\b\s*/g, "\\\\ \\text{where }");
  return tex.trim();
}
