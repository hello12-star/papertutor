# 阿里云文档解析选型（M0 调研）

- 调研日期：2026-11-17
- 状态：官方文档已核对；**边缘诊断已发布并通过 45 秒执行 / 流式 / 出网测试**；DocMind 1 页烟测等待 AccessKey
- 结论：DocMind 可用性高、免费额度足够；集成复杂度主要在 AccessKey 签名与文件上传方式。Qwen-Long 是更省事的降级方案。

## 1. 首选：文档智能（Document Mind）— 文档解析（大模型版）

### 产品与接口

- 产品：阿里云文档智能（Document Mind）
- 能力：文档解析（大模型版）
- 调用方式：异步三步
  1. `SubmitDocParserJob`（公网 URL）或 `SubmitDocParserJobAdvance`（本地文件流）提交任务
  2. `QueryDocParserStatus` 查询状态
  3. `GetDocParserResult` 获取结果
- Endpoint：`docmind-api.cn-hangzhou.aliyuncs.com`（IPv6 使用 `docmind-api-dualstack.cn-hangzhou.aliyuncs.com`）
- 输出：`OutputFormat=markdown` 可返回 Markdown；同时提供版面、表格等结构化信息
- 关键参数：
  - `FormulaEnhancement`：公式识别增强，默认关闭
  - `LlmEnhancement` / `EnhancementMode=VLM`：大模型/VLM 增强，会显著增加耗时与每页费用
  - `OutputHtmlTable`、`PageIndex`、`OssBucket/OssEndpoint`（OSS 托管场景）
- 文件限制（URL 方式）：单文件 ≤ 150MB、≤ 1.5 万页；本地流方式同样支持
- 结果查询窗口：任务提交后 24 小时内可查询

### 计费与免费额度

- 计费：图文文档按页计费；PDF/Word/PPT 按实际页数，图片按张数
- 免费额度：文档解析（大模型版）图文文档 **每月 3000 页**，当月用完即止；超出按量付费
- 该免费额度足以覆盖比赛演示与评测（3 篇示例 + 数十次测试）

### 鉴权与集成风险

- 需要阿里云 AccessKey，并给 RAM 账号授予 `AliyunDocmindFullAccess` 权限
- 官方提供 Node.js SDK：`@alicloud/docmind-api20220711`、`@alicloud/credentials`、`@alicloud/tea-util`
- **Qoder Sites Function 是 Deno Edge 运行时**，官方 SDK 为 CommonJS 体系，能否直接运行需要实测；备选是手写 RPC 签名（HMAC-SHA1）或用 URL 方式提交
- URL 方式要求文件有公网可访问地址；若不在阿里云 OSS，就需要先解决临时文件托管/签名 URL
- 本地流方式（Advance API）需要实现 multipart 签名，工作量更高

## 2. 降级：百炼 Qwen-Long 文件接口

- 文件上传：百炼 OpenAI 兼容文件接口，`purpose=file-extract`
- 支持 PDF、DOCX、TXT、MD 等；单文件 ≤ 150MB；文件上传、存储、解析本身不额外计费
- 通过 `file_id` 在 system 消息中引用；Qwen-Long 支持 1000 万 Token 上下文
- 计费：仅按模型调用的输入 Token 计费
- 代价：公式、表格、章节层级的结构化质量弱于 DocMind；UI 必须标注“公式/表格可能不完整”
- 优点：只需要 `DASHSCOPE_API_KEY`，不需要 AccessKey、OSS 或额外签名，是当前工程复杂度最低的服务端解析方案

## 3. Qoder Sites Functions 现状（基于现有站点的实测）

已验证：

- 函数可部署，公网可访问
- 请求体 9.8MB 可被网关接受
- 函数可出网访问外部 API（MinerU 实测）
- POST 请求网关要求同源 `Origin`，浏览器正常携带
- 异步任务可通过“提交/轮询”拆成多次短请求，避免单次长执行

未验证：

- 单次函数执行时长上限、流式响应能力、内存上限
- 跨实例共享状态（影响服务端预算/限流的实现方式）

