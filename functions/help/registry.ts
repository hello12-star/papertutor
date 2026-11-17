export type HelpScreen = "landing" | "result";
export type HelpVariant = "default" | "simpler" | "example";

export type HelpEntry = {
  id: string;
  screen: HelpScreen;
  label: string;
  description: string;
  baseScore: number;
  what: string;
  why: string;
  effect: string;
  example?: string;
};

export type PredictItem = {
  helpId: string;
  unfamiliarity: number;
  reason: string;
  suggestedQuestion: string;
};

export type HelpAnswer = {
  helpId: string;
  variant: HelpVariant;
  what: string;
  why: string;
  effect: string;
  example?: string;
};

export const HELP_PROMPT_VERSION = "v2";
export const REGISTRY_VERSION = "v1";

export const HELP_REGISTRY: HelpEntry[] = [
  {
    id: "landing.samplePaper",
    screen: "landing",
    label: "示例论文",
    description: "用预置论文快速走完解析与分析流程，不必先上传自己的文件。",
    baseScore: 0.86,
    what: "首页的示例论文入口，用一份预置论文快速看到完整结果。",
    why: "不想先上传自己的论文时，可以先看结果页长什么样。",
    effect: "开发预览会打开内置 QA 示例；比赛版会改为预生成示例，不消耗模型额度。",
    example: "先点示例论文，再点引用校验旁的 ? 看帮助。",
  },
  {
    id: "landing.upload",
    screen: "landing",
    label: "PDF 上传",
    description: "上传英文论文 PDF，解析成保留结构的 Markdown。",
    baseScore: 0.78,
    what: "把英文论文 PDF 上传到这里，系统会解析成结构化 Markdown。",
    why: "速览、论证骨架和引用定位都依赖这一步的文本。",
    effect: "选择文件后开始解析；同一文件会命中本地缓存，不重复解析。",
    example: "上传一篇 10 页左右的论文即可。",
  },
  {
    id: "landing.parseMode",
    screen: "landing",
    label: "解析模式",
    description: "轻量模式更快；精准模式对公式和表格更完整。",
    baseScore: 0.62,
    what: "解析模式决定 PDF 如何还原成 Markdown：轻量模式快，精准模式公式和表格更完整。",
    why: "公式、表格多的论文需要更完整的结构，才能支撑后续讲解。",
    effect: "当前预览走 MinerU 轻量/精准通道；服务端模式接入后改由服务端解析。",
    example: "摘要和正文为主的论文，轻量模式通常够用。",
  },
  {
    id: "landing.privacy",
    screen: "landing",
    label: "隐私说明",
    description: "说明论文、解析结果和模型 Key 分别存放在哪里。",
    baseScore: 0.56,
    what: "说明论文、解析结果和模型 Key 分别存在哪里。",
    why: "读论文之前先知道数据会去哪里，才能放心使用。",
    effect: "当前默认版本：解析结果缓存在本机，模型 Key 只保存在浏览器；服务端模式改由服务端安全调用。",
    example: "不想保留缓存时，可以在设置里清空本地缓存。",
  },
  {
    id: "result.quickview",
    screen: "result",
    label: "速览卡",
    description: "30 秒建立认知地图：问题、贡献、方法、前置知识与阅读路径。",
    baseScore: 0.45,
    what: "30 秒速览：核心问题、核心贡献、方法概括、前置知识和阅读路径。",
    why: "先建立认知地图，避免一上来就淹没在细节里。",
    effect: "只展示阅读建议，不会修改论文原文。",
    example: "先看核心问题，再决定从哪一节开始读。",
  },
  {
    id: "result.citationCheck",
    screen: "result",
    label: "引用校验",
    description: "在解析文本中逐条比对引用，标出能在原文定位的结论。",
    baseScore: 0.88,
    what: "系统会在解析出的 Markdown 中逐条比对引用，显示哪些能在原文找到。",
    why: "防止 AI 编造页码或引文，让每条结论都能回查。",
    effect: "点引用卡的定位会打开原文抽屉；找不到时明确提示未定位，不假装跳转。",
    example: "点任意绿色引用卡，看它跳到原文的位置。",
  },
  {
    id: "result.skeleton",
    screen: "result",
    label: "论证骨架",
    description: "把论文拆成问题、洞察、方法模块、实验和局限。",
    baseScore: 0.68,
    what: "把论文拆成问题、洞察、方法模块、实验和局限五个部分。",
    why: "作者的问题和论证结构常常是隐性的，拆开更容易跟上。",
    effect: "按站展示，每条结构性结论都带原文引用。",
    example: "先读问题与动机，再读方法模块。",
  },
  {
    id: "result.prereq",
    screen: "result",
    label: "前置知识",
    description: "读懂这篇论文前建议先掌握的概念和补齐路径。",
    baseScore: 0.72,
    what: "读懂这篇论文之前，建议先掌握的概念清单。",
    why: "术语和前置知识是初学者最容易卡住的地方。",
    effect: "展开每一项会看到为什么需要，以及怎么补。",
    example: "不认识自注意力时，先补 Q、K、V 的基本概念。",
  },
  {
    id: "result.original",
    screen: "result",
    label: "原文对照",
    description: "查看解析出的原文 Markdown，并定位引用所在位置。",
    baseScore: 0.58,
    what: "查看解析出的原文 Markdown，并可从引用跳转到对应位置。",
    why: "AI 的解释需要能对回原文，才值得信任。",
    effect: "展开后显示完整解析文本；引用定位会滚动到对应字符位置并高亮。",
    example: "在原文抽屉里搜索一个术语，核对上下文。",
  },
  {
    id: "result.deepMode",
    screen: "result",
    label: "深度模式",
    description: "计划中的分节深度分析，降低长论文超时和遗漏。",
    baseScore: 0.5,
    what: "计划中的深度分析模式，按章节分节生成，减少遗漏。",
    why: "长论文一次性生成容易超时或被截断。",
    effect: "当前版本尚未开放，按钮不会发起生成；接入后会分节生成。",
    example: "等深度模式开放后，再用它读长论文。",
  },
  {
    id: "result.selfTest",
    screen: "result",
    label: "自测",
    description: "计划中的章节自测，用问题检查是否真的读懂。",
    baseScore: 0.62,
    what: "计划中的自测：每节 2–3 个问题，检查是否真的读懂。",
    why: "只看总结容易产生“我懂了”的错觉。",
    effect: "当前版本尚未开放，不会生成题目。",
    example: "开放后先做方法模块的自测。",
  },
  {
    id: "result.export",
    screen: "result",
    label: "导出",
    description: "计划中的 Markdown 导出，方便复习和做笔记。",
    baseScore: 0.4,
    what: "计划中的导出：把速览、骨架、引用和自测整理成 Markdown。",
    why: "方便复习、做笔记和带到别处。",
    effect: "当前版本尚未开放，不会下载文件。",
    example: "开放后可以把结果粘贴到自己的笔记里。",
  },
];

