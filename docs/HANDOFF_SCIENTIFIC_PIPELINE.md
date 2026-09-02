# Open-Scientist 科学推理 Pipeline 交接文档

更新时间：2026-08-11  
仓库：`C:\vscode_project\ali_competition\scientist_code\open-scientist`  
分支：`ymy-branch`  
基线提交：`08a96ce`

## 1. 当前状态

科学现象输入、模型推理、多智能体协作、本地 FITS 处理、证据约束、自校正、验证任务执行、SQLite 持久化和前端回放已经完成一次端到端验证。

最终演示运行：

- 项目：`scientific-thinking-demo`
- Run ID：`run-1786373507807-8e55d269`
- 状态：`completed`
- 轮次：2
- 终止原因：`max_rounds_reached`
- SSE/持久化事件：1,789 条
- 模型调用：12 次
- Provider 返回的 reasoning tokens：24,215
- 公开推理摘要：23 条
- B 阶段智能体执行：14 次，即 7 个智能体 × 2 轮
- 智能体失败：0
- 假设：4 个
- 证据：42 条
- 确定性处理运行：2 次
- 验证任务：8 个，其中 2 个 `completed`、6 个 `planned`
- 最终 State 中的自校正：27 条；事件流中另含 1 条模型重试通知，共 28 个自校正事件

最终假设状态为 3 个 `candidate`、1 个 `uncertain`、0 个 `supported`。系统没有把单一或非唯一诊断错误升级为机制证实。

## 2. 服务当前状态

本次交接使用受管脚本重新启动并验证了两个开发服务：

| 服务                   | 地址                    | 当前结果                                 |
| ---------------------- | ----------------------- | ---------------------------------------- |
| Hono API / `tsx watch` | `http://127.0.0.1:3002` | 正在运行，`/api/health` 返回 `status=ok` |
| Next.js Web            | `http://localhost:5173` | 正在运行，HTTP 200                       |

进程状态和日志位于 `.runtime/local-services/`。运行 `corepack pnpm local:stop` 可只终止脚本启动的 API、Web，以及由同一次脚本启动的可选 HelixDB；项目数据库、运行事件和演示文件不会被删除。

## 3. 最终 Demo 输入

请求文件：`.runtime/scientific-thinking-demo.request.json`

现象：NOAA AR11158 本地观测窗口中，AIA 94 Å 与 131 Å 出现间歇性热通道增强，171 Å 与 193 Å 同时存在准周期强度变化，HMI 视向磁场持续演化。系统比较波动耗散、纳耀斑重联和二者耦合，并主动寻找反例。

问题：哪些真实处理指标能够区分这些机制；当前证据不能回答什么；下一步哪些任务在现有系统中确实可执行。

约束：

- 只使用已核验文献、本地 FITS 数据和登记的处理产物。
- 数据覆盖或模型判断不能直接充当机制证据。
- 单一非唯一指标不能把候选机制升级为 `supported`。

请求使用 `executionMode: "model-assisted"` 和 `maxRounds: 2`。

## 4. Pipeline 结构

### A：假设生成与资料定位

Librarian 先检索已登记文献、已有假设和本地太阳数据目录，再生成少量竞争或耦合假设。科学现象路径使用独立 schema，不再要求或填充 legacy `pythonCode`、F1 等字段。没有足够 grounding 时允许返回空假设或 `unknown`，不能用固定模板补齐内容。

### B：证据工作组

每轮先并行运行 4 个确定性程序，再顺序运行 3 个模型审阅智能体。模型智能体会收到前序确定性结果以及前一个模型的公开证据记录，从而形成真实的协作链，而不是彼此隔离的占位调用。

确定性程序如下：

| ID                                 | 职责                                                                              | 为什么确定性                                             |
| ---------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `looker-local-observation-catalog` | 核验 manifest、文件大小、仪器、波段、时间采样和覆盖                               | 只读取登记目录和元数据；相同输入、代码和参数得到相同结果 |
| `explorer-coronal-diagnostics`     | 使用 Python、Astropy、SciPy 读取 FITS 并计算 ROI 时序、相关、周期、峰值和变异指标 | 数值算法和输入快照固定，不调用模型生成测量值             |
| `oracle-local-counterexample`      | 比较同一活动区目标窗口与背景窗口                                                  | 使用固定对照、固定指标和已登记快照，不让模型改写结果     |
| `oracle-processing-fact-check`     | 复核 snapshot、processing run、artifact、checksum 和溯源关系                      | 对结构化记录和哈希执行规则校验，不依赖自然语言判断       |

