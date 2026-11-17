# PaperTutor P0 验收清单与测试映射

> 基线分支：`feat/m1e2-docs-audit`（从 `feat/m1e1-cancel-retry` 9e9403c 新建）。
> 当前自动化结果：`npm test` **41/41 通过**；`npm run build` 通过（前端 `tsc --noEmit` + Vite）；函数侧 `tsc` 通过。
> 本文区分三类证据：**自动化测试**（`node --test`）、**浏览器验收**（Playwright + Edge，脚本为临时 QA，不入库）、**未验证**（需要真实环境或人工）。

## 1. 自动化测试总览

| 测试文件 | 用例数 | 主要覆盖点 |
|---|---:|---|
| `tests/server-skeleton.test.mjs` | 12 | `SERVER_MODE` 开关；缺 DocMind/LLM 环境变量时不发起外部 fetch；mock parser + mock LLM 端到端与缓存键；错误码；help predict/answer；help 无外部 fetch；`SERVICE_ENABLED=false` 503；每日预算 402；生产环境拒绝 mock provider |
| `tests/help-core.test.mjs` | 8 | 帮助缓存键前缀/版本；缓存命中不调用 fetcher；缓存未命中写入；超时/离线回退静态帮助；预测分数范围/排序/屏幕过滤；预测失败回退；启动预生成；同一控件最多重生成一次 |
| `tests/export-history.test.mjs` | 6 | 导出 Markdown 章节；大纲；自测题离线生成；文件名清洗；历史去重/最多 10 条；历史标题回退 |
| `tests/demo-papers.test.mjs` | 4 | 3 篇示例索引与 approved 状态；只含引用节选/无密钥字段；速览/骨架/公式完整；每条引用都能在节选中匹配 |
| `tests/study-tools.test.mjs` | 3 | 自测答案与引用；学习报告基于本地进度生成；从 Markdown 提取公式卡 |
| `tests/budget.test.mjs` | 4 | 停服 503；预算耗尽 402 且不超支；限流 429 与窗口重置；跨 UTC 日重置 |
| `tests/parse-control.test.mjs` | 4 | 同一时间只允许一个解析请求；取消中止并清空 busy；晚到完成不释放新请求；完成后可重试 |
| **合计** | **41** | — |

运行命令：

```bash
npm test
npm run build
npx tsc --noEmit --allowImportingTsExtensions --strict \
  --lib ES2022,DOM --module ESNext --moduleResolution Bundler \
  --target ES2022 --skipLibCheck functions/handler.ts
```

说明：项目当前**没有 lint 脚本**；`npm run build` 只包含前端 `tsc --noEmit` 与 Vite 构建。Playwright 浏览器脚本放在临时目录 `/tmp/qa`，未纳入 CI。

## 2. P0 验收项与现有证据

| P0 验收项 | 自动化测试 | 浏览器/人工证据 | 状态 |
|---|---|---|---|
| 全新浏览器、无 Key，点示例 2 秒内出完整速览与骨架 | `demo-papers`：3 篇 approved、完整材料、引用可校验 | `docs/trackb`：示例加载 314–553 ms；三篇均可打开 | 数据/交互已覆盖；2 秒阈值无自动化性能测试 |
| 真实 10 页 PDF：进度可见、可取消、失败可重试、可看原文 | `parse-control`：取消/重试/晚到响应；`server-skeleton`：mock 解析端到端 | `docs/m1e1`：1440/390 的 3/10 进度、取消回首页、失败重试、同一文件；`docs/m1e2`：320–430 进度/失败页 | mock + 浏览器通过；**真实 MinerU 未验证** |
| verified 引用 100% 可点击跳转并高亮；未定位有提示 | `demo-papers`：所有示例引用可匹配；`export-history`：导出包含引用 | M1-A 浏览器验收：引用定位抽屉、偏移高亮、未定位提示；Track B 示例结果页 | 示例/夹具通过；**真实论文 100% 未验证** |
| 四步引导可完成、刷新保留；自测可展开答案；学习报告可生成 | `export-history`：自测题/导出；`study-tools`：答案/报告 | M1-D1：四步导航/历史；Track B：自测展开/学习报告下载 | 部分覆盖；刷新后进度保留无自动化断言 |
| 帮助预生成 <200ms；未命中 <6s；离线/失败有兜底；无报错弹窗 | `help-core`：缓存命中/未命中/超时回退/预生成/重生成限制；`server-skeleton`：help mock 无外部 fetch | M1-C 浏览器验收：cache/api/fallback、popover/sheet、0 console error | 逻辑通过；**延迟阈值未自动化/未计时** |
| 方法流程图、实验-结论表、公式卡桌面和移动可读 | `study-tools`：公式提取 | Track B：流程图、实验表、公式卡；M1-E2：320–430 无横向滚动 | 部分覆盖；无 DOM/视觉回归测试 |
| 前端 bundle/localStorage/网络无密钥；付费接口只允许本站 Origin；无公开免鉴权代理；无 CORS `*` | `demo-papers`：示例 JSON 无密钥字段；`server-skeleton`：生产拒绝 mock | Track B/M1-E1 bundle 审计：QA 夹具/mock-llm/env 名均 0；`debug.env` 只读检查 | **部署后 Origin/CORS/网络请求未验证**；无自动化密钥扫描 |
| 模拟超预算 402；模拟停服 503；3 篇成本写入 `docs/cost.md`；每日上限生效 | `budget`：503/402/429/跨日；`server-skeleton`：SERVICE_ENABLED 503、预算 402 无 LLM fetch | [docs/cost.md](cost.md) 已完成估算 | 逻辑通过；**每日上限仍是进程内 mock，未持久化** |
| build/lint/typecheck/Playwright 冒烟；320/360/390/414 无横向滚动；Lighthouse 阈值 | `npm run build`（tsc + Vite）通过 | M1-E2：320/360/390/414/430 四类页面 scrollWidth==clientWidth、0 console error；见 [docs/m1e2/mobile-qa.json](m1e2/mobile-qa.json) | **lint、Playwright CI、Lighthouse 未完成** |

