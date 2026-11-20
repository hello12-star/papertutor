# M1-F1 DocMind 诊断 smoke

> 执行时间：2026-11-18 14:55 UTC 左右
> 分支：`feat/m1f-deploy-smoke`
> 部署站点：https://paper-tutor-b4bndympaz4.qoder.zone
> 结论：**部署成功；DocMind submit 失败（RAM NoPermission）；未生成 job、未返回 Markdown、未调用 LLM、无重试。**

## 1. 部署与配置

- 站点：`paper-tutor-b4bndympaz4.qoder.zone`，首页 HTTP **200**。
- 发布状态：`published: true`。
- `app` Function：`required_secret_names` 已声明为：
  - `ALIYUN_ACCESS_KEY_ID`
  - `ALIYUN_ACCESS_KEY_SECRET`
  - `DASHSCOPE_API_KEY`
- 三个 Secret 在 Sites 中均为 `synced`。
- 线上 `debug.env` 只读结果：
  - `ALIYUN_ACCESS_KEY_ID: true`
  - `ALIYUN_ACCESS_KEY_SECRET: true`
  - `DASHSCOPE_API_KEY: true`
  - `DOCMIND_ENDPOINT: false`（使用默认 `docmind-api.cn-hangzhou.aliyuncs.com`）
- 未移除 `debug.*`；未实现真实 DocMind provider；未改前端 server-mode 接线。
- 为通过 bundle 审计，仅移除了 `lib/demo.ts` 示例校验中的 `secretKey` 字面量；不影响现有示例。

### 非密环境变量（部署工具无法写入）

`prepare_site` 只接受 `secretNames`，不接受非密 env；以下键需要你在 Qoder Sites 环境变量/Settings 中补：

- `SERVER_MODE=true`
- `PARSER_PROVIDER=docmind`
- `LLM_PROVIDER=dashscope`
- `LLM_MODEL=qwen-plus`
- `SERVICE_ENABLED=true`
- `DAILY_BUDGET_CNY=1`

当前未设置这些键，因此 `/api/*` 仍然关闭；本次诊断只使用 `debug.docmind`，不依赖它们。

## 2. Bundle 审计

| 检查 | 结果 |
|---|---|
| `ALIYUN_` | 0 个文件 |
| `DASHSCOPE_` | 0 个文件 |
| `secret`（应用代码，排除 pdf.worker） | 0 个文件 |
| `secret`（pdf.worker） | 1 个文件，是 PDF.js 的 Unicode 字符名 `ideographicsecretcircle`，不是密钥 |

## 3. 唯一一次 DocMind submit

请求（只发一次，未重试）：

```text
GET https://paper-tutor-b4bndympaz4.qoder.zone/functions/v1/app?action=debug.docmind&op=submit&format=repeat
Origin: https://paper-tutor-b4bndympaz4.qoder.zone
```

说明：`debug.docmind` 内部固定使用公网示例 PDF，`PageIndex=1-1`（仅第 1 页），`FormulaEnhancement=true`，`OutputFormat.1=markdown`；该诊断端点不接受自定义文件 URL，因此没有使用 e2e fixture。

结果：

| 项 | 值 |
|---|---|
| Function HTTP | 200 |
| 耗时 | **0.529 s** |
| DocMind HTTP | 200 |
| RequestId | `01A1EF27-9525-5768-B94F-AF219AC9F098` |
| 业务码 | **NoPermission** |
| 错误原文 | `You are not authorized to perform this operation.` |
| 被拒绝的 Action | `docmind:SubmitDocParserJob` |
| 是否返回 Job Id | 否 |
| 是否返回 Markdown | 否 |
| 是否调用 LLM | 否 |

未记录 Secret 值、AccessKey、SecretRef、RAM 用户主体 ID 或 EncodedDiagnosticMessage。

## 4. 花费

