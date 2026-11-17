# PaperTutor API（M1-D1 服务端骨架 + 帮助 + 导出/历史）

## 入口与开关

- 逻辑路径：`/api/parse`、`/api/jobs/:id`、`/api/analyze`
- Qoder Sites 实际路径：`/functions/v1/app/api/...`（同一个 `app` Edge Function）
- 本地 Vite 代理同样使用 `/functions/v1/app/api/...` → `127.0.0.1:8000`
- `SERVER_MODE=false`（默认）：所有 `/api/*` 返回 `404 SERVER_MODE_DISABLED`，
  现有 `health` / `mineru.*` 路径不受影响

## POST /api/parse

提交 PDF 并创建解析任务。

请求：

- `Content-Type: multipart/form-data`，字段 `file`（推荐）
- 或 `Content-Type: application/pdf` + `x-file-name: paper.pdf`
- 仅接受 `.pdf`；大小受 `MAX_UPLOAD_MB` 限制（默认 20MB）

成功响应（新解析 `202`，缓存命中 `200`）：

```json
{
  "ok": true,
  "jobId": "uuid",
  "docId": "sha256-hex",
  "status": "succeeded",
  "cacheKey": "parse:v1:{sha256}",
  "pages": 5,
  "markdown": "# ...（mock 模式返回，便于骨架端到端）",
  "cached": false
}
```

错误：

- `INVALID_FILE`（400）：空文件、缺少 `file`、非 `.pdf`
- `FILE_TOO_LARGE`（413）：超过 `MAX_UPLOAD_MB`
- `DOCMIND_NOT_CONFIGURED`（503）：未配置阿里云 AccessKey，**未发起外网请求**
- `PARSER_NOT_IMPLEMENTED`（501）：已配置凭证，但真实 DocMind 接入尚未完成

## GET /api/jobs/:id

查询解析任务。

```json
{
  "ok": true,
  "job": {
    "id": "uuid",
    "status": "succeeded",
    "step": "done",
    "progress": 100,
    "docId": "sha256-hex",
    "markdown": "# ...（骨架阶段附带，便于前端）",
    "pages": 5,
    "createdAt": 0,
    "updatedAt": 0
  }
}
```

- `JOB_NOT_FOUND`（404）
- 当前 mock 在请求内同步完成；真实 DocMind 的 `queued/running` 状态在 M1-C 接入

## POST /api/analyze

请求：

```json
{ "docId": "sha256-hex", "mode": "quick" }
```

- `mode`: `quick` | `deep`

成功响应（`200`）：

```json
{
  "ok": true,
  "jobId": "uuid",
  "status": "succeeded",
  "analysis": { "quickview": {}, "skeleton": {} },
  "model": "mock-llm",
  "cacheKey": "analysis:v1:{docId}:quick:v2:mock-llm",
  "cached": false
}
```

- 服务端只做 JSON 结构校验；citation 的 verified 标记仍由前端
  `verifyCitations` 完成（M1-C 再前移）
- 未配置 LLM Key：`LLM_NOT_CONFIGURED`（503），**未发起外网请求**
- `INVALID_REQUEST`（400）：缺少 `docId`
- `INVALID_MODE`（400）：mode 不是 quick/deep
- `DOC_NOT_FOUND`（404）：docId 不存在
- `INVALID_ANALYSIS_JSON`（502）：模型输出不是包含 quickview/skeleton 的 JSON

## POST /api/help/predict

请求：

```json
{ "screen": "landing", "paperHash": "paper-1" }
```

响应：

```json
{
  "ok": true,
  "provider": "mock-help",
  "promptVersion": "v2",
  "items": [
    {
      "helpId": "landing.samplePaper",
      "unfamiliarity": 0.86,
      "reason": "根据当前页面与控件状态估计",
      "suggestedQuestion": "这个「示例论文」是做什么的？"
    }
  ]
}
```

- items 按 `unfamiliarity` 降序，分数限制在 0–1
- `screen` 仅支持 `landing` / `result`，否则 `INVALID_REQUEST`（400）
- 无 LLM Key 且非 mock：`LLM_NOT_CONFIGURED`（503），未发起外网请求
- mock provider 不发起任何外网请求

## POST /api/help/answer

请求：

```json
{
  "helpId": "result.citationCheck",
  "variant": "default",
  "paperHash": "paper-1"
}
```

- `variant`: `default` | `simpler` | `example`

响应：

```json
{
  "ok": true,
  "provider": "mock-help",
  "promptVersion": "v2",
  "answer": {
    "helpId": "result.citationCheck",
    "variant": "default",
    "what": "这是什么",
    "why": "为什么需要",
    "effect": "点了会发生什么",
    "example": "可选的例子"
  }
}
```

- 未知 helpId：`UNKNOWN_HELP_ID`（400）
- 无 LLM Key 且非 mock：`LLM_NOT_CONFIGURED`（503），未发起外网请求
- 模型输出不合法：`INVALID_HELP_JSON`（502）

## 帮助缓存与限制

