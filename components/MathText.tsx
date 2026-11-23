import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";
import { normalizeLatex } from "@/lib/math";
import { cn } from "@/lib/utils";

function render(tex: string, displayMode: boolean): string | null {
  const source = normalizeLatex(tex);
  if (!source) return null;
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      strict: false,
      trust: false,
      output: "html",
      maxSize: 24,
      maxExpand: 1000,
    });
  } catch {
    return null;
  }
}

export function MathBlock({ tex, className }: { tex: string; className?: string }) {
  const html = useMemo(() => render(tex, true), [tex]);
  if (!html) {
    return (
      <pre
        className={cn(
          "overflow-x-auto rounded-lg bg-secondary/60 px-3 py-2 font-mono text-[12px] leading-6 break-words whitespace-pre-wrap",
          className,
        )}
      >
        {tex}
      </pre>
    );
  }
  return (
    <div
      className={cn("overflow-x-auto px-1 py-1", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function MathInline({ tex }: { tex: string }) {
  const html = useMemo(() => render(tex, false), [tex]);
  if (!html) return <code className="rounded bg-secondary/60 px-1 font-mono text-[0.92em]">{tex}</code>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
