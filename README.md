# PaperTutor · ML 论文陪读

PaperTutor 把机器学习论文重构成初学者能读懂的学习材料：**速览卡、论证骨架、逐条可核验的原文引用**。

- 线上体验：<https://paper-tutor-b4bndympaz4.qoder.zone>
- 当前分支：`feat/m1f-deploy-smoke`（M1-F5 已上线）

## 核心能力

- **四步陪读**：上传 PDF → 解析 → 速览卡 → 论证骨架，每步都有进度、可取消、失败可重试。
- **速览卡**：元信息、核心问题、核心贡献、方法摘要、前置知识、阅读路径（先读什么、看哪张图、可跳过什么）。
- **论证骨架**：问题、洞察、模块、实验、局限；每条结构结论都带原文引用，点击可定位并高亮，未定位有提示。
- **即时帮助**：按当前屏幕预测你可能的问题；回答带引用，命中缓存不产生费用，离线/失败时回退静态帮助。
- **学习闭环**：自测题与答案、阅读进度、学习报告 / Markdown 导出、本地历史（IndexedDB，最多 10 条）。
- **结果可恢复**：结果页写入 `#/paper/<sha256>`，刷新、直接访问、前进后退都只读本地历史/缓存恢复，不会重新上传、解析或分析。
- **双运行模式**：默认 BYOK（浏览器直连你自己的 OpenAI 兼容接口）；服务端模式由 Edge Function 统一调用 DocMind 解析与 DashScope 分析。
- **成本与安全**：密钥只存在于服务端 Sites Settings；`DAILY_BUDGET_CNY=1` 预算闸、停服开关、同源 Origin 校验。

## 技术栈

React 19 + TypeScript + Vite + Tailwind CSS v4；`pdfjs-dist` 做本地页数与指纹；Qoder Sites Edge Function（Deno）承载服务端 API；IndexedDB 保存历史、缓存与阅读进度。

## 本地开发

Node 需满足 `^22.13.0 || >=24.0.0`：

```sh
npm ci
npm run dev        # http://127.0.0.1:5173
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview
```

可选的服务端本地调试（需要 Deno）：

```sh
npm run check:function
npm run dev:function   # 127.0.0.1:8000，Vite 会把 /functions/v1/app 代理过去
```

### 质量门禁

```sh
npm test                          # 单元测试
npm run lint -- --max-warnings 0
npm run test:e2e                  # Playwright，使用本机 Edge
npm run build
npx tsc --noEmit --allowImportingTsExtensions --strict \
  --lib ES2022,DOM --module ESNext --moduleResolution Bundler \
  --target ES2022 --skipLibCheck functions/handler.ts
```

当前状态（2026-11-21，M1-F5）：单测 **130/130**、lint **0 error / 0 warning**、e2e **56/56**、构建通过、函数 `tsc` 通过；首屏入口 **299 kB（gzip 96 kB）**，Lighthouse 移动端 **99 / 95 / 100**。详见 [docs/eval.md](docs/eval.md)。

## 服务端模式配置

在 Qoder Sites 的环境变量 / Settings 中配置（**不要把密钥写进代码、前端或 Git**）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `SERVER_MODE` | `false` | `true` 时启用 `/api/*` 服务端链路 |
| `PARSER_PROVIDER` | `docmind` | `docmind` 或 `mock`（生产环境拒绝 mock） |
| `LLM_PROVIDER` | `dashscope` | `dashscope` / `openai-compatible` / `mock` |
| `LLM_MODEL` | `qwen-plus` | 分析所用模型 |
| `SERVICE_ENABLED` | `true` | `false` 时全站返回 503 |
| `DAILY_BUDGET_CNY` | `1` | 每日 LLM 预算（元），耗尽返回 402 |
| `MAX_UPLOAD_MB` | `20` | 单篇 PDF 上限 |

密钥（仅服务端 Secret）：`ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET`、`DASHSCOPE_API_KEY`。

## API 摘要

逻辑路径均映射到同一个 Edge Function：`/functions/v1/app/api/*`（也支持 `?action=api.parse` 形式）。

| 方法与路径 | 作用 |
|---|---|
| `GET /api/health` | 服务状态（`serverMode` / `serviceEnabled`） |
| `POST /api/parse` | 上传 PDF（multipart 或 `application/pdf` + `x-file-name`），返回 `docId`、页数与 Markdown |
| `GET /api/jobs/:id` | 查询解析任务 |
| `POST /api/analyze` | 传入 `docId`、`markdown`、`mode`，返回速览卡与骨架 JSON |
| `POST /api/help/predict`、`/api/help/answer` | 即时帮助的预测与回答 |

细节与错误码见 [docs/api.md](docs/api.md)。

## 目录结构

```text
src/           入口与全局样式
components/    页面与结果视图、帮助、设置、历史等
lib/           缓存、历史、导出、路由恢复、provider 客户端
functions/     Edge Function：路由、预算、provider（DocMind / LLM / mock）
e2e/           Playwright 用例与 PDF 夹具
tests/         node --test 单元测试
docs/          架构、API、成本、验收与各里程碑记录
```

## 已知限制

- 解析/分析缓存与预算计数都在 Edge Function 进程内，实例回收后失效；跨实例共享需要持久化 KV。
- 首次真实 DocMind 解析约 15–30 s，受论文页数与排队影响。
- 尚未接入 CI；e2e 依赖本机 Edge，移动端只做过视口模拟，未做真机验证。
- 无账号体系，历史与进度只存在当前浏览器。

## 文档与出处

- 架构：[docs/architecture.md](docs/architecture.md)
- 成本模型：[docs/cost.md](docs/cost.md)
- 验收清单与证据：[docs/eval.md](docs/eval.md)
- 上线冒烟与 M1-F5 性能记录：[docs/m1f-smoke.md](docs/m1f-smoke.md)、[docs/m1f5.md](docs/m1f5.md)
- 模板来源与第三方许可：[PROVENANCE.md](PROVENANCE.md)、`vendor/`
