import { useRef, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  FileText,
  Layers,
  ListChecks,
  ScanText,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Props = {
  onFile: (file: File) => void;
  onOpenSettings: () => void;
  hasKey: boolean;
  hasMineruToken: boolean;
};

const STEPS = [
  {
    icon: ScanText,
    index: "01",
    title: "解析成结构",
    body: "MinerU 把 PDF 重构为保留章节结构的 Markdown；精准模式下公式与表格也能更好还原。",
  },
  {
    icon: ListChecks,
    index: "02",
    title: "30 秒速览",
    body: "核心问题、核心贡献、方法概括、前置知识清单和建议阅读路径，先建立认知地图。",
  },
  {
    icon: Layers,
    index: "03",
    title: "拆开论证",
    body: "问题 → 洞察 → 模块 → 实验 → 局限，每一步都带可回查的原文引用。",
  },
];

export function Landing({ onFile, onOpenSettings, hasKey, hasMineruToken }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = () => inputRef.current?.click();

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pt-10 pb-20">
      <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr]">
        <section>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
              StudyHack · ML 论文陪读
            </Badge>
            <Badge variant="outline" className="text-muted-foreground">
              面向大二 / 大三初学者
            </Badge>
          </div>

          <h1 className="font-display mt-6 text-[2.7rem] leading-[1.12] font-semibold tracking-tight sm:text-5xl">
            读论文最难的，
            <br />
            不是英文。
            <span className="relative ml-1 inline-block text-primary">
              是不知道
              <span className="absolute -bottom-1 left-0 h-[3px] w-full rounded-full bg-primary/25" />
            </span>
            <br />
            自己在读什么。
          </h1>

          <p className="mt-6 max-w-lg text-[15px] leading-7 text-muted-foreground">
            陌生术语逼你跳出页面去搜，搜完又接不上；作者在解决什么问题、每一步为什么这样做，
            全都藏在文字背后。PaperTutor 把一篇论文重构成
            <span className="font-medium text-foreground">能跟着学下去的材料</span>
            ，而不是再给你一段摘要。
          </p>

          <ul className="mt-7 grid gap-3 text-sm sm:grid-cols-2">
            <li className="flex items-start gap-2.5">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>先速览、再精读的阅读节奏</span>
            </li>
            <li className="flex items-start gap-2.5">
              <BookOpenCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>前置知识清单，缺什么补什么</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Layers className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>方法模块的输入 / 输出 / 目标</span>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>每条结论回链原文，逐条校验</span>
            </li>
          </ul>
        </section>

        <section className="relative">
          <div className="absolute -inset-3 -z-10 rounded-[26px] bg-primary/[0.045]" />
          <div
            className={cn(
              "paper-texture rounded-2xl border bg-card p-6 shadow-[0_24px_60px_-38px_rgba(29,39,51,0.45)] transition-colors sm:p-7",
              dragging && "border-primary bg-primary/[0.04]",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleFiles(event.dataTransfer.files);
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
                  Upload
                </p>
                <h2 className="font-display mt-1 text-2xl font-semibold">上传一篇论文</h2>
              </div>
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <UploadCloud className="size-5" />
              </div>
            </div>

            <button
              type="button"
              onClick={pick}
              className="mt-5 flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/60 px-5 py-9 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.03]"
            >
              <FileText className="size-7 text-muted-foreground" />
              <span className="text-sm font-medium">把 PDF 拖到这里，或点击选择文件</span>
              <span className="text-xs text-muted-foreground">
                NeurIPS / ICML / ICLR / CVPR 等英文论文都可以
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                handleFiles(event.target.files);
                event.target.value = "";
              }}
            />

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="secondary" className="font-normal">
                ≤ 10MB / 20 页 · 免 Token
              </Badge>
              <Badge variant="secondary" className="font-normal">
                {hasMineruToken ? "MinerU 精准模式已开启" : "保留章节结构"}
              </Badge>
              <Badge variant="secondary" className="font-normal">
                同文件本地缓存
              </Badge>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-muted-foreground">配置</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {hasKey ? "模型已配置" : "还差一个模型 Key"}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {hasKey
                    ? "Key 只存在本地浏览器，分析时直接调用你选择的模型"
                    : "Bring Your Own Key：DeepSeek / 百炼 / SiliconFlow / OpenRouter"}
                </p>
              </div>
              <Button
                type="button"
                variant={hasKey ? "ghost" : "default"}
                size="sm"
                onClick={onOpenSettings}
              >
                {hasKey ? "修改" : "去配置"}
                <ArrowRight />
              </Button>
            </div>

            <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
              解析用时通常 15–60 秒。同一个文件会命中本地缓存，不会重复消耗 MinerU 额度。
            </p>
          </div>
        </section>
      </div>

      <section className="mt-16 grid gap-4 border-t pt-8 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.index} className="rounded-xl border bg-card/70 p-5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">{step.index}</span>
              <step.icon className="size-4 text-primary" />
              <span className="text-sm font-medium">{step.title}</span>
            </div>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">{step.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-10 flex flex-col items-start justify-between gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center">
        <p>不是“AI 替你读完”，而是把读论文的门槛降到你能自己走进去。</p>
        <p className="font-mono">PaperTutor · Stage 1</p>
      </section>
    </main>
  );
}