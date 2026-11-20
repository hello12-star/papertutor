import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Info } from "lucide-react";
import { fetchHelpAnswer, fetchPredictions } from "@/lib/help-api";
import { helpCache } from "@/lib/help-cache";
import { bootstrapHelp } from "@/lib/help-core";
import { getHelpEntry, type HelpScreen } from "@/functions/help/registry.ts";
import { cn } from "@/lib/utils";

const HelpOverlay = lazy(() => import("@/components/HelpOverlay").then((module) => ({ default: module.HelpOverlay })));

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
  autoBootstrap = true,
  children,
}: {
  screen: HelpScreen;
  paperHash: string;
  autoBootstrap?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!autoBootstrap) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void bootstrapHelp({
        screen,
        paperHash,
        autoBootstrap,
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
  }, [screen, paperHash, autoBootstrap]);

  return (
    <HelpContext.Provider value={{ screen, paperHash }}>{children}</HelpContext.Provider>
  );
}

export function HelpButton({ helpId, className }: { helpId: string; className?: string }) {
  const { paperHash } = useContext(HelpContext);
  const entry = getHelpEntry(helpId);
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);

  if (!entry) return null;

  const iconButton = (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        setRequested(true);
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

  if (!requested) return iconButton;

  return (
    <Suspense fallback={<>{iconButton}<span role="status" className="sr-only">正在加载帮助…</span></>}>
      <HelpOverlay helpId={helpId} paperHash={paperHash} open={open} onOpenChange={setOpen} trigger={iconButton} />
    </Suspense>
  );
}
