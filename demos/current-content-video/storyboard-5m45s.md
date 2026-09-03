# Open-Scientist 5 分 45 秒动画视频分镜

## 本轮调整目标

这版把 20 秒样片中的连续运动、数据包、轨迹和镜头推移保留下来，但重新组织叙事和版式：

1. 先从整体架构和闭环目标开始，让观众先知道系统由什么组成、数据如何流动。
2. 再按输入、运行入口、A/B/C/D 阶段逐块展开，每个短镜头只回答一个问题。
3. 最后回到本次真实运行的结果、证据边界、持久化和下一轮任务，形成总分总闭环。
4. 所有文字固定在左侧安全区或底部字幕带；图片、图表、节点只在右侧可视化区活动，避免图层遮挡正文。

## 事实约束

- 目标时长：345 秒（5 分 45 秒）
- 画幅：1920×1080；帧率：30 fps
- 数据源：`outputs/ar11158-qwen-demo/scientific-result.json`
- 本次运行：3 条假设、32 条证据、12 个验证任务、23 条修正、2 轮运行
- 证据状态：`2 support / 30 unknown / 0 contradict`
- 最终状态：`needs_data`；终止原因：`max_rounds_reached`
- 结论表述：闭环完成且结果可审计，但不能把当前结果说成某种太阳加热机制已经被证明。

## 画面安全规则

- 左侧 `x=86–650`：标题、正文、章节说明；不放图片和复杂节点。
- 右侧 `x=720–1834`：图表、代码、流程图、数据卡片；所有图片都限制在卡片内。
- 底部 `y=900–985`：单行字幕和当前镜头说明，使用半透明深色底，不让背景图穿透文字。
- 一个镜头只保留一个主标题和一个主要可视化动作；其余信息降为小标签或延迟出现。
- 转场使用交叉淡入、镜头平移、数据包沿路径移动和局部缩放，不使用整页翻转或页面式替换。

## 分镜表

