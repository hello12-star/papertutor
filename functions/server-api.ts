import { guardAnalysisBudget, serviceEnabled } from "./budget.ts";
import { readEnv, serverModeEnabled } from "./providers/env.ts";
import { ProviderError } from "./providers/errors.ts";
import { getLlmProvider, getParserProvider, promptVersion } from "./providers/index.ts";
import { ApiError, json } from "./http.ts";
import { handleHelpAnswer, handleHelpPredict } from "./help/api.ts";

type JobStatus = "queued" | "running" | "succeeded" | "failed";

type Job = {
  id: string;
  status: JobStatus;
  step: string;
  progress: number;
  docId?: string;
  error?: { code: string; message: string };
  createdAt: number;
  updatedAt: number;
};

type DocRecord = {
  docId: string;
  markdown: string;
  pages?: number;
  meta?: Record<string, string>;
  fileName: string;
  createdAt: number;
};

const jobs = new Map<string, Job>();
const docs = new Map<string, DocRecord>();
const analyses = new Map<string, unknown>();

export function parseCacheKey(sha256: string): string {
  return `parse:v1:${sha256}`;
}

export function analysisCacheKey(
  docId: string,
  mode: string,
  version: string,
  model: string,
): string {
  return `analysis:v1:${docId}:${mode}:${version}:${model}`;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function extractJsonObject(raw: string): unknown {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new ApiError("INVALID_ANALYSIS_JSON", "模型输出不是 JSON 对象", 502);
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new ApiError(
      "INVALID_ANALYSIS_JSON",
      error instanceof Error ? error.message : "JSON 解析失败",
      502,
    );
  }
}

async function readParseInput(
  request: Request,
): Promise<{ file: ArrayBuffer; fileName: string; mimeType?: string }> {
  const contentType = request.headers.get("content-type") || "";
  let file: ArrayBuffer;
  let fileName: string;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const uploaded = form.get("file");
    if (!uploaded || typeof (uploaded as any).arrayBuffer !== "function") {
      throw new ApiError("INVALID_FILE", "multipart 请求缺少 file 字段", 400);
    }
    file = await (uploaded as any).arrayBuffer();
    fileName = String((uploaded as any).name || form.get("fileName") || "paper.pdf");
  } else {
    file = await request.arrayBuffer();
    fileName = decodeURIComponent(request.headers.get("x-file-name") || "paper.pdf");
  }

  if (!file || file.byteLength === 0) {
    throw new ApiError("INVALID_FILE", "文件为空", 400);
  }
  if (!/\.pdf$/i.test(fileName)) {
    throw new ApiError("INVALID_FILE", "仅支持 .pdf 文件", 400);
  }
  const maxMb = Number(readEnv("MAX_UPLOAD_MB") || 20);
  if (Number.isFinite(maxMb) && maxMb > 0 && file.byteLength > maxMb * 1024 * 1024) {
    throw new ApiError("FILE_TOO_LARGE", `文件超过 ${maxMb}MB 限制`, 413);
  }
  return { file, fileName, mimeType: contentType || "application/pdf" };
}

async function handleParse(request: Request): Promise<Response> {
  const input = await readParseInput(request);
  const sha256 = await sha256Hex(input.file);
  const cacheKey = parseCacheKey(sha256);
  const jobId = crypto.randomUUID();
  const now = Date.now();

  const cached = docs.get(sha256);
  if (cached) {
    jobs.set(jobId, {
      id: jobId,
      status: "succeeded",
      step: "done",
      progress: 100,
      docId: sha256,
      createdAt: now,
      updatedAt: now,
    });
    return json(
      {
        ok: true,
        jobId,
        docId: sha256,
        status: "succeeded",
        cacheKey,
        pages: cached.pages,
        markdown: cached.markdown,
        cached: true,
      },
      200,
    );
  }

  const provider = getParserProvider();
  const result = await provider.parse(input);
  docs.set(sha256, {
    docId: sha256,
    markdown: result.markdown,
    pages: result.pages,
    meta: result.meta,
    fileName: input.fileName,
    createdAt: now,
  });
  jobs.set(jobId, {
    id: jobId,
    status: "succeeded",
    step: "done",
    progress: 100,
    docId: sha256,
    createdAt: now,
    updatedAt: now,
  });

  return json(
    {
      ok: true,
      jobId,
      docId: sha256,
      status: "succeeded",
      cacheKey,
      pages: result.pages,
      markdown: result.markdown,
      cached: false,
    },
    202,
  );
}

