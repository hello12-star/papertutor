const MINERU = "https://mineru.net";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "health";
  try {
    if (action === "health") {
      return json({ ok: true, service: "papertutor", ts: Date.now() });
    }
    if (action === "mineru.submit") {
      return await submitMineru(request, url);
    }
    if (action === "mineru.status") {
      return await pollMineru(request, url);
    }
    if (action.startsWith("debug.")) {
      return await handleDebug(request, url, action);
    }
    return json({ ok: false, error: "unknown_action" }, 404);
  } catch (error) {
    return json({ ok: false, error: "proxy_error", detail: describe(error) }, 502);
  }
}

async function submitMineru(request: Request, url: URL): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  const mode = url.searchParams.get("mode") === "token" ? "token" : "flash";
  const fileName = decodeURIComponent(request.headers.get("x-file-name") || "paper.pdf");
  const token = (request.headers.get("x-mineru-token") || "").trim();
  const file = await request.arrayBuffer();

  if (file.byteLength === 0) {
    return json({ ok: false, error: "empty_file" }, 400);
  }
  if (mode === "token" && !token) {
    return json({ ok: false, error: "token_required" }, 400);
  }
  if (mode === "flash" && file.byteLength > 10 * 1024 * 1024) {
    return json({ ok: false, error: "flash_size_limit", detail: "10MB" }, 413);
  }
  if (file.byteLength > 200 * 1024 * 1024) {
    return json({ ok: false, error: "file_too_large", detail: "200MB" }, 413);
  }

  let taskId = "";
  let uploadUrl = "";

  if (mode === "flash") {
    const res = await fetch(`${MINERU}/api/v1/agent/parse/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_name: fileName,
        language: "en",
        enable_table: true,
        enable_formula: true,
        is_ocr: false,
      }),
    });
    const body = await readJson(res);
    if (!res.ok || Number(body?.code) !== 0) {
      return json(
        {
          ok: false,
          error: "mineru_submit_failed",
          detail: String(body?.msg ?? `HTTP ${res.status}`),
          code: body?.code ?? null,
        },
        502,
      );
    }
    taskId = String(body?.data?.task_id ?? "");
    uploadUrl = String(body?.data?.file_url ?? "");
  } else {
    const res = await fetch(`${MINERU}/api/v4/file-urls/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        files: [{ name: fileName }],
        model_version: "vlm",
        language: "en",
        enable_formula: true,
        enable_table: true,
      }),
    });
    const body = await readJson(res);
    if (!res.ok || Number(body?.code) !== 0) {
      return json(
        {
          ok: false,
          error: "mineru_submit_failed",
          detail: String(body?.msg ?? `HTTP ${res.status}`),
          code: body?.code ?? null,
        },
        502,
      );
    }
    taskId = String(body?.data?.batch_id ?? "");
    uploadUrl = String(body?.data?.file_urls?.[0] ?? "");
  }

  if (!taskId || !uploadUrl) {
    return json({ ok: false, error: "mineru_submit_failed", detail: "missing task or upload url" }, 502);
  }

  const put = await fetch(uploadUrl, { method: "PUT", body: file });
  if (!put.ok) {
    return json(
      { ok: false, error: "upload_failed", detail: `OSS HTTP ${put.status}` },
      502,
    );
  }

  return json({ ok: true, taskId, mode });
}

