const PROXY = "/functions/v1/app";

export class MineruError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "MineruError";
    this.code = code;
    this.detail = detail;
  }
}

export type MineruMode = "flash" | "token";

export type ParseProgress = {
  state: string;
  elapsed: number;
  extracted?: number;
  total?: number;
};

type ParseOptions = {
  mode: MineruMode;
  token?: string;
  onProgress?: (progress: ParseProgress) => void;
  signal?: AbortSignal;
};

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new MineruError(
      response.status === 404 ? "proxy_missing" : "proxy_invalid_response",
      text.slice(0, 160) || `HTTP ${response.status}`,
    );
  }
}

export async function parseWithMineru(
  file: File,
  buffer: ArrayBuffer,
  options: ParseOptions,
): Promise<{ markdown: string; mode: MineruMode }> {
  const { mode } = options;
  const token = options.token?.trim();
  const tokenHeader: Record<string, string> = token ? { "x-mineru-token": token } : {};

  const submitRes = await fetch(`${PROXY}?action=mineru.submit&mode=${mode}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "x-file-name": encodeURIComponent(file.name || "paper.pdf"),
      ...tokenHeader,
    },
    body: buffer,
    signal: options.signal,
  });
  const submit = await readJson(submitRes);
  if (!submitRes.ok || !submit?.ok) {
    throw new MineruError(
      String(submit?.error ?? `submit_http_${submitRes.status}`),
      submit?.detail ? String(submit.detail) : undefined,
    );
  }

  const taskId = String(submit.taskId ?? "");
  if (!taskId) throw new MineruError("missing_task_id");

  const started = Date.now();
  const deadline = started + 10 * 60 * 1000;
  let interval = 2500;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (options.signal?.aborted) throw new MineruError("aborted");
    interval = Math.min(5000, interval + 250);

    const statusRes = await fetch(
      `${PROXY}?action=mineru.status&mode=${mode}&taskId=${encodeURIComponent(taskId)}`,
      { headers: { Accept: "application/json", ...tokenHeader }, signal: options.signal },
    );
    const status = await readJson(statusRes);
    if (!statusRes.ok || !status?.ok) {
      throw new MineruError(
        String(status?.error ?? `status_http_${statusRes.status}`),
        status?.detail ? String(status.detail) : undefined,
      );
    }

    const elapsed = Math.round((Date.now() - started) / 1000);
    if (status.state === "done") {
      const markdown = typeof status.markdown === "string" ? status.markdown : "";
      if (!markdown.trim()) throw new MineruError("empty_markdown");
      return { markdown, mode };
    }
    options.onProgress?.({
      state: String(status.state ?? "pending"),
      elapsed,
      extracted: status.progress?.extracted,
      total: status.progress?.total,
    });
  }

  throw new MineruError("timeout", "MinerU 在 10 分钟内没有返回结果");
}