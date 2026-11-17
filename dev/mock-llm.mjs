import { createServer } from "node:http";

// Local-only mock of an OpenAI-compatible endpoint, used to exercise the UI without a real key.
// It never ships: dev/ is excluded from the published dist/ output.

function pickQuotes(markdown, count) {
  const clean = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ");
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 80 && item.length < 320 && /[a-zA-Z]/.test(item));
  const picked = [];
  for (let i = 0; i < sentences.length && picked.length < count; i += Math.max(1, Math.floor(sentences.length / count))) {
    picked.push(sentences[i]);
  }
  while (picked.length < count && sentences.length) picked.push(sentences[picked.length % sentences.length]);
  return picked;
}

function firstHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "示例论文";
}

function quickview(markdown) {
  const quotes = pickQuotes(markdown, 2);
  return {
    meta: {
      title: firstHeading(markdown),
      authors: "示例作者 A, B, C 等",
      venue: "示例会议",
      year: "2024",
    },
    coreQuestion: "（本地 mock）这篇论文试图解决什么具体问题？这是一个用于验证界面流程的占位问题。",
    coreContribution: "（本地 mock）作者提出了一个核心方法，用一个占位贡献验证速览卡的展示。",
    methodSummary: "先给出直觉解释，再补技术细节；这里用占位文本验证布局。",
    prerequisites: [
      { term: "自注意力", english: "self-attention", why: "本文的每个模块都建立在它之上。", suggest: "先看图解版 Transformer 教程。" },
      { term: "残差连接", english: "residual connection", why: "方法里用来稳定深层网络训练。", suggest: "复习 ResNet 的基本结构。" },
      { term: "交叉熵", english: "cross-entropy", why: "实验里的主损失函数。", suggest: "看一遍分类任务的损失推导。" },
    ],
    readingPath: {
      first: ["第 3 节：方法总览", "图 1：整体结构"],
      keyFigure: "先看图 1，理解数据从哪里进、从哪里出。",
      skip: ["第 5 节的完整证明可以暂时跳过"],
    },
    _quotes: quotes,
  };
}

function skeleton(markdown) {
  const q = pickQuotes(markdown, 10);
  return {
    problem: {
      summary: "（本地 mock）现有方法在长距离依赖上存在信息损失，作者认为这是一个重要问题。",
      limitations: ["现有方法难以并行", "长距离依赖建模成本高"],
      importance: "如果问题成立，会直接影响训练效率和效果。",
      citations: [{ section: "1 Introduction", quote: q[0] }],
    },
    insight: {
      summary: "（本地 mock）作者的关键判断是：把序列建模拆成可并行的注意力计算。",
      citations: [{ section: "2 Background", quote: q[1] }],
    },
    modules: [
      {
        name: "编码器模块",
        role: "把输入映射成上下文表示",
        input: "词嵌入序列",
        output: "上下文向量",
        goal: "并行建模序列内依赖",
        next: "输出送入解码器做交叉注意力",
        citations: [{ section: "3.1", quote: q[2] }],
      },
      {
        name: "解码器模块",
        role: "逐步生成输出",
        input: "编码器输出与已生成前缀",
        output: "下一个词的概率分布",
        goal: "在保持并行训练的同时做自回归生成",
        citations: [{ section: "3.2", quote: q[3] }],
      },
    ],
    experiments: [
      {
        name: "主实验（表 1）",
        claim: "验证方法在翻译任务上的效果",
        finding: "（mock）BLEU 有提升，训练时间下降。",
        verdict: "supports",
        citations: [{ section: "4.1", quote: q[4] }],
      },
      {
        name: "消融实验（表 2）",
        claim: "验证每个模块的必要性",
        finding: "（mock）去掉任一模块都会掉点。",
        verdict: "partial",
        citations: [{ section: "4.2", quote: q[5] }],
      },
    ],
    limitations: {
      stated: ["作者承认在超长序列上仍然有成本问题。"],
      inferred: ["方法依赖大规模并行算力，小团队复现门槛较高。"],
      citations: [{ section: "5 Conclusion", quote: q[6] }],
    },
  };
}

function replyFor(userText) {
  const paperMatch = userText.match(/<paper>([\s\S]*)<\/paper>/);
  const markdown = paperMatch ? paperMatch[1] : "";
  const isSkeleton = /论证骨架/.test(userText);
  const payload = isSkeleton ? skeleton(markdown) : quickview(markdown);
  if (payload._quotes) delete payload._quotes;
  return JSON.stringify(payload);
}

const server = createServer((req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.url?.endsWith("/models")) {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          { id: "qwen3.8-flash" },
          { id: "qwen3.8-max" },
          { id: "qwen3.7-plus" },
          { id: "qwen3.7-flash" },
          { id: "qwen-plus" },
          { id: "qwen-max" },
          { id: "qwen-long" },
          { id: "qwen-turbo" },
          { id: "qwen3-235b-a22b" },
          { id: "qwen3-32b" },
          { id: "qwen2.5-72b-instruct" },
          { id: "unavailable-model" },
          { id: "truncated-model" },
          { id: "prose-model" },
          { id: "context-model" },
          { id: "qwen-vl-max" },
          { id: "text-embedding-v3" },
          { id: "qwen-audio-asr" },
          { id: "wanx2.1-t2i-turbo" },
        ],
      }),
    );
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    try {
      const body = JSON.parse(raw || "{}");
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const lastUser = [...messages].reverse().find((item) => item.role === "user");
      const userText = String(lastUser?.content ?? "").trim();
      const joined = messages.map((item) => String(item.content ?? "")).join("\n");

      if (body.model === "unavailable-model") {
        res.writeHead(400, { ...cors, "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message:
                "The model `unavailable-model` does not exist or you do not have access to it.",
              type: "invalid_request_error",
              code: "model_not_found",
            },
          }),
        );
        return;
      }

      if (body.model === "truncated-model") {
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "mock",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: '{"meta":{"title":"Partial' },
                finish_reason: "length",
              },
            ],
          }),
        );
        return;
      }

      if (body.model === "prose-model") {
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "mock",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content:
                    "Sure! Here is the analysis you asked for. The paper studies sparse attention for long documents, and the main idea is to select blocks.",
                },
                finish_reason: "stop",
              },
            ],
          }),
        );
        return;
      }

      if (body.model === "context-model" && joined.length > 20000) {
        res.writeHead(400, { ...cors, "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message:
                "This model's maximum context length is 8192 tokens. However, your messages resulted in 30000 tokens.",
              type: "invalid_request_error",
              code: "invalid_parameter",
            },
          }),
        );
        return;
      }

      const content = /^(ping|只回复 OK)$/.test(userText) ? "OK" : replyFor(userText);
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "mock",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        }),
      );
    } catch (error) {
      res.writeHead(500, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
});

server.listen(8787, "127.0.0.1", () => {
  console.log("mock llm on http://127.0.0.1:8787/v1");
});