> M1-E2 元素扫描中，进度条内部填充元素出现负 `left`（进度为 0 时的 transform），其父容器 `overflow-hidden`，页面 `scrollWidth` 未变化；不计为页面横向滚动。

## 3. 仍缺真实环境验证（单独列出）

以下三项是当前最关键的未验证项，均**没有**用真实付费/线上环境证明：

### 3.1 真实 MinerU 解析

- 现状：M1-E1 使用**生成的 10 页 PDF + Playwright 拦截 MinerU submit/status** 验证进度、取消、重试；没有调用真实 MinerU。
- 未验证：真实 10 页 PDF 的实际页数/耗时/限流/失败码；真实网络下的取消是否及时中止；真实 Markdown 质量。
- 证据缺口：`docs/m1e1`、`docs/m1e2` 都是 mock 拦截；不是真实解析。

### 3.2 真实 LLM 调用

- 现状：`DASHSCOPE_API_KEY` 仍为 `false`；没有用真实 qwen-plus/qwen-max 生成速览/骨架/帮助。
- 未验证：真实 JSON 结构、输出截断、上下文超限、429/402、超时、模型可用性/免费额度；`docs/cost.md` 的价格是公开定价估算，不是实际账单。
- 证据缺口：`server-skeleton` 使用 mock LLM；`docs/trackb` 的 3 篇示例是预生成 JSON，不是现场调用。

### 3.3 部署后的 Origin / 超时 / 流式

- 现状：线上仍是 M0 诊断版；M1-A/B/C/D1/E1/E2 未部署；`/functions/v1/app/api/*` 没有在 Sites Edge 上验收。
- 未验证：同源 `Origin` 网关、`SERVER_MODE` 生产行为、45 秒以上的长任务、真实流式响应、函数冷启动/并发、Edge 与本地 Node 的兼容性。
- 证据缺口：M0 只验证过 45 秒 sleep、10 个流式 chunk、9.8MB 请求体；不能外推到正式 API。

## 4. 其他仍需补齐的项

- **Lighthouse**：移动端 Performance/Accessibility/Best Practices ≥85、桌面 ≥90 尚未跑。
- **lint**：项目没有 lint 脚本，P0 的 lint 要求尚未满足。
- **Playwright 正式化**：当前浏览器脚本是 `/tmp/qa` 的临时脚本；没有纳入仓库/CI，也没有固定 10 页 PDF fixture。
- **真实论文引用定位**：M1-A 和 Track B 主要验证夹具/示例；真实论文的 100% 定位/高亮仍需抽样。
- **帮助延迟**：<200ms / <6s 没有自动化计时；需要浏览器 Performance 计时。
- **四步刷新保留**：M1-D1 验证了导航/历史，但没有自动化断言“刷新后进度保留”。
- **预算持久化**：`functions/budget.ts` 是进程内计数，冷启动重置；上线前必须改为持久化。
- **真实 DocMind smoke**：Secret 仍为 false；`PARSER_NOT_IMPLEMENTED` 仍未替换为真实提交/轮询。
- **真实移动设备**：M1-E2 使用 Edge 模拟视口；未在 iOS Safari/Android Chrome 真机验证。

## 5. 证据索引

| 证据 | 位置 |
|---|---|
| Track B 示例/公式/流程图/实验表/自测/报告截图 | [docs/trackb/](trackb/) |
| M1-E1 取消/重试 1440/390 截图 | [docs/m1e1/](m1e1/) |
| M1-E2 320/360/390/414/430 四类页面截图与 JSON | [docs/m1e2/](m1e2/) |
| 3 篇示例成本估算 | [docs/cost.md](cost.md) |
| 引用定位/响应式历史证据 | `docs/m1a/`、`docs/m1d1/` |
| 测试命令与结果 | `npm test`（41/41）、`npm run build`、函数侧 `tsc` |

## 6. 结论

- **已达到自动化/本地证据**：示例演示、引用校验（示例）、帮助缓存/回退、预算 402/503、解析取消/重试、学习报告、320–430 无横向滚动。
- **不能宣称已达到**：真实 MinerU、真实 LLM、部署后的 Origin/超时/流式、Lighthouse、lint、Playwright CI。
- 比赛提交前，至少应完成第 3 节三项真实环境验证，并补齐 Lighthouse 与 lint；否则应在验收说明中明确标注“本地/mock 验证”。
