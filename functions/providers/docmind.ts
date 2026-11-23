import { readEnv } from "./env.ts";
import { ProviderError, type ProviderErrorCode } from "./errors.ts";
import type { ParserProvider, ParseInput, ParseResult } from "./types.ts";

const DOCMIND_VERSION = "2022-07-11";
const AUTH_VERSION = "2019-12-19";
const DEFAULT_ENDPOINT = "docmind-api.cn-hangzhou.aliyuncs.com";
const AUTH_ENDPOINT = "openplatform.aliyuncs.com";
const REQUEST_TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = 32_000;
const POLL_INITIAL_MS = 700;
const POLL_MAX_MS = 4_000;
const RESULT_LAYOUT_STEP = 100;
const RESULT_MAX_LAYOUTS = 30_000;

type SignedRequest = {
  url: string;
  body?: string;
};

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function hmacSha1(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${secret}&`),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(text),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function signedRequest(options: {
  endpoint: string;
  version: string;
  action: string;
  method: "GET" | "POST";
  params?: Record<string, string>;
}): Promise<SignedRequest> {
  const accessKeyId = readEnv("ALIYUN_ACCESS_KEY_ID");
  const accessKeySecret = readEnv("ALIYUN_ACCESS_KEY_SECRET");
  if (!accessKeyId || !accessKeySecret) {
    throw new ProviderError(
      "DOCMIND_NOT_CONFIGURED",
      "缺少 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET，未发起外网请求。",
      503,
    );
  }

  const all: Record<string, string> = {
    ...options.params,
    AccessKeyId: accessKeyId,
    Action: options.action,
    Format: "JSON",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: options.version,
  };
  const canonical = Object.keys(all)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(String(all[key]))}`)
    .join("&");
  const stringToSign = `${options.method}&%2F&${percentEncode(canonical)}`;
  const signature = await hmacSha1(accessKeySecret, stringToSign);
  const endpoint = options.endpoint
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const signed = `${canonical}&Signature=${percentEncode(signature)}`;
  if (options.method === "POST") {
    return { url: `https://${endpoint}/`, body: signed };
  }
  return { url: `https://${endpoint}/?${signed}` };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ProviderError(
        "DOCMIND_TIMEOUT",
        "DocMind 请求超时，未继续轮询。",
        504,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response, errorCode: ProviderErrorCode): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(
      errorCode,
      `DocMind 返回了非 JSON 响应（HTTP ${response.status}）。`,
      502,
      text.slice(0, 200),
    );
  }
}

function errorDetail(body: any): string {
  const code = String(body?.Code ?? body?.code ?? "");
  const message = String(body?.Message ?? body?.message ?? "");
  const requestId = String(body?.RequestId ?? body?.requestId ?? "");
  return [code, message, requestId].filter(Boolean).join(" · ").slice(0, 400);
}

async function callDocMind(
  action: string,
  params: Record<string, string>,
  options: {
    endpoint?: string;
    version?: string;
    method?: "GET" | "POST";
    errorCode?: ProviderErrorCode;
    timeoutMs?: number;
  } = {},
): Promise<any> {
  const errorCode = options.errorCode ?? "DOCMIND_STATUS_FAILED";
  const signed = await signedRequest({
    endpoint: options.endpoint || readEnv("DOCMIND_ENDPOINT") || DEFAULT_ENDPOINT,
    version: options.version ?? DOCMIND_VERSION,
    action,
    method: options.method ?? "POST",
    params,
  });
  let response: Response;
  try {
    response = await fetchWithTimeout(signed.url, {
      method: options.method ?? "POST",
      headers:
        (options.method ?? "POST") === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : { Accept: "application/json" },
      body: signed.body,
    }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      errorCode,
      `DocMind 网络请求失败：${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }
  const body = await readJson(response, errorCode);
  const code = body?.Code ?? body?.code;
  if (!response.ok || (code !== undefined && String(code) !== "200")) {
    throw new ProviderError(
      errorCode,
      `DocMind ${action} 失败。`,
      502,
      errorDetail(body),
    );
  }
  return body;
}

type UploadAuth = {
  accessKeyId: string;
  policy: string;
  signature: string;
  objectKey: string;
  bucket: string;
  endpoint: string;
};

async function authorizeFileUpload(): Promise<UploadAuth> {
  const body = await callDocMind(
    "AuthorizeFileUpload",
    { Product: "docmind-api", RegionId: "cn-hangzhou" },
    {
      endpoint: AUTH_ENDPOINT,
      version: AUTH_VERSION,
      method: "GET",
      errorCode: "DOCMIND_AUTH_FAILED",
    },
  );
  const data = body?.Data ?? body;
  const auth: UploadAuth = {
    accessKeyId: String(data?.AccessKeyId ?? ""),
    policy: String(data?.Policy ?? data?.EncodedPolicy ?? ""),
    signature: String(data?.Signature ?? ""),
    objectKey: String(data?.ObjectKey ?? ""),
    bucket: String(data?.Bucket ?? ""),
    endpoint: String(data?.Endpoint ?? ""),
  };
  if (
    !auth.accessKeyId ||
    !auth.policy ||
    !auth.signature ||
    !auth.objectKey ||
    !auth.bucket ||
    !auth.endpoint
  ) {
    throw new ProviderError(
      "DOCMIND_AUTH_FAILED",
      "DocMind 文件上传授权返回不完整。",
      502,
    );
  }
  return auth;
}

async function uploadToOss(
  auth: UploadAuth,
  input: ParseInput,
): Promise<string> {
  const endpoint = auth.endpoint
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const form = new FormData();
  form.append("OSSAccessKeyId", auth.accessKeyId);
  form.append("policy", auth.policy);
  form.append("Signature", auth.signature);
  form.append("key", auth.objectKey);
  form.append("success_action_status", "201");
  form.append(
    "file",
    new Blob([input.file], { type: input.mimeType || "application/pdf" }),
    input.fileName || "paper.pdf",
  );

  let response: Response;
  try {
    response = await fetchWithTimeout(`https://${auth.bucket}.${endpoint}/`, {
      method: "POST",
      body: form,
    }, 30_000);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      "DOCMIND_UPLOAD_FAILED",
      `文件上传到 DocMind 临时 OSS 失败：${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }
  if (!response.ok) {
    throw new ProviderError(
      "DOCMIND_UPLOAD_FAILED",
      `文件上传到 DocMind 临时 OSS 失败（HTTP ${response.status}）。`,
      502,
    );
  }
  return `https://${auth.bucket}.${endpoint}/${auth.objectKey}`;
}