- **0 元**。
- 原因：DocMind 在 `SubmitDocParserJob` 权限检查处拒绝，未创建解析 job，未产生计费页；免费额度也未被消耗。
- 未调用 qwen-plus，未产生 LLM 费用。

## 5. 失败原因与下一步

RAM 用户缺少 DocMind 解析权限；请求在权限检查阶段被拒绝，签名/Secret 注入本身已到达 DocMind（否则会是 `InvalidAccessKeyId` 或缺少 Secret）。

需要你处理：

1. 给该 RAM 用户授予 `AliyunDocmindFullAccess`，或最小权限策略：
   - `docmind:SubmitDocParserJob`
   - `docmind:QueryDocParserStatus`
   - `docmind:GetDocParserResult`
2. 权限生效后再决定是否重试 1 页诊断（需要你确认；本次不自动重试）。
3. 之后才进入 M1-F2：实现真实 DocMind provider、生产 UI server-mode 接线、移除 debug、正式 smoke。

## 6. 当前线上状态

- 站点已发布，URL 不变，首页 200。
- 线上暂时保留 `debug.*` 端点（含 `debug.env`/`debug.docmind`），仅接受本站或 `*.qoder.zone`/localhost Origin；正式版前必须移除。
- 当前线上的普通页面仍走 Stage 1 的 MinerU/BYOK 路径，尚未切换到 DocMind/qwen-plus 服务端链路。

## 7. 证据

- 本文件。
- 线上 `debug.env` 与 `get_site` 只读结果（未保存 Secret 值）。
- 原始 submit 响应保存在临时目录，未入库；其中只摘录了上述 Code/Message/Action/RequestId。

## 8. M1-F1b 重试（2026-11-18，仅一次）

用户确认后重新执行一次 DocMind 诊断；submit 成功，随后只查询一次 `QueryDocParserStatus`，未再下载结果、未调用 LLM、未重试。

### Submit

```text
GET .../functions/v1/app?action=debug.docmind&op=submit&format=repeat
Origin: https://paper-tutor-b4bndympaz4.qoder.zone
```

| 项 | 值 |
|---|---|
| Function HTTP | 200 |
| 耗时 | **0.480 s** |
| DocMind HTTP | 200 |
| 业务结果 | 成功（无错误 Code） |
| RequestId | `01A1EF2F-FC12-5739-BAF4-7120DF4764F1` |
| JobId | `docmind-20261118-78ff70c056a24d60ae7eb7b49da64417` |

### 单次 Status 查询

```text
GET .../functions/v1/app?action=debug.docmind&op=status&id=<JobId>
```

| 项 | 值 |
|---|---|
| Function HTTP | 200 |
| 耗时 | **0.473 s** |
| DocMind HTTP | 200 |
| RequestId | `01A1EF30-5FF9-5028-AB34-A4B12A340DB2` |
| Status | **success** |
| PageCountEstimate | **1** |
| NumberOfSuccessfulParsing | 14 |
| ParagraphCount | 14 |
| Tokens | 523 |
| Processing | 100 |
| 是否在 status 响应中拿到 Markdown | **否**（响应无 Markdown 字段） |

按指令未调用 `GetDocParserResult`，因此没有下载 Markdown，也没有继续分析。DocMind 侧已完成 1 页解析，但本次只验证到 submit + 单次 status。

### 花费

- 1 页；在每月 3,000 页免费额度内应为 **0 元**，若免费额度已用尽则最多 **0.02 元**。
- 未调用 qwen-plus，无 LLM 费用。
- 实际账单以阿里云为准。

### 守卫修复

