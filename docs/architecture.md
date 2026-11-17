# PaperTutor 架构（M1-D1 服务端骨架 + 帮助 + 导出/历史）

- 分支：`feat/m1d1-export-history`
- 状态：服务端 provider/API 骨架、即时帮助、离线导出/历史与四步导航完成；默认仍走现有 BYOK 路径；未部署线上
- 约束：不依赖 Secret、不调用付费 API、`SERVER_MODE` 默认 `false`

## 1. 默认路径（SERVER_MODE=false）

```
Browser
  ├─ PDF 上传 → Qoder Sites Function（现有 MinerU 代理）
  └─ 速览/骨架 → 浏览器直连用户自己的 OpenAI 兼容接口（BYOK）
```

- 现有 `health`、`mineru.submit`、`mineru.status` 行为不变
- 新增的 `/api/*` 在 `SERVER_MODE=false` 时直接返回 `404 SERVER_MODE_DISABLED`
- 前端默认流程不调用 `/api/*`，不读取服务端 Secret
- 线上诊断版不设置 `SERVER_MODE`，因此默认关闭服务端 API

## 2. 服务端模式骨架（SERVER_MODE=true）

```
Browser
  └─ /functions/v1/app/api/parse|jobs/:id|analyze
        │  (same-origin, Vite proxy → 8000 locally)
        ▼
  handleServerApi
        ├─ ParserProvider (mock | docmind)
        ├─ LlmProvider (mock | openai-compatible)
        ├─ in-memory docs / jobs / analyses
        └─ cache keys: parse:v1:*, analysis:v1:*
```

- Qoder Sites 只暴露一个 `app` Edge Function；逻辑路径 `/api/*` 实际映射为
  `/functions/v1/app/api/*`（本地 Vite 代理同样走这个前缀）
- `SERVER_MODE=false` 时不进入该链路
- Mock 模式同步完成解析和分析，便于本地端到端验收；真实 DocMind 为异步任务，
  后续 M1-C 再引入可持久化 job 存储

## 3. Provider 接口

### LLM（`functions/providers/llm-openai.ts`）

- `LlmProvider.complete({ messages, model?, maxTokens?, temperature? })`
- 返回 `{ text, model, usage? }`
- 未配置 `LLM_API_KEY` / `DASHSCOPE_API_KEY` / `OPENAI_API_KEY` 时：
  - 抛出 `ProviderError("LLM_NOT_CONFIGURED", ..., 503)`
  - **在 fetch 之前返回，不发起任何外网请求**

### DocMind（`functions/providers/docmind.ts`）

- `ParserProvider.parse({ file, fileName, mimeType? })`
- 返回 `{ markdown, pages?, meta? }`
- 未配置 `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` 时：
  - 抛出 `ProviderError("DOCMIND_NOT_CONFIGURED", ..., 503)`
  - 不发起外网请求
- 已配置时当前返回 `PARSER_NOT_IMPLEMENTED`（501）；M0 已验证的
  POST + HMAC-SHA1 链路将在 M1-C 移入该 provider

### Mock

- `PARSER_PROVIDER=mock` → 返回 `functions/fixtures/qa.ts` 中的合成论文
- `LLM_PROVIDER=mock` → 返回同一夹具的 `quickview + skeleton` JSON
- 不访问网络、不使用 Secret

## 4. 缓存键

```
parse:v1:{sha256(file)}
analysis:v1:{docId}:{mode}:{promptVersion}:{model}
```

- `docId` 当前等于文件 SHA-256
- `PROMPT_VERSION` 默认 `v2`
- 内存 Map 仅用于骨架与本地 mock；Edge Function 多实例下不保证共享，M1-C 切换到持久化缓存

## 5. 前端入口

- 默认入口：现有 BYOK / MinerU 流程，完全不变
- `/?qa=m1a`（仅 dev）：读取 `dev/qa-fixture.json`，本地夹具直接进结果页
- `/?qa=server`（仅 dev）：调用 `/api/parse` → `/api/jobs/:id` → `/api/analyze`，
  把 mock 结果喂给现有结果页
- 生产构建不包含 QA 夹具内容；`SERVER_MODE` 未设置时线上 API 自动禁用

## 6. 安全与边界

- 所有 API 同源；没有 `Access-Control-Allow-Origin: *`
- 未配置 Secret 的 provider 在 fetch 前抛错；测试用 mock fetch 断言 0 次调用
- 未实现预算、限流、真实 DocMind/LLM 调用；这些属于 M1-C/M6
- 临时 `debug.*` 诊断端点是 M0 遗留，发布前必须移除；M1-B 未部署线上

## 7. 本地运行

