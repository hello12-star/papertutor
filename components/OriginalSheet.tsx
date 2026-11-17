import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { findQuoteRange } from "@/lib/citations";
import { cn } from "@/lib/utils";

type Target = {
  quote: string;
  section?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  markdown: string;
  target: Target | null;
};

export function OriginalSheet({ open, onOpenChange, title, markdown, target }: Props) {
  const range = useMemo(
    () => (target ? findQuoteRange(markdown, target.quote) : null),
    [markdown, target],
  );
  const markRef = useRef<HTMLElement | null>(null);
  const [highlight, setHighlight] = useState(false);

  useEffect(() => {
    if (!open || !range) return;
    setHighlight(true);
    const frame = requestAnimationFrame(() => {
      markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const timer = window.setTimeout(() => setHighlight(false), 2000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [open, range]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <SheetTitle className="font-display text-lg">原文定位</SheetTitle>
          <SheetDescription className="line-clamp-2 break-words text-xs">
            {target?.section ? `§${target.section} · ` : ""}
            {title} · 基于解析出的 Markdown 定位
          </SheetDescription>
        </SheetHeader>

        {target && !range && (
          <div className="shrink-0 border-b border-amber-500/30 bg-amber-50 px-5 py-3 text-xs leading-5 text-amber-900">
            未能在原文定位这句引文。下面仍展示解析出的 Markdown，你可以手动搜索。
            <blockquote className="mt-2 break-words border-l-2 border-amber-500/50 pl-2 font-serif text-[12px] italic">
              “{target.quote}”
            </blockquote>
          </div>
        )}

        {target && range && (
          <div className="shrink-0 border-b bg-secondary/40 px-5 py-2 text-[11px] text-muted-foreground">
            已定位 · 字符偏移 {range.start}–{range.end}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-foreground/85">
            {range ? (
              <>
                {markdown.slice(0, range.start)}
                <mark
                  ref={markRef}
                  className={cn(
                    "rounded px-0.5 text-foreground transition-colors duration-300",
                    highlight ? "bg-amber-300/80" : "bg-amber-100",
                  )}
                >
                  {markdown.slice(range.start, range.end)}
                </mark>
                {markdown.slice(range.end)}
              </>
            ) : (
              markdown
            )}
          </pre>
        </div>
      </SheetContent>
    </Sheet>
  );
}