async function submitJob(fileUrl: string, fileName: string): Promise<string> {
  const body = await callDocMind(
    "SubmitDocParserJob",
    {
      FileUrl: fileUrl,
      FileName: fileName,
      FormulaEnhancement: "true",
      "OutputFormat.1": "markdown",
    },
    { errorCode: "DOCMIND_SUBMIT_FAILED" },
  );
  const id = String(body?.Data?.Id ?? body?.Data?.ID ?? "");
  if (!id) {
    throw new ProviderError(
      "DOCMIND_SUBMIT_FAILED",
      "DocMind 提交成功但没有返回 Job Id。",
      502,
      errorDetail(body),
    );
  }
  return id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStatus(id: string): Promise<{ pages?: number; status: any }> {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let delay = POLL_INITIAL_MS;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const body = await callDocMind(
      "QueryDocParserStatus",
      { Id: id },
      { timeoutMs: Math.min(REQUEST_TIMEOUT_MS, Math.max(1_000, remaining)) },
    );
    const data = body?.Data ?? body;
    const status = String(data?.Status ?? "").toLowerCase();
    if (status === "fail" || status === "failed") {
      throw new ProviderError(
        "DOCMIND_STATUS_FAILED",
        "DocMind 解析失败。",
        502,
        errorDetail(body),
      );
    }
    if (status === "success" || Number(data?.Processing) >= 100) {
      const pages = Number(
        data?.PageCountEstimate ??
          data?.NumberOfSuccessfulParsing ??
          data?.NumberOfSuccessfulPages ??
          0,
      );
      return { pages: Number.isFinite(pages) && pages > 0 ? pages : undefined, status: data };
    }
    const left = deadline - Date.now();
    if (left <= 0) break;
    await sleep(Math.min(delay, left));
    delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.7));
  }
  throw new ProviderError(
    "DOCMIND_TIMEOUT",
    "DocMind 在总超时内没有完成解析，未继续轮询。",
    504,
  );
}

function assembleMarkdown(layouts: any[]): string {
  const parts: string[] = [];
  for (const layout of layouts) {
    const raw =
      typeof layout?.markdownContent === "string" ? layout.markdownContent : "";
    const markdown = raw.replace(/\s+$/, "");
    if (markdown.trim()) {
      parts.push(markdown);
      continue;
    }
    const text = typeof layout?.text === "string" ? layout.text.trim() : "";
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

async function fetchResult(id: string): Promise<ParseResult> {
  const layouts: any[] = [];
  let layoutNum = 0;
  while (layouts.length < RESULT_MAX_LAYOUTS) {
    const body = await callDocMind(
      "GetDocParserResult",
      {
        Id: id,
        LayoutNum: String(layoutNum),
        LayoutStepSize: String(RESULT_LAYOUT_STEP),
      },
      { errorCode: "DOCMIND_EMPTY_RESULT" },
    );
    let data: any = body?.Data ?? body;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        data = null;
      }
    }
    const page = Array.isArray(data?.layouts) ? data.layouts : [];
    if (page.length === 0) break;
    layouts.push(...page);
    layoutNum += page.length;
    if (page.length < RESULT_LAYOUT_STEP) break;
  }
  const markdown = assembleMarkdown(layouts);
  if (!markdown.trim()) {
    throw new ProviderError(
      "DOCMIND_EMPTY_RESULT",
      "DocMind 解析成功但没有返回 Markdown。",
      502,
    );
  }
  return {
    markdown,
    meta: { provider: "docmind", jobId: id },
  };
}

async function parseWithDocMind(input: ParseInput): Promise<ParseResult> {
  if (!readEnv("ALIYUN_ACCESS_KEY_ID") || !readEnv("ALIYUN_ACCESS_KEY_SECRET")) {
    throw new ProviderError(
      "DOCMIND_NOT_CONFIGURED",
      "缺少 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET，未发起外网请求。",
      503,
    );
  }
  const auth = await authorizeFileUpload();
  const fileUrl = await uploadToOss(auth, input);
  const id = await submitJob(fileUrl, input.fileName || "paper.pdf");
  const status = await waitForStatus(id);
  const result = await fetchResult(id);
  return {
    ...result,
    pages: status.pages,
    meta: {
      ...(result.meta ?? {}),
      status: String(status.status?.Status ?? "success"),
    },
  };
}

export function createDocmindProvider(): ParserProvider {
  return {
    id: "docmind",
    async parse(input: ParseInput) {
      return await parseWithDocMind(input);
    },
  };
}