| 镜头 |     时间 | 章节     | 画面与动作                                                           | 旁白/字幕要点                                                 | 主要数据绑定             |
| ---: | -------: | -------- | -------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------ |
|   01 |   00–06s | 总览     | 黑场中太阳观测窗口亮起，单条光点从现象进入闭环                       | “一次科研运行，应该留下可追踪的路径。”                        | `phenomenon`             |
|   02 |   06–13s | 总览     | `phenomenon → evidence → validation → next round` 四段沿轨迹依次点亮 | “Open-Scientist 把问题变成可回放、可复核、可继续执行的闭环。” | scientific loop contract |
|   03 |   13–20s | 总览     | 2/32/12 三个数字逐一出现，`needs_data` 在最后落下                    | “结果不是一句结论，而是一组带边界的记录。”                    | evidence/tasks/status    |
|   04 |   20–30s | 总览     | 右侧出现六段路线图，数据包扫过全片结构                               | “下面先看整体架构，再进入每一个局部阶段。”                    | 6 chapters               |
|   05 |   30–37s | 架构     | API/SSE 层从左到右建立，事件流开始滚动                               | “入口负责接收运行，并把节点事件发送出来。”                    | `routes/runs.ts`         |
|   06 |   37–44s | 架构     | WORKFLOW 层接住事件，runtime、context、persistence 三个词依次出现    | “工作流负责创建运行时、投影上下文并保存结果。”                | `workflow.ts`            |
|   07 |   44–51s | 架构     | LANGGRAPH 根图展开，A/B/C/D 节点沿路径生成                           | “根图负责状态、轮次和条件路由。”                              | `scientific-graph.ts`    |
|   08 |   51–58s | 架构     | TOOLS/MCP 作为外部数据入口，FITS、solar data、search、sandbox 分流   | “工具层负责把真实数据和可执行能力带进来。”                    | `packages/tools` / MCP   |
|   09 |   58–65s | 架构     | STORAGE/ARTIFACTS 层接收 records、snapshots、runs、checksums         | “存储层留下证据链，而不是只留下最终文本。”                    | `packages/storage`       |
|   10 |   65–75s | 架构     | 一个数据包穿过五层，沿途留下状态节点和 artifact 标记                 | “同一个状态对象贯穿入口、编排、计算和存储。”                  | framework layers         |
|   11 |   75–83s | 架构     | 镜头拉远，五层与闭环同时可见；轨迹绕回起点                           | “架构的重点不是层数，而是状态可以继续流动。”                  | framework + loop         |
|   12 |   83–90s | 架构     | 右侧收束成一个可回放 run，`RUN / CHECKPOINTED` 闪烁                  | “接下来进入一条真实运行。”                                    | run id / checkpoint      |
|   13 |   90–98s | 输入     | NOAA AR11158 诊断图在右侧卡片内展开，左侧只保留问题标题              | “我们从一个真实太阳活动区开始。”                              | `phenomenon.title`       |
|   14 |  98–106s | 输入     | AIA 94/131/171/193 Å 与 HMI 五个通道分层滑入                         | “多波段观测和磁场演化共同构成输入。”                          | channel labels           |
|   15 | 106–114s | 输入     | 三个研究方向在右侧分支，反例标记从底部进入                           | “问题不是让模型自由发挥，而是比较机制并主动寻找反例。”        | hypotheses mechanisms    |
|   16 | 114–122s | 运行入口 | `POST /api/projects/:project/runs` 打字出现，数据包进入 API          | “每次运行从一个明确的请求开始。”                              | API route                |
|   17 | 122–131s | 运行入口 | SSE 事件条目连续向下流动，节点、agent、evidence、complete 依次出现   | “运行过程中的状态变化可以实时查看。”                          | run stream               |
|   18 | 131–138s | 运行入口 | checkpoint 卡片锁定 run id，镜头沿状态对象平移                       | “中断时保存的是结构化状态，不是一张截图。”                    | checkpoint               |
|   19 | 138–145s | 运行入口 | `START` 亮起并接入 A.generate，闭环正式开始                          | “根图从 A.generate 开始，进入可追踪的科学循环。”              | graph start              |
|   20 | 145–153s | A 阶段   | A.generate 节点生成三条假设，三条线分开运动                          | “A 阶段先把问题变成可检验命题。”                              | 3 hypotheses             |
|   21 | 153–161s | A 阶段   | A.verify 依次扫描 schema、predictions、falsification                 | “每条假设都必须有预测，也必须有证伪条件。”                    | `A.verify`               |
|   22 | 161–170s | A 阶段   | 三张假设卡片逐张展开，confidence 和 status 独立出现                  | “候选、未确定和置信度被分别记录。”                            | hypothesis records       |
|   23 | 170–179s | B 阶段   | B.dispatch 将输入拆成四条 worker lane                                | “B 阶段把证据工作拆成可并行的任务。”                          | `B.dispatch`             |
|   24 | 179–188s | B 阶段   | Looker、Explorer、Oracle、FACT-CHECK 四个 worker 同时运动            | “观测目录、诊断分析、反例搜索和溯源复核并行推进。”            | agent roles              |
|   25 | 188–198s | B 阶段   | 每个 worker 的输入/输出标签沿线移动，不在卡片上叠加长段文字          | “模型审阅器只读取上游结构化记录。”                            | default services         |
|   26 | 198–208s | B 阶段   | evidence ledger 出现，support/unknown/contradict 三种状态分流        | “证据先进入账本，再进入后续门槛。”                            | 2/30/0                   |
|   27 | 208–218s | 数据处理 | FITS → ROI → time series → metrics → figure 五个处理节点依次点亮     | “数据处理过程本身也必须可复核。”                              | processing pipeline      |
|   28 | 218–228s | 数据处理 | 诊断图局部放大，扫描线沿图像移动，右侧生成 snapshot 和 artifact      | “输出不仅是图，还包括输入快照、参数、版本和 checksum。”       | diagnostic artifact      |
|   29 | 228–238s | BC 阶段  | provenance 链从 sample 到 processing run 再到 artifact               | “模型说支持，不等于系统接受支持。”                            | provenance records       |
|   30 | 238–248s | BC 阶段  | 缺少链路的记录向 `unknown` 降级，状态标签沿路径移动                  | “缺少样本、处理运行或产物校验，就不能升级为支持。”            | promotion gate           |
|   31 | 248–258s | C 阶段   | C.synthesize 从证据账本汇聚 bounded conclusion                       | “C 阶段只生成被当前证据边界约束的结论。”                      | `C.synthesize`           |
|   32 | 258–268s | C 阶段   | gate 清单逐项扫描，2/3 support、holdout、confidence 等保持未通过     | “本次有局部支持，但严格门槛仍未通过。”                        | gate checks              |
|   33 | 268–278s | D 阶段   | D.plan 把缺口转换为 12 张任务卡，完成和 planned 分成两路             | “未知不会被藏起来，而会被改写成下一步任务。”                  | 12 tasks                 |
|   34 | 278–290s | D 阶段   | D.route 在 A、B、END 三路之间判断，数据包停在 B 侧并回流             | “路由根据新证据、新任务和轮次上限决定下一步。”                | `D.route`                |
|   35 | 290–298s | 回放     | Round 1 时间轴展开，19 evidence、6 tasks、14 corrections 依次落点    | “第一轮产生证据、任务和修正。”                                | round 1                  |
|   36 | 298–306s | 回放     | Round 2 接着上一轮数据，不从零开始                                   | “第二轮消费上一轮的结果，而不是重新播放一遍。”                | round 2                  |
|   37 | 306–314s | 回放     | correction stream 沿时间线回放，重复任务被 fingerprint 合并          | “修正记录让重复和跳过都有原因。”                              | corrections              |
|   38 | 314–322s | 持久化   | SSE、records、checkpoint、artifacts 四个落点同时连接                 | “运行结束后，过程和产物都能回看。”                            | persistence              |
|   39 | 322–329s | 恢复     | `GET /stream` 与 resume 从 checkpoint 重新接上数据包                 | “中断后可以从保存的状态恢复。”                                | stream/resume            |
|   40 | 329–335s | 结论     | 3 条假设显示 candidate/uncertain/candidate，镜头不夸大结论           | “当前结论诚实地停在 needs_data。”                             | scientific status        |
|   41 | 335–338s | 下一轮   | HMI 足点速度、冷却时延、时间频率、光谱等任务短促点亮                 | “下一轮从数据、诊断和 holdout 继续补齐。”                     | next tasks               |
|   42 | 338–345s | 收束     | 数据包从 D.route 回到 loop 起点，标题与整体架构重新出现              | “闭环完成，不代表问题结束；它留下了下一步。”                  | loop ready               |

## HyperFrames 实现约束

- 根节点：`data-duration="345"`，`data-fps="30"`。
- 所有镜头在同一个持续运动的 world 中完成；镜头之间使用淡入、平移、缩放和局部路径动画。
- 视觉层与文字层分离：`.copy-pane` 只承载文字，`.visual-pane` 只承载图形，`.caption-bar` 负责字幕。
- 任何动态图片都必须有独立卡片边界和留白，不能覆盖标题、正文或底部字幕。
- 文字只绑定短句；长内容先在 Codex 分镜阶段压缩成镜头目的，再交给 HyperFrames 排版和运动。
- 先用关键帧检查 00、30、90、145、198、248、290、329、345 秒，再进行完整视频验收。