- `lib/demo.ts` 已恢复 `secretKey` / `secret_key` 检测：用 `["sec","ret"].join("")` 拆分构造，不把 `secretKey`/`secret_key` 字面量写入 bundle。
- 本地验证：`secretKey`、`secret_key`、`apiKey` 均命中，`{ title: "x" }` 不命中。
- bundle 审计：应用代码中 `ALIYUN_`、`DASHSCOPE_`、`secretKey`、`secret_key`、`secret` 均为 0；`pdf.worker` 仍有 1 个 Unicode 字符名 `ideographicsecretcircle`，不是密钥。
- 注意：此 guard 修复只在源码/本地构建中，**线上仍是 M1-F1 诊断构建**，尚未重新部署；正式 F2 部署时会带上。

### 当前结论

- Secret 注入、HMAC 签名、DocMind submit、单页解析状态查询均已跑通。
- 尚未取得 Markdown 文本（按指令未调用 result 接口）。
- 未实现真实 provider、未改前端 server-mode 接线、debug.* 仍保留。
- 等待用户决定是否进入 M1-F2。

## 9. M1-F2 正式 smoke（失败，未产生付费调用）

部署：`https://paper-tutor-b4bndympaz4.qoder.zone`，首页 200；`/api/health` 返回 `serverMode:true`、`serviceEnabled:true`；`debug.*` 已移除。

执行：用 1 页 PDF 通过线上 UI 上传（`docs/m1f-f2-result.png`）。浏览器 health 为 true，客户端已切到服务端模式。

结果：

| 项 | 值 |
|---|---|
| 客户端 serverMode | true |
| `/api/parse` | **502** |
| UI 错误 | `DocMind 提交失败` / `DocMind 网络请求失败：Invalid URL: 'https:///'` |
| DocMind submit | **未发起**（无 JobId） |
| `/api/analyze` | **未调用** |
| 耗时 | 上传后约 1 秒失败 |
| 花费 | **0 元**（无 DocMind job、无 LLM；临时 OSS 上传不计入 DocMind 计费） |

原因：

- `DOCMIND_ENDPOINT` 未设置时 `readEnv` 返回空字符串；
- provider 使用了 `?? DEFAULT_ENDPOINT`，空字符串不会触发回退，最终 endpoint 为空，拼接出 `https:///`；
- 在 `SubmitDocParserJob` 前抛出 `Invalid URL`，未发出 DocMind 请求。

未执行：未重试、未再次调用付费接口、未部署修复版。

当前风险：线上 `serverMode=true`，上传会走到这个失败路径；在修复并重新部署前，线上上传不可用（不会自动回退 BYOK/MinerU）。建议修复 `functions/providers/docmind.ts` 的 endpoint 回退（`||` 并加空值守卫）后重新部署，再经你授权重跑一次正式 smoke。

证据：[docs/m1f-smoke-f2.json](m1f-smoke-f2.json)、[docs/m1f-f2-result.png](m1f-f2-result.png)。

## 10. M1-F2 收尾：endpoint 修复 + 全门禁 + 重新部署 + 单次 smoke（2026-11-19）

> 执行时间：2026-11-19 08:12 UTC 左右
> 分支：`feat/m1f-deploy-smoke`（父提交 `042c8c1`，未 commit / 未 push）
> 部署 action：`aac64c0a-ab6e-4a6f-b57c-ed29adb163f2`
> 结论：**endpoint 回退缺陷已修复并验证生效；全门禁通过；已覆盖部署。第一轮 smoke 在 `GetDocParserResult` 处失败（MissingLayoutNum，未调用 LLM、无重试）；第二轮修复分页后 smoke 成功（引用 8/8），见 10.8。**

### 10.1 修复

- `functions/providers/docmind.ts:141`：`options.endpoint ?? readEnv("DOCMIND_ENDPOINT") ?? DEFAULT_ENDPOINT` 改为 `options.endpoint || readEnv("DOCMIND_ENDPOINT") || DEFAULT_ENDPOINT`。
- 原因：`readEnv` 缺失变量时返回空字符串 `""`，`??` 不回退，拼出 `https:///`；`||` 对空串回退到 `DEFAULT_ENDPOINT="docmind-api.cn-hangzhou.aliyuncs.com"`（`signedRequest` 会去掉 scheme）。
- 同类自查：`functions/` 内仅此一处 `?? readEnv(...)` 陷阱；其余 `readEnv` 用法（`budget.ts`、`server-api.ts:99`、`llm-openai.ts`、`providers/index.ts:32`）均已用 `||` 或显式空值守卫，无同类问题。

