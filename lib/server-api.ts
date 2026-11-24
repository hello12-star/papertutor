import type { Analysis } from "./types";

const FUNCTION = "/functions/v1/app";
const HEALTH = `${FUNCTION}/api/health`;
const action = (name: string) => `${FUNCTION}?action=api.${name}`;

export type ServerHealth = {
  serverMode: boolean;
  serviceEnabled?: boolean;
};

export type ServerParseResult = {
  docId: string;
  markdown: string;
  pages?: number;
  cached: boolean;
};

export type ServerAnalyzeResult = {
  analysis: Analysis;
  model: string;
  cached: boolean;
};

export class ServerApiError extends Error {
  code: string;
  status: number;
  detail?: string;

  constructor(code: string, message: string, status: number, detail?: string) {
    super(message);
    this.name = "ServerApiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

async function responseBody(response: Response): Promise<any> {
  return await response.json().catch(() => null);
}

function apiError(response: Response, body: any, fallback: string): ServerApiError {
  return new ServerApiError(
    String(body?.code ?? `HTTP_${response.status}`),
    String(body?.message ?? fallback),
    response.status,
    body?.detail ? String(body.detail) : undefined,
  );
}

export const ANALYSIS_RETRY_MARKDOWN_CHARS = 20_000;

export function isTransientServerError(error: unknown): boolean {
  if (error && typeof error === "object" && (error as { name?: string }).name === "AbortError") {
    return false;
  }
  if (error instanceof ServerApiError) {
    if (error.code === "SERVICE_DISABLED" || error.status === 402 || error.status === 429) {
      return false;
    }
    return error.status === 502 || error.status === 503 || error.status === 504;
  }
  return error instanceof TypeError;
}

export async function getServerHealth(signal?: AbortSignal): Promise<ServerHealth> {
  try {
    const response = await fetch(HEALTH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal,
    });
    if (!response.ok) return { serverMode: false };
    const body = await responseBody(response);
    return {
      serverMode: Boolean(body?.serverMode),
      serviceEnabled: Boolean(body?.serviceEnabled),
    };
  } catch {
    return { serverMode: false };
  }
}

export async function parseWithServer(
  file: File,
  buffer: ArrayBuffer,
  options?: { signal?: AbortSignal },
): Promise<ServerParseResult> {
  const response = await fetch(action("parse"), {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "x-file-name": encodeURIComponent(file.name || "paper.pdf"),
    },
    body: buffer,
    signal: options?.signal,
  });
  const body = await responseBody(response);
  if (!response.ok || !body?.ok) {
    throw apiError(response, body, "服务端解析失败");
  }
  if (typeof body.markdown !== "string" || !body.markdown.trim()) {
    throw new ServerApiError("EMPTY_MARKDOWN", "服务端没有返回 Markdown", 502);
  }
  return {
    docId: String(body.docId ?? ""),
    markdown: body.markdown,
    pages: typeof body.pages === "number" ? body.pages : undefined,
    cached: Boolean(body.cached),
  };
}

export async function analyzeWithServer(
  input: {
    docId: string;
    markdown: string;
    fileName?: string;
    mode?: "quick" | "deep";
  },
  options?: { signal?: AbortSignal },
): Promise<ServerAnalyzeResult> {
  const response = await fetch(action("analyze"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      docId: input.docId,
      markdown: input.markdown,
      fileName: input.fileName,
      mode: input.mode ?? "quick",
    }),
    signal: options?.signal,
  });
  const body = await responseBody(response);
  if (!response.ok || !body?.ok) {
    throw apiError(response, body, "服务端分析失败");
  }
  if (!body.analysis) {
    throw new ServerApiError("EMPTY_ANALYSIS", "服务端没有返回分析结果", 502);
  }
  return {
    analysis: body.analysis as Analysis,
    model: String(body.model ?? "server"),
    cached: Boolean(body.cached),
  };
}