import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Compass,
  Copy,
  Eye,
  FastForward,
  FlaskConical,
  Lightbulb,
  ListTree,
  Quote,
  RefreshCw,
  Settings2,
  Sparkles,
  Target,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type {
  Analysis,
  AppError,
  Citation,
  CitationStats,
  Experiment,
  MethodModule,
  ParsedDoc,
  Prerequisite,
  QuickView,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  doc: ParsedDoc;
  analysis: Analysis | null;
  stats: CitationStats | null;
  error: AppError | null;
  generating: boolean;
  cacheHit: boolean;
  hasKey: boolean;
  diagnostics: { model: string; baseUrl: string };
  onRegenerate: () => void;
  onOpenSettings: () => void;
  onBack: () => void;
};

const NAV = [
  { id: "quickview", label: "速览卡", index: "00" },
  { id: "problem", label: "问题与动机", index: "01" },
  { id: "insight", label: "核心洞察", index: "02" },
  { id: "method", label: "方法模块", index: "03" },
  { id: "experiments", label: "实验验证", index: "04" },
  { id: "limitations", label: "局限", index: "05" },
];

export function ResultView({
  doc,
  analysis,
  stats,
  error,
  generating,
  cacheHit,
  hasKey,
  diagnostics,
  onRegenerate,
  onOpenSettings,
  onBack,
}: Props) {
  const [copied, setCopied] = useState(false);

  const copyDiagnostics = () => {
    if (!error) return;
    const text = [
      "PaperTutor 诊断信息",
      `模型：${diagnostics.model || "未设置"}`,
      `Base URL：${diagnostics.baseUrl || "未设置"}`,
      `标题：${error.title}`,
      `信息：${error.message}`,
      error.hint ? `提示：${error.hint}` : "",
      error.raw ? `服务商原始返回：${error.raw}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const fallbackCopy = () => {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } catch {
        // ignore
      }
      document.body.removeChild(area);
    };

    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        fallbackCopy();
        done();
      });
    } else {
      fallbackCopy();
      done();
    }
  };
  const title = analysis?.quickview.meta.title && analysis.quickview.meta.title !== "未识别"
    ? analysis.quickview.meta.title
    : doc.fileName.replace(/\.pdf$/i, "");
  const meta = analysis?.quickview.meta;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pt-8 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            ← 换一篇论文
          </button>
          <h1 className="font-display mt-3 max-w-3xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {meta?.authors && meta.authors !== "未识别" ? meta.authors : "作者未识别"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {meta && meta.venue !== "未识别" && (
              <Badge variant="outline">{meta.venue}</Badge>
            )}
            {meta && meta.year !== "未识别" && <Badge variant="outline">{meta.year}</Badge>}
            {doc.pages && (
              <Badge variant="secondary" className="font-normal">
                {doc.pages} 页
              </Badge>
            )}
            <Badge variant="secondary" className="font-normal">
              {doc.mode === "token" ? "MinerU 精准解析" : "MinerU 轻量解析"}
            </Badge>
            {cacheHit && (
              <Badge variant="outline" className="border-primary/30 font-normal text-primary">
                本地缓存命中
              </Badge>
            )}
            {stats && stats.total > 0 && <CitationSummary stats={stats} />}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={onOpenSettings}>
            <Settings2 /> 设置
          </Button>
          <Button size="sm" onClick={onRegenerate} disabled={generating || !hasKey}>
            <RefreshCw className={cn(generating && "animate-spin")} />
            {analysis ? "重新生成" : "生成分析"}
          </Button>
        </div>
      </div>

      {generating && analysis && (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.05] px-4 py-3 text-xs text-primary">
          <RefreshCw className="size-3.5 animate-spin" />
          正在重新生成，当前仍显示上一次的结果。
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-destructive/25 bg-destructive/[0.04] p-5">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">{error.title}</p>
              <p className="mt-1 text-sm leading-6 text-foreground/80">{error.message}</p>
              {error.hint && (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{error.hint}</p>
              )}
              {error.raw && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground">
                    查看服务商原始返回
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-background/70 p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap">
                    {error.raw}
                  </pre>
                </details>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {error.kind === "need_key" || error.kind === "llm" || error.kind === "network" ? (
                  <Button size="sm" variant="outline" onClick={onOpenSettings}>
                    <Settings2 /> 检查设置
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={onRegenerate} disabled={generating || !hasKey}>
                  <RefreshCw /> 重试生成
                </Button>
                <Button size="sm" variant="ghost" onClick={copyDiagnostics}>
                  <Copy /> {copied ? "已复制" : "复制诊断信息"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!analysis ? (
        <ParseReady doc={doc} hasKey={hasKey} generating={generating} onRegenerate={onRegenerate} onOpenSettings={onOpenSettings} />
      ) : (
        <div className="mt-8 grid gap-10 lg:grid-cols-[168px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <nav className="sticky top-24 space-y-0.5">
              <p className="mb-2 px-2 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                阅读路径
              </p>
              {NAV.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <span className="font-mono text-[10px] text-border group-hover:text-primary">
                    {item.index}
                  </span>
                  {item.label}
                </a>
              ))}
              <div className="mt-4 border-t pt-3">
                <a
                  href="#raw"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ListTree className="size-3.5" /> 解析原文
                </a>
              </div>
            </nav>
          </aside>

          <div className="min-w-0 space-y-14">
            <QuickViewSection quickview={analysis.quickview} />
            <SkeletonSection skeleton={analysis.skeleton} />
            <RawMarkdown markdown={doc.markdown} />
          </div>
        </div>
      )}
    </main>
  );
}

function CitationSummary({ stats }: { stats: CitationStats }) {
  const ratio = stats.total > 0 ? stats.verified / stats.total : 0;
  const coverage = stats.units > 0 ? stats.unitsWithVerified / stats.units : 0;
  const good = ratio >= 0.8 && coverage >= 0.8;
  return (
    <>
      <Badge
        variant="outline"
        className={cn(
          "gap-1 font-normal",
          good ? "border-primary/30 text-primary" : "border-amber-500/40 text-amber-700",
        )}
        title="系统会在解析出的 Markdown 中逐条比对引文"
      >
        <CheckCircle2 className="size-3" />
        引用校验 {stats.verified}/{stats.total}
      </Badge>
      <Badge
        variant="outline"
        className={cn(
          "gap-1 font-normal",
          coverage >= 0.8 ? "border-primary/30 text-primary" : "border-amber-500/40 text-amber-700",
        )}
        title="至少有一条已验证引用的结论单元占比"
      >
        结论引用覆盖 {stats.unitsWithVerified}/{stats.units}
      </Badge>
    </>
  );
}

function ParseReady({
  doc,
  hasKey,
  generating,
  onRegenerate,
  onOpenSettings,
}: {
  doc: ParsedDoc;
  hasKey: boolean;
  generating: boolean;
  onRegenerate: () => void;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section className="mt-8 rounded-2xl border bg-card p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-primary" />
          <p className="text-sm font-medium">PDF 已解析完成</p>
        </div>
        <h2 className="font-display mt-3 text-2xl font-semibold">
          {hasKey ? "下一步：生成学习材料" : "还差一个模型 Key，就能生成学习材料"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          MinerU 已经把 PDF 重构成 {doc.markdown.length.toLocaleString()} 字符的结构化 Markdown。
          {hasKey
            ? "现在可以让模型生成速览卡和论证骨架，每条结论都会回链原文。"
            : "PaperTutor 使用 BYOK：填入你自己的 OpenAI 兼容接口 Key，Key 只保存在本机浏览器。"}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {!hasKey && (
            <Button onClick={onOpenSettings}>
              <Settings2 /> 配置模型 Key
            </Button>
          )}
          <Button variant={hasKey ? "default" : "outline"} onClick={onRegenerate} disabled={!hasKey || generating}>
            <Sparkles className={cn(generating && "animate-pulse")} />
            {generating ? "正在生成…" : "生成速览卡与论证骨架"}
          </Button>
        </div>
        <div className="mt-6 border-t pt-4">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={open}
          >
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            查看解析出的 Markdown
          </button>
          {open && (
            <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-secondary/60 p-4 font-mono text-[11px] leading-5 whitespace-pre-wrap">
              {doc.markdown.slice(0, 6000)}
              {doc.markdown.length > 6000 ? "\n\n…" : ""}
            </pre>
          )}
        </div>
      </section>
    </>
  );
}

function SectionTitle({
  index,
  eyebrow,
  title,
  description,
}: {
  index: string;
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-primary">{index}</span>
        <span className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          {eyebrow}
        </span>
      </div>
      <h2 className="font-display mt-2 text-2xl font-semibold tracking-tight">{title}</h2>
      {description && (
        <p className="mt-1.5 max-w-2xl text-xs leading-5 text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function QuickViewSection({ quickview }: { quickview: QuickView }) {
  return (
    <section id="quickview" className="scroll-mt-24">
      <SectionTitle
        index="00"
        eyebrow="Quick view"
        title="30 秒速览：这篇论文值不值得深读"
        description="先建立认知地图，再决定从哪一节开始。"
      />

      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
          <KeyBlock
            icon={<Target className="size-4" />}
            label="核心问题"
            text={quickview.coreQuestion}
          />
          <KeyBlock
            icon={<Sparkles className="size-4" />}
            label="核心贡献"
            text={quickview.coreContribution}
          />
          <KeyBlock
            icon={<Lightbulb className="size-4" />}
            label="方法概括"
            text={quickview.methodSummary}
          />
        </div>

        <div className="grid gap-8 border-t p-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-primary" />
              <h3 className="text-sm font-medium">前置知识清单</h3>
              <span className="text-[11px] text-muted-foreground">
                {quickview.prerequisites.length} 项
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              如果你不熟悉这些概念，先补哪、怎么补都在下面。
            </p>
            <div className="mt-3 space-y-2">
              {quickview.prerequisites.length === 0 && (
                <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                  模型没有给出前置知识清单。
                </p>
              )}
              {quickview.prerequisites.map((item, index) => (
                <PrerequisiteItem key={`${item.term}-${index}`} item={item} defaultOpen={index === 0} />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <Compass className="size-4 text-primary" />
              <h3 className="text-sm font-medium">建议阅读路径</h3>
            </div>
            <div className="mt-3 space-y-3">
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  先读这些
                </p>
                <ol className="mt-2 space-y-1.5">
                  {quickview.readingPath.first.length === 0 && (
                    <li className="text-xs text-muted-foreground">未给出</li>
                  )}
                  {quickview.readingPath.first.map((item, index) => (
                    <li key={`${item}-${index}`} className="flex gap-2 text-xs leading-5">
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[9px] text-primary">
                        {index + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
              {quickview.readingPath.keyFigure && (
                <div className="flex items-start gap-2 rounded-xl bg-primary/[0.05] p-3">
                  <Eye className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <div>
                    <p className="text-[11px] font-medium text-primary">核心图</p>
                    <p className="mt-1 text-xs leading-5">{quickview.readingPath.keyFigure}</p>
                  </div>
                </div>
              )}
              {quickview.readingPath.skip.length > 0 && (
                <div className="rounded-xl bg-secondary/50 p-3">
                  <p className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    <FastForward className="size-3" /> 可以暂时跳过
                  </p>
                  <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                    {quickview.readingPath.skip.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex gap-1.5">
                        <span className="text-border">–</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function KeyBlock({ icon, label, text }: { icon: ReactNode; label: string; text: string }) {
  return (
    <div className="p-5">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="text-[11px] font-medium tracking-[0.12em] uppercase">{label}</span>
      </div>
      <p className="mt-2.5 text-sm leading-6">{text || "未识别"}</p>
    </div>
  );
}

function PrerequisiteItem({ item, defaultOpen }: { item: Prerequisite; defaultOpen: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border bg-background/60">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
        <span className="min-w-0">
          <span className="text-[13px] font-medium">{item.term}</span>
          {item.english && (
            <span className="ml-1.5 text-[11px] text-muted-foreground">{item.english}</span>
          )}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t px-3 py-2.5 text-xs leading-5">
        <p>
          <span className="mr-1.5 font-medium text-primary">为什么需要</span>
          <span className="text-foreground/85">{item.why || "模型未说明"}</span>
        </p>
        {item.suggest && (
          <p>
            <span className="mr-1.5 font-medium text-primary">怎么补</span>
            <span className="text-foreground/85">{item.suggest}</span>
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function SkeletonSection({ skeleton }: { skeleton: Analysis["skeleton"] }) {
  return (
    <section id="skeleton" className="scroll-mt-24">
      <SectionTitle
        index="—"
        eyebrow="Argument map"
        title="论证骨架：这篇论文到底在干什么"
        description="按“问题 → 洞察 → 方法 → 实验 → 局限”逐站推进；每条结论都能展开对照原文。"
      />

      <div className="relative">
        <div className="absolute top-3 bottom-3 left-[15px] w-px bg-border" aria-hidden />
        <div className="space-y-8">
          <Station index="01" id="problem" title="问题与动机" icon={<Target className="size-4" />}>
            <p className="text-sm leading-7">{skeleton.problem.summary || "未识别"}</p>
            {skeleton.problem.importance && (
              <p className="mt-3 rounded-lg bg-secondary/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                <span className="font-medium text-foreground">为什么重要：</span>
                {skeleton.problem.importance}
              </p>
            )}
            {skeleton.problem.limitations.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                  现有方法的局限
                </p>
                <ul className="mt-2 space-y-1.5">
                  {skeleton.problem.limitations.map((item, index) => (
                    <li key={index} className="flex gap-2 text-[13px] leading-6">
                      <ArrowRight className="mt-1 size-3.5 shrink-0 text-primary/60" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Citations citations={skeleton.problem.citations} />
          </Station>

          <Station index="02" id="insight" title="核心洞察 / 假设" icon={<Lightbulb className="size-4" />}>
            <div className="rounded-xl border-l-[3px] border-primary bg-primary/[0.04] px-4 py-3">
              <p className="text-sm leading-7">{skeleton.insight.summary || "未识别"}</p>
            </div>
            <Citations citations={skeleton.insight.citations} />
          </Station>

          <Station index="03" id="method" title="方法模块" icon={<Boxes className="size-4" />}>
            <p className="mb-4 text-xs leading-5 text-muted-foreground">
              每个模块只看四件事：输入是什么、输出是什么、要达成什么、怎么交给下一步。
            </p>
            <div className="space-y-3">
              {skeleton.modules.length === 0 && (
                <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                  模型没有给出可拆分的模块。
                </p>
              )}
              {skeleton.modules.map((module, index) => (
                <ModuleCard key={`${module.name}-${index}`} module={module} index={index} />
              ))}
            </div>
          </Station>

          <Station index="04" id="experiments" title="实验验证" icon={<FlaskConical className="size-4" />}>
            <p className="mb-4 text-xs leading-5 text-muted-foreground">
              重点不是记住数字，而是看每个实验到底在支撑哪一条声称。
            </p>
            <div className="space-y-3">
              {skeleton.experiments.length === 0 && (
                <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                  模型没有给出实验映射。
                </p>
              )}
              {skeleton.experiments.map((experiment, index) => (
                <ExperimentCard key={`${experiment.name}-${index}`} experiment={experiment} />
              ))}
            </div>
          </Station>

          <Station index="05" id="limitations" title="局限与未解决的问题" icon={<AlertTriangle className="size-4" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border bg-background/60 p-4">
                <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                  作者自己承认
                </p>
                <ul className="mt-2 space-y-1.5 text-[13px] leading-6">
                  {skeleton.limitations.stated.length === 0 && (
                    <li className="text-xs text-muted-foreground">未识别</li>
                  )}
                  {skeleton.limitations.stated.map((item, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="text-border">–</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-dashed bg-background/40 p-4">
                <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                  可从方法推断
                </p>
                <ul className="mt-2 space-y-1.5 text-[13px] leading-6">
                  {skeleton.limitations.inferred.length === 0 && (
                    <li className="text-xs text-muted-foreground">未识别</li>
                  )}
                  {skeleton.limitations.inferred.map((item, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="text-border">–</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <Citations citations={skeleton.limitations.citations} />
          </Station>
        </div>
      </div>
    </section>
  );
}

function Station({
  index,
  id,
  title,
  icon,
  children,
}: {
  index: string;
  id: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="relative scroll-mt-24 pl-12">
      <div className="absolute top-0 left-0 z-10 flex size-8 items-center justify-center rounded-full border bg-card text-primary shadow-xs">
        {icon}
      </div>
      <div className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="font-mono text-[11px] text-primary">{index}</span>
          <h3 className="font-display text-lg font-semibold">{title}</h3>
        </div>
        {children}
      </div>
    </section>
  );
}

function ModuleCard({ module, index }: { module: MethodModule; index: number }) {
  return (
    <div className="rounded-xl border bg-background/60 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-[10px] text-primary">
          M{index + 1}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{module.name}</p>
          {module.role && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{module.role}</p>}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Field label="输入" value={module.input} />
        <Field label="输出" value={module.output} />
        <Field label="目标" value={module.goal} />
        {module.next && <Field label="衔接到下一步" value={module.next} />}
      </div>
      <Citations citations={module.citations} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 px-3 py-2">
      <p className="text-[10px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-xs leading-5">{value || "未说明"}</p>
    </div>
  );
}

function ExperimentCard({ experiment }: { experiment: Experiment }) {
  const badge =
    experiment.verdict === "supports"
      ? { label: "直接支持", className: "border-primary/30 text-primary" }
      : experiment.verdict === "partial"
        ? { label: "部分支持", className: "border-amber-500/40 text-amber-700" }
        : { label: "未直接覆盖", className: "border-destructive/30 text-destructive" };
  return (
    <div className="rounded-xl border bg-background/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{experiment.name}</p>
        <Badge variant="outline" className={cn("font-normal", badge.className)}>
          {badge.label}
        </Badge>
      </div>
      <div className="mt-3 space-y-2 text-[13px] leading-6">
        <p>
          <span className="mr-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            对应声称
          </span>
          {experiment.claim || "未说明"}
        </p>
        <p>
          <span className="mr-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            实际发现
          </span>
          {experiment.finding || "未说明"}
        </p>
      </div>
      <Citations citations={experiment.citations} />
    </div>
  );
}

function Citations({ citations }: { citations: Citation[] }) {
  if (!citations.length) {
    return (
      <p className="mt-3 text-[11px] text-muted-foreground">未在原文中精确定位相关段落</p>
    );
  }
  return (
    <div className="mt-3 space-y-1.5">
      {citations.map((citation, index) => (
        <CitationChip key={index} citation={citation} />
      ))}
    </div>
  );
}

function CitationChip({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
          citation.verified
            ? "border-primary/25 bg-primary/[0.04] text-primary hover:bg-primary/[0.08]"
            : "border-amber-500/35 bg-amber-50 text-amber-800 hover:bg-amber-100",
        )}
      >
        <Quote className="size-3" />
        <span className="truncate">{citation.section || "原文"}</span>
        {citation.verified ? (
          <CheckCircle2 className="size-3 shrink-0" />
        ) : (
          <AlertTriangle className="size-3 shrink-0" />
        )}
        <ChevronDown className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {!citation.verified && (
        <p className="mt-1 text-[10px] text-amber-700/80">
          未能在解析文本中精确匹配，请以原文为准
        </p>
      )}
      {open && (
        <blockquote className="mt-1.5 rounded-lg border-l-2 border-primary/40 bg-secondary/50 px-3 py-2 font-serif text-[12px] leading-5 text-foreground/80 italic">
          “{citation.quote}”
        </blockquote>
      )}
    </div>
  );
}

function RawMarkdown({ markdown, hidden }: { markdown: string; hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  return (
    <section id="raw" className="scroll-mt-24">
      <SectionTitle
        index="—"
        eyebrow="Source"
        title="解析出的 Markdown"
        description="这是 MinerU 从 PDF 还原出的结构化文本，所有引用都在这里做逐条比对。"
      />
      <div className="rounded-2xl border bg-card">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          aria-expanded={open}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <BookOpen className="size-4 text-primary" />
            {markdown.length.toLocaleString()} 字符 · 点击{open ? "收起" : "展开"}
          </span>
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <pre className="max-h-[560px] overflow-auto border-t bg-secondary/40 p-5 font-mono text-[11px] leading-5 whitespace-pre-wrap">
            {markdown}
          </pre>
        )}
      </div>
    </section>
  );
}