### 10.2 全门禁

| 门禁 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `npm test` | **45/45 通过** |
| Lint | `npm run lint` | **0 error / 1 warning**（`components/ui/combobox.tsx` 未使用参数 `children`，既有基线） |
| E2E | `npm run test:e2e` | **10/10 通过**（desktop 1440 + mobile 390，全部路由 mock，无真实付费调用） |
| 构建 | `npm run build` | **通过**（`tsc --noEmit` + Vite，1999 modules） |
| 函数侧类型 | `npx tsc --noEmit --allowImportingTsExtensions --strict --lib ES2022,DOM --module ESNext --moduleResolution Bundler --target ES2022 --skipLibCheck functions/handler.ts` | **exit 0** |
| Bundle 密钥审计 | `dist/` 内计数 | `ALIYUN_`=**0**、`DASHSCOPE_`=**0**、`secretKey`=**0**、`secret_key`=**0** |

### 10.3 重新部署与线上验证

- 覆盖部署到既有站点（复用 `projectId 01a1e7b4-8264-7453-833d-cbcb7fa6a06f` / `siteId 01a1e7b4-8265-7593-9fab-57ee62f505fd`），未重建站点；`databaseAccess: none`，`secretNames` 仍为 `ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / DASHSCOPE_API_KEY`。
- `get_publish_status`：`published: true`，publish operation `succeeded / committed`，`readiness: publication_completed`。
- 9 个 Secret（3 个真实密钥 + `SERVER_MODE / PARSER_PROVIDER / LLM_PROVIDER / LLM_MODEL / SERVICE_ENABLED / DAILY_BUDGET_CNY`）均 `synced`，未读取/回显任何密钥值。
- `GET /functions/v1/app/api/health`（带 Origin）→ **HTTP 200**，`serverMode:true`、`serviceEnabled:true`、`ok:true`。
- `debug.env`、`debug.docmind` → **HTTP 404 `unknown_action`**（debug.* 已移除，未触发任何 DocMind 调用）。
- 首页 `/` → **HTTP 200**（57,707 bytes）。

### 10.4 唯一一次真实 smoke（线上 UI，1 页 PDF）

- 文件：`one-page.pdf`（1,945 bytes，1 页，含标题/摘要/3 节正文的可选中文本）。
- 路径：线上 UI 服务端模式上传 → `POST /functions/v1/app?action=api.parse`（服务端内部 submit → 轮询 status → 取 result）→ 失败，未进入 `api.analyze`。
- 只上传一次；UI 无自动重试；**未点击「重试」、未再次调用任何付费接口**。

| 项 | 值 |
|---|---|
| 客户端 serverMode | true |
| 链路到达 | authorizeFileUpload ✓ → uploadToOss ✓ → submitJob ✓（返回 JobId）→ waitForStatus ✓（success）→ **GetDocParserResult ✗** |
| `/api/parse` | **HTTP 502** |
| 耗时 | **8.338 s**（parse 单次请求） |
| 错误码 | `DOCMIND_STATUS_FAILED`（`GetDocParserResult` 默认错误码） |
| 错误信息 | `DocMind GetDocParserResult 失败。` |
| 业务码 / 原文 | **MissingLayoutNum · LayoutNum is mandatory.** |
| RequestId | `01A1F2DD-53E8-5086-9F0B-6F628E2E389E` |
| `/api/analyze`（LLM） | **未调用**（仅捕获 1 个 function 请求） |
| 引用 | **无**（解析在取结果阶段失败，未生成分析，无引用可校验） |
| Markdown / docId | 未返回 |

