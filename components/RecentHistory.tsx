import { useEffect, useState } from "react";
import { Clock, History, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearHistory, deleteHistory, listHistory } from "@/lib/history-db";
import type { HistoryRecord } from "@/lib/history-core";

export function RecentHistory({ onOpen }: { onOpen: (record: HistoryRecord) => void }) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const next = await listHistory();
    setRecords(next);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const remove = async (paperHash: string) => {
    await deleteHistory(paperHash);
    await load();
  };

  const clearAll = async () => {
    if (!window.confirm("清空最近分析记录？本机保存的标题、分析与原文将一并删除。")) return;
    await clearHistory();
    await load();
  };

  return (
    <section className="mt-12 border-t pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <History className="size-4 text-primary" />
            <h2 className="font-display text-xl font-semibold">最近分析</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            保存在本机 IndexedDB，最多 10 条；刷新后仍在。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} /> 刷新
          </Button>
          {records.length > 0 && (
            <Button type="button" variant="ghost" size="xs" onClick={() => void clearAll()}>
              <Trash2 /> 清空
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {records.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card/60 px-4 py-5 text-xs leading-5 text-muted-foreground">
            还没有记录。完成一次分析后会自动保存，最多保留 10 条。
          </p>
        ) : (
          records.map((record) => (
            <div
              key={record.paperHash}
              className="flex items-center gap-3 rounded-xl border bg-card p-3"
            >
              <button
                type="button"
                onClick={() => onOpen(record)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium">{record.title}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" />
                    {new Date(record.createdAt).toLocaleString()}
                  </span>
                  <span className="font-mono">{record.paperHash.slice(0, 10)}</span>
                  <span>{record.doc.pages ?? "?"} 页</span>
                </p>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void remove(record.paperHash)}
                aria-label={`删除 ${record.title}`}
              >
                <Trash2 />
                删除
              </Button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}