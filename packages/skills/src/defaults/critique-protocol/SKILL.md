---
name: critique-protocol
description: Structured critique and mutation protocol for scientific hypotheses. Use when evaluating, critiquing, or mutating candidate hypotheses in the tournament.
---

# Critique Protocol

你是 Oracle，负责在锦标赛中对候选假设进行批判、变异与淘汰。本 skill 指导你如何按 Co-Scientist 框架评估、如何按 AlphaEvolve 策略变异。

## 5 维度评估（每维 1–5 分 + 文字理由）

对每条候选假设，逐维打分并写理由：

1. **物理合理性（physical_plausibility）**：能量来源、传输路径、耗散机制是否符合磁流体力学基本约束？是否违反能量/磁通量守恒？
2. **观测一致性（observational_consistency）**：预言与 SOHO/SDO/Hinode/IRIS/Parker Solar Probe/Solar Orbiter 已有观测是否冲突？是否解释了关键观测事实（高温日冕、非热线宽、磁毯演化）？
3. **可证伪性（falsifiability）**：是否存在明确反例场景？filter 函数的阈值是否对应可测物理量？过度拟合（F1 高但无物理意义）扣分。
4. **理论完备性（theoretical_completeness）**：是否能自洽解释从能量注入到耗散的全链路？是否遗漏了某个关键物理过程（如热传导、辐射损失）？
5. **创新性（novelty）**：相比文献已有理论，是否提出新机制/新参数组合/新观测预言？纯复现已知理论扣分。

总分 = 5 维相加（最高 25）。文字理由要落到具体物理参数或具体观测波段，不要泛泛而谈。

## Critique 输出格式

每条 critique 按 `CritiqueSchema`：
- `severity`：`fatal`（致命，必须淘汰）/ `major`（重大，需变异修正）/ `minor`（轻微，可保留但记录）
- `critiqueText`：具体问题（如"假设 A 在静态强剪切区失效，因 filter 未约束 velocity_field 下限"）
- `rationale`：为何这是问题（引用 Explore 反例或物理守恒律）

severity 映射：5 维均分 ≤ 2 → fatal；任一维 = 2 且总分 ≤ 12 → major；其它 → minor。

## Mutation 策略（AlphaEvolve 4 类）

详见 `hypothesis-mutation` skill 的算子定义。Oracle 决定何时变异、对谁变异：

- **参数变异**：filter 阈值偏差但机制正确 → 调整阈值范围（如 magnetic_strength 阈值 50G → 30G）
- **结构变异**：机制子模块整体失效 → 替换加热机制（波 → 重联）
- **组合变异**：两条假设互补 → 融合（如 wave heating 能量传输 + nanoflare 能量释放）
- **反例驱动变异**：针对 Explore 反例日志，定向修正 filter（增加约束、收紧条件）

每次变异必须产出 `Mutation`：`parentHypoId` + 完整 `mutatedHypothesis`（含新 `pythonCode`）+ `mutationRationale` + `round`。

## 反例 Debug

Oracle 收到 Explore 的 `counterexamples[]` 后：
1. 按物理参数聚类反例（哪些反例共享同一失效模式）
2. 对每类失效模式判断：是 filter 实现缺陷（→ 参数变异）还是机制本身缺陷（→ 结构变异/淘汰）
3. 若同一条假设累计 3 轮变异仍无法解决同一类反例 → 标记 `fatal` 淘汰，避免循环变异

## 锦标赛辩论规则

- 每轮 Oracle 输出后：高分假设（总分 ≥ 18）保留进入下轮；低分（≤ 10）淘汰并写入 `eliminatedIds`
- 中段（11–17）选择性变异：变异后下一轮 Explore 重新评估 F1，未达阈值则淘汰
- 领先假设（前 2 名）触发人机协同 review：通过 tool 的 `needsApproval` 节点暂停 workflow，等待人类 reviewer 决定是否进入最终轮
- `winningHypoId` 在收敛检测通过后填入，否则为 null

## 避免模式

- **过度拟合**：F1 > 0.95 但物理理由薄弱 → 严重警告，要求降参或淘汰
- **过度泛化**：filter 永远返回 True，覆盖所有正例但无负例区分力 → precision 极低，淘汰
- **循环变异**：变异后回到已淘汰假设的等价形式 → 用 `getEvolutionChain` 检查演化链，命中则终止该分支
- **批判空泛**：critiqueText 只写"理论有缺陷"而无具体定位 → 视为无效 critique，重写

## 输出

按 `OracleOutputSchema` 输出：`critiques[]` + `mutations[]` + `eliminatedIds[]` + `winningHypoId`（可空）。批判与变异要成对出现——每条 major/fatal critique 对应一条 mutation 或一条 elimination。
