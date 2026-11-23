import { handleServerApi } from "./server-api.ts";
import { serverModeEnabled } from "./providers/env.ts";
import { serviceEnabled } from "./budget.ts";
import { json } from "./http.ts";

const MINERU = "https://mineru.net";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "health";
  try {
    const path = url.pathname.replace(/^\/functions\/v1\/app/, "");
    if (path.startsWith("/api/")) {
      return await handleServerApi(request, url, path);
    }
    if (action === "health") {
      return json({
        ok: true,
        service: "papertutor",
        ts: Date.now(),
        serverMode: serverModeEnabled(),
        serviceEnabled: serviceEnabled(),
      });
    }
    if (action.startsWith("api.")) {
      const apiPath = `/api/${action.slice(4).replace(/\./g, "/")}`;
      return await handleServerApi(request, url, apiPath);
    }
    if (action === "mineru.submit") {
      return await submitMineru(request, url);
    }
    if (action === "mineru.status") {
      return await pollMineru(request, url);
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