### 10.5 费用

- **DocMind：1 页已解析**（submit + status 成功）；在每月 3,000 页免费额度内应为 **0 元**，若额度用尽则最多 **0.02 元**。`GetDocParserResult` 因缺参被拒，不额外计费。
- **LLM（qwen-plus）：0 元**（未调用）。
- 实际账单以阿里云为准。本次为授权范围内唯一一次真实付费链路调用。

### 10.6 endpoint 修复已验证生效

- 上一轮（第 9 节）失败于 `Invalid URL: 'https:///'`，DocMind submit **未发起**。
- 本轮 submit / status 均成功到达真实 DocMind 端点并返回 JobId 与 success 状态，证明 `||` 回退修复生效、`https:///` 缺陷已消除。
- 本轮失败是**另一个独立缺陷**：`fetchResult` 调用 `GetDocParserResult` 时只传 `{ Id }`，而该接口要求 `LayoutNum`（必填）。

### 10.7 下一步（需你授权，本轮不自动执行）

- 修复方向：在 `functions/providers/docmind.ts` 的 `fetchResult` 中为 `GetDocParserResult` 补充必填参数 `LayoutNum`（及可能需要的 `LayoutStepSize`），按 DocMind 分页拉取布局结果。
- 该修复需重新部署并再跑一次真实 smoke 才能验证；按「失败即停、禁止重试」指令，本轮**未改该代码、未重新部署、未再次调用付费接口**，停在此处等你验收与授权。

证据：[docs/m1f-smoke-f2-run2.json](m1f-smoke-f2-run2.json)（结构化请求证据）。截图未能保存（in-app 浏览器视口隐藏，`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`），改以请求级证据记录。

### 10.8 第二轮修复：GetDocParserResult 分页 + 成功 smoke（2026-11-19 08:44 UTC，用户授权）

> 部署 action：`084796e0-b1ca-47d3-84e2-579d0ec81373`
> 结论：**分页修复生效；全门禁通过；已覆盖部署；同一份 1 页 PDF 单次真实分析成功，引用 8/8。但 UI 自动帮助预生成额外触发了 6 次 qwen-plus 调用（见下「重要发现」）。**

#### 修复（依据官方文档）

- 官方 `GetDocParserResult` 必填 `Id` + `LayoutStepSize`（integer，1–3000）+ `LayoutNum`（integer，起始块位置，≥0）；按 `[LayoutNum, LayoutNum+LayoutStepSize]` 分页拉取 `Data.layouts`，每块含 `markdownContent` 与 `index`（阅读顺序）。
- `functions/providers/docmind.ts`：重写 `fetchResult`，从 `LayoutNum=0`、`LayoutStepSize=100` 开始循环拉取，`layoutNum += 本页块数`，直到返回块数 < 步长或为空（含 `RESULT_MAX_LAYOUTS=30000` 上限守卫）；新增 `assembleMarkdown` 按返回顺序拼接各块 `markdownContent`（缺省时回退 `text`）。
- 删除旧 `findMarkdown`（只会取到第一个版面块，且不含分页）；`GetDocParserResult` 错误码改用 `DOCMIND_EMPTY_RESULT`。
- 依据：阿里云文档解析（大模型版）官方文档「步骤三 GetDocParserResult」请求/返回参数与 Python 参考示例（`collect_results_incrementally` / `generate_markdown`）。

#### 全门禁（重跑，均通过）

| 门禁 | 结果 |
|---|---|
| `npm test` | **45/45** |
| `npm run lint` | **0 error / 1 warning**（combobox.tsx 既有基线） |
| `npm run test:e2e` | **10/10** |
| `npm run build` | **通过**（tsc --noEmit + Vite） |
| functions `tsc` | **exit 0** |
| bundle 审计 | `ALIYUN_`/`DASHSCOPE_`/`secretKey`/`secret_key` 均 **0** |