## 4. 结论与待确认

- DocMind 在能力与免费额度上满足比赛需求；主要风险是 AccessKey 签名/文件上传在 Deno Function 中的兼容性，以及是否需要 OSS。
- Qwen-Long 集成成本最低，但解析结构质量较弱，需要在 UI 明示。
- **账号是否开通 DocMind、是否接受 Qwen-Long 降级，需要用户确认后才能继续 M1。**

## 5. M0 诊断进展（2026-11-17）

已在本地验证：

- DocMind RPC 只接受 **POST**；GET 返回 `UnsupportedHTTPMethod`
- 手写 HMAC-SHA1 RPC 签名可被服务端接受：用测试 AccessKey 调用返回 `InvalidAccessKeyId.NotFound`，说明 HTTP 方法、签名与参数格式已通过校验，只差真实 AccessKey
- 函数本地适配器：`sleep 2s`、分块流式输出、DashScope 出网（未带 Key 返回 401）均正常
- 无需依赖官方 Node SDK，避免 Deno/CommonJS 兼容风险

诊断部署状态：

- 已准备一次临时诊断部署，加入 `debug.timeout`、`debug.stream`、`debug.fetch`、`debug.env`、`debug.docmind` 端点；测试后立即移除
- 发布被 Secrets 缺失阻塞：`ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET`
- `DOCMIND_ENDPOINT` 有默认值 `docmind-api.cn-hangzhou.aliyuncs.com`，未声明为必填 Secret

### 5.1 边缘诊断结果（无凭证版本已发布）

| 测试 | 结果 | 结论 |
|---|---|---|
| `debug.timeout?ms=45000` | HTTP 200，45.0 秒返回 | 单次函数执行 ≥45 秒可行 |
| `debug.stream`（10 块，间隔 1 秒） | 块按约 1 秒间隔到达，总计 10.3 秒 | 边缘支持真实流式响应 |
| `debug.fetch?target=dashscope` | 401（未带 Key） | 函数出网正常 |
| `debug.env` | 全部 Secret 为 false | 等待用户配置 |
| `debug.docmind` | `missing_aliyun_secrets` | 等待真实 AccessKey |

架构结论：

- 服务端 LLM 可以采用**流式转发**，不必因函数超时改用 FC + OSS
- 单次 45 秒已覆盖多数分节生成；长任务可用流式保活
- DocMind 仍需要一个可公网访问的文件 URL（或实现本地流 Advance API）；这是 M1 的主要待解点

待完成：

1. 在 Sites Settings 中填入两个 AccessKey Secret（值不进对话、不进 Git）
2. 复用带 secretNames 的准备版本发布，实测 1 页 DocMind 提交/轮询/结果
3. 把结果补入本文档，然后移除诊断端点

### 5.2 2026-11-17 复查

- `debug.env` 复查：`ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET`、`DOCMIND_ENDPOINT`、`DASHSCOPE_API_KEY` 均为 `false`
- 按指令未发起任何 DocMind 付费调用
- 当前已发布的无 Secret 版本没有声明 `secretNames`；后加的 Secret 可能不会自动注入。配置后先复查 `debug.env`，若仍为 false，则发布已准备的带 `secretNames` 版本（同一份诊断代码）后再烟测

## 参考

- [文档解析（大模型版）官方文档](https://help.aliyun.com/zh/document-mind/developer-reference/document-parsing-large-model-version)
- [文档智能免费额度](https://help.aliyun.com/zh/document-mind/product-overview/free-quota)
- [文档智能计费概述](https://help.aliyun.com/zh/document-mind/product-overview/billing-overview)
- [百炼 OpenAI 文件接口兼容](https://help.aliyun.com/zh/model-studio/openai-file-interface)
- [Qwen-Long 长上下文与文件引用](https://help.aliyun.com/zh/model-studio/long-context-qwen-long)
- [文档智能 API 权限说明](https://help.aliyun.com/document_detail/2543823.html)