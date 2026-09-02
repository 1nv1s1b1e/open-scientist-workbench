# Agentic scientific-loop research notes

检索日期：2026-08-08

用途：为 open-scientist 的多轮科研闭环、跨轮次 memory 和 self-evolve 设计提供公开项目参考。

## 可借鉴的机制

### Google DeepMind Co-Scientist

- 官方说明把系统分为生成、辩论和演化三个阶段。
- 生成阶段包含生成和相似性/聚类角色，用于扩大并保持假设空间多样性。
- 辩论阶段包含反思、排序和假设竞赛，用于集中计算资源验证候选假设。
- 演化阶段组合、修订高排名假设，并由元评审形成最终研究建议。
- 官方描述强调监督规划器应根据任务动态拆分步骤，并行探索多个方向。
- 可迁移到本项目：A 生成假设，Oracle 做反思和排序，跨轮次保留假设谱系，D 作为元评审和下一实验规划。
- 不能直接照搬：Co-Scientist 的公开材料介绍的是系统机制和实验工具，不提供可直接嵌入本项目的完整开源后端；本项目仍需自己实现数据证据、可复算指标和持久化状态。

来源：

- https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/

### Karpathy autoresearch

- 固定评估器和固定预算，研究 agent 只修改限定范围内的实验对象。
- 每次实验都要运行、读取确定性指标、记录结果，并根据指标决定保留或回退。
- 失败、崩溃和超时都作为实验结果记录，而不是丢弃。
- 结果使用结构化表格保存，便于下一轮判断哪些方向已经尝试过。
- 可迁移到本项目：B 的数据分析任务应有固定输入、固定输出和预算；D 生成的任务应经过执行、评估、保留/拒绝和记录。
- 不能直接照搬：本项目的目标不是单一可优化指标，不能用 F1 代替科学证据；保留标准应同时考虑证据质量、反例、数据一致性和假设可证伪性。

来源：

- https://github.com/karpathy/autoresearch
- https://github.com/karpathy/autoresearch/blob/master/program.md

### InternAgent

- 公开仓库包含长期自主科学发现框架、实验发现、论文复现和持久化 memory 模块。
- memory 用于记录实验结果，避免重复失败方向，并在后续会话中复用有效经验。
- 公开入口将 idea generation、实验执行、论文复现和 QA 研究区分开，说明不同类型任务不应共用同一段自由文本上下文。
- 可迁移到本项目：memory 应保存可检索的实验事实、失败原因、适用范围和下一步建议，而不是只保存整段对话。

来源：

- https://github.com/InternScience/InternAgent

### cmbagent

- 采用 Planning and Control 两阶段结构。
- 规划阶段由 planner 和 plan reviewer 反复审查计划；控制阶段逐步执行计划，每一步交给合适的 agent。
- 可迁移到本项目：D 生成验证计划后，必须由可执行性检查通过，再交给 B；Oracle 负责证据审查，但不直接修改原始数据。

来源：

- https://github.com/CMBAgents/cmbagent

## 对 open-scientist 的设计结论

1. 把科学闭环从“F1 锦标赛”改成“证据任务锦标赛”。
2. 为每一轮保存 hypothesis、evidence、counterexample、revision、validation task 和 memory summary。
3. 以固定数据快照、固定任务预算和确定性分析器保证轮次可比较。
4. 由 D 生成下一轮任务；只有产生新证据或明确失败记录时才允许进入下一轮。
5. 用结构化 memory 检索历史实验，不把全部历史对话直接塞回模型上下文。
6. self-evolve 只改变可审查的假设、分析计划或模型版本，并要求独立验证；不得让系统自行修改评估器或事实来源。
