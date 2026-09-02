# Qwen3.5-Plus 扩展数据闭环审计（2026-08-24）

> 历史审计说明：本文记录 48.036 GB 阶段的中间状态，数值和缺口不再代表当前最终包。当前 64.061 GB、analysis-v4、IRIS/SHARP 补充包和作用域安全门禁请以 [方向 2B 后端、数据与证据边界最终说明](competition-2b-final-backend-and-data.md) 为准。

## 结论

扩展数据包已经下载、校验并完成轻量派生处理。当前包实际为
48,035,882,880 字节（约 48.036 GB / 44.737 GiB），不是整 70 GB；“70 GB”是此前的容量规划名称，
不应写成实际下载量。manifest 中 4,688/4,688 个资产均为 verified，共 4,924 条逻辑观测、
11 个有界案例。派生工作缓存为 340,823,596 字节，约为原始包的 0.710%。

当前数据足够运行“现象 → 动态候选 → 确定性诊断 → 背景反例 → 跨活动区 holdout →
逐假设门槛 → 下一步计划”的比赛闭环，但不足以把任何日冕加热机制判为 `supported`。

## 实际运行

### 确定性基线

- 输出：`output/expanded-baseline-20260824/scientific-result.json`
- 结果：3 个 candidate，32 条 `unknown + diagnostic_boundary`，6 个 `executable_now` 任务完成。
- 科学状态：`needs_data`。

### Qwen3.5-Plus 初始审计

- 输出：`output/qwen35plus-expanded-audit-20260824/scientific-result.json`
- 结果：3 个 candidate，33 条 `unknown + diagnostic_boundary`。
- 发现的问题：扩展包仍使用旧 sourceId、模型未必生成 holdout、末轮可执行任务可能遗留、
  0–1 confidence 容易被误读为概率。

### Qwen3.5-Plus 修复后完整审计

- Run ID：`run-1787509944027-878e0d9c`
- 输出：`output/qwen35plus-final-audit-20260824/scientific-result.json`
- 模型流明确记录 `model=qwen3.5-plus`。
- 结果：3 个 candidate，50 条 `unknown + diagnostic_boundary`，0 support，0 contradict。
- 5/5 个 `executable_now` 任务全部完成，无本地可执行任务遗留。
- holdout 实际覆盖 AR11082、AR11420、AR11429、AR11850 四个独立活动区；
  AR11158 保留 discovery 和 validation 记录。
- 科学状态：`inconclusive`；终止原因：`no_new_evidence_or_tasks`。

该完整模型运行验证了 sourceId、holdout、任务清空和 confidence 语义修复。其后新增的
“按事件聚合 evidence 给 Explorer/Oracle”与“过滤后保留外部下一步任务”已通过类型检查和
自动化测试，但尚未把它们表述为一次新的 Qwen 端到端运行结果。

## supported 判定审计

强支持门槛要求：至少 3 条机制区分性记录、3 个独立事件、3 个独立原始数据谱系、
2 类可观测量、2 类方法、至少 1 条有效 holdout、覆盖全部预测、完整定量区间与 provenance，
且不存在有效机制级反例。重复运行、换 agent 或换 processing id 不增加事件独立性。

本次运行虽然执行了 holdout，但所有结果都是诊断边界：

- 171/193 Å 候选周期不是传播速度或能流；
- 94/131 Å 热峰和相对变异不是磁重联唯一指纹；
- 冷却序列 0/5 通过冻结判据，不能证明不存在冷却过程；
- HMI 缺 WCS/BUNIT，不能形成物理磁通、磁梯度或 PIL 共空间证据；
- 联合时序指标不能建立因果耦合或能量分配。

因此 `validSupportEvidenceIds=0`、`supportGatePassed=false` 是合理结果。

## confidence 的正确解释

> 本节只解释该历史运行为什么不能把 0.50 当作概率。当前最终实现已经取消新运行中的假设级数值 `confidence`，改用序数 `evidenceStrengthGrade`；请以最终说明为准。

当前 0.50 是未校准的候选排序分，不是“机制成立概率”，也不是 Bayesian posterior。
没有独立专家裁决的机制标签时，不能从这些观测拟合可靠的概率校准器。后端已经在验证报告中写入
`confidenceSemantics=uncalibrated_evidence_rubric_not_probability`。

当前 confidence 只能用于候选排序和保守附加门槛。可验证主体应是：逐预测状态、效应量、
95% 区间、原始 lineage、holdout、反例检出力和门槛失败原因。若未来获得专家裁决标签，
应在按活动区隔离的验证集上报告 Brier score、log loss、校准曲线/期望校准误差，
再讨论“概率”。

## 仍未解决的科学缺口

1. HMI 物理 WCS/BUNIT 与 AIA 共空间磁场分析。
2. DEM/温度响应反演，避免把 AIA 通道强度直接当温度。
3. 环路径传播速度、相位差、阻尼长度和能流。
4. 光谱 Doppler、非热展宽或密度诊断。
5. 足够事件数下的等待时间/能量分布与预注册效应量检出力。
6. 与观测匹配的 MHD 前向模型或能量闭合。

继续增加同类 AIA 帧数只能改善部分时序精度，不能替代这些新的可观测量和方法族。

## 本轮后端修复

- demo 按 `CORONAL_DATASET_ID` 检查 manifest，并在元数据记录 datasetId。
- sourceId 随实际数据包解析为 `local:coronal-evidence-70gb-v1`。
- 放宽但约束 holdout 可测子指标映射，并明确子指标复现不等于完整预测成立。
- 把跨事件确定性 evidence 按 eventGroup 聚合给 Explorer/Oracle，避免只看到 discovery。
- 模型计划全部被过滤后，为未解决假设保留外部下一步计划。
- 置信度报告明确标注为未校准排序分，而非概率。
- 反例“未检出”只有在预注册功效/最小可检测效应达标后才可视为充分搜索；本次均未达标。

## 验证

- Monorepo typecheck：11/11 包通过。
- 测试：61 个文件通过、1 个跳过；515 项通过、11 项跳过。
