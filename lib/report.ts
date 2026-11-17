import type { Analysis, CitationStats, ParsedDoc } from "./types";
import { paperTitle } from "./export.ts";
import { buildSelfTestItems, verdictLabel } from "./self-test.ts";

export type LearningReportInput = {
  doc: ParsedDoc;
  analysis: Analysis;
  stats: CitationStats | null;
  selfTest: { revealedIds: string[]; total: number };
};

export function buildLearningReport({
  doc,
  analysis,
  stats,
  selfTest,
}: LearningReportInput): string {
  const title = paperTitle(doc, analysis);
  const { quickview, skeleton } = analysis;
  const revealed = new Set(selfTest.revealedIds);
  const items = buildSelfTestItems(analysis);
  const pending = items.filter((item) => !revealed.has(item.id));
  const allCitations = [
    ...skeleton.problem.citations,
    ...skeleton.insight.citations,
    ...skeleton.modules.flatMap((module) => module.citations),
    ...skeleton.experiments.flatMap((experiment) => experiment.citations),
    ...skeleton.limitations.citations,
  ];
  const unverified = allCitations.filter((citation) => !citation.verified).length;
  const source = doc.sourceUrl
    ? `- 原文：${doc.sourceLabel ?? "arXiv"} · ${doc.sourceUrl}`
    : "- 原文：本地上传的 PDF";

  const lines: string[] = [];
  lines.push(`# 学习报告：${title}`);
  lines.push(
    [
      `- 作者：${quickview.meta.authors || "未识别"}`,
      `- 来源：${quickview.meta.venue || "未识别"} · ${quickview.meta.year || "未识别"}`,
      `- 页数：${doc.pages ?? "未知"}`,
      source,
      `- 生成时间：${new Date().toISOString().slice(0, 10)}`,
    ].join("\n"),
  );

  lines.push("## 速览要点");
  lines.push(
    [
      `**核心问题：** ${quickview.coreQuestion || "未识别"}`,
      `**核心贡献：** ${quickview.coreContribution || "未识别"}`,
      `**方法概括：** ${quickview.methodSummary || "未识别"}`,
    ].join("\n\n"),
  );

  lines.push("## 前置知识");
  lines.push(
    quickview.prerequisites.length
      ? quickview.prerequisites
          .map(
            (item) =>
              `- **${item.term}**${item.english ? `（${item.english}）` : ""}：${item.why || "未说明"}`,
          )
          .join("\n")
      : "_未识别_",
  );

  lines.push("## 论证骨架摘要");
  lines.push(
    [
      `- 问题：${skeleton.problem.summary || "未识别"}`,
      `- 核心洞察：${skeleton.insight.summary || "未识别"}`,
      `- 方法模块：${skeleton.modules.map((module) => module.name).join("、") || "未识别"}`,
      `- 实验映射：${
        skeleton.experiments
          .map((experiment) => `${experiment.name}（${verdictLabel(experiment.verdict)}）`)
          .join("、") || "未识别"
      }`,
    ].join("\n"),
  );

  lines.push("## 引用校验");
  if (stats && stats.total > 0) {
    lines.push(
      `- 已验证引用：${stats.verified}/${stats.total}`,
      `- 结论单元引用覆盖：${stats.unitsWithVerified}/${stats.units}`,
      unverified > 0
        ? `- 有 ${unverified} 条引用未能在解析文本中精确匹配，建议回到原文核对。`
        : "- 所有引用都在解析文本中匹配成功。",
    );
  } else {
    lines.push("_当前没有引用校验数据。_");
  }

  lines.push("## 自测进度");
  lines.push(`- 本次会话已展开参考答案：${revealed.size}/${selfTest.total}`);
  if (pending.length) {
    lines.push(`- 尚未展开：\n${pending.map((item) => `  - ${item.question}`).join("\n")}`);
  } else if (selfTest.total > 0) {
    lines.push("- 已展开全部参考答案。");
  }

  lines.push("## 建议复习");
  const review: string[] = [];
  if (unverified > 0) review.push(`优先核对 ${unverified} 条未定位引用。`);
  if (skeleton.limitations.inferred.length) {
    review.push(`从方法推断的局限：${skeleton.limitations.inferred.join("；")}`);
  }
  if (pending.length) review.push(`还有 ${pending.length} 道自测题没有展开答案。`);
  lines.push(review.length ? review.map((item) => `- ${item}`).join("\n") : "- 暂无额外复习项。");

  lines.push("---");
  lines.push("本报告由 PaperTutor 根据当前页面的本地学习状态生成，不包含模型调用或密钥。");
  return `${lines.join("\n\n")}\n`;
}

export function learningReportFileName(doc: ParsedDoc, analysis: Analysis): string {
  const base = paperTitle(doc, analysis)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return `学习报告-${base || "papertutor"}.md`;
}
