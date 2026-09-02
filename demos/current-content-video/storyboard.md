# Open-Scientist 闭环架构视频分镜 v2

> 当前 5–6 分钟长片以同目录的 [`storyboard-5m45s.md`](./storyboard-5m45s.md) 和 [`motion-5m45s.html`](./motion-5m45s.html) 为准；本文件保留 175 秒版本，作为早期结构基线。

## 目标

这版视频不再把 Open-Scientist 展示成“几个 Agent 卡片加一张结果图”，而是复现一次真实 scientific run：观众先看到系统的代码分层，再看到一个现象如何进入 LangGraph，如何经过 A/B/C/D 四个阶段，如何产出证据和验证任务，最后如何由 `D.route` 决定回到下一轮或停止。

视频以现有 `outputs/ar11158-qwen-demo/scientific-result.json` 为唯一结果数据源。所有数字、状态和任务名称都从这个 JSON 绑定，不在页面里手写另一份结果。

## 真实框架主线

```text
POST /api/projects/:project/runs
        │
        ▼
scientificLoopWorkflow()
        │  LangGraph checkpoint / run-scoped State
        ▼
START → A.generate → A.verify → B.run → BC.verify
                                      │
                                      ▼
                              C.verify → C.synthesize
                                      │
                                      ▼
                              D.plan → D.route
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                    route = A                 route = B
                  回到 A.generate             回到 B.run
                         └────────────┬────────────┘
                                      ▼
                                     END
```

### 对应代码位置

| 视频中展示的层 | 实际代码/产物 | 在闭环里的作用 |
|---|---|---|
| API 与事件流 | `apps/api/src/routes/runs.ts`、`apps/api/src/lib/run-stream.ts` | 接收 run，向前端/SSE 发出节点、Agent、证据和完成事件；支持流式查看与恢复 |
| 工作流入口 | `packages/agents/src/scientific-loop/workflow.ts` | 创建运行时和默认服务，调用根图，结束后持久化 scientific records |
| 根编排图 | `packages/agents/src/scientific-loop/scientific-graph.ts` | 实现 A/B/C/D 节点、状态、条件路由、轮次和终止原因 |
| 上下文投影 | `packages/agents/src/scientific-loop/context-builder.ts` | 按阶段和能力给 Agent 投影可用的现象、假设、证据和任务 |
| B 证据子图 | `packages/agents/src/scientific-loop/evidence-subgraph.ts` | `B.dispatch → B.worker → B.aggregate`，并行调度确定性 Agent |
| 默认服务与 Agent | `packages/agents/src/scientific-loop/default-services.ts` | 注册 Looker、Explorer、Oracle、fact-check，以及模型审阅器和验证执行器 |
| 数据处理 | `scripts/analyze_coronal_window.py`、`packages/tools/src/` | 读取 SDO/AIA/HMI FITS，生成指标、图像和可追溯处理产物 |
| 证据审计 | `evidence-promotion.ts`、`evidence-gate.ts` | 校验 schema、样本、处理 provenance、独立事件、观测族、方法族和 holdout |
| 结果存储 | `packages/storage/src/repo/`、LangGraph runtime | 保存 run、checkpoint、hypothesis、evidence、correction、validation task 和 artifact |

## 现有运行的事实锚点

- 运行模式：`model-assisted`
- 运行轮次：2
- 候选假设：3 条，最终状态为 `candidate / uncertain / candidate`
- Agent 执行记录：14 条，其中 13 条完成、1 条跳过
- 证据记录：32 条，其中 `support=2`、`unknown=30`、`contradict=0`
- 修正记录：23 条，Round 1 为 14 条，Round 2 为 9 条
- 验证任务：12 条，其中 3 条已完成、9 条仍为 `planned`
- 最终科学状态：`needs_data`
- 终止原因：`max_rounds_reached`
- 重要解释：本轮产生了可审计的局部支持，但没有通过严格支持门槛；视频不能把结果说成“机制已被证明”。

## 总时长与表达方式

- 目标时长：约 175 秒
- 画幅：1920×1080
- 帧率：30 fps
- 形式：无声字幕版；字幕承担旁白信息，后续可以在同一时间轴上添加中文配音
- 画面语言：太阳观测任务控制台 + 可读的代码节点 + 证据账本
- 视觉原则：每个场景只回答一个问题；每个节点同时显示 `stage / input / output / status`
- 不使用虚构的模型思维链；只展示已落盘的事件、结构化输出、审计规则和结果摘要

## 分镜表

