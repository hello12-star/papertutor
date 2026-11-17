import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  FileText,
  Loader2,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes, formatElapsed } from "@/lib/files";
import type { AppError, Phase } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  fileName: string;
  fileSize: number;
  phases: Phase[];
  error: AppError | null;
  onOpenSettings: () => void;
  onBack: () => void;
};

const WEIGHTS: Record<string, number> = {
  read: 8,
  parse: 47,
  quickview: 22,
  skeleton: 23,
};

function percent(phases: Phase[]): number {
  let value = 0;
  for (const phase of phases) {
    const weight = WEIGHTS[phase.key] ?? 0;
    if (phase.status === "done") value += weight;
    else if (phase.status === "active") value += weight * 0.45;
  }
  return Math.min(99, Math.round(value));
}

export function ProgressView({ fileName, fileSize, phases, error, onOpenSettings, onBack }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (error) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [error]);

  const value = percent(phases);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14">
      <div className="rounded-2xl border bg-card p-6 shadow-[0_20px_50px_-40px_rgba(29,39,51,0.5)] sm:p-8">
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Working
        </p>
        <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight">
          正在把这篇论文重构成学习材料
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          解析和生成都在你的浏览器里直接调用，请不要关闭这个页面。
        </p>

        <div className="mt-5 flex items-center gap-3 rounded-xl bg-secondary/60 px-4 py-3">
          <FileText className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{fileName}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(fileSize)} · 已用 {formatElapsed(elapsed)}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <Progress value={value} className="h-1.5" />
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>{error ? "流程已中断" : "四步流水线"}</span>
            <span>{value}%</span>
          </div>
        </div>

        <ol className="mt-6 space-y-1">
          {phases.map((phase) => (
            <li
              key={phase.key}
              className={cn(
                "flex items-start gap-3 rounded-lg px-3 py-3",
                phase.status === "active" && "bg-primary/[0.045]",
              )}
            >
              <span className="mt-0.5">
                {phase.status === "done" && <CheckCircle2 className="size-4 text-primary" />}
                {phase.status === "active" && <Loader2 className="size-4 animate-spin text-primary" />}
                {phase.status === "pending" && <Circle className="size-4 text-border" />}
                {phase.status === "error" && <AlertCircle className="size-4 text-destructive" />}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-sm font-medium",
                    phase.status === "pending" && "text-muted-foreground",
                  )}
                >
                  {phase.label}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {phase.detail || "等待上一步完成"}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {error && (
          <div className="mt-5 rounded-xl border border-destructive/25 bg-destructive/[0.04] p-4">
            <div className="flex items-start gap-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-destructive">{error.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{error.message}</p>
                {error.hint && (
                  <p className="mt-2 text-xs leading-5 text-foreground/80">{error.hint}</p>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {error.kind === "need_key" && (
                <Button size="sm" onClick={onOpenSettings}>
                  <Settings2 /> 打开设置
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={onBack}>
                换一篇论文
              </Button>
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        解析结果会缓存在本机；生成分析时会把论文 Markdown 发送给你配置的模型服务。
      </p>
    </main>
  );
}