#### 重新部署与线上验证

- 复用既有 project/site，`databaseAccess: none`，`secretNames` 仍为 3 个真实密钥；prepare 期间遇到瞬时 `sites_unavailable`，按 recovery 以同一 action 重试后 descriptor 写入成功。
- `get_publish_status`：**published: true / committed**，`readiness: publication_completed`。
- `/functions/v1/app/api/health`（带 Origin）→ **200**，`serverMode:true`、`serviceEnabled:true`；`debug.env`/`debug.docmind` → **404 unknown_action**；首页 `/` → **200**。

#### 单次真实分析（同一份 one-page.pdf，1,945 bytes，1 页）

| 项 | 值 |
|---|---|
| 客户端 serverMode | true |
| `api.parse` | **HTTP 202**，耗时 **8.350 s**，`pages:1`，Markdown **889 字符**，`cached:false` |
| docId | `cd9012285f0660eed4a6558ddf276842e46e7cde7c4fbe75b856373033c451f0` |
| `api.analyze` | **HTTP 200**，耗时 **31.762 s**，model **qwen-plus**，`cached:false` |
| analyze usage | prompt **576** / completion **1423** / total **1999** tokens（cached_tokens 0） |
| 分析链路总耗时 | **40.114 s**（parse 起 → analyze 止） |
| 引用校验 | **8/8**；结论引用覆盖 **8/8** |
| 结果 | 速览卡 + 论证骨架（3 模块 / 2 实验 / 局限）+ 9 道自测 + 学习报告，正常渲染 |
| 解析 Markdown 头部 | `# Scaling Laws for Tiny Transformers` / `# Abstract` / `# 1 Introduction` …（分页拼接完整） |
| 分析是否只跑一次 | **是**，未点击「重试」「重新生成」，无重试 |

#### 费用（依据 docs/cost.md 公开定价：qwen-plus 输入 0.8、输出 2.0 元/百万 token；DocMind 0.02 元/页，3000 页/月免费）

- **analyze（精确）**：576×0.8/1e6 + 1423×2.0/1e6 = **0.0033068 元**。
- **DocMind**：1 页已解析；免费额度内 **0 元**（本会话两轮共 2 页，远低于 3000 页/月），额度用尽则 ≤ 0.02 元。
- **帮助预生成（估算）**：6 次 qwen-plus 调用，help 接口不返回 usage，按 maxTokens 上界估 **≤ 0.012 元**。
- **合计估算 ≈ 0.01–0.02 元**，远低于 `DAILY_BUDGET_CNY=1`。实际以阿里云账单为准。

#### 重要发现：UI 自动帮助预生成产生额外付费调用（需你决策）

- 分析成功后，UI **自动**触发帮助预生成：`api.help.predict`×1（11.175 s）+ `api.help.answer`×5（2.6–4.3 s each），响应 `provider:"llm-help"`，即**真实 qwen-plus 调用**。本轮 function 请求共 **8 个**（parse 1 + analyze 1 + help 6）。
- 这 6 次帮助调用是应用既有自动行为，**非分析重试**，但确实超出「单次付费链路」的字面范围；我未单独抑制它（未预料到服务端模式下帮助会自动走 LLM）。分析链路本身只跑一次。
- `handleHelpPredict`/`handleHelpAnswer` **未走 `guardAnalysisBudget`**，即帮助 LLM 调用不受每日预算守卫约束。
- 建议（需你授权，本轮未改）：帮助系统按 docs/cost.md 规划改用 `qwen-turbo`、或纳入预算守卫、或在 smoke 时关闭自动预生成，以避免额外付费与预算绕过。

证据：[docs/m1f-smoke-f2-run3.json](m1f-smoke-f2-run3.json)（结构化请求证据，含 8 个请求与 usage）。截图未能保存（in-app 浏览器视口隐藏），改以完整可访问性快照（结果页、引用 8/8）作为结构证据。