```bash
# 应用（6392）
npm run dev -- --port 6392 --strictPort

# mock server（8000，供 Vite 代理）
SERVER_MODE=true PARSER_PROVIDER=mock LLM_PROVIDER=mock node dev/function-node.mjs
```

验收：

- `http://127.0.0.1:6392/?qa=server` → mock API 端到端 → 现有结果页
- `http://127.0.0.1:6392/?qa=m1a` → 本地夹具，不经过服务端
- `npm test` → 5 个服务端骨架测试
- `npm run build` → 前端构建（含 tsc）

## 8. 帮助系统（M1-C）

### Registry 与控件

- 单一来源：`functions/help/registry.ts`，前后端共用
- 覆盖 12 个控件：
  - landing：示例论文、PDF 上传、解析模式、隐私说明
  - result：速览卡、引用校验、论证骨架、前置知识、原文对照、深度模式、自测、导出
- 每条包含 label、description、默认分数、三段式静态说明（这是什么 / 为什么需要 / 点了会发生什么）

### 服务端

- `POST /api/help/predict`：返回控件 `unfamiliarity`（0–1）、reason、suggestedQuestion
- `POST /api/help/answer`：返回三段式帮助，支持 `default | simpler | example`
- provider：
  - `LLM_PROVIDER=mock` → `mock-help`，纯静态，无外网
  - 否则 → `llm-help`，通过 OpenAI 兼容 provider 生成；缺 Key 返回 `LLM_NOT_CONFIGURED`，fetch 前抛错
- 生产保护：`NODE_ENV=production` 时，`PARSER_PROVIDER=mock` 或 `LLM_PROVIDER=mock` 直接返回
  `MOCK_PROVIDER_FORBIDDEN`，防止 mock 误上线

### 客户端

- `HelpScope` 在 landing/result 页面空闲 700ms 后调用 predict：
  - landing 取前 3，result 取前 5，分数 ≥0.55 才预生成，至少保留 1 条
  - 预生成逐条并发 1，写入 IndexedDB `papertutor-help`
- `HelpButton` 点击：
  - 先读缓存 → 命中立即显示（来源：缓存）
  - 未命中 → 调 `/api/help/answer`（来源：现场生成）
  - 失败/超时 → 使用 registry 静态说明（来源：内置说明）
- UI：桌面 Popover，移动端 bottom Sheet；只在点击 `?` 时出现，不自动弹窗、不阻断主操作
- 文案固定为「需要的话，可以看这里」，不使用对用户能力做判断的措辞
- 限制：每屏最多 5 条、每会话最多 20 条、同一控件最多重生成 1 次
- 缓存键：`help:answer:v2:{helpId}:{paperHash}:{variant}:v3`

### 本地验收

- 启动 mock 函数（SERVER_MODE=true / PARSER_PROVIDER=mock / LLM_PROVIDER=mock）
- 打开 `http://127.0.0.1:6392/?qa=server`
- 引用校验帮助：命中预生成缓存（`data-source=cache`）
- 深度模式帮助：不在结果页前 5，触发现场生成（`data-source=api`）
- 返回首页后点示例论文帮助：命中首页预生成缓存（`data-source=cache`）
- 帮助面板不显示内部来源；`data-source` 仅供 QA 检查

## 8.1 M1-D1 导出、历史与四步导航

### 四步导航

- 结果页顶部（桌面）/底部（移动端）：速览 → 读原文 → 拆论证 → 自测
- 点击步骤切换高亮；速览/拆论证/自测滚动到对应 section，读原文打开原文抽屉
- 自测步骤当前展示根据骨架生成的问题，交互答题仍未上线

### 导出

- `lib/export.ts` 纯函数：
  - `buildExportMarkdown`：标题、元数据、速览卡、前置知识/术语、阅读路径、论证骨架、引用清单、自测题
  - `buildOutline`：可复制的大纲
  - `buildSelfTestQuestions`：根据模块/实验离线生成问题
- 结果页「导出」菜单：下载 `.md`、复制 Markdown、复制大纲
- 导出不调用任何外部服务

### 最近分析

- IndexedDB：`papertutor-history` / `records`，按 `paperHash` 去重，保留最近 10 条
- 记录字段：`paperHash`、`title`、`createdAt`、`doc`、`analysis`
- 首页「最近分析」支持打开、删除、清空；刷新后仍在
- 历史记录保存发生在分析结果进入结果页时

## 9. 后续待办（M1-D2）

- DocMind 真实提交/轮询 + 可持久化 job/cache
- OpenAI 兼容 provider 接入真实 Key（仅服务端）
- 预算、限流、Origin 校验、密钥注销
- 移除 M0 `debug.*` 端点
- 服务端 citation 验证与分段生成
- 真实 DocMind 与真实 LLM 端到端
