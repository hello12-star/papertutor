import type { Analysis, Citation, ParsedDoc } from "./types";
import { buildSelfTestQuestions, verdictLabel } from "./self-test.ts";

export { buildSelfTestQuestions, verdictLabel } from "./self-test.ts";

function line(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function citationText(citation: Citation): string {
  const section = citation.section ? `§${citation.section}` : "原文";
  const status = citation.verified ? "原文已验证" : "未能定位";
  return `> ${section}（${status}）：${citation.quote}`;
}

function citationsBlock(citations: Citation[]): string {
  if (!citations.length) return "_未在原文定位相关段落_";
  return citations.map(citationText).join("\n");
}

function allCitations(analysis: Analysis): Citation[] {
  const { skeleton } = analysis;
  const list: Citation[] = [
    ...skeleton.problem.citations,
    ...skeleton.insight.citations,
    ...skeleton.modules.flatMap((module) => module.citations),
    ...skeleton.experiments.flatMap((experiment) => experiment.citations),
    ...skeleton.limitations.citations,
  ];
  const seen = new Set<string>();
  return list.filter((citation) => {
    const key = `${citation.section ?? ""}|${citation.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function paperTitle(doc: ParsedDoc, analysis: Analysis): string {
  const title = line(analysis.quickview.meta.title);
  if (title && title !== "未识别") return title;
  return doc.fileName.replace(/\.pdf$/i, "") || "未命名论文";
}

export function buildExportMarkdown(doc: ParsedDoc, analysis: Analysis): string {
  const { quickview, skeleton } = analysis;
  const title = paperTitle(doc, analysis);
  const meta = quickview.meta;
  const exportedAt = new Date().toISOString().slice(0, 10);
  const parts: string[] = [];

  parts.push(`# ${title}`);
  parts.push(
    [
      `- 作者：${line(meta.authors) || "未识别"}`,
      `- 来源：${line(meta.venue) || "未识别"} · ${line(meta.year) || "未识别"}`,
      `- 页数：${doc.pages ?? "未知"}`,
      `- 解析模式：${doc.mode === "demo" ? "预生成示例" : doc.mode === "docmind" ? "DocMind 服务端解析" : doc.mode === "token" ? "精准模式" : "轻量模式"}`,
      `- Paper Hash：${doc.hash}`,
      `- 导出日期：${exportedAt}`,
    ].join("\n"),
  );

  parts.push("## 速览卡");
  parts.push(`### 核心问题\n${line(quickview.coreQuestion) || "未识别"}`);
  parts.push(`### 核心贡献\n${line(quickview.coreContribution) || "未识别"}`);
  parts.push(`### 方法概括\n${line(quickview.methodSummary) || "未识别"}`);

  parts.push("## 前置知识 / 术语");
  if (quickview.prerequisites.length === 0) {
    parts.push("_模型没有给出前置知识清单_");
  } else {
    for (const item of quickview.prerequisites) {
      const english = item.english ? `（${item.english}）` : "";
      parts.push(`- **${item.term}**${english}：${item.why || "未说明"}${item.suggest ? ` 补法：${item.suggest}` : ""}`);
    }
  }

  parts.push("## 建议阅读路径");
  const first = quickview.readingPath.first.length
    ? quickview.readingPath.first.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "_未给出_";
  parts.push(`### 先读\n${first}`);
  parts.push(`### 核心图\n${line(quickview.readingPath.keyFigure) || "未识别"}`);
  parts.push(
    `### 可以暂时跳过\n${
      quickview.readingPath.skip.length
        ? quickview.readingPath.skip.map((item) => `- ${item}`).join("\n")
        : "_未给出_"
    }`,
  );

  parts.push("## 论证骨架");
  parts.push("### 问题与动机");
  parts.push(line(skeleton.problem.summary) || "未识别");
  if (skeleton.problem.importance) parts.push(`**为什么重要：** ${skeleton.problem.importance}`);
  if (skeleton.problem.limitations.length) {
    parts.push(
      `**现有方法的局限：**\n${skeleton.problem.limitations
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  parts.push(citationsBlock(skeleton.problem.citations));

  parts.push("### 核心洞察 / 假设");
  parts.push(line(skeleton.insight.summary) || "未识别");
  parts.push(citationsBlock(skeleton.insight.citations));

  parts.push("### 方法模块");
  if (skeleton.modules.length === 0) {
    parts.push("_未识别到可拆分的模块_");
  } else {
    for (const module of skeleton.modules) {
      parts.push(`#### ${module.name}`);
      if (module.role) parts.push(`- 角色：${module.role}`);
      parts.push(`- 输入：${module.input || "未说明"}`);
      parts.push(`- 输出：${module.output || "未说明"}`);
      parts.push(`- 目标：${module.goal || "未说明"}`);
      if (module.next) parts.push(`- 衔接到下一步：${module.next}`);
      parts.push(citationsBlock(module.citations));
    }
  }

  parts.push("### 实验验证");
  if (skeleton.experiments.length === 0) {
    parts.push("_未识别到实验映射_");
  } else {
    for (const experiment of skeleton.experiments) {
      parts.push(`#### ${experiment.name}`);
      parts.push(`- 对应声称：${experiment.claim || "未说明"}`);
      parts.push(`- 实际发现：${experiment.finding || "未说明"}`);
      parts.push(`- 判定：${verdictLabel(experiment.verdict)}`);
      parts.push(citationsBlock(experiment.citations));
    }
  }

  parts.push("### 局限与未解决的问题");
  parts.push(
    `**作者自己承认：**\n${
      skeleton.limitations.stated.length
        ? skeleton.limitations.stated.map((item) => `- ${item}`).join("\n")
        : "_未识别_"
    }`,
  );
  parts.push(
    `**可从方法推断：**\n${
      skeleton.limitations.inferred.length
        ? skeleton.limitations.inferred.map((item) => `- ${item}`).join("\n")
        : "_未识别_"
    }`,
  );
  parts.push(citationsBlock(skeleton.limitations.citations));

  parts.push("## 引用清单");
  const citations = allCitations(analysis);
  if (citations.length === 0) {
    parts.push("_没有可导出的引用_");
  } else {
    citations.forEach((citation, index) => {
      parts.push(`${index + 1}. ${citationText(citation).replace(/^> /, "")}`);
    });
  }

  parts.push("## 自测题");
  const questions = buildSelfTestQuestions(analysis);
  questions.forEach((question, index) => parts.push(`${index + 1}. ${question}`));

  parts.push("---");
  parts.push(
    "由 PaperTutor 导出。引用基于解析出的 Markdown 校验；未定位的引用请以原文为准。",
  );

  return `${parts.join("\n\n")}\n`;
}

export function buildOutline(doc: ParsedDoc, analysis: Analysis): string {
  const { quickview, skeleton } = analysis;
  const title = paperTitle(doc, analysis);
  const lines = [
    `# ${title}`,
    "- 速览卡：核心问题 / 核心贡献 / 方法概括",
    `- 前置知识：${
      quickview.prerequisites.map((item) => item.term).join("、") || "未识别"
    }`,
    `- 问题与动机：${line(skeleton.problem.summary).slice(0, 60) || "未识别"}`,
    `- 核心洞察：${line(skeleton.insight.summary).slice(0, 60) || "未识别"}`,
    `- 方法模块：${
      skeleton.modules.map((item) => item.name).join("、") || "未识别"
    }`,
    `- 实验验证：${
      skeleton.experiments.map((item) => item.name).join("、") || "未识别"
    }`,
    "- 局限与未解决的问题",
    `- 自测题：${buildSelfTestQuestions(analysis).length} 题`,
    `- 原文：${doc.pages ?? "?"} 页`,
  ];
  return `${lines.join("\n")}\n`;
}

export function exportFileName(doc: ParsedDoc, analysis: Analysis): string {
  const base = paperTitle(doc, analysis)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  return `${base || "papertutor-export"}.md`;
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadMarkdown(
  doc: ParsedDoc,
  analysis: Analysis,
  markdown: string,
): void {
  downloadText(exportFileName(doc, analysis), markdown);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}