async function pollMineru(request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  const mode = url.searchParams.get("mode") === "token" ? "token" : "flash";
  const taskId = url.searchParams.get("taskId") || "";
  if (!taskId) {
    return json({ ok: false, error: "missing_task_id" }, 400);
  }

  if (mode === "flash") {
    const res = await fetch(`${MINERU}/api/v1/agent/parse/${encodeURIComponent(taskId)}`, {
      headers: { Accept: "application/json" },
    });
    const body = await readJson(res);
    if (!res.ok || Number(body?.code) !== 0) {
      return json(
        {
          ok: false,
          error: "mineru_status_failed",
          detail: String(body?.msg ?? `HTTP ${res.status}`),
        },
        502,
      );
    }
    const state = String(body?.data?.state ?? "");
    if (state === "failed") {
      return json(
        {
          ok: false,
          error: "mineru_failed",
          detail: String(body?.data?.err_msg ?? "解析失败"),
          code: body?.data?.err_code ?? null,
        },
        200,
      );
    }
    if (state === "done") {
      const markdownUrl = String(body?.data?.markdown_url ?? "");
      const md = await downloadText(markdownUrl);
      return json({ ok: true, state: "done", markdown: md, progress: null });
    }
    return json({ ok: true, state: normalizeState(state), progress: null });
  }

  const token = (request.headers.get("x-mineru-token") || "").trim();
  if (!token) {
    return json({ ok: false, error: "token_required" }, 400);
  }
  const res = await fetch(
    `${MINERU}/api/v4/extract-results/batch/${encodeURIComponent(taskId)}`,
    { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } },
  );
  const body = await readJson(res);
  if (!res.ok || Number(body?.code) !== 0) {
    return json(
      {
        ok: false,
        error: "mineru_status_failed",
        detail: String(body?.msg ?? `HTTP ${res.status}`),
      },
      502,
    );
  }
  const item = body?.data?.extract_result?.[0];
  const state = String(item?.state ?? "");
  if (state === "failed") {
    return json(
      {
        ok: false,
        error: "mineru_failed",
        detail: String(item?.err_msg ?? "解析失败"),
      },
      200,
    );
  }
  if (state === "done") {
    const zipUrl = String(item?.full_zip_url ?? "");
    const markdown = await downloadZipMarkdown(zipUrl);
    return json({ ok: true, state: "done", markdown, progress: null });
  }
  const progress = item?.extract_progress
    ? {
        extracted: Number(item.extract_progress.extracted_pages ?? 0),
        total: Number(item.extract_progress.total_pages ?? 0),
      }
    : null;
  return json({ ok: true, state: normalizeState(state), progress });
}

function normalizeState(state: string): string {
  if (state === "waiting-file" || state === "uploading") return "pending";
  if (state === "converting") return "running";
  return state || "pending";
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: -1, msg: text.slice(0, 200) || `HTTP ${res.status}` };
  }
}

async function downloadText(url: string): Promise<string> {
  if (!url) throw new Error("missing markdown url");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download markdown HTTP ${res.status}`);
  return await res.text();
}

async function downloadZipMarkdown(url: string): Promise<string> {
  if (!url) throw new Error("missing zip url");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download zip HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const markdown = await readZipEntry(buffer, "full.md");
  if (!markdown) throw new Error("full.md not found in MinerU result zip");
  return markdown;
}

async function readZipEntry(buffer: ArrayBuffer, wanted: string): Promise<string | null> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();

  let eocd = -1;
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("invalid zip: EOCD not found");

  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < entries; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("invalid zip: central directory");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (name === wanted || name.endsWith(`/${wanted}`)) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) {
        throw new Error("invalid zip: local header");
      }
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = bytes.subarray(start, start + compressedSize);
      if (method === 0) return decoder.decode(data);
      if (method === 8) {
        const stream = new Response(data).body!.pipeThrough(
          new DecompressionStream("deflate-raw"),
        );
        return decoder.decode(await new Response(stream).arrayBuffer());
      }
      throw new Error(`unsupported zip compression method ${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Temporary M0 diagnostics. These endpoints are removed after the smoke test.
// ---------------------------------------------------------------------------

const DOCMIND_DEFAULT_ENDPOINT = "docmind-api.cn-hangzhou.aliyuncs.com";
const DEBUG_SECRET_NAMES = [
  "ALIYUN_ACCESS_KEY_ID",
  "ALIYUN_ACCESS_KEY_SECRET",
  "DOCMIND_ENDPOINT",
  "DASHSCOPE_API_KEY",
];

function envValue(name: string): string {
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

function debugOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin") ?? "";
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host.endsWith(".qoder.zone");
  } catch {
    return false;
  }
}

function trimLongStrings(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > 1500 ? `${value.slice(0, 1500)}…[truncated ${value.length - 1500} chars]` : value;
  }
  if (depth > 6) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => trimLongStrings(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, trimLongStrings(item, depth + 1)]),
    );
  }
  return value;
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function signedDocmindPost(
  params: Record<string, string>,
): Promise<{ url: string; body: string }> {
  const accessKeyId = envValue("ALIYUN_ACCESS_KEY_ID");
  const accessKeySecret = envValue("ALIYUN_ACCESS_KEY_SECRET");
  if (!accessKeyId || !accessKeySecret) throw new Error("missing_aliyun_secrets");
  const endpoint = (envValue("DOCMIND_ENDPOINT") || DOCMIND_DEFAULT_ENDPOINT)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  const all: Record<string, string> = {
    ...params,
    AccessKeyId: accessKeyId,
    Format: "JSON",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2022-07-11",
  };
  const canonical = Object.keys(all)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(String(all[key]))}`)
    .join("&");
  const stringToSign = `POST&%2F&${percentEncode(canonical)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${accessKeySecret}&`),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = btoa(
    String.fromCharCode(
      ...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign))),
    ),
  );
  return {
    url: `https://${endpoint}/`,
    body: `${canonical}&Signature=${percentEncode(signature)}`,
  };
}