function handleJob(id: string): Response {
  const job = jobs.get(id);
  if (!job) throw new ApiError("JOB_NOT_FOUND", "找不到这个 job", 404);
  const doc = job.docId ? docs.get(job.docId) : undefined;
  return json({
    ok: true,
    job: {
      ...job,
      markdown: doc?.markdown,
      pages: doc?.pages,
    },
  });
}

async function handleAnalyze(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const docId = typeof body?.docId === "string" ? body.docId : "";
  const mode = body?.mode === "quick" || body?.mode === "deep" ? body.mode : "";
  if (!docId) throw new ApiError("INVALID_REQUEST", "缺少 docId", 400);
  if (!mode) throw new ApiError("INVALID_MODE", "mode 必须是 quick 或 deep", 400);

  const doc = docs.get(docId);
  if (!doc) throw new ApiError("DOC_NOT_FOUND", "找不到这个 docId", 404);

  const budget = guardAnalysisBudget();
  if (!budget.ok) {
    return json({ ok: false, code: budget.code, message: budget.message }, budget.status);
  }

  const provider = getLlmProvider();
  const version = promptVersion();
  const result = await provider.complete({
    messages: [
      {
        role: "system",
        content:
          "You are PaperTutor. Return exactly one JSON object with quickview and skeleton fields. Do not include markdown fences.",
      },
      {
        role: "user",
        content: `Return the analysis JSON for this paper:\n\n${doc.markdown.slice(0, 12_000)}`,
      },
    ],
    maxTokens: 4000,
    temperature: 0.2,
  });

  const cacheKey = analysisCacheKey(docId, mode, version, result.model);
  const cached = analyses.get(cacheKey);
  if (cached) {
    return json({
      ok: true,
      jobId: crypto.randomUUID(),
      status: "succeeded",
      analysis: cached,
      model: result.model,
      cacheKey,
      cached: true,
    });
  }

  const parsed = extractJsonObject(result.text);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !(parsed as any).quickview ||
    !(parsed as any).skeleton
  ) {
    throw new ApiError("INVALID_ANALYSIS_JSON", "缺少 quickview 或 skeleton", 502);
  }
  analyses.set(cacheKey, parsed);

  const jobId = crypto.randomUUID();
  const now = Date.now();
  jobs.set(jobId, {
    id: jobId,
    status: "succeeded",
    step: "done",
    progress: 100,
    docId,
    createdAt: now,
    updatedAt: now,
  });

  return json({
    ok: true,
    jobId,
    status: "succeeded",
    analysis: parsed,
    model: result.model,
    cacheKey,
    cached: false,
  });
}

export async function handleServerApi(
  request: Request,
  _url: URL,
  path: string,
): Promise<Response> {
  if (!serverModeEnabled()) {
    return json(
      {
        ok: false,
        code: "SERVER_MODE_DISABLED",
        message: "SERVER_MODE=false，服务端 API 未启用；现有 BYOK / MinerU 路径不受影响。",
      },
      404,
    );
  }

  if (!serviceEnabled()) {
    return json(
      {
        ok: false,
        code: "SERVICE_DISABLED",
        message: "服务暂时关闭（SERVICE_ENABLED=false）。",
      },
      503,
    );
  }

  try {
    if (path === "/api/parse" && request.method === "POST") {
      return await handleParse(request);
    }
    if (path === "/api/analyze" && request.method === "POST") {
      return await handleAnalyze(request);
    }
    if (path === "/api/help/predict" && request.method === "POST") {
      return await handleHelpPredict(request);
    }
    if (path === "/api/help/answer" && request.method === "POST") {
      return await handleHelpAnswer(request);
    }
    if (path.startsWith("/api/jobs/") && request.method === "GET") {
      return handleJob(path.slice("/api/jobs/".length));
    }
    return json({ ok: false, code: "NOT_FOUND", message: `未知 API 路径 ${path}` }, 404);
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ ok: false, code: error.code, message: error.message }, error.status);
    }
    if (error instanceof ProviderError) {
      return json(
        {
          ok: false,
          code: error.code,
          message: error.message,
          detail: error.detail,
        },
        error.status,
      );
    }
    return json(
      {
        ok: false,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}