- 客户端缓存键：`help:answer:v2:{helpId}:{paperHash}:{variant}:v3`
- IndexedDB：`papertutor-help` / `answers`
- 帮助面板不显示内部来源；面板根节点带 `data-source`（cache/api/fallback）供 QA
- 每屏最多 5 条预生成、每会话最多 20 条、同一控件最多重生成 1 次
- 预生成：landing 前 3、result 前 5，分数 ≥0.55，至少 1 条；并发 1

## 客户端离线功能（M1-D1，无新增服务端 API）

- 导出 Markdown：标题、元数据、速览卡、术语、论证骨架、引用清单、自测题
- 导出菜单：下载 `.md` / 复制 Markdown / 复制大纲
- 最近分析：IndexedDB `papertutor-history` / `records`，按 `paperHash` 去重，最多 10 条
- 历史记录字段：`paperHash`、`title`、`createdAt`、`doc`、`analysis`
- 四步导航：速览 / 读原文 / 拆论证 / 自测；桌面顶部、移动端底部

## 缓存键

```
parse:v1:{sha256(file)}
analysis:v1:{docId}:{mode}:{promptVersion}:{model}
```

- `docId` 当前等于文件 SHA-256
- `PROMPT_VERSION` 默认 `v2`

## 错误码总表

| code | HTTP | 说明 |
|---|---|---|
| `SERVER_MODE_DISABLED` | 404 | 服务端 API 未启用 |
| `INVALID_FILE` | 400 | 空文件 / 非 PDF / 缺少文件 |
| `FILE_TOO_LARGE` | 413 | 超过大小限制 |
| `DOCMIND_NOT_CONFIGURED` | 503 | 缺少阿里云 AccessKey |
| `PARSER_NOT_IMPLEMENTED` | 501 | DocMind 真实解析未接入 |
| `LLM_NOT_CONFIGURED` | 503 | 缺少 LLM Key |
| `LLM_UPSTREAM_ERROR` | 502 | LLM 上游错误 |
| `LLM_EMPTY_RESPONSE` | 502 | LLM 空响应 |
| `INVALID_ANALYSIS_JSON` | 502 | 分析 JSON 不合法 |
| `INVALID_REQUEST` | 400 | 缺少字段或 screen 非法 |
| `INVALID_MODE` | 400 | mode 非法 |
| `UNKNOWN_HELP_ID` | 400 | helpId 不在 registry |
| `INVALID_HELP_JSON` | 502 | 帮助 JSON 不合法 |
| `MOCK_PROVIDER_FORBIDDEN` | 500 | production 环境禁止 mock provider |
| `DOC_NOT_FOUND` | 404 | docId 不存在 |
| `JOB_NOT_FOUND` | 404 | jobId 不存在 |
| `INTERNAL_ERROR` | 500 | 未分类异常 |

## 环境变量（M1-B）

| 变量 | 默认 | 说明 |
|---|---|---|
| `SERVER_MODE` | `false` | 仅 `true/1/yes/on` 时启用 `/api/*` |
| `PARSER_PROVIDER` | `auto` | `mock` 或 DocMind |
| `LLM_PROVIDER` | `auto` | `mock` 或 OpenAI 兼容 |
| `PROMPT_VERSION` | `v2` | 分析缓存版本 |
| `MAX_UPLOAD_MB` | `20` | 上传大小上限 |
| `LLM_API_KEY` / `DASHSCOPE_API_KEY` | 空 | LLM 凭证（只放服务端） |
| `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` | 空 | DocMind 凭证（只放服务端） |
| `LLM_BASE_URL` | 百炼兼容地址 | OpenAI 兼容 Base URL |
| `LLM_MODEL` | `qwen-plus` | 默认模型 |
| `NODE_ENV` | 未设置 | 为 `production` 时禁止 mock provider |

## 生产保护

`NODE_ENV=production` 时，以下任一配置会直接返回
`500 MOCK_PROVIDER_FORBIDDEN`，不会发起外网请求：

- `PARSER_PROVIDER=mock`
- `LLM_PROVIDER=mock`

本地 mock 验收必须不设置 `NODE_ENV=production`。

## 本地 mock 验收

```bash
# 应用
npm run dev -- --port 6392 --strictPort

# 本地函数（server mode + mock，不访问任何外部 API）
SERVER_MODE=true PARSER_PROVIDER=mock LLM_PROVIDER=mock node dev/function-node.mjs
```

打开 `http://127.0.0.1:6392/?qa=server`，会执行
`parse → jobs/:id → analyze`，并把 QA 夹具结果送入现有结果页。
帮助验收：在结果页点「引用校验」的 ?（缓存），点「深度模式」的 ?（现场生成），
回到首页点「示例论文」的 ?（首页预生成缓存）。

测试：

```bash
npm test          # 24 个服务端/帮助/导出/历史测试
npm run build     # 前端构建 + tsc
```

## 说明

- 当前 docs/jobs/analyses 为函数实例内存 Map，不保证跨实例持久化；M1-C 改用持久化存储
- mock 模式同步完成解析/分析；真实 provider 的异步任务、预算与限流在 M1-C/M6
