import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Loader2,
  ServerCog,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelPicker } from "@/components/ModelPicker";
import { matchPreset, PRESETS, type Settings } from "@/lib/settings";
import {
  curatedModels,
  loadModelOptions,
  providerLabel,
  type ModelListStatus,
  type ModelOption,
} from "@/lib/models";
import { testConnection, LlmError } from "@/lib/llm";
import { generateQuickview } from "@/lib/analysis";
import {
  cachedModelCheck,
  recordModelCheck,
  verifyModel,
  verifyModels,
  type ModelCheck,
} from "@/lib/model-check";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClearCache?: () => void;
};

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

type BatchState = {
  running: boolean;
  done: number;
  total: number;
};

const SAMPLE_PAPER = `# Sparse Attention for Long Documents

## Abstract
We study how sparse attention reduces compute for long-document classification. We propose a block-sparse attention layer that selects the top-k blocks per query. On three benchmarks, it matches dense attention while using 38% less compute.

## 1 Introduction
Transformer attention scales quadratically with sequence length. Long documents therefore require approximations. Prior work uses fixed patterns or low-rank projections, but these can miss long-range evidence.

## 2 Method
Our layer partitions the sequence into blocks of 64 tokens. A lightweight scorer ranks blocks for each query block, and attention is computed only over the top-8 blocks. The scorer is trained jointly with the main model.

## 3 Experiments
We evaluate on three document classification datasets. The proposed layer matches dense attention within 0.4 accuracy points while reducing FLOPs by 38%. Ablations show that top-8 blocks are sufficient; top-4 degrades accuracy by 1.2 points.

## 4 Limitations
The scorer adds a small overhead for short sequences, and the block size must be tuned per dataset.`;