export const HELP_IDS = HELP_REGISTRY.map((entry) => entry.id);

export function getHelpEntry(helpId: string): HelpEntry | undefined {
  return HELP_REGISTRY.find((entry) => entry.id === helpId);
}

export function predictionsForScreen(screen: HelpScreen): PredictItem[] {
  return HELP_REGISTRY.filter((entry) => entry.screen === screen)
    .map((entry) => ({
      helpId: entry.id,
      unfamiliarity: entry.baseScore,
      reason: "根据当前页面与控件状态估计",
      suggestedQuestion: `这个「${entry.label}」是做什么的？`,
    }))
    .sort((a, b) => b.unfamiliarity - a.unfamiliarity);
}

export function staticHelpAnswer(
  helpId: string,
  variant: HelpVariant = "default",
): HelpAnswer | null {
  const entry = getHelpEntry(helpId);
  if (!entry) return null;
  if (variant === "simpler") {
    return {
      helpId,
      variant,
      what: `简单说：${entry.what}`,
      why: `因为：${entry.why}`,
      effect: `点了：${entry.effect}`,
    };
  }
  if (variant === "example") {
    return {
      helpId,
      variant,
      what: entry.what,
      why: entry.why,
      effect: entry.effect,
      example: entry.example ?? "这个控件的具体例子会在后续版本补充。",
    };
  }
  return {
    helpId,
    variant: "default",
    what: entry.what,
    why: entry.why,
    effect: entry.effect,
  };
}