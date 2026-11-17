import { useEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Landing } from "@/components/Landing";
import { ProgressView } from "@/components/ProgressView";
import { ResultView } from "@/components/ResultView";
import { SettingsDialog } from "@/components/SettingsDialog";
import { generateQuickview, generateSkeleton, assembleAnalysis, verifyCitations } from "@/lib/analysis";
import { cacheAnalysis, cacheDoc, clearCache, getCachedAnalysis, getCachedDoc } from "@/lib/cache";
import { countPdfPages, formatBytes, sha256Hex } from "@/lib/files";
import { LlmError } from "@/lib/llm";
import { verifyModel } from "@/lib/model-check";
import { parseWithMineru, MineruError, type MineruMode } from "@/lib/mineru";
import { loadSettings, saveSettings, type Settings } from "@/lib/settings";
import type { Analysis, AppError, CitationStats, ParsedDoc, Phase } from "@/lib/types";

type View = "landing" | "working" | "result";

function initialPhases(): Phase[] {
  return [
    {
      key: "read",
      label: "读取 PDF",
      detail: "校验文件并计算指纹、页数",
      status: "pending",
    },
    {
      key: "parse",
      label: "MinerU 重构 Markdown",
      detail: "保留章节层级、公式与表格",
      status: "pending",
    },
    {
      key: "quickview",
      label: "生成速览卡",
      detail: "提炼核心问题、贡献、前置知识与阅读路径",
      status: "pending",
    },
    {
      key: "skeleton",
      label: "拆解论证骨架",
      detail: "问题 → 洞察 → 模块 → 实验 → 局限，逐条匹配原文",
      status: "pending",
    },
  ];
}

