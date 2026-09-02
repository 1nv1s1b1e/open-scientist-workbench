# 日冕加热机制区分文献扩充（2026-08-24）

## 目的与边界

本轮检索用于扩充假设生成、可证伪预测、替代解释和反例搜索所需的一手研究。文献只提供“应该测什么、什么结果能区分候选”的外部知识，不计作本项目任何活动区的本地观测支持，也不参与 `supported` 证据条数。

本机未发现 `parallel-cli`，因此按 research-lookup 回退路径检索期刊、NASA、机构知识库及 arXiv 原文页。以下 DOI、题名与作者已交叉核对。

## 检索问题

1. AIA 多通道时延能区分哪些热过程，哪些零时延或有序时延仍存在非唯一解释？
2. DEM、密度与高温尾如何约束低频脉冲、高频脉冲或近稳态加热？
3. 磁编织/足点扰动模型给出哪些可前向建模的观测量？
4. 热非平衡能否构成对“有序冷却即脉冲加热”的替代解释？
5. 仅有 AIA 宽带成像为何不能替代硬 X 射线、光谱和能量闭合？

## 新增核验文献

### 1. Viall & Klimchuk (2012)

- 题名：Evidence for Widespread Cooling in an Active Region Observed with the SDO Atmospheric Imaging Assembly
- DOI：10.1088/0004-637X/753/1/35
- 原文页：https://arxiv.org/abs/1202.4001
- NASA 全文：https://ntrs.nasa.gov/api/citations/20120008687/downloads/20120008687.pdf
- 用途：定义 AIA 通道时延的冷却过程预测，并把“广泛存在动态冷却”与“某个微观加热机制已成立”严格分开。

### 2. Viall & Klimchuk (2016)

- 题名：Signatures of Steady Heating in Time Lag Analysis of Coronal Emission
- DOI：10.3847/0004-637X/828/2/76
- NASA 记录：https://ntrs.nasa.gov/citations/20170003765
- 原文页：https://arxiv.org/abs/1607.02008
- 用途：约束零时延解释；零时延并不自动等于近稳态加热，也可能来自动态演化。

### 3. Barnes, Cargill & Bradshaw (2016)

- 题名：Inference of Heating Properties from “Hot” Non-flaring Plasmas in Active Region Cores. II. Nanoflare Trains
- DOI：10.3847/1538-4357/833/2/217
- 机构记录：https://research-repository.st-andrews.ac.uk/handle/10023/10097
- 用途：将加热频率、等待时间和发射量分布连接起来；要求与仪器响应和流体动力学前向模型比较。

### 4. Winebarger et al. (2011)

- 题名：Using a Differential Emission Measure and Density Measurements in an Active Region Core to Test a Steady Heating Model
- DOI：10.1088/0004-637X/740/1/2
- NASA 全文：https://solarscience.msfc.nasa.gov/papers/Winebarger/Winebarger_2011_ApJ_740_2.pdf
- 原文页：https://arxiv.org/abs/1106.5057
- 用途：把 DEM、密度、环长和稳态模型组成替代解释；避免把所有热通道变化都预设成低频脉冲。

### 5. Li et al. (2015)

- 题名：Heating and Cooling of Coronal Loops Observed by SDO
- DOI：10.1051/0004-6361/201526912
- 期刊全文：https://www.aanda.org/articles/aa/pdf/2015/11/aa26912-15.pdf
- 用途：AR 11850 的事件级多通道热演化正控，定义可复现的 Fe XVIII/冷却序列，但不把正控复现当作盲发现。

### 6. Dahlburg et al. (2016)

- 题名：Observational Signatures of Coronal Loop Heating and Cooling Driven by Footpoint Shuffling
- DOI：10.3847/0004-637X/817/1/47
- 原文页：https://arxiv.org/abs/1512.03079
- 用途：给出足点扰动—电流片—多热细丝的前向预测；观测相容必须经过同仪器响应卷积才具有机制区分力。

### 7. Rappazzo et al. (2008)

- 题名：Nonlinear Dynamics of the Parker Scenario for Coronal Heating
- DOI：10.1086/528786
- 原文页：https://arxiv.org/abs/0709.3687
- 机构记录：https://flore.unifi.it/handle/2158/346600
- 用途：定义磁编织/湍流级联候选的能量注入、磁场强度标度和电流片预测；HMI 的低分辨率相关代理不能单独证明该机制。

### 8. Froment et al. (2020)

- 题名：Multi-scale Observations of Thermal Non-equilibrium Cycles in Coronal Loops
- DOI：10.1051/0004-6361/201936717
- 期刊全文：https://www.aanda.org/articles/aa/pdf/2020/01/aa36717-19.pdf
- 原文页：https://arxiv.org/abs/1911.09710
- 用途：把足点集中、准恒定加热导致的热非平衡/蒸发—凝结循环纳入反例池，防止“有序冷却时延 ⇒ 低频脉冲”的单向推断。

### 9. Ishikawa & Krucker (2019)

- 题名：Hot Plasma in a Quiescent Solar Active Region as Measured by RHESSI, XRT, and AIA
- 原文页：https://arxiv.org/abs/1903.11293
- 用途：说明高温尾的跨仪器约束；AIA DEM 的微弱高温尾不等价于 RHESSI/FOXSI/NuSTAR 的硬 X 射线约束。

### 10. Knizhnik et al. (2020)

- 题名：Nanoflare Diagnostics from Magnetohydrodynamic Heating Profiles
- 原文页：https://arxiv.org/abs/2009.00132
- 用途：把三维 MHD 加热分布与一维流体响应、发射量斜率连接起来，并提供“模型只能覆盖部分观测范围”的反例结构。

## 对后端的直接约束

- AIA 冷却时延只能支持“动态冷却/热过程层级”，不能独立支持纳耀斑或磁重联。
- `supported` 必须来自本地重新处理的、预测绑定的、相互独立的定量证据；论文数量不进入支持门槛。
- 近稳态、热非平衡、磁编织湍流和低频脉冲应作为可并存或竞争的候选，不能由关键词白名单限制。
- 数值 `confidence` 在没有专家裁决标签和校准集时不能解释为概率；应改为可审计的序数证据等级。
