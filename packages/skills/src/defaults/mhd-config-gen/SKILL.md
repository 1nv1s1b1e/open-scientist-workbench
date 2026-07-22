---
name: mhd-config-gen
description: Generate MHD simulation configuration files and satellite observation proposals. Use when in the final round of tournament evolution.
---

# MHD Config Generation

你是 Prometheus，负责在锦标赛收敛后输出 MHD 仿真配置 `.cfg` 与卫星观测建议书。本 skill 指导你如何把获胜假设翻译为可仿真的物理参数与可观测的验证方案。

## MHD 仿真背景

理想 MHD 方程组（5 个）：连续性、动量、能量、感应方程、约束 ∇·B=0。仿真需要：

- 边界条件（boundary）：日冕底部光球层通常用 velocity 驱动 + 磁场 fixed-flux
- 刹始条件（init）：磁场位形（势场 / 无作用力场 / 实测外推）、密度温度剖面
- 网格参数（grid）：分辨率 + 求解器配置
- 物理参数（params）：无量纲数 + 加热源项

## .cfg 文件格式

由 `mhdConfigTool` 写盘，路径 `<mhdDir>/<runId>.cfg`。Prometheus 负责组装 `physicalParams` 字段，tool 生成 `[params]` 段。建议字段：

```
[grid]
nx = 256
ny = 256
nz = 512

[params]
plasma_beta = 0.01          # 等离子体 beta（日冕低 beta）
alfven_speed = 1.0e6        # Alfvén 速度 m/s
reynolds_number = 1.0e8     # 雷诺数（日冕高 Re）
lundquist_number = 1.0e10   # Lundquist 数（决定重联率）
heating_rate = 3.0e2        # 加热率 W/m³（与假设预言一致）
magnetic_topology = "flux_tube"  # 磁场拓扑（flux_tube / arcade / open / mixed）

[boundary]
bottom = "velocity_driven"  # 光球足点驱动
top = "open"
side = "periodic"

[init]
b_field = "potential"       # 初始磁场（potential / force_free / extrapolated)
density_profile = "stratified"

[output]
cadence_steps = 100         # 每 100 步输出一次
fields = ["rho", "v", "B", "p", "T"]
```

参数取值原则：

- 从获胜假设的 filter 阈值反推物理参数范围（如 filter 用 magnetic_strength > 30G，则 init 的 B 场幅值要覆盖该阈值）
- 加热率必须与假设预言的能量耗散率量级一致（安静太阳 ~300 W/m²，活动区更高）
- Lundquist 数 >> 1 才能进入快重联 regime；过低则 nanoflare 假设无法验证

## 观测建议书格式

观测建议书（作为 `observationProposal` 参数传给 mhdConfig 工具，工具会写入文件并返回 proposalPath）必须含：

1. **假设陈述**：一句话概括获胜假设的物理机制与可观测预言
2. **预言观测量**：具体到波段 + 物理量（如"171Å 应出现环顶增亮 + 非热线宽 > 30 km/s"）
3. **推荐卫星/仪器/波段**：从下表选，说明为何该仪器能验证预言
4. **时间窗口**：活动区演化阶段（emerging / decaying / flaring）+ 持续时长
5. **验证方法**：如何从观测数据判定预言成立/不成立（阈值化判据，与 filter 同口径）

## 推荐卫星与仪器

| 卫星/仪器          | 适用预言                   | 关键能力                             |
| ------------------ | -------------------------- | ------------------------------------ |
| SDO/AIA            | EUV 环拓扑、温度分布、波动 | 7 波段 EUV 成像，12s cadence，全日面 |
| SDO/HMI            | 磁场演化、磁通量、剪切角   | 矢量磁场，45s cadence                |
| Hinode/XRT         | 高温日冕（>2 MK）成分      | X 射线成像，高温敏感                 |
| IRIS               | 过渡区光谱、非热线宽       | Mg II/C II/Si IV 光谱，高光谱分辨    |
| Parker Solar Probe | 原位 Alfvén 波、磁场扰动   | 近日（~10 R_sun）原位测量            |
| Solar Orbiter      | 高分辨成像 + 原位耦合      | 偏轴高分辨 EUV，多视角               |

## 末轮触发条件

Prometheus 仅在以下情况生成 `mhdConfig`（否则 `mhdConfig: null`，`shouldContinue: true`）：

- 收敛检测通过：领先假设 F1 ≥ `TARGET_F1` 且与第二名差距 ≥ 0.1
- 或达到 `MAX_ROUNDS`（强制收尾）
- 且领先假设已通过人机协同 review（`needsApproval` 通过）

若未触发末轮，Prometheus 输出 `PlanSchema`：下一轮的 `paramRange`（搜索范围）+ `populationSize` + `mutationRate` + `computeBudget`（maxEvals/parallelWorkers）+ `rationale`。

## 输出

按 `PrometheusOutputSchema`：

- 非末轮：`plan`（含调整后的搜索范围）+ `mhdConfig: null` + `shouldContinue: true`
- 末轮：`plan`（最终轮标记）+ `mhdConfig`（含 cfgPath + proposalPath + summary）+ `shouldContinue: false`

调 `mhdConfigTool` 时传入 `runId`/`winningHypoId`/`hypothesisStatement`/`physicalParams`，tool 负责写盘并返回 `MhdConfig`。Prometheus 把返回值嵌入输出。
