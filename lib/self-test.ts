import type { Analysis, Citation } from "./types";

export type SelfTestItem = {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
};

export function verdictLabel(verdict: string): string {
  if (verdict === "supports") return "直接支持";
  if (verdict === "partial") return "部分支持";
  return "未直接覆盖";
}

export function buildSelfTestItems(analysis: Analysis): SelfTestItem[] {
  const { quickview, skeleton } = analysis;
  const items: SelfTestItem[] = [];

  if (quickview.prerequisites.length > 0) {
    items.push({
      id: "prerequisites",
      question: "读懂这篇论文需要哪些前置知识？每一项在本文里怎么用？",
      answer: quickview.prerequisites
        .map(
          (item) =>
            `${item.term}${item.english ? `（${item.english}）` : ""}：${item.why || "未说明"}${
              item.suggest ? ` 补法：${item.suggest}` : ""
            }`,
        )
        .join("\n"),
      citations: [],
    });
  }

  items.push({
    id: "problem",
    question: "这篇论文试图解决的核心问题是什么？作者认为现有方法有哪些局限？",
    answer: [
      skeleton.problem.summary || "未识别",
      skeleton.problem.importance ? `为什么重要：${skeleton.problem.importance}` : "",
      skeleton.problem.limitations.length
        ? `现有方法的局限：\n${skeleton.problem.limitations.map((item) => `- ${item}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    citations: skeleton.problem.citations,
  });

  if (skeleton.insight.summary) {
    items.push({
      id: "insight",
      question: "作者的核心洞察或关键假设是什么？它为什么能绕开现有方法的局限？",
      answer: skeleton.insight.summary,
      citations: skeleton.insight.citations,
    });
  }

  skeleton.modules.forEach((module, index) => {
    items.push({
      id: `module-${index}`,
      question: `模块「${module.name}」的输入、输出和目标分别是什么？它如何衔接到下一步？`,
      answer: [
        `输入：${module.input || "未说明"}`,
        `输出：${module.output || "未说明"}`,
        `目标：${module.goal || "未说明"}`,
        module.next ? `衔接到下一步：${module.next}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      citations: module.citations,
    });
  });

  skeleton.experiments.forEach((experiment, index) => {
    items.push({
      id: `experiment-${index}`,
      question: `实验「${experiment.name}」对应作者的哪条声称？实际结果是否支持（${verdictLabel(
        experiment.verdict,
      )}）？`,
      answer: [
        `对应声称：${experiment.claim || "未说明"}`,
        `实际发现：${experiment.finding || "未说明"}`,
        `判定：${verdictLabel(experiment.verdict)}`,
      ].join("\n"),
      citations: experiment.citations,
    });
  });

  if (skeleton.limitations.stated.length || skeleton.limitations.inferred.length) {
    items.push({
      id: "limitations",
      question: "作者明确承认了哪些局限？你还能从方法设定中推断出什么？",
      answer: [
        `作者自己承认：\n${
          skeleton.limitations.stated.length
            ? skeleton.limitations.stated.map((item) => `- ${item}`).join("\n")
            : "未识别"
        }`,
        `可从方法推断：\n${
          skeleton.limitations.inferred.length
            ? skeleton.limitations.inferred.map((item) => `- ${item}`).join("\n")
            : "未识别"
        }`,
      ].join("\n\n"),
      citations: skeleton.limitations.citations,
    });
  }

  return items.slice(0, 12);
}

export function buildSelfTestQuestions(analysis: Analysis): string[] {
  return buildSelfTestItems(analysis).map((item) => item.question);
}