function phaseStateLabel(state: string): string {
  if (state === "pending") return "排队中";
  if (state === "running") return "解析中";
  return state;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<View>("landing");
  const [doc, setDoc] = useState<ParsedDoc | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [stats, setStats] = useState<CitationStats | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [phases, setPhases] = useState<Phase[]>(() => initialPhases());
  const [generating, setGenerating] = useState(false);
  const [cacheHit, setCacheHit] = useState(false);
  const [fileMeta, setFileMeta] = useState({ name: "", size: 0 });
  const runRef = useRef(0);

  const hasKey = Boolean(settings.apiKey.trim());
  const hasMineruToken = Boolean(settings.mineruToken.trim());

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get("qa") !== "m1a") return;
    let cancelled = false;
    void (async () => {
      const mod = await import("../dev/qa-fixture");
      if (cancelled) return;
      const { doc: qaDoc, record } = mod.buildQaFixture();
      const qaStats = verifyCitations(qaDoc.markdown, record.analysis);
      setDoc(qaDoc);
      setAnalysis(record.analysis);
      setStats(qaStats);
      setError(null);
      setGenerating(false);
      setCacheHit(false);
      setView("result");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updatePhase = (key: Phase["key"], patch: Partial<Phase>) => {
    setPhases((current) =>
      current.map((phase) => (phase.key === key ? { ...phase, ...patch } : phase)),
    );
  };

  const resetToLanding = () => {
    runRef.current += 1;
    setView("landing");
    setDoc(null);
    setAnalysis(null);
    setStats(null);
    setError(null);
    setGenerating(false);
    setCacheHit(false);
    setPhases(initialPhases());
  };

  const failWith = (nextError: AppError, targetView: View) => {
    setError(nextError);
    setGenerating(false);
    setPhases((current) =>
      current.map((phase) =>
        phase.status === "active" ? { ...phase, status: "error" } : phase,
      ),
    );
    setView(targetView);
  };

  const markReadAndParseDone = (target: ParsedDoc) => {
    updatePhase("read", { status: "done", detail: `${formatBytes(target.fileSize)}${target.pages ? ` · ${target.pages} 页` : ""}` });
    updatePhase("parse", {
      status: "done",
      detail: `${target.markdown.length.toLocaleString()} 字符 · ${target.mode === "token" ? "精准模式" : "轻量模式"}`,
    });
  };

  const analyze = async (target: ParsedDoc) => {
    const run = runRef.current;
    const stale = () => runRef.current !== run;
    setError(null);
    setGenerating(true);

    updatePhase("quickview", {
      status: "active",
      detail: "正在验证所选模型是否能真实调用…",
    });
    let modelCheck;
    try {
      modelCheck = await verifyModel(settings, settings.model);
    } catch (error) {
      modelCheck = {
        state: "error" as const,
        message: "模型验证失败",
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: Date.now(),
      };
    }
    if (stale()) return;
    if (modelCheck.state !== "ok") {
      const detail = modelCheck.detail ? `服务商返回：${modelCheck.detail.slice(0, 300)}。` : "";
      failWith(
        {
          title: `模型 ${settings.model} 当前不可用`,
          message: modelCheck.message ?? "模型调用失败",
          hint: `${detail}打开设置，点击“检测推荐模型”，选择一个绿色可用的模型后再生成。`,
          kind: "llm",
          raw: modelCheck.detail,
        },
        "result",
      );
      return;
    }

    updatePhase("quickview", {
      status: "active",
      detail: `模型可用（${modelCheck.latencyMs ?? "?"}ms），正在通读全文，提炼速览信息…`,
    });
    let quickview;
    try {
      quickview = await generateQuickview(target.markdown, settings);
    } catch (error) {
      if (!stale()) failWith(mapLlmError(error), "result");
      return;
    }
    if (stale()) return;

    updatePhase("quickview", {
      status: "done",
      detail: `${quickview.prerequisites.length} 个前置概念 · 已生成阅读路径`,
    });
    updatePhase("skeleton", { status: "active", detail: "逐站拆解方法，并在原文中匹配引用…" });

    let skeleton;
    try {
      skeleton = await generateSkeleton(target.markdown, settings);
    } catch (error) {
      if (!stale()) failWith(mapLlmError(error), "result");
      return;
    }
    if (stale()) return;

    const assembled = assembleAnalysis(quickview, skeleton, target.markdown);
    const citationStats = verifyCitations(target.markdown, assembled);
    updatePhase("skeleton", {
      status: "done",
      detail: `${citationStats.verified}/${citationStats.total} 条引用已在原文中定位`,
    });
    setAnalysis(assembled);
    setStats(citationStats);
    setGenerating(false);
    setView("result");
    void cacheAnalysis(target.hash, {
      analysis: assembled,
      model: settings.model,
      createdAt: Date.now(),
    });
  };

  const start = async (file: File) => {
    const run = ++runRef.current;
    const stale = () => runRef.current !== run;

    setError(null);
    setAnalysis(null);
    setStats(null);
    setDoc(null);
    setGenerating(false);
    setCacheHit(false);
    setPhases(initialPhases());
    setFileMeta({ name: file.name, size: file.size });
    setView("working");

    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      failWith({
        title: "这不是一个 PDF 文件",
        message: "目前只支持上传 .pdf 格式的英文论文。",
        hint: "如果你手里是 arXiv 网页或 Word 文档，请先导出为 PDF。",
        kind: "generic",
      }, "working");
      return;
    }

    updatePhase("read", { status: "active", detail: "读取文件并计算指纹…" });

    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      failWith({
        title: "读取文件失败",
        message: "浏览器没能读取这个 PDF，可能是文件损坏或权限受限。",
        hint: "换一个文件再试。",
        kind: "generic",
      }, "working");
      return;
    }
    if (stale()) return;

    const hash = await sha256Hex(buffer);
    let pages: number | null = null;
    try {
      pages = await countPdfPages(buffer);
    } catch {
      pages = null;
    }
    if (stale()) return;

    updatePhase("read", {
      status: "done",
      detail: `${formatBytes(file.size)}${pages ? ` · ${pages} 页` : ""}`,
    });

    const applyDoc = async (target: ParsedDoc) => {
      if (stale()) return;
      setDoc(target);
      markReadAndParseDone(target);
      const cached = await getCachedAnalysis(target.hash);
      if (stale()) return;
      if (cached) {
        const citationStats = verifyCitations(target.markdown, cached.analysis);
        setAnalysis(cached.analysis);
        setStats(citationStats);
        updatePhase("quickview", { status: "done", detail: `来自本地缓存 · ${cached.model}` });
        updatePhase("skeleton", {
          status: "done",
          detail: `${citationStats.verified}/${citationStats.total} 条引用已在原文中定位`,
        });
        setView("result");
        return;
      }
      if (settings.apiKey.trim()) {
        await analyze(target);
      } else {
        setView("result");
      }
    };

    const cachedDoc = await getCachedDoc(hash);
    if (stale()) return;
    if (cachedDoc) {
      setCacheHit(true);
      await applyDoc(cachedDoc);
      return;
    }

    const tooLarge = file.size > 10 * 1024 * 1024;
    const tooManyPages = pages !== null && pages > 20;
    if (!settings.mineruToken.trim() && (tooLarge || tooManyPages)) {
      failWith({
        title: "超出免 Token 通道的限制",
        message: `这篇论文${pages ? `有 ${pages} 页` : ""}${tooLarge ? `${pages ? "、" : ""}${formatBytes(file.size)}` : ""}，超过免 Token 通道的 20 页 / 10MB 限制。`,
        hint: "在设置里填入自己的 MinerU Token（可获得 200 页 / 200MB 的精准解析），或者先上传论文正文的前 20 页。",
        kind: "limit",
      }, "working");
      return;
    }

    const mode: MineruMode = settings.mineruToken.trim() ? "token" : "flash";
    updatePhase("parse", {
      status: "active",
      detail: mode === "token" ? "上传到 MinerU 精准解析通道…" : "上传到 MinerU 轻量通道…",
    });

    try {
      const result = await parseWithMineru(file, buffer, {
        mode,
        token: settings.mineruToken,
        onProgress: (progress) => {
          if (stale()) return;
          updatePhase("parse", {
            status: "active",
            detail: progress.total
              ? `第 ${progress.extracted}/${progress.total} 页 · 已用 ${progress.elapsed} 秒`
              : `${phaseStateLabel(progress.state)} · 已用 ${progress.elapsed} 秒`,
          });
        },
      });
      if (stale()) return;

      const target: ParsedDoc = {
        hash,
        fileName: file.name,
        fileSize: file.size,
        pages,
        mode: result.mode,
        markdown: result.markdown,
        parsedAt: Date.now(),
      };
      setDoc(target);
      void cacheDoc(target);
      await applyDoc(target);
    } catch (error) {
      if (stale()) return;
      failWith(mapMineruError(error), "working");
    }
  };

  const regenerate = () => {
    if (!doc) return;
    if (!settings.apiKey.trim()) {
      setSettingsOpen(true);
      return;
    }
    runRef.current += 1;
    const run = runRef.current;
    void (async () => {
      setPhases((current) =>
        current.map((phase) =>
          phase.key === "read" || phase.key === "parse"
            ? { ...phase, status: "done" }
            : { ...phase, status: "pending", detail: "" },
        ),
      );
      if (runRef.current !== run) return;
      await analyze(doc);
    })();
  };

  const onSaveSettings = (next: Settings) => {
    setSettings(next);
    saveSettings(next);
  };

  return (
    <div className="relative min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <button type="button" onClick={resetToLanding} className="flex items-center gap-2.5 text-left">
            <span className="font-display flex size-8 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground">
              P
            </span>
            <span>
              <span className="font-display block text-lg leading-none font-semibold tracking-tight">
                PaperTutor
              </span>
              <span className="mt-1 block text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
                ML paper companion
              </span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            <span
              className={`size-1.5 rounded-full ${hasKey ? "bg-primary" : "bg-amber-500"}`}
              aria-hidden
            />
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              {hasKey ? settings.model : "未配置模型"}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 />
              设置
            </Button>
          </div>
        </div>
      </header>

      <div className="relative z-10">
        {view === "landing" && (
          <Landing
            onFile={(file) => void start(file)}
            onOpenSettings={() => setSettingsOpen(true)}
            hasKey={hasKey}
            hasMineruToken={hasMineruToken}
          />
        )}

        {view === "working" && (
          <ProgressView
            fileName={fileMeta.name}
            fileSize={fileMeta.size}
            phases={phases}
            error={error}
            onOpenSettings={() => setSettingsOpen(true)}
            onBack={resetToLanding}
          />
        )}

        {view === "result" && doc && (
          <ResultView
            doc={doc}
            analysis={analysis}
            stats={stats}
            error={error}
            generating={generating}
            cacheHit={cacheHit}
            hasKey={hasKey}
            diagnostics={{ model: settings.model, baseUrl: settings.baseUrl }}
            onRegenerate={regenerate}
            onOpenSettings={() => setSettingsOpen(true)}
            onBack={resetToLanding}
          />
        )}
      </div>

      <footer className="relative z-10 border-t border-border/70 py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>PaperTutor · 把论文重构成能跟着学的材料</span>
          <span>解析结果缓存在本机 · 模型 Key 不上传</span>
        </div>
      </footer>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSave={onSaveSettings}
        onClearCache={() => void clearCache()}
      />
    </div>
  );

  function mapMineruError(error: unknown): AppError {
    if (error instanceof MineruError) {
      switch (error.code) {
        case "proxy_missing":
          return {
            title: "解析服务未部署",
            message: "当前站点没有启用解析代理，无法调用 MinerU。",
            hint: "请确认站点已部署 functions 目录；本地开发时先运行 npm run dev:function。",
            kind: "network",
          };
        case "flash_size_limit":
        case "file_too_large":
          return {
            title: "文件超出解析限制",
            message: `MinerU 拒绝了这次上传（${error.detail ?? "文件过大"}）。`,
            hint: "配置 MinerU Token 后可以解析更大的文件，或先截取论文前 20 页。",
            kind: "limit",
          };
        case "upload_failed":
          return {
            title: "上传到 MinerU 失败",
            message: "文件已经提交，但没有成功传到解析服务。",
            hint: "通常是网络抖动，重试一次；仍然失败可以换一个网络环境。",
            kind: "network",
          };
        case "mineru_failed": {
          const detail = error.detail ?? "";
          if (/page count|页数|-30003/i.test(detail)) {
            return {
              title: "论文页数超出免费通道限制",
              message: detail || "免 Token 通道最多解析 20 页。",
              hint: "配置 MinerU Token 走精准解析（最多 200 页），或先截取正文前 20 页。",
              kind: "limit",
            };
          }
          return {
            title: "MinerU 解析失败",
            message: detail || "解析服务没有返回可用结果。",
            hint: "换一篇 PDF 试试；如果这篇是扫描件，可能需要开启 OCR 或使用精准模式。",
            kind: "parse",
          };
        }
        case "mineru_submit_failed": {
          const detail = error.detail ?? "";
          if (/429|rate|limit/i.test(detail)) {
            return {
              title: "MinerU 免费通道正在限流",
              message: "当前网络请求太频繁，解析服务暂时拒绝了新任务。",
              hint: "等一分钟再试；或者在设置里填入自己的 MinerU Token，避开共享限流。",
              kind: "limit",
            };
          }
          if (/A0202|A0211|token/i.test(detail)) {
            return {
              title: "MinerU Token 无效或已过期",
              message: detail,
              hint: "到 MinerU API 管理页重新创建一个 Token，粘贴到设置里。",
              kind: "parse",
            };
          }
          return {
            title: "MinerU 拒绝了这次解析请求",
            message: detail || "提交任务失败。",
            hint: "重试一次；仍然失败可以换一篇 PDF 或使用自己的 MinerU Token。",
            kind: "parse",
          };
        }
        case "empty_markdown":
          return {
            title: "解析结果为空",
            message: "MinerU 返回了空的 Markdown，可能是 PDF 是纯图片或格式不受支持。",
            hint: "换一篇文本型 PDF；扫描件建议使用 MinerU 精准模式。",
            kind: "parse",
          };
        case "timeout":
          return {
            title: "解析超时",
            message: "MinerU 在 10 分钟内没有返回结果。",
            hint: "稍后重试；长论文建议使用自己的 MinerU Token 提高优先级。",
            kind: "network",
          };
        case "aborted":
          return { title: "已取消", message: "解析已取消。", kind: "generic" };
        default:
          return {
            title: "解析失败",
            message: error.detail || error.code,
            hint: "重试一次，或换一篇 PDF。",
            kind: "parse",
          };
      }
    }
    if (error instanceof TypeError) {
      return {
        title: "无法连接解析服务",
        message: "请求没有到达站点后端，可能是网络中断或代理不可用。",
        hint: "检查网络后重试；如果问题持续，说明站点的解析函数没有正常部署。",
        kind: "network",
      };
    }
    return {
      title: "解析过程中出现未知错误",
      message: error instanceof Error ? error.message : String(error),
      hint: "重试一次；如果仍然失败，换一篇 PDF 验证。",
      kind: "generic",
    };
  }

  function mapLlmError(error: unknown): AppError {
    const mapped = mapLlmErrorInner(error);
    if (error instanceof LlmError) {
      mapped.raw = error.raw ?? error.detail;
    }
    return mapped;
  }

  function mapLlmErrorInner(error: unknown): AppError {
    if (error instanceof LlmError) {
      switch (error.code) {
        case "missing_key":
          return {
            title: "还没有配置模型 Key",
            message: "生成速览卡和论证骨架需要调用你自己的模型。",
            hint: "打开设置，选择一个供应商并填入 API Key。Key 只保存在浏览器本地。",
            kind: "need_key",
          };
        case "invalid_key":
          return {
            title: "模型 Key 无效（401）",
            message: "模型服务拒绝了这个 Key。",
            hint: "检查 Key 是否复制完整、是否已过期，然后重新保存设置。",
            kind: "llm",
          };
        case "forbidden":
          return {
            title: "模型服务拒绝访问（403）",
            message: "Key 有效，但没有调用该模型的权限。",
            hint: "确认账号已开通该模型，或换一个模型名。",
            kind: "llm",
          };
        case "model_not_found":
          return {
            title: "找不到模型或接口地址（404）",
            message: "Base URL 或模型名可能拼错了。",
            hint: "检查 Base URL 是否包含 /v1 等版本路径，并确认模型名与服务商文档一致。",
            kind: "llm",
          };
        case "model_unavailable":
          return {
            title: "当前模型不可用",
            message: error.detail || "服务商拒绝了这个模型。",
            hint: "打开设置，点击“检测推荐模型”或“检测全部模型”，选择一个绿色可用的模型。常见原因是 Key 未开通该模型、模型 ID 不对或地域不支持。",
            kind: "llm",
          };
        case "invalid_parameter":
          return {
            title: "模型拒绝了请求参数",
            message: error.detail || "这个模型可能不接受当前的 OpenAI 兼容请求格式。",
            hint: "换一个模型试试；如果必须用这个模型，请确认它在百炼控制台支持 chat/completions 调用。",
            kind: "llm",
          };
        case "context_too_long":
          return {
            title: "论文超出模型上下文",
            message: "这个模型的上下文窗口装不下当前论文；系统已自动精简输入重试一次，仍然超限。",
            hint: "换用 128k / 1M 上下文的模型（例如 qwen3.8-flash、qwen-long、qwen-plus），或在设置里检测并选择支持长上下文的模型。",
            kind: "llm",
          };
        case "output_truncated":
          return {
            title: "模型输出被截断",
            message: "模型在输出上限处停止，JSON 没有闭合；系统已自动扩大输出上限重试一次，仍然失败。",
            hint: "换一个支持更长输出的模型，或稍后重试。下面的原始返回可以看到截断位置。",
            kind: "llm",
          };
        case "quota_exceeded":
          return {
            title: "账户额度不足",
            message: "模型服务返回余额或免费配额不足。",
            hint: "到服务商控制台确认免费额度、余额或计费状态，或换一个 Key / 供应商。",
            kind: "llm",
          };
        case "rate_limited":
          return {
            title: "模型服务限流（429）",
            message: error.detail || "请求被模型服务临时拒绝。",
            hint: "稍等片刻再试，或检查账户余额与调用频率。",
            kind: "llm",
          };
        case "network_or_cors":
          return {
            title: "无法连接模型服务",
            message: "浏览器没能完成请求，常见原因是网络不可达，或该服务不允许浏览器直连（CORS）。",
            hint: "DeepSeek、阿里云百炼、SiliconFlow、OpenRouter 已验证可在浏览器直连；如果用的是其他服务，请换一个供应商。",
            kind: "network",
          };
        case "timeout":
          return {
            title: "模型响应超时",
            message: "模型在 5 分钟内没有返回结果。",
            hint: "论文较长时建议换用长上下文模型，或稍后重试。",
            kind: "llm",
          };
        case "invalid_json":
          return {
            title: "模型输出不是合法 JSON",
            message: "已经自动重试过一次，模型仍然没有按结构返回。",
            hint: "再生成一次；如果反复出现，换一个指令遵循能力更强的模型。下面的原始返回可以看到模型到底输出了什么。",
            kind: "llm",
          };
        case "empty_response":
          return {
            title: "模型返回了空内容",
            message: error.detail || "接口成功返回，但内容为空。",
            hint: "重试一次，或检查该模型是否支持当前请求参数。",
            kind: "llm",
          };
        default:
          return {
            title: "生成分析时出错",
            message: error.detail || error.code,
            hint: "检查模型设置后重试。",
            kind: "llm",
          };
      }
    }
    return {
      title: "生成分析时出现未知错误",
      message: error instanceof Error ? error.message : String(error),
      hint: "重试一次；如果仍然失败，检查模型设置。",
      kind: "llm",
    };
  }
}