| # | 时间 | 场景与目的 | 画面动作 | 屏幕文案/旁白要点 | 数据/代码绑定 |
|---:|---:|---|---|---|---|
| 01 | 0–8s | 开场：系统到底解决什么问题 | 黑底太阳观测窗口逐渐展开；中央不是“AI”字样，而是一条可回放的闭环：`phenomenon → evidence → validation → next round` | “Open-Scientist 把一次科研问题变成可追踪、可复核、可继续执行的闭环。” | 标题来自项目名；闭环四段来自 scientific loop contract |
| 02 | 8–20s | 展示真实框架结构 | 画面分成 5 层并逐层点亮：API/SSE、Agents/LangGraph、Tools/MCP、Storage/Checkpoint、Artifacts/Result | “入口负责接收和发事件；编排图负责推进状态；工具负责计算；存储负责留下证据链。” | `routes/runs.ts`、`run-stream.ts`、`workflow.ts`、`scientific-graph.ts`、`packages/storage` |
| 03 | 20–29s | 输入一个真实现象 | 左侧显示 NOAA AR11158；右侧列出 AIA 94/131/171/193 Å 与 HMI；底部显示研究约束 | “问题不是让模型自由发挥，而是比较波动耗散、纳耀斑重联和耦合机制，并主动寻找反例。” | `examples/ar11158-scientific-demo.request.json`、phenomenon input |
| 04 | 29–40s | 运行从哪里开始 | `POST /runs` 进入 `scientificLoopWorkflow`；随后出现 `createProjectScientificRuntime`、checkpoint 和 `START` | “每次运行都有 project、run id 和可恢复的状态。根图从 A.generate 开始，而不是从一段不可追踪的对话开始。” | `workflow.ts`、`langgraph-runtime.ts`、`scientific-graph.ts` |
| 05 | 40–52s | A 阶段：生成并检查假设 | 三条假设从 `A.generate` 流出，经过 `A.verify` 的 schema/预测/证伪条件检查；每条带 confidence 和 status | “A 阶段把研究问题变成可检验命题：每条假设必须有预测，也必须有证伪条件。” | 3 hypotheses；`A.generate`、`A.verify` |
| 06 | 52–66s | B 阶段：证据工作组如何运行 | `B.run` 展开为 `B.dispatch → B.worker → B.aggregate`；四个确定性 Agent 并行出现，再接三个模型审阅角色 | “Looker 审计观测目录，Explorer 执行诊断，Oracle 寻找反例，fact-check 复核处理溯源；模型审阅器只能读取上游结构化记录。” | `evidence-subgraph.ts`、`default-services.ts`；本次每轮注册 7 类执行角色 |
| 07 | 66–79s | Explorer 真正做了什么 | 画面从 Agent 节点进入 Python 处理器：manifest → FITS → ROI/时间序列 → metrics + figure；右侧生成 snapshot、processing run、artifact | “数据工作不是一张装饰图。处理器记录输入快照、参数、代码版本、输出文件和 checksum。” | `scripts/analyze_coronal_window.py`、`local-processing.ts`、`packages/storage` |
| 08 | 79–91s | BC 阶段：证据先过 provenance | 候选 `support` 进入审计闸门；缺少样本、处理运行或产物 checksum 的记录被降级为 `unknown`；画面展示 `support / contradict / unknown` 三态 | “模型说支持，不等于系统接受支持。证据必须绑定假设、样本、处理产物和可复核来源。” | `promoteEvidence()`、`verifyLocalEvidenceProvenance()`、`EvidenceRecordSchema` |
| 09 | 91–104s | C 阶段：结论与严格 support gate | 左侧显示 `C.synthesize` 生成 bounded conclusion；右侧 gate 清单逐项打勾/留空：独立事件、原始谱系、观测族、方法族、holdout、全预测覆盖 | “本次有 2 条 support，但仍缺少独立事件、holdout 和完整预测覆盖，所以结论保持 uncertain/needs_data。” | `C.synthesize`、`C.verify`、`assessSupportGate()`；2/30/0 evidence summary |
| 10 | 104–118s | D 阶段：把缺口变成任务 | 12 条任务按 `executorId` 分成“现在可执行”和“需要数据/外部执行器”；展示 3 个已完成、9 个 planned | “系统不把未知藏起来，而是把未知转成下一步任务，并记录成功标准、失败标准和区分性结果。” | `D.plan`、`ValidationTaskSchema`；12 tasks |
| 11 | 118–130s | D.route 真正形成闭环 | 任务卡沿两条路分叉：`route=A` 回到模型/机制更新，`route=B` 回到数据/证据执行；同时显示 `new evidence / new tasks / maxRounds` 判定 | “D.route 不凭感觉继续。它根据新证据、新任务、可执行性和轮次上限决定下一步，或者明确结束。” | `D.route`、`shouldContinueScientificLoop()`、`decideNextRoute()` |
| 12 | 130–142s | 回放本次两轮运行 | 时间轴显示 Round 1：19 条证据、6 个任务、14 条修正；Round 2：13 条证据、6 个任务、9 条修正；一个 Agent 因不可运行被 skip | “Round 2 不是重新播放 Round 1，而是消费上一轮的证据和任务；重复任务会按 fingerprint 去重。” | result JSON 按 `round` 聚合；`deduplicateValidationTasks()` |
| 13 | 142–153s | 结果如何落盘和可恢复 | SSE 事件流落入 run chunks；右侧显示 SQLite scientific records、LangGraph checkpoint、metrics/figure artifacts；出现 `GET /stream` 与 resume 关系 | “运行结束后，节点事件、证据、修正、任务和产物都能回看；中断后可以从 checkpoint 恢复，而不是从头猜测。” | `run-stream.ts`、`persistScientificRecords()`、API stream/resume routes |
| 14 | 153–162s | 当前结论：诚实地停在 needs_data | 三条假设显示 `candidate / uncertain / candidate`；证据计数停在 `2 support / 30 unknown / 0 contradict`；红色警告不代表失败，而是证据边界 | “这次运行证明了闭环能完成，不证明某一种太阳加热机制已经成立。” | `scientificStatus=needs_data`、`terminationReason=max_rounds_reached` |
| 15 | 162–175s | 下一轮真正要做什么 | 依次点亮 HMI 足点速度相关、94→131→193→171 冷却时延、时间频率分析、手工 ROI、IRIS/EIS 光谱；最后回到 `D.route` | “下一轮从任务继续：补数据、补诊断、补 holdout，再让同一套 gate 重新判断。” | `validationTasks` 中的 future source ids 与 executor ids |