三个模型审阅智能体为：

- `looker-model-observation-review`
- `explorer-model-diagnostic-review`
- `oracle-model-counterexample-review`

模型记录只能生成有边界的解释、冲突检查和候选任务；没有确定性处理溯源的模型记录保持 `unknown`，不能单独升级假设状态。

### C：综合、自校正和结论约束

Sisyphus 汇总证据后执行证据强度检查。假设只有同时满足至少两个独立 processing run、至少两种方法、且没有有效反证时，才可能升级为 `supported`。单一非唯一指标保持 `uncertain` 或 `candidate`。过强结论会触发 correction，并被改写成带证据边界的结论。

### D：验证规划与路由

Prometheus 为每个任务选择注册执行器或 `external`。注册执行器只接受自己完整支持的原子任务；包含 WCS、人工掩膜、DEM、波传播速度、能量闭合、MHD 等未实现步骤的复合任务不会因为包含某个关键词而被误判为可执行。

当前注册执行器：

- `coronal-timeseries-lag-v1`
- `coronal-background-variability-v1`
- `coronal-hot-channel-variability-v1`

最终 Demo 真正完成了：

| Task ID                   | 执行器                               | 新证据                          |
| ------------------------- | ------------------------------------ | ------------------------------- |
| `task-model-5586a70af2ee` | `coronal-timeseries-lag-v1`          | `e-diagnostic-1230865bbea0e361` |
| `task-model-d9c5d32954ab` | `coronal-hot-channel-variability-v1` | `e-diagnostic-3c8a55be09c7bbeb` |

另外 6 个任务保持 `planned`。这是能力边界的正确表达，不是执行失败。

## 5. 模型思考和 Qwen 配置

当前角色配置使用 `qwen3.5-plus + chat`。全局默认 thinking level 为 `medium`；Librarian 为 `low`；Looker 为 `medium`；Explore、Oracle、Sisyphus 和 Prometheus 为 `high`。

Qwen Chat 兼容层会将配置转换为原生请求字段：

- `thinkingLevel=off`：`enable_thinking=false`，不发送 `thinking_budget`。
- 其他级别：`enable_thinking=true`，并发送有上限的 `thinking_budget`。
- `minimal/low/medium/high/xhigh/max` 对应 512/1,024/2,048/4,096/8,192/16,384 tokens。
- Qwen Chat 请求会删除通用 `reasoning_effort`，避免网关兼容问题。

因此 `thinkingLevel=off` 可以修改，并且会真正关闭 Qwen thinking。最终 Demo 没有使用 `off`；事件中的 24,215 个 reasoning tokens 来自模型供应方返回的 usage telemetry。各角色统计如下：

| 角色              | 调用次数 | Reasoning tokens |
| ----------------- | -------: | ---------------: |
| Librarian         |        1 |              733 |
| Looker 模型审阅   |        3 |            4,662 |
| Explorer 模型审阅 |        2 |            2,986 |
| Oracle 模型审阅   |        2 |            6,787 |
| Sisyphus 综合     |        2 |            2,034 |
| Prometheus 规划   |        2 |            7,013 |

Looker 的首次结构化提交不完整。系统拒绝该结果进入 State，发出 `scientific.self-correction`，压缩提示并提高输出预算后重试成功。这个重试包含在 Looker 的 3 次调用中。

## 6. 前端同步展示

项目页：`http://localhost:5173/projects/scientific-thinking-demo`

重启后可查看：

- “科学工作台”：假设、证据、处理运行、验证任务和有边界结论。
- “智能体编排”：实际的 7 个 B 阶段工作者，并区分“确定性计算/核验”和“模型审阅”。
- “执行轨迹”：模型、provider、API mode、thinking level、reasoning tokens、工具调用、公开推理摘要和自校正事件。

前端使用与后端 State 相同的 SSE/SQLite chunks 构建视图，因此公开摘要、工具调用、证据和任务状态按同一事件序列同步。界面不展示或伪造供应商未返回的隐藏 Chain-of-Thought；它展示模型提交的公开、可审计 reasoning summary 和 reasoning-token telemetry。

