import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ModelCheck } from "@/lib/model-check";
import type { ModelListStatus, ModelOption } from "@/lib/models";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  options: ModelOption[];
  status: ModelListStatus;
  checks: Record<string, ModelCheck | undefined>;
  testing: Record<string, boolean | undefined>;
  onChange: (value: string) => void;
  onOpen: () => void;
  onRefresh: () => void;
  onTest: (id: string) => void;
  hasKey: boolean;
};

function HealthIcon({ check, testing }: { check?: ModelCheck; testing?: boolean }) {
  if (testing) return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
  if (check?.state === "ok") return <CheckCircle2 className="size-3.5 text-emerald-600" />;
  if (check?.state === "error") return <XCircle className="size-3.5 text-destructive" />;
  return <span className="block size-1.5 rounded-full bg-border" aria-hidden />;
}

export function ModelPicker({
  value,
  options,
  status,
  checks,
  testing,
  onChange,
  onOpen,
  onRefresh,
  onTest,
  hasKey,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return options.slice(0, 80);
    return options.filter((option) => option.id.toLowerCase().includes(text)).slice(0, 80);
  }, [options, query]);

  const exact = filtered.some((option) => option.id === query.trim());
  const custom = query.trim() && !exact ? query.trim() : "";
  const current = options.find((option) => option.id === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const toggle = () => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      onOpen();
    }
    setOpen((value) => !value);
  };

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, filtered.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (custom) choose(custom);
      else if (filtered[activeIndex]) choose(filtered[activeIndex].id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        onClick={toggle}
        className="h-auto min-h-9 w-full justify-between gap-3 py-2 font-normal"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-left">
          <HealthIcon check={checks[value]} testing={testing[value]} />
          <span
            className={cn(
              "max-w-full truncate font-mono text-xs",
              !value && "font-sans text-sm text-muted-foreground",
            )}
          >
            {value || "从可用模型中选择"}
          </span>
          {current?.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px]",
                tag === "推荐" || tag === "综合推荐"
                  ? "bg-primary/10 text-primary"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {tag}
            </span>
          ))}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </Button>

      {open && (
        <div className="mt-2 overflow-hidden rounded-lg border bg-popover shadow-md">
          <div className="flex items-center gap-1 border-b px-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="搜索模型，例如 qwen-plus、deepseek"
              className="h-9 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={onRefresh}
              disabled={!hasKey || status.state === "loading"}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              aria-label="刷新模型列表"
              title={hasKey ? "重新拉取模型列表" : "先填入 API Key"}
            >
              <RefreshCw className={cn("size-3.5", status.state === "loading" && "animate-spin")} />
            </button>
          </div>

          <div className="flex items-center gap-1.5 border-b bg-secondary/40 px-3 py-1.5 text-[10px] leading-4 text-muted-foreground">
            {status.state === "loading" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : status.state === "error" ? (
              <TriangleAlert className="size-3 text-amber-600" />
            ) : (
              <Sparkles className="size-3 text-primary" />
            )}
            <span className="min-w-0 flex-1">{status.message}</span>
            {status.source === "api" && status.state === "ready" && (
              <span className="shrink-0 font-mono">API</span>
            )}
          </div>

          <div role="listbox" aria-label="可用模型" className="max-h-60 overflow-y-auto p-1">
            {custom && (
              <button
                type="button"
                onClick={() => choose(custom)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent"
              >
                <span className="flex size-4 items-center justify-center rounded border border-dashed border-primary/50 text-primary">
                  +
                </span>
                <span>
                  使用自定义模型名
                  <span className="ml-1 font-mono text-foreground">{custom}</span>
                </span>
              </button>
            )}

            {filtered.map((option, index) => {
              const check = checks[option.id];
              const isTesting = testing[option.id];
              return (
                <div
                  key={option.id}
                  role="option"
                  aria-selected={value === option.id}
                  tabIndex={0}
                  onClick={() => choose(option.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(option.id);
                    }
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-left outline-none",
                    index === activeIndex && "bg-accent",
                  )}
                >
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                    {value === option.id ? (
                      <Check className="size-4 text-primary" />
                    ) : (
                      <HealthIcon check={check} testing={isTesting} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-[11px] text-foreground">
                        {option.id}
                      </span>
                      {check?.state === "ok" && check.latencyMs != null && (
                        <span className="shrink-0 text-[10px] text-emerald-700">
                          {check.latencyMs}ms
                        </span>
                      )}
                    </span>
                    {option.tags.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {option.tags.map((tag) => (
                          <span
                            key={tag}
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px]",
                              tag === "推荐" || tag === "综合推荐"
                                ? "bg-primary/10 text-primary"
                                : "bg-secondary text-muted-foreground",
                            )}
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                    {check?.state === "error" && (
                      <span className="mt-1 block text-[10px] leading-4 text-destructive/90">
                        {check.message ?? "不可用"}
                        {check.detail ? (
                          <span className="text-muted-foreground"> · 展开详情请见下方</span>
                        ) : null}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onTest(option.id);
                    }}
                    disabled={isTesting || !hasKey}
                    className="mt-0.5 rounded p-1 text-muted-foreground opacity-70 hover:bg-background hover:text-primary hover:opacity-100 disabled:opacity-40"
                    title={hasKey ? "检测这个模型是否真的可调用" : "先填入 API Key"}
                    aria-label={`检测 ${option.id}`}
                  >
                    {isTesting ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                  </button>
                </div>
              );
            })}

            {!filtered.length && !custom && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {status.state === "loading"
                  ? "正在获取模型列表…"
                  : "没有匹配的模型，可直接输入模型名后回车"}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="size-3 text-emerald-600" /> 可用
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="size-3 text-destructive" /> 不可用
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-border" /> 未检测
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-[10px] text-muted-foreground">
            <span className="truncate">
              {status.source === "api"
                ? "列表来自你的 Key；没有的模型可直接输入完整名称后回车"
                : hasKey
                  ? "当前展示常用模型；Key 校验通过后会替换为完整列表"
                  : "填入 API Key 后可拉取真实可用模型"}
            </span>
            <span className="shrink-0 font-mono">{filtered.length}</span>
          </div>
        </div>
      )}
    </div>
  );
}