## HyperFrames 实现约束

1. 保留 15 个叙事章节，但在实现层拆成 24 个带 `data-start`、`data-duration`、`data-track-index` 的紧凑 `clip`；根节点总时长设为 175 秒。
2. 每个节点显示真实阶段标识，例如 `A.generate`、`B.dispatch`、`BC.verify`、`C.verify`、`D.route`，不要只显示“Agent 1/2/3”。
3. `data.js` 从 `scientific-result.json` 生成以下派生数据：`hypotheses`、`evidenceByStatus`、`tasksByReadiness`、`agentsByRound`、`correctionsByRound`、`frameworkLayers`、`nextTaskGroups`。
4. 证据、任务和 Agent 画面允许做摘要，但必须保留原始 ID 的短 hash 或稳定短名，确保观众知道它们来自真实记录。
5. 不把 `support=2` 渲染成“已证明”；画面中必须同时出现 support gate 未通过的原因和 `needs_data`。
6. 需要突出真实闭环，而不是只做静态架构图：至少让一条动画路径从 `D.route` 回到 `B.run`，并让 Round 2 消费上一轮任务。
7. 保留当前 `index.html` 和旧版 `hyperframes.html` 作为对照；v3 使用 `hyperframes-compact.html`、`render-demo.mjs`、`data.js` 和本分镜文件。

## 验收标准

- 观众在前 40 秒内能说出 API、workflow、LangGraph、tools、storage 的关系。
- 观众能看见 A/B/C/D 的实际节点名和条件路由，而不是只看见抽象流程箭头。
- 观众能理解 B 阶段如何产生证据、为什么 BC/C 阶段会降级或拒绝证据。
- 观众能理解 D 阶段如何把未解决问题变成可执行/延期任务。
- 视频中的 3、32、12、23、2/30/0、`needs_data` 与当前 JSON 一致。
- 视频不暗示当前运行已经证明太阳加热机制；最终落点是“闭环完成，证据仍需补齐”。

## v3 紧凑页面节拍

原分镜的叙事顺序没有改变，v3 只是把长场景拆成更短的页面，使结构之间产生明确的切换和连续轨道：

| 页 | 时间 | 页面节拍 |
|---:|---:|---|
| 01 | 0–6s | 闭环命题 / Run replay |
| 02 | 6–13s | Phenomenon input / AR11158 |
| 03 | 13–20s | API / SSE → state |
| 04 | 20–27s | ScientificLoopState assembly |
| 05 | 27–34s | LangGraph root |
| 06 | 34–41s | A.generate |
| 07 | 41–48s | A.verify |
| 08 | 48–55s | B.dispatch |
| 09 | 55–62s | B worker group |
| 10 | 62–69s | Deterministic processing |
| 11 | 69–76s | Artifact lineage |
| 12 | 76–83s | BC.verify / promote |
| 13 | 83–90s | Evidence ledger |
| 14 | 90–97s | C.verify / evidence gate |
| 15 | 97–104s | C.synthesize |
| 16 | 104–111s | D.plan |
| 17 | 111–118s | D.route |
| 18 | 118–125s | Round 1 replay |
| 19 | 125–132s | Round 2 replay |
| 20 | 132–139s | Correction stream |
| 21 | 139–146s | Durable trace |
| 22 | 146–153s | Current verdict |
| 23 | 153–162s | Next handoff |
| 24 | 162–175s | Loop ready / closing |