async function debugDocmind(url: URL): Promise<Response> {
  const op = url.searchParams.get("op") ?? "submit";
  const present = Object.fromEntries(
    DEBUG_SECRET_NAMES.map((name) => [name, Boolean(envValue(name))]),
  );
  if (!present["ALIYUN_ACCESS_KEY_ID"] || !present["ALIYUN_ACCESS_KEY_SECRET"]) {
    return json({ ok: false, error: "missing_aliyun_secrets", present }, 400);
  }

  let params: Record<string, string>;
  if (op === "submit") {
    const style = url.searchParams.get("format") ?? "repeat";
    params = {
      Action: "SubmitDocParserJob",
      FileUrl: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
      FileName: "example.pdf",
      PageIndex: "1-1",
      FormulaEnhancement: "true",
      ...(style === "flat" ? { OutputFormat: "markdown" } : { "OutputFormat.1": "markdown" }),
    };
  } else if (op === "status" || op === "result") {
    const id = url.searchParams.get("id") ?? "";
    if (!id) return json({ ok: false, error: "missing_id" }, 400);
    params = {
      Action: op === "status" ? "QueryDocParserStatus" : "GetDocParserResult",
      Id: id,
    };
  } else {
    return json({ ok: false, error: "unknown_op" }, 400);
  }

  try {
    const signed = await signedDocmindPost(params);
    const response = await fetch(signed.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: signed.body,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 2000) };
    }
    return json({ ok: response.ok, op, http: response.status, data: trimLongStrings(data) });
  } catch (error) {
    return json({ ok: false, op, error: String(error) }, 502);
  }
}

async function handleDebug(request: Request, url: URL, action: string): Promise<Response> {
  if (!debugOriginAllowed(request)) {
    return json({ ok: false, error: "forbidden_origin" }, 403);
  }

  if (action === "debug.env") {
    return json({
      ok: true,
      present: Object.fromEntries(DEBUG_SECRET_NAMES.map((name) => [name, Boolean(envValue(name))])),
    });
  }

  if (action === "debug.timeout") {
    const requestedMs = Math.min(60_000, Math.max(0, Number(url.searchParams.get("ms") ?? 45_000)));
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, requestedMs));
    return json({ ok: true, requestedMs, sleptMs: Date.now() - started });
  }

  if (action === "debug.stream") {
    const chunks = Math.min(20, Math.max(1, Number(url.searchParams.get("chunks") ?? 10)));
    const interval = Math.min(5000, Math.max(100, Number(url.searchParams.get("interval") ?? 1000)));
    const encoder = new TextEncoder();
    let sent = 0;
    const stream = new ReadableStream({
      start(controller) {
        const tick = () => {
          if (sent >= chunks) {
            controller.close();
            return;
          }
          sent += 1;
          controller.enqueue(encoder.encode(`chunk ${sent}/${chunks} at ${new Date().toISOString()}\n`));
          setTimeout(tick, interval);
        };
        tick();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (action === "debug.fetch") {
    const target = url.searchParams.get("target") ?? "dashscope";
    const targets: Record<string, string> = {
      dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
      docmind: "https://docmind-api.cn-hangzhou.aliyuncs.com/",
    };
    const targetUrl = targets[target];
    if (!targetUrl) return json({ ok: false, error: "unknown_target" }, 400);
    try {
      const response = await fetch(targetUrl, { signal: AbortSignal.timeout(15_000) });
      const text = await response.text();
      return json({ ok: true, target, http: response.status, body: text.slice(0, 500) });
    } catch (error) {
      return json({ ok: false, target, error: String(error) }, 502);
    }
  }

  if (action === "debug.docmind") {
    return await debugDocmind(url);
  }

  return json({ ok: false, error: "unknown_debug_action" }, 404);
}