REST 请求、SSE 启动/续传和 artifact URL 统一经过同一个 `NEXT_PUBLIC_API_BASE_URL`，不会再出现“实时流请求 API、历史回放却请求另一个 Next 代理”的分叉。切换项目会清空旧项目状态；历史恢复使用一次批量归约，并以持久化 `seq` 作为续传游标，避免 1,000 条以上事件逐条触发 React 更新或重连后重复追加。历史读取失败会显示错误状态，不再伪装成“尚未启动”。

编排页当前显示 4 个确定性并行工作项和 3 个按 Looker → Explorer → Oracle 串行执行的模型审阅。摘要只统计后端实际发出状态事件的 8 个运行节点；`B.dispatch` 与 `B.aggregate` 作为子图结构说明展示，不会造成已完成 run 仍显示 `8 / 10`。

本轮最终浏览器验收截图：

- `.runtime/frontend-audit-workbench.png`
- `.runtime/frontend-audit-orchestration.png`
- `.runtime/frontend-audit-trace.png`
- `.runtime/frontend-audit-mobile.png`

## 7. 数据与持久化

本次运行使用本地 `coronal-starter-v1` 数据登记和 NOAA 11158 目标/背景窗口。处理运行 ID：

- Round 1：`processing-coronal-bbb4ee7f5097f39e`
- Round 2：`processing-coronal-db6db714f5d2cdac`

项目持久化文件：

- `data/projects/scientific-thinking-demo/db.sqlite`
- `data/projects/scientific-thinking-demo/db.sqlite-wal`
- `data/projects/scientific-thinking-demo/db.sqlite-shm`
- `data/projects/scientific-thinking-demo/langgraph-checkpoints.sqlite`

运行 chunks 保存在项目 SQLite 的 `run_chunks` 表中；最终导出为 `.runtime/scientific-thinking-demo-v5.chunks.json`。本次最终运行目录存在，但没有生成 `science-loop.jsonl`，排查该运行时应以 SQLite chunks 和 `.runtime` 导出为准。

复制或备份项目数据库时，应在服务关闭状态下一并保留 `db.sqlite`、`db.sqlite-wal` 和 `db.sqlite-shm`，不能只复制主数据库文件。

## 8. 启动与复现

推荐从仓库根目录一键启动。脚本读取本机 `.env` 或当前 PowerShell 会话中的稳定 `CREDENTIAL_ENCRYPTION_KEY`，统一 API 地址，后台启动服务并等待健康检查：

```powershell
corepack pnpm local:start
```

需要同时启动 HelixDB 图数据库时，先确认 Docker Desktop 可用，再运行：

```powershell
corepack pnpm local:start:helix
```

停止由脚本管理的服务：

```powershell
corepack pnpm local:stop
```

也可从两个 PowerShell 终端手动启动。

API：

```powershell
$env:PORT = '3002'
corepack pnpm --filter @open-scientist/api dev
```

Web：

```powershell
corepack pnpm --filter @open-scientist/web dev
```

`apps/web/.env.local` 当前配置：

```text
API_BASE_URL=http://127.0.0.1:3002
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3002
```

启动后打开 `http://localhost:5173/projects/scientific-thinking-demo`。已有运行会从 SQLite 批量回放。开发模式应使用 `localhost` 作为 Web 主机名；本机验证中以 `127.0.0.1:5173` 打开会导致 Next.js HMR WebSocket 握手失败，而 `localhost:5173` 的 hydration、HMR 与历史恢复均正常。

重新提交同一 Demo：

```powershell
curl.exe -N `
  -D ".runtime\scientific-thinking-demo-rerun.headers.txt" `
  -H "Content-Type: application/json" `
  --data-binary "@.runtime\scientific-thinking-demo.request.json" `
  "http://127.0.0.1:3002/api/projects/scientific-thinking-demo/runs" `
  -o ".runtime\scientific-thinking-demo-rerun.sse"
