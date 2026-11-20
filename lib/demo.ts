import type { Analysis, ParsedDoc } from "./types";

export type DemoPaperMeta = {
  id: string;
  title: string;
  authors: string;
  venue: string;
  year: string;
  arxivId: string;
  sourceUrl: string;
  pages: number;
  blurb: string;
  tags: string[];
  file: string;
};

export type DemoPaperFile = {
  version: number;
  reviewStatus: "draft" | "approved";
  meta: DemoPaperMeta;
  doc: ParsedDoc;
  analysis: Analysis;
};

const INDEX_URL = "/demo/index.json";
const MAX_EXCERPT_CHARS = 20_000;
const SECRET_WORD = ["sec", "ret"].join("");
const SENSITIVE_FIELD = new RegExp(
  `"(?:apiKey|api_key|accessKey|access_key|accessKeyId|access_key_id|${SECRET_WORD}Key|${SECRET_WORD}_key)"`,
  "i",
);

export function hasSecretField(value: unknown): boolean {
  return SENSITIVE_FIELD.test(JSON.stringify(value));
}

function isMeta(value: unknown): value is DemoPaperMeta {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.authors === "string" &&
    typeof record.venue === "string" &&
    typeof record.year === "string" &&
    typeof record.arxivId === "string" &&
    typeof record.sourceUrl === "string" &&
    record.sourceUrl.startsWith("https://arxiv.org/") &&
    typeof record.pages === "number" &&
    typeof record.blurb === "string" &&
    Array.isArray(record.tags) &&
    typeof record.file === "string" &&
    /^[a-z0-9-]+\.json$/.test(record.file)
  );
}

function assertDemoPaper(value: unknown, expected: DemoPaperMeta): DemoPaperFile {
  if (!value || typeof value !== "object") throw new Error("示例文件格式不正确");
  const paper = value as DemoPaperFile;
  if (paper.version !== 1) throw new Error("示例文件版本不受支持");
  if (!paper.meta || paper.meta.id !== expected.id) throw new Error("示例文件与索引不匹配");
  if (!paper.doc || paper.doc.mode !== "demo") throw new Error("示例缺少 demo 文档");
  if (typeof paper.doc.markdown !== "string" || paper.doc.markdown.length < 200) {
    throw new Error("示例缺少可校验的引用节选");
  }
  if (paper.doc.markdown.length > MAX_EXCERPT_CHARS) {
    throw new Error("示例节选超出限制，不应打包论文全文");
  }
  if (!paper.doc.sourceUrl?.startsWith("https://arxiv.org/")) {
    throw new Error("示例缺少 arXiv 来源");
  }
  if (!paper.analysis?.quickview || !paper.analysis?.skeleton) {
    throw new Error("示例缺少分析结果");
  }
  if (!Array.isArray(paper.analysis.skeleton.modules) || paper.analysis.skeleton.modules.length === 0) {
    throw new Error("示例缺少方法模块");
  }
  if (!Array.isArray(paper.analysis.skeleton.experiments) || paper.analysis.skeleton.experiments.length === 0) {
    throw new Error("示例缺少实验映射");
  }
  if (hasSecretField(paper)) {
    throw new Error("示例文件包含疑似密钥字段");
  }
  return paper;
}

export async function loadDemoIndex(signal?: AbortSignal): Promise<DemoPaperMeta[]> {
  const response = await fetch(INDEX_URL, { cache: "force-cache", signal });
  if (!response.ok) throw new Error(`示例索引加载失败（HTTP ${response.status}）`);
  const data = (await response.json()) as { papers?: unknown };
  if (!Array.isArray(data.papers)) throw new Error("示例索引格式不正确");
  const papers = data.papers.filter(isMeta);
  if (papers.length !== data.papers.length) throw new Error("示例索引包含无效条目");
  return papers;
}

export async function loadDemoPaper(
  meta: DemoPaperMeta,
  signal?: AbortSignal,
): Promise<DemoPaperFile> {
  const response = await fetch(`/demo/${meta.file}`, { cache: "force-cache", signal });
  if (!response.ok) throw new Error(`示例加载失败（HTTP ${response.status}）`);
  return assertDemoPaper(await response.json(), meta);
}

export function prefetchDemoPapers(metas: DemoPaperMeta[]): void {
  if (typeof window === "undefined" || metas.length === 0) return;
  const run = () => {
    for (const meta of metas) {
      void fetch(`/demo/${meta.file}`, { cache: "force-cache" }).catch(() => {});
    }
  };
  const idle = (window as Window & { requestIdleCallback?: (callback: () => void) => number })
    .requestIdleCallback;
  if (idle) idle(run);
  else window.setTimeout(run, 800);
}
