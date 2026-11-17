# PaperTutor 架构（M1-B 服务端骨架）

- 分支：`feat/m1b-server-skeleton`
- 状态：服务端 provider 与 API 骨架完成；默认仍走现有 BYOK 路径；未部署线上
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

## 8. M1-C 待办

- DocMind 真实提交/轮询 + 可持久化 job/cache
- OpenAI 兼容 provider 接入真实 Key（仅服务端）
- 预算、限流、Origin 校验、密钥注销
- 移除 M0 `debug.*` 端点
- 服务端 citation 验证与分段生成