```

响应头 `x-workflow-run-id` 给出新 Run ID。若迁移到新机器，先设置稳定且本机保密的 `CREDENTIAL_ENCRYPTION_KEY`，再通过设置页或 credentials API 新建模型凭据。`data/settings.json` 只保存 `credentialId`；不要把 API Key 写进 settings、本文档或 Git。

## 9. 验证记录

最终 Demo 前完成了以下工程验证：

- 全仓递归 TypeScript typecheck 通过。
- 全仓递归 build 通过。
- Qwen model compatibility 测试：12 项通过。
- 科学 schema、context、evidence、graph、local-grounded 和自校正相关定向测试通过。
- 最终 context 修复后的定向回归测试：11 项通过；覆盖第 18 条任务触发证据经过两次 B 投影后仍保留任务 → 证据 → 假设关系。
- 浏览器验收确认工作台显示最终 Run、Round 2、第二次处理运行和已完成任务。
- 浏览器验收确认执行轨迹显示模型运行、reasoning tokens、自校正和公开推理摘要。
- 浏览器验收确认编排页显示实际工作者及两种执行方式标签。
- 前端定向测试 14 项通过，覆盖统一 API 地址、回放 State、7 个工作项语义、模型调用统计和 planned task 状态。
- Next.js production build 通过；生产模式浏览器回放无 console error、page error 或 failed request。
- 最终 run 在工作台恢复为 Round 2、2 次处理运行；执行轨迹显示 12 次真实模型调用和 24,215 reasoning tokens。
- 执行轨迹刷新前后均为 215 个投影条目，未发生重复或丢失；390 px 移动端无页面级横向溢出。
- 全仓最终测试：59 个测试文件通过，494 项通过，1 项按设计跳过；全仓 11 个包 typecheck 与 build 均通过。

合并前建议重新执行：

```powershell
corepack pnpm run typecheck
corepack pnpm run build
corepack pnpm test
```

## 10. 关键实现位置

| 内容                      | 文件                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| Qwen thinking 参数适配    | `packages/config/src/models.ts`                                               |
| 科学假设和验证任务 schema | `packages/schema/src/hypothesis.ts`、`packages/schema/src/scientific-loop.ts` |
| 科学图和四阶段编排        | `packages/agents/src/scientific-loop/scientific-graph.ts`                     |
| 确定性/模型智能体及执行器 | `packages/agents/src/scientific-loop/default-services.ts`                     |
| 结构化模型重试            | `packages/agents/src/scientific-loop/model-assisted.ts`                       |
| 分阶段上下文投影          | `packages/agents/src/scientific-loop/context-builder.ts`                      |
| 模型 telemetry 事件       | `packages/agents/src/shared/run-workflow.ts`                                  |
| API 运行和 chunks 恢复    | `apps/api/src/routes/runs.ts`、`apps/api/src/lib/run-stream.ts`               |
| 前端执行轨迹              | `apps/web/src/components/visualizers/scientific-trace.tsx`                    |
| 前端智能体编排            | `apps/web/src/components/visualizers/scientific-orchestration.tsx`            |
| 前端状态投影              | `apps/web/src/lib/workbench/state.ts`                                         |
| 前端 API 同源与历史续传   | `apps/web/src/lib/api/client.ts`、`apps/web/src/lib/hooks/useRunStream.ts`    |
| FITS 诊断程序             | `scripts/analyze_coronal_window.py`                                           |

## 11. 已知边界

- 本次结果证明系统能够运行科学推理闭环，不等于已经确定 NOAA 11158 的主导加热机制。
- 当前没有光谱、Doppler、非热展宽、DEM、完整 WCS 重投影、人工日冕环掩膜、传播速度、能流闭合或观测同化 MHD 结果。
- `max_rounds_reached` 表示按 Demo 设置完成两轮后停止，不表示科学问题已经收敛。
- 6 个 `planned` 任务需要新执行器、外部数据或人工复核后才能继续。
- 前端展示公开推理摘要，不展示模型隐藏思维链。
- 工作区当前包含大量未提交修改和运行产物；本次没有创建 Git commit。提交前应逐项审阅 `git status`，不要直接提交 `.runtime`、日志、数据库或本机凭据。

## 12. 建议的后续顺序

1. 先整理和拆分当前代码变更，运行完整验证后提交核心代码与测试。
2. 将 `.runtime` 保留为本机验收证据，另生成不含凭据和绝对路径的最小可复现 Demo 包。
3. 优先实现 WCS 对齐/人工 ROI、DEM 或光谱诊断执行器，再开放相应任务的自动完成状态。
4. 为长事件回放增加分页或虚拟化，缩短 1,000 条以上 chunks 的首次加载时间。
5. 增加可导出的 evidence bundle，固定输入摘要、处理版本、哈希、指标、反例、限制和任务状态。
