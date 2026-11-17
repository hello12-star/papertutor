import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Info, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { fetchHelpAnswer, fetchPredictions } from "@/lib/help-api";
import { helpCache } from "@/lib/help-cache";
import {
  bootstrapHelp,
  canRegenerate,
  helpSourceLabel,
  loadHelpAnswer,
  type HelpSource,
} from "@/lib/help-core";
import { getHelpEntry, type HelpAnswer, type HelpScreen, type HelpVariant } from "@/functions/help/registry.ts";
import { cn } from "@/lib/utils";

type HelpContextValue = {
  screen: HelpScreen;
  paperHash: string;
};

const HelpContext = createContext<HelpContextValue>({
  screen: "landing",
  paperHash: "landing",
});

export function HelpScope({
  screen,
  paperHash,
  children,
}: {
  screen: HelpScreen;
  paperHash: string;
  children: ReactNode;
}) {
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void bootstrapHelp({
        screen,
        paperHash,
        cache: helpCache,
        predictFetcher: fetchPredictions,
        answerFetcher: fetchHelpAnswer,
        isCancelled: () => cancelled,
      }).catch(() => undefined);
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [screen, paperHash]);

  return (
    <HelpContext.Provider value={{ screen, paperHash }}>{children}</HelpContext.Provider>
  );
}

export function HelpButton({
  helpId,
  className,
}: {
  helpId: string;
  className?: string;
}) {
  const { paperHash } = useContext(HelpContext);
  const entry = getHelpEntry(helpId);
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  if (!entry) return null;

  const iconButton = (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        setOpen(true);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      aria-label={`需要的话，可以看这里：${entry.label}`}
      title={`需要的话，可以看这里：${entry.label}`}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <Info className="size-3.5" />
    </button>
  );

  if (isMobile) {
    return (
      <>
        {iconButton}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[82vh] rounded-t-2xl p-0">
            <HelpPanel helpId={helpId} paperHash={paperHash} onClose={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{iconButton}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="z-[90] w-80 max-w-[calc(100vw-2rem)] p-0"
      >
        <HelpPanel helpId={helpId} paperHash={paperHash} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function HelpSection({ title, text }: { title: string; text: string }) {
  return (
    <section>
      <h4 className="text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
        {title}
      </h4>
      <p className="mt-1 break-words text-xs leading-5 text-foreground/85">{text}</p>
    </section>
  );
}

function HelpPanel({
  helpId,
  paperHash,
  onClose,
}: {
  helpId: string;
  paperHash: string;
  onClose: () => void;
}) {
  const entry = getHelpEntry(helpId);
  const [answer, setAnswer] = useState<HelpAnswer | null>(null);
  const [source, setSource] = useState<HelpSource>("fallback");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async (variant: HelpVariant) => {
    setLoading(true);
    setError(null);
    const result = await loadHelpAnswer({
      helpId,
      variant,
      paperHash,
      cache: helpCache,
      fetcher: fetchHelpAnswer,
    });
    setAnswer(result.answer);
    setSource(result.source);
    setError(result.error ?? null);
    setLoading(false);
  };

  useEffect(() => {
    void load("default");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helpId, paperHash]);

  const requestVariant = async (variant: HelpVariant) => {
    if (!canRegenerate(helpId)) {
      setNotice("这个控件已经重新生成过一次，先看当前说明。");
      return;
    }
    setNotice(null);
    await load(variant);
  };

  if (!entry) return null;

  return (
    <div className="flex max-h-[80vh] flex-col">
      <div className="shrink-0 border-b px-4 py-3">
        <p className="text-[11px] text-muted-foreground">需要的话，可以看这里</p>
        <div className="mt-1 flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold break-words">{entry.label}</h3>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {helpSourceLabel(source)}
          </Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && !answer ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            正在准备说明…
          </div>
        ) : answer ? (
          <div className="space-y-3">
            <HelpSection title="这是什么" text={answer.what} />
            <HelpSection title="为什么需要" text={answer.why} />
            <HelpSection title="点了会发生什么" text={answer.effect} />
            {answer.example && <HelpSection title="举个例子" text={answer.example} />}
          </div>
        ) : null}

        {source === "fallback" && error && (
          <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
            帮助服务暂时不可用，以上是内置说明。
          </p>
        )}
        {notice && <p className="mt-3 text-[10px] leading-4 text-amber-700">{notice}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
        <div className="flex gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => void requestVariant("simpler")}
            disabled={loading}
          >
            再简单点
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => void requestVariant("example")}
            disabled={loading}
          >
            举个例子
          </Button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          关闭
        </button>
      </div>
    </div>
  );
}