export function SettingsDialog({ open, onOpenChange, settings, onSave, onClearCache }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [showMineru, setShowMineru] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [models, setModels] = useState<ModelOption[]>(() => curatedModels(settings.baseUrl));
  const [modelStatus, setModelStatus] = useState<ModelListStatus>({
    state: "idle",
    message: "填入 API Key 后，可拉取这个 Key 实际可用的模型",
  });
  const [checks, setChecks] = useState<Record<string, ModelCheck | undefined>>({});
  const [testing, setTesting] = useState<Record<string, boolean | undefined>>({});
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [batchSummary, setBatchSummary] = useState<{ ok: number; total: number; label: string } | null>(
    null,
  );
  const [deep, setDeep] = useState<TestState>({ status: "idle" });
  const fetchSeq = useRef(0);
  const lastFetched = useRef("");
  const batchAbort = useRef<AbortController | null>(null);

  const activePreset = matchPreset(draft.baseUrl);
  const currentCheck = checks[draft.model.trim()];
  const firstAvailable = models.find((option) => checks[option.id]?.state === "ok");
  const modelMismatch =
    modelStatus.source === "api" &&
    modelStatus.state === "ready" &&
    Boolean(draft.model.trim()) &&
    !models.some((option) => option.id === draft.model.trim());

  const seedChecks = (list: ModelOption[], source: Settings) => {
    const next: Record<string, ModelCheck | undefined> = {};
    for (const option of list) {
      const cached = cachedModelCheck(source, option.id);
      if (cached) next[option.id] = cached;
    }
    setChecks(next);
  };

  const refreshModels = async (force: boolean, override?: Settings) => {
    const target = override ?? draft;
    if (!target.apiKey.trim()) {
      const list = curatedModels(target.baseUrl);
      setModels(list);
      seedChecks(list, target);
      setModelStatus({
        state: "idle",
        message: "填入 API Key 后，可拉取这个 Key 实际可用的模型",
      });
      return;
    }
    const signature = `${target.baseUrl.replace(/\/+$/, "")}|${target.apiKey.trim()}`;
    if (!force && lastFetched.current === signature) return;

    const seq = ++fetchSeq.current;
    setModelStatus({ state: "loading", message: "正在向服务商拉取模型列表…" });
    try {
      const result = await loadModelOptions(target);
      if (seq !== fetchSeq.current) return;
      setModels(result.options);
      seedChecks(result.options, target);
      setModelStatus({ state: "ready", message: result.message, source: result.source });
      lastFetched.current = signature;
    } catch (error) {
      if (seq !== fetchSeq.current) return;
      const list = curatedModels(target.baseUrl);
      setModels(list);
      seedChecks(list, target);
      if (error instanceof LlmError && error.code === "invalid_key") {
        setModelStatus({ state: "error", message: "Key 无效（401），修正后会自动重新拉取" });
      } else {
        setModelStatus({ state: "error", message: "拉取模型列表失败，已展示常用模型" });
      }
    }
  };

  useEffect(() => {
    if (!open) {
      batchAbort.current?.abort();
      batchAbort.current = null;
      setBatch(null);
      return;
    }
    setDraft(settings);
    setTest({ status: "idle" });
    setDeep({ status: "idle" });
    setChecks({});
    setTesting({});
    setBatchSummary(null);
    const list = curatedModels(settings.baseUrl);
    setModels(list);
    seedChecks(list, settings);
    setModelStatus({
      state: "idle",
      message: "填入 API Key 后，可拉取这个 Key 实际可用的模型",
    });
    lastFetched.current = "";
    if (settings.apiKey.trim()) {
      void refreshModels(false, settings);
    }
    // refreshModels 依赖 draft，首次打开用传入的 settings 覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings]);

  const update = (patch: Partial<Settings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setTest({ status: "idle" });
  };

  const handleApiKeyChange = (apiKey: string) => {
    setDraft((current) => ({ ...current, apiKey }));
    setTest({ status: "idle" });
    setDeep({ status: "idle" });
    setChecks({});
    setBatchSummary(null);
    lastFetched.current = "";
  };

  const updateBaseUrl = (baseUrl: string) => {
    setDraft((current) => ({ ...current, baseUrl }));
    setTest({ status: "idle" });
    setDeep({ status: "idle" });
    setChecks({});
    setBatchSummary(null);
    const list = curatedModels(baseUrl);
    setModels(list);
    seedChecks(list, { ...draft, baseUrl });
    setModelStatus({
      state: "idle",
      message: "填入 API Key 后，可拉取这个 Key 实际可用的模型",
    });
    lastFetched.current = "";
  };

  const applyPreset = (presetId: string) => {
    const preset = PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const next: Settings = { ...draft, baseUrl: preset.baseUrl, model: preset.model };
    setDraft(next);
    setTest({ status: "idle" });
    setDeep({ status: "idle" });
    setChecks({});
    setBatchSummary(null);
    const list = curatedModels(preset.baseUrl);
    setModels(list);
    seedChecks(list, next);
    setModelStatus({
      state: "idle",
      message: "填入 API Key 后，可拉取这个 Key 实际可用的模型",
    });
    lastFetched.current = "";
    if (next.apiKey.trim()) void refreshModels(true, next);
  };

  const checkOne = async (id: string): Promise<ModelCheck> => {
    if (!draft.apiKey.trim()) {
      const check: ModelCheck = {
        state: "error",
        message: "没有填入 API Key",
        checkedAt: Date.now(),
      };
      setChecks((current) => ({ ...current, [id]: check }));
      return check;
    }
    setTesting((current) => ({ ...current, [id]: true }));
    const check = await verifyModel(draft, id, { force: true });
    setTesting((current) => ({ ...current, [id]: false }));
    setChecks((current) => ({ ...current, [id]: check }));
    return check;
  };

  const runTest = async () => {
    setTest({ status: "testing" });
    try {
      await testConnection(draft);
      if (!draft.model.trim()) {
        setTest({ status: "ok", message: "Key 可用；请选择一个模型后再验证" });
        void refreshModels(true, draft);
        return;
      }
      const check = await checkOne(draft.model);
      if (check.state === "ok") {
        setTest({
          status: "ok",
          message: `Key 可用 · ${draft.model} 可真实调用（${check.latencyMs ?? "?"}ms）`,
        });
      } else {
        setTest({
          status: "error",
          message: `Key 可用，但 ${draft.model} 不可用：${check.message ?? "调用失败"}`,
        });
      }
      void refreshModels(true, draft);
    } catch (error) {
      const messages: Record<string, string> = {
        invalid_key: "Key 无效（401）",
        forbidden: "没有权限（403）",
        network_or_cors: "网络或跨域失败，请检查 Base URL 是否可访问",
        timeout: "连接超时",
      };
      const message =
        error instanceof LlmError
          ? (messages[error.code] ?? `连接失败：${error.code}`)
          : "连接失败";
      setTest({ status: "error", message });
    }
  };

  const runBatch = async (scope: "recommended" | "all") => {
    if (!draft.apiKey.trim()) {
      setTest({ status: "error", message: "先填入 API Key，再检测模型" });
      return;
    }
    if (batch?.running) return;
    const limit = scope === "recommended" ? 12 : 60;
    const ids = models.slice(0, limit).map((option) => option.id);
    if (ids.length === 0) return;

    const controller = new AbortController();
    batchAbort.current = controller;
    setBatch({ running: true, done: 0, total: ids.length });
    setBatchSummary(null);
    setTesting((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = true;
      return next;
    });

    const results: Record<string, ModelCheck> = {};
    let okCount = 0;
    try {
      await verifyModels(
        draft,
        ids,
        (id, check) => {
          results[id] = check;
          if (check.state === "ok") okCount += 1;
          setChecks((current) => ({ ...current, [id]: check }));
          setTesting((current) => ({ ...current, [id]: false }));
          setBatch((current) =>
            current ? { ...current, done: current.done + 1 } : current,
          );
        },
        { concurrency: 4, signal: controller.signal },
      );
    } finally {
      setBatch((current) => (current ? { ...current, running: false } : current));
      setTesting((current) => {
        const next = { ...current };
        for (const id of ids) next[id] = false;
        return next;
      });
      if (!controller.signal.aborted) {
        setBatchSummary({
          ok: okCount,
          total: ids.length,
          label: scope === "recommended" ? "推荐模型" : "全部模型",
        });
      }
      batchAbort.current = null;
    }
  };

  const stopBatch = () => {
    batchAbort.current?.abort();
    setBatch((current) => (current ? { ...current, running: false } : current));
  };

  const runDeepCheck = async () => {
    const model = draft.model.trim();
    if (!model) {
      setDeep({ status: "error", message: "先选择一个模型" });
      return;
    }
    if (!draft.apiKey.trim()) {
      setDeep({ status: "error", message: "先填入 API Key" });
      return;
    }
    setDeep({ status: "testing" });
    const started = performance.now();
    try {
      await generateQuickview(SAMPLE_PAPER, draft);
      const check: ModelCheck = {
        state: "ok",
        message: "深度生成通过",
        checkedAt: Date.now(),
      };
      setChecks((current) => ({ ...current, [model]: check }));
      recordModelCheck(draft, model, check);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      setDeep({
        status: "ok",
        message: `${model} 已完成一次真实 JSON 生成（${seconds} 秒）`,
      });
    } catch (error) {
      const info = error instanceof LlmError ? error : null;
      const message = info
        ? `深度生成失败：${info.code}${info.detail ? ` · ${info.detail.slice(0, 120)}` : ""}`
        : "深度生成失败";
      const check: ModelCheck = {
        state: "error",
        message: info ? `深度生成失败：${info.code}` : "深度生成失败",
        detail: info?.raw ?? info?.detail ?? String(error),
        checkedAt: Date.now(),
      };
      setChecks((current) => ({ ...current, [model]: check }));
      recordModelCheck(draft, model, check);
      setDeep({ status: "error", message: `${message}（详情见上方当前模型）` });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">模型与解析设置</DialogTitle>
          <DialogDescription>
            模型 Key 只保存在你的浏览器 localStorage，不会回传到 PaperTutor 的服务器。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="size-4 text-primary" />
              AI 模型（OpenAI 兼容接口）
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    activePreset?.id === preset.id
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-accent",
                  )}
                >
                  <span className="block text-sm font-medium">{preset.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                    {preset.note}
                  </span>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="base-url">Base URL</Label>
              <Input
                id="base-url"
                value={draft.baseUrl}
                onChange={(event) => updateBaseUrl(event.target.value)}
                onBlur={() => {
                  if (draft.apiKey.trim()) void refreshModels(false);
                }}
                placeholder="https://api.deepseek.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <div className="relative">
                <Input
                  id="api-key"
                  type={showKey ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(event) => handleApiKeyChange(event.target.value)}
                  onBlur={() => {
                    if (draft.apiKey.trim()) void refreshModels(false);
                  }}
                  placeholder="sk-..."
                  className="pr-9"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((value) => !value)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showKey ? "隐藏 Key" : "显示 Key"}
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                填入 Key 后会调用 {providerLabel(draft.baseUrl)} 的 /models
                拉取这个 Key 实际可用的模型；Key 通过只代表能列模型，模型是否真能调用要在下面单独检测。
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>模型</Label>
                <span className="text-[10px] text-muted-foreground">
                  {providerLabel(draft.baseUrl)}
                </span>
              </div>
              <ModelPicker
                value={draft.model}
                options={models}
                status={modelStatus}
                checks={checks}
                testing={testing}
                onChange={(model) => update({ model })}
                onOpen={() => void refreshModels(false)}
                onRefresh={() => void refreshModels(true)}
                onTest={(id) => void checkOne(id)}
                hasKey={Boolean(draft.apiKey.trim())}
              />
              {modelMismatch && (
                <p className="text-[11px] leading-5 text-amber-700">
                  当前模型名不在这个 Key 返回的列表中，建议从上方列表重新选择；直接使用可能返回 404。
                </p>
              )}

              {currentCheck?.state === "ok" && (
                <p className="flex items-center gap-1 text-[11px] text-emerald-700">
                  <CheckCircle2 className="size-3.5" />
                  已实际调用成功{currentCheck.latencyMs ? ` · ${currentCheck.latencyMs}ms` : ""}
                </p>
              )}
              {currentCheck?.state === "error" && (
                <div className="rounded-lg border border-destructive/25 bg-destructive/[0.04] p-3">
                  <p className="text-[11px] font-medium text-destructive">
                    当前模型不可用：{currentCheck.message ?? "调用失败"}
                  </p>
                  {currentCheck.detail && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] text-muted-foreground">
                        查看服务商返回
                      </summary>
                      <pre className="mt-1 max-h-28 overflow-auto rounded bg-background/70 p-2 text-[10px] leading-4 whitespace-pre-wrap">
                        {currentCheck.detail}
                      </pre>
                    </details>
                  )}
                  {firstAvailable && firstAvailable.id !== draft.model.trim() && (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="mt-2"
                      onClick={() => update({ model: firstAvailable.id })}
                    >
                      改用已验证可用的 {firstAvailable.id}
                    </Button>
                  )}
                </div>
              )}

              <p className="text-[11px] leading-5 text-muted-foreground">
                排序会优先长上下文、指令遵循和性价比，Qwen3.8-Flash 这类百万上下文模型会排在前面；列表里没有的模型，直接输入完整模型名并回车即可。
              </p>
            </div>

            <div className="space-y-2 rounded-lg border bg-secondary/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={runTest}
                  disabled={test.status === "testing" || !draft.apiKey.trim()}
                >
                  {test.status === "testing" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ServerCog />
                  )}
                  测试 Key 与模型
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void runBatch("recommended")}
                  disabled={!draft.apiKey.trim() || Boolean(batch?.running)}
                >
                  <FlaskConical /> 检测推荐模型
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void runBatch("all")}
                  disabled={!draft.apiKey.trim() || Boolean(batch?.running)}
                >
                  <FlaskConical /> 检测全部模型
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void runDeepCheck()}
                  disabled={
                    !draft.apiKey.trim() ||
                    !draft.model.trim() ||
                    Boolean(batch?.running) ||
                    deep.status === "testing"
                  }
                >
                  {deep.status === "testing" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <FlaskConical />
                  )}
                  深度生成检测
                </Button>
                {batch?.running && (
                  <Button type="button" size="xs" variant="ghost" onClick={stopBatch}>
                    停止
                  </Button>
                )}
              </div>
              <p className="text-[10px] leading-4 text-muted-foreground">
                检测会给每个模型发一次极小的真实请求（约几十 token，不读取论文）；深度生成检测会用一段样例论文真实跑一次 JSON 生成（约 1–2k token），能发现“ping 通但生成失败”的问题。
              </p>
              {batch && (
                <p className="text-[11px] text-muted-foreground">
                  检测进度 {batch.done}/{batch.total}
                  {batch.running ? "…" : "（已结束）"}
                </p>
              )}
              {batchSummary && (
                <p
                  className={cn(
                    "text-[11px]",
                    batchSummary.ok > 0 ? "text-emerald-700" : "text-destructive",
                  )}
                >
                  本轮{batchSummary.label}可用 {batchSummary.ok}/{batchSummary.total}；可用模型在列表里显示为绿色。
                </p>
              )}
              {test.status === "ok" && (
                <p className="flex items-start gap-1.5 rounded-md bg-emerald-50 p-2 text-[11px] leading-5 text-emerald-800">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                  {test.message}
                </p>
              )}
              {test.status === "error" && (
                <p className="flex items-start gap-1.5 rounded-md bg-destructive/[0.06] p-2 text-[11px] leading-5 text-destructive">
                  <XCircle className="mt-0.5 size-3.5 shrink-0" />
                  {test.message}
                </p>
              )}
              {deep.status === "ok" && (
                <p className="flex items-start gap-1.5 rounded-md bg-emerald-50 p-2 text-[11px] leading-5 text-emerald-800">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                  {deep.message}
                </p>
              )}
              {deep.status === "error" && (
                <p className="flex items-start gap-1.5 rounded-md bg-destructive/[0.06] p-2 text-[11px] leading-5 text-destructive">
                  <XCircle className="mt-0.5 size-3.5 shrink-0" />
                  {deep.message}
                </p>
              )}
            </div>
          </section>

          <section className="space-y-2 border-t pt-5">
            <div className="text-sm font-medium">MinerU Token（可选）</div>
            <p className="text-xs leading-5 text-muted-foreground">
              留空时使用免 Token 的轻量通道：单文件 ≤ 10MB、≤ 20 页，公式与表格识别能力有限。
              填入自己的 Token 后走精准解析：≤ 200MB、≤ 200 页，公式和表格更完整。Token 可在{" "}
              <a
                href="https://mineru.net/apiManage/token"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                MinerU API 管理页
              </a>{" "}
              创建。
            </p>
            <div className="relative">
              <Input
                type={showMineru ? "text" : "password"}
                value={draft.mineruToken}
                onChange={(event) => update({ mineruToken: event.target.value })}
                placeholder="可选：粘贴 MinerU Token"
                className="pr-9"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowMineru((value) => !value)}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showMineru ? "隐藏 Token" : "显示 Token"}
              >
                {showMineru ? <EyeOff className="size-4" /> : <Eye />}
              </button>
            </div>
          </section>

          {onClearCache && (
            <section className="flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
              <span>本地缓存了已解析的论文，换论文时可随时清理。</span>
              <Button type="button" variant="ghost" size="xs" onClick={onClearCache}>
                清空本地缓存
              </Button>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => {
              onSave({
                baseUrl: draft.baseUrl.trim(),
                model: draft.model.trim(),
                apiKey: draft.apiKey.trim(),
                mineruToken: draft.mineruToken.trim(),
              });
              onOpenChange(false);
            }}
          >
            保存设置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}