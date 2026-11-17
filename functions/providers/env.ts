export function readEnv(name: string): string {
  const deno = (globalThis as any).Deno;
  if (deno?.env?.get) {
    try {
      return deno.env.get(name) ?? "";
    } catch {
      return "";
    }
  }
  const proc = (globalThis as any).process;
  return proc?.env?.[name] ?? "";
}

export function isTruthy(value: string): boolean {
  return /^(1|true|yes|on)$/i.test(value.trim());
}

export function serverModeEnabled(): boolean {
  return isTruthy(readEnv("SERVER_MODE"));
}

export function providerMode(name: "PARSER_PROVIDER" | "LLM_PROVIDER"): string {
  return (readEnv(name) || "auto").trim().toLowerCase();
}