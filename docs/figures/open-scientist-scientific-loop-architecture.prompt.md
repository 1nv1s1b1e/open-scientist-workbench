# Open-Scientist 科学闭环架构图提示词

使用 Image 2 生成一张 16:9、白底、扁平矢量风格的中文学术架构图，标题为“Open-Scientist 日冕机制推理闭环（实际项目架构）”。按从左到右的顺序绘制“现象输入 → A 假设生成与资料定位 → E1 文献与来源核验 → B 证据工作组 → E2 数据处理事实核验 → C 综合与结论约束 → D 验证规划与路由”。

现象输入包含不同活动区现象或科学问题、多波段观测（AIA 94/131/171/193 Å、HMI）、可选数值模拟或派生数据，以及 `ObservationRef + sourceId + checksum`。

A 阶段显示 Librarian 的模型思考与 RAG，并列出核验文献、历史假设、本地观测目录和数据覆盖；输出候选机制、可观测预测、证伪条件和 `sourceIds`，候选示例为波动耗散、纳耀斑重联和耦合机制。E1 检查文献 ID、来源范围和假设 schema，失败则拒绝进入 State 或保持 `unknown`。

B 阶段为最大的青绿色区域，包含两个泳道。确定性程序并行运行：Looker 观测目录审计、Explorer FITS 诊断、Oracle 背景反例、Oracle 溯源复核；处理内容包括 ROI 时序、相关与时延、周期、峰值、变异度和 checksum。模型审阅按 Looker 观测语境 → Explorer 诊断比较 → Oracle 反例审阅串行协作。B 的输出为 `Evidence: support / contradict / unknown + provenance`。机器学习模型训练使用虚线扩展框，明确写明“仅在已有标注 / 处理产物时作为 model-update 任务”，不得画成当前已实现能力。

E2 检查 snapshot、processing run、artifact 和 checksum；无确定性溯源时降级为 `unknown`，结构化失败时受限重试或拒绝。

C 阶段显示 Sisyphus 汇总证据，并执行文献选取、schema、provenance、factual、execution 五类自校正。只有至少两个独立 processing run、至少两种方法且没有有效反证，假设才可升级为 `supported`；输出有边界结论与 limitations，过强结论改写为 `candidate / uncertain`。

D 阶段显示 Prometheus 生成下一步验证计划、拆分任务、选择执行器并定义可区分结果。当前执行器为 `coronal-timeseries-lag-v1`、`coronal-background-variability-v1`、`coronal-hot-channel-variability-v1`；WCS、DEM、光谱、MHD 和人工复核放入虚线 `external` 区域。输出 `ValidationTask: completed / planned / failed`。

绘制 D 返回 B 的实线闭环“新证据任务 → 下一轮 B”，以及 D 返回 A 的虚线支路“新机制 / model-update → A”。顶部显示 `maxRounds: 1–12; 默认 3; Demo = 2`。底部显示“跨阶段自校正与可审计 State”，包含 `scientific.self-correction`、LangGraph checkpoint、SQLite/SSE chunks、假设谱系、证据、反例、任务、处理产物和公开推理摘要；终止条件为 `max_rounds_reached / 无可执行任务 / 无新证据或任务`。

配色为深蓝文字、灰色输入、蓝色 A、琥珀色 E1/E2、青绿色 B、绿色 C、紫色 D、珊瑚红自校正；使用正交箭头、圆角矩形、高对比度中文无衬线字体。实线表示当前已实现，虚线表示扩展或外部。无 Logo、无水印、无 3D、无渐变、无多余装饰和新增标签。
