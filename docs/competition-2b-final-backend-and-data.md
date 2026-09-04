# 方向 2B 后端、数据与证据边界最终说明

更新日期：2026-09-03。本文记录实际下载、处理和运行得到的结果。它把“闭环是否可复现”“某项预测是否相容”“具体加热机制是否得到区分性支持”分开报告，禁止用流程完整度替代科学结论。

## 1. 当前结论

- 已登记原始层为 65,514,362,075 字节（65.514 GB，十进制；约 61.015 GiB），覆盖 7 个已处理独立活动区、7 个目标窗、6 个背景对照窗和定向 EIS/IRIS/NuSTAR 补充。无需为了凑到 70 GB 继续堆同类 AIA 帧。
- 13/13 案例均完成可追溯批处理；工作层 426,015,059 字节，为原始层的 0.665%。工作层是有损缓存，原始 FITS/归档必须保留。
- 已实现 AIA/HMI WCS 与冻结 ROI、热通道事件、阈值敏感性、94/131→335→211→193→171 Å 冷却、六通道 DEM、HMI LOS/SHARP 磁诊断、空间波动代理、IRIS Si IV Doppler 正控复现和跨事件留出验证。
- 假设空间不禁止纳耀斑、磁重联、MHD 波动或任意有物理含义的耦合机制。后端限制的是证据可以支持到哪一层：非唯一热响应不能被改写成具体微观机制得证。
- `correction` 可通过稳定 ID 撤销或降级错误证据；被撤销记录不能再提高证据等级或通过门禁。
- 辅助机器学习只区分登记事件窗/背景窗，不具备机制真值标签，固定为 `mechanismEvidencePermitted=false`。
- 真实 Qwen3.5-Plus 使用 `thinkingLevel=low`。模型负责提出、审阅和规划；`supported` 由确定性门禁计算，不由模型措辞决定。

## 2. 数据清单

| 数据层                       |                                    已校验数量 |         字节数 | 主要用途                                                                          |
| ---------------------------- | --------------------------------------------: | -------------: | --------------------------------------------------------------------------------- |
| 主 AIA/HMI 包                |            6,020 个唯一资产、6,256 条逻辑观测 | 61,490,226,240 | 多波段热演化、背景反例、LOS 磁场、跨活动区复测                                    |
| HMI SHARP CEA                |                  250 条记录、1,750 个 segment |  1,108,653,120 | `Br/Bt/Bp`、误差、消歧置信度、电流与磁能面密度代理                                |
| AR11899 IRIS/EIS 联合光谱    |                                4/4 个登记资产 |  1,462,224,668 | IRIS Level-2 Doppler 正控复现；EIS Level-0 保留用于原始溯源                       |
| EIS/IRIS/NuSTAR 定向判别补充 |                              62/62 个登记资产 |  1,453,258,047 | EIS Level-1、AR11890/AR12222 IRIS Level-2、四个 NuSTAR ObsID 及 livetime/姿轨输入 |
| 合计                         | 13 个主处理案例、7 个独立活动区及定向外部事件 | 65,514,362,075 | 比赛闭环与受限机制层级检验                                                        |

主包体积大，是因为 AIA 需要多通道、多时刻、全日面图像；SHARP 是事件 ROI 的分量 segment，光谱又以压缩归档和少量 raster 登记，体积小不等于作用小。官方 JW-FD 示例与本项目太阳物理证据包不是同一种任务数据：前者可用于验证通用格式或旧流程，不能替代事件匹配的 AIA/HMI/IRIS 观测。

## 3. 数据处理与实测诊断

处理顺序固定为：

1. 校验 manifest、字节数、SHA-256、`QUALITY`、时间覆盖和 HMI 元数据旁车。
2. 曝光归一化，以 AIA 193 Å 为参考网格执行 WCS 重投影，冻结 ROI；保留配准失败和 PSF/差分旋转限制。
3. 在预注册 prominence 网格重复事件检测；仅阈值稳定且定量区间完整的结果可进入后续门禁。
4. 使用移动块 bootstrap、循环移位置换与 Holm 多重比较处理自相关、最大时延选择和多通道比较。
5. 计算事件相对 fluence、冷却序列、六通道正则化 DEM、空间相干/表观传播、LOS 磁通/梯度/PIL、SHARP 径向磁通/电流代理和磁—热关联。
6. 对 AR11899 的 6/6 个 IRIS raster，在文献预定义足点 ROI 内以 O I 校准 Si IV 波长；另对校验后的 EIS Level-1 在同一文献 ROI 使用 `eispac==0.99.4` 和六条冻结模板拟合 51 个像素，报告强度、相对 Doppler、观测线宽和 Si X 258/261 比值。未冻结 CHIANTI 密度转换及热/仪器线宽传播，因此不输出密度或非热速度。
7. 对四个 NuSTAR ObsID 的 FPMA/FPMB `SCIENCE_SC` 事件、GTI 和 livetime 完成输入质量审计；该产物没有源/背景提取、响应或 ghost-ray 校正，不是物理 HXR flux 证据。
8. 每条证据绑定原子预测、样本、事件组、原始数据指纹、观测量族、方法族、分析 split、处理版本、点估计和区间。

13 个案例的可观测诊断中，DEM 为 13/13，SHARP 矢量代理为 10/13，事件 fluence 分布为 5/13，冷却序列为 2/13，空间波动为 1/13，LOS 磁演化为 1/13，IRIS 光谱为 1/13，磁—热时间关联为 0/13。这里的 `support` 是“该诊断通过自己的冻结条件”，不是“具体机制已支持”。

AR11420 的移动块冷却相关系数为：94→335 0.892（95% 区间 0.774–0.921）、335→211 0.980（0.948–0.989）、211→193 0.985（0.968–0.993）、193→171 0.966（0.931–0.980）。AR11899 的 Si IV 足点 Doppler 中位速度为 5.484 km/s（95% 区间 3.741–6.642 km/s）。二者均是受限过程证据，不是纳耀斑或重联的唯一指纹。

## 4. 假设空间与作用域

候选由输入现象和检索动态产生，通常包括但不限于：低频脉冲热过程、纳耀斑/重联、MHD 波动传播与耗散、波动触发重联、重联激发波动，以及两个机制并存但统计独立等。后端不设“禁用机制词”。

门禁只执行三项边界：

- 如果 statement、mechanism 或预测主张了纳耀斑/重联，必须由对应的特异预测支持，不能复用只区分“脉冲与近稳态”的证据。
- 热过程候选可以提到“与纳耀斑预测相容”，但必须同时写明非唯一；支持结论仍停留在热过程层级。
- 跨活动区队列只能支持明确写成“所选跨事件样本”的假设。其他活动区结果不能被用于宣称 AR11158 单事件由某过程主导。

因此系统可以同时保留很多竞争候选和耦合候选，但每条候选必须拥有自己的原子预测、证伪条件和作用域。

### 4.1 主流机制对比研究的实际实现

| 候选                      | 当前已执行的观测检验                                                                                                                   | 真正有区分力的目标证据                                                                                   | 当前处置                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 阿尔芬波传播与耗散        | AIA 171/193 Å 周期、跨通道相关、空间相干、自动时距轴和表观传播速度                                                                     | 人工核验环路径上的密度、相速度、振幅、频率依赖阻尼长度，以及波能流能否闭合辐射/传导损失                  | 只完成波动代理；缺少能量闭合，具体波加热保持 `deferred_requires_data`                  |
| 磁重联/纳耀斑             | AIA 94/131 Å 间歇热峰、阈值敏感性、事件相对 fluence、冷却链、DEM、HMI LOS/SHARP 电流代理和磁—热时序关联；NuSTAR 输入已通过基础质量审计 | NuSTAR 源/背景/响应/ghost-ray 校正后的物理通量或上限、可重复的磁—热关联、磁拓扑/自由能前向模型和能量预算 | 可支持受限脉冲热过程，但这些预测并不唯一；具体重联/纳耀斑保持 `deferred_requires_data` |
| 波动—重联耦合             | 同一窗口联合检查波动、热通道和磁场代理，并要求先后关系与联合增益                                                                       | 观测匹配 MHD 中分别关闭波驱动、重联耗散或耦合项的组件消融；合成 AIA/光谱后比较留出事件预测增益           | 已生成原子预测和模拟任务，尚无可执行的匹配模拟产物，保持 `deferred_requires_data`      |
| 近稳态/热非平衡等替代解释 | 背景对照、零/非零时延边界、DEM、跨事件复现与反例搜索                                                                                   | 匹配环几何和加热空间分布的流体模型、长周期循环/日冕雨/密度光谱联合诊断                                   | 作为竞争解释保留，用于阻止把有序冷却自动写成纳耀斑或重联                               |

数值模拟部分目前的状态是“文献前向预测进入 RAG、生成 MHD 配置/观测建议、登记 `future:matched-mhd-forward-model` 和 `future:component-ablation-study`”，并已新增一层**确定性约化前向闭环**：`scripts/run_loop_forward_model.py`（`loop-forward-model-v1`）消费 `mhdConfigTool` 的 `.cfg`（对 MHD 码单位的 `heating_rate` 做物理范围守卫），对定常/纳耀斑风暴/波动驱动三个共享平均加热的预注册场景确定性积分单区能量平衡环模型，合成六通道 AIA 光变并输出峰值温度、热通道衰减时标与 171/193 时延，与登记观测目标（AR11158 窗口实测 171-193 时延 144 s）做加权相对误差场景排序；产物含 manifest SHA-256（`outputs/loop-forward-model-v1/`），自检覆盖能量闭合、单调衰减与字节级确定性。它仍**不启动 3D MHD 求解器、不生成图像级合成 AIA/IRIS/EIS、不做组件消融、不在科学循环内自动认领任务**，且单区模型无空间冷却传播，合成时延绝对值系统性偏小，仅支持场景间相对排序。因此“结合数值模拟寻找判别证据”目前仍是**部分实现**，不能写成已经完整实现；`loop-forward-model-v1` 把候选机制的定性讨论升级为可复现的正演判别演示，完整闭环（可版本化模拟执行器、参数先验、仪器响应卷积、同一特征提取、组件消融、独立事件评分）仍待工程，规划器应继续把它登记为 `requires_data`，不能为了得到 `supported` 伪造模拟证据。

## 5. `supported` 与证据等级

当前新运行不再生成假设级 0–1 `confidence`。在没有专家裁决标签、独立校准集和适当概率模型时，0.48、0.60 或 0.75 都不能被科学地解释为“假设为真的概率”，固定加减分同样会制造不存在的精度。后端改为序数 `evidenceStrengthGrade`：`not_assessed`、`insufficient`、`limited`、`moderate`、`strong`、`conflicted`，并固定写入 `evidenceStrengthSemantics=ordinal_evidence_grade_not_probability`。

`quantitativeResults[].confidenceLevel=0.95` 与此不同：它只说明某个可观测量的重采样或统计区间采用 95% 覆盖水平，必须与点估计、上下界、单位和算法一起阅读；它不是整个假设有 95% 概率为真。

进入 `supported` 必须同时满足：

- 至少 3 条 `mechanism_discriminating` 有效支持；
- 至少 3 个独立事件和 3 个独立原始数据谱系；
- 至少 2 个观测量族、2 个方法族；
- 至少 1 条真实登记的 holdout 支持；验证集不得重标为 holdout；
- 覆盖该候选的全部注册预测；数值方向必须由完整 95% 区间满足，而非只看点估计；
- 所有记录具有确定性 provenance、点估计、区间、单位和处理产物；
- 没有未解决的机制级反例或撤销性 correction。

“预测相容”记录可以展示，但不进入上述严格数量。结论摘要同时报告相容总数和真正计入门禁的数量，防止两者混写。

## 6. 辅助机器学习

当前事件/背景辅助检测器采用按活动区留一评估，预处理和特征选择只在训练折内拟合，并排除帧数、cadence、流存在标记和背景比值等泄漏变量。实测 ROC AUC 0.774、平衡准确率 0.786；7 个活动区配对的 64 种精确置换检验 `p=0.125`，未达到 0.05。报告固定为 `pilot_only`、`uncalibrated`。

这类模型可做异常质检和窗口排序，不能输出机制概率。若未来训练机制分类器，必须先获得按独立活动区划分的专家裁决机制标签，并在隔离测试集报告 Brier score、log loss 和校准曲线。

## 7. 是否继续增加数据

65.514 GB 已足以完成当前比赛的可追溯方法闭环。下一步不是无休止扩充同类 AIA，而是由尚未覆盖的特异预测触发：

| 科学缺口                 | 应补内容                                        | 作用                                             |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------ |
| 非热粒子/极高温尾        | 事件匹配的 FOXSI、NuSTAR 或其他硬 X 射线        | 增强纳耀斑候选的机制区分力                       |
| 日冕磁拓扑与自由能       | 质量合格的矢量边界、NLFFF/拓扑与不确定度        | 检验重联位置和能量预算，不把 PIL 代理当重联率    |
| 波能流和阻尼             | 人工核验环路径、密度、相速度、振幅和阻尼长度    | 完成波动候选的能流闭合                           |
| 光谱广度                 | 更多真正独立的 IRIS/EIS 事件与版本化标定        | 区分 Doppler、非热展宽、密度和温度预测           |
| 模型比较                 | 与观测几何匹配的 MHD/流体前向模拟及仪器响应卷积 | 比较候选而非只找共同预测                         |
| 概率校准（可选后续研究） | 独立事件和专家裁决标签                          | 只有在标签、隔离测试集和校准评估齐备后才输出概率 |

AR11158 发生在 IRIS 发射前，不能补到真实同期 IRIS。其他事件的光谱可以检验跨事件样本假设或方法外推，但不能冒充 AR11158 的同事件证据。

## 8. Helix、Qwen 与复现入口

Helix 文献库当前登记 80 条去重且已核验的论文记录，达到 80–150 篇冻结区间下限；`node scripts/audit-literature-corpus.ts --require-freeze-ready` 已验证数量、分层覆盖、必填元数据和重复 ID/题名/DOI，当前 `freezeReady=true`。`start-local.ps1 -WithHelix` 会幂等种入当前语料。`searchPapers` 同时联合 Helix/本地语料、OpenAlex 和 Crossref 免费元数据接口；结果记录 provider、原生 ID、DOI/来源链接、检索时间和缓存状态。在线接口失败时回退到 7 天缓存和本地语料，不会使文献溯源智能体整体失败。文献用于提出机制、区分性预测、替代解释和反例，不直接创建本地 `support`。接口选择与边界记录在 `sources/research_free_literature_api_integration_20260824.md`。

历史真实模型标定 `run-1787839551365-dec915cb` 位于 `outputs/qwen35plus-final-gap-audit-20260827/scientific-result.json`，使用 `qwen3.5-plus / thinkingLevel=low` 和 80 篇冻结语料。它在 **v3 预处理**下得到 1 条受限过程层 `supported/strong` 和 3 条具体机制 `uncertain/insufficient`。该结果证明门禁路径可达，但不是当前科学结论：v4/v5 加入差分自转并重建事件目录后，三个 validation 窗未再通过冻结 fluence 判据，因此 v3 结果只保留为历史标定，不得写成当前版本仍支持某个过程或机制。

当前提交基线为 Docker + Helix 实跑 `run-1788431926970-1f3b6181`，结果位于 `output/docker-helix-submission-20260903/scientific-result.json`，元数据位于同目录的 `run-metadata.json`。该次 `local-grounded` 回归使用 `coronal-evidence-70gb-v1`、`maxRounds=2` 和两路有界并发本地处理；15 条假设、144 条证据、29 个任务中 18 个已完成，11 个明确依赖新数据/外部设施的任务保持 `planned`。失败任务 0、失败智能体 0、未解决 error correction 0。

当前严格结果为 0 条 `supported`、1 条受限过程层 `provisionally_supported`、14 条 `deferred_requires_data`、0 条 `eliminated`，总体 `scientificStatus=needs_data`。系统产生 144 条证据，但没有任何具体机制同时满足机制区分、独立事件、定量区间、全部预测覆盖和 holdout 门槛。把当前结果写成 supported 会违反预注册判据；“预测相容”也不能替代机制证据。

每条假设都有机器可读的主状态和原因状态；当前 14 条因数据或执行器边界延期，1 条仅为受限过程层的暂定支持。`workflowClosure.status=complete` 表示本轮假设和任务均已处置；`operationalClosure.status=complete` 表示智能体、执行器和数据完整性没有失败；`closureStatus=partial` 则诚实表示科学证据仍不足。这三个状态不得合并。`maxRounds` 只是硬计算预算，结果新增 `roundBudget={maxRounds,roundsUsed,exhausted,deferredTaskCount}`；本次为 `2/2` 且 `exhausted=true`，但终止原因仍为更有科学含义的 `no_executable_validation_task`，不会为了跑满轮数重复同一处理。

实时工作台不再把“支持性证据条数”标成“支持假设数”。`oracle.verify` 现在会重新发布裁决后的假设状态，并单独发布 `scientific.verification-report`；界面显示假设支持/排除/待裁决数，同时展开有效支持证据、独立事件、方法族、holdout 和预测覆盖。新运行的智能体展示名统一为文献溯源、观测质控、物理诊断、反证审计、验证设计和闭环协调智能体；英文 role key 仅作为内部兼容契约保留。

最新结果额外包含 15 条 `agentExecutions`，覆盖四大执行阶段（该基线运行由七阶段命名引入前的代码产出，持久化记录沿用 A/B/C/D 旧代号，分别对应现行的 Librarian/Explorer/Oracle/Prometheus；新运行直接使用 `librarian.generate` 等七阶段命名），逐条记录 agent、能力、轮次和假设/证据/任务输出 ID。Prometheus 阶段会将最终轮无法实际执行的本地建议计入预算审计，而不会登记成虚假的 `executable_now`；Oracle 阶段裁决也会进入同一执行账本，避免“智能体运行过但没有科学责任边界”的黑箱。

后端具备真实淘汰能力：只有至少两条独立事件/原始谱系上的、命中预注册致命证伪条件的定量反证，包含 holdout 且对应完成任务的功效与最小可检出效应达到预注册要求，才把候选标为 `eliminated` 并从活动池移除；审计记录永久保留。本次 0 条淘汰不是功能缺失，而是当前反例没有达到该门槛。单事件阴性、诊断不特异和“未发现”均不能用于强行淘汰。

下一步数据由具体缺口触发：先重取本轮发现的 3 个抽样 FITS 异常并复算受影响产物；过程层再按事先登记选择规则增加一个独立/更长事件窗和第三个独立光谱事件；波动层需要环路径、密度、传播、阻尼和能流闭合；纳耀斑/重联需要事件匹配硬 X 射线与磁拓扑前向模型；耦合层需要匹配观测的 MHD 前向模拟和组件消融。不能在看到结果后只挑“强尾部事件”，也不能承诺新增固定 GB 数后必然 supported。

最终 JSON 中假设级 `confidence` 字段为 0 个；`confidenceLevel` 只出现在定量指标区间中。当前 `closureStatus=partial`：预测和证伪条件均有证据或计划覆盖，但反例检验能力尚不足，所以“没有发现反例”不能写成“反例不存在”。完整归档同时保存 request、SSE、headers、代码状态补丁与状态清单、commit、request/manifest/patch SHA 和预处理版本，可独立核对本次运行。

```powershell
$env:CORONAL_DATASET_ID = 'coronal-evidence-70gb-v1'
corepack pnpm local:start:helix

python scripts/process_coronal_pack.py `
  --manifest data/dataset/coronal-evidence-70gb-v1/manifest.json `
  --dataset-root data/dataset/coronal-evidence-70gb-v1

powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/run-scientific-demo.ps1 `
  -ExecutionMode model-assisted -MaxRounds 2
```

关键产物：

- `data/dataset/coronal-evidence-70gb-v1/manifest.json`
- `data/dataset/coronal-evidence-70gb-v1/derived/analysis-v4/processing_report.json`
- `data/dataset/coronal-evidence-70gb-v1/derived/analysis-v4/event-features-v4.csv`
- `data/dataset/coronal-evidence-70gb-v1/derived/analysis-v4/auxiliary-event-detector-report.json`
- `sources/coronal-heating-corpus-v1.json`
- `sources/research_joint_solar_event_selection_20260824.md`
- `sources/research_coronal_heating_discriminants_expansion_20260824.md`
- `sources/research_free_literature_api_integration_20260824.md`
- `output/docker-helix-submission-20260903/scientific-result.json`
- `output/docker-helix-submission-20260903/run-metadata.json`
- `output/docker-helix-submission-20260903/code-state.patch`（代码状态快照）
- `outputs/qwen35plus-final-gap-audit-20260827/scientific-result.json`（仅作 v3 历史标定）

任何提交结论都应引用最终 JSON 的逐假设验证报告，而不是只引用 UI 文案。

## 9. 最终验收

- Monorepo typecheck：11/11 包通过。
- 自动化测试：最终回归 73 个测试文件无失败；最近一次环境中 610 项通过、1 项按设计跳过，并额外通过 PowerShell API-only/动态端口/归档恢复脚本回归。淘汰门禁测试同时覆盖“多事件、holdout 且功效充分时淘汰”和“单事件/功效不足时不得淘汰”；新增测试覆盖多 agent 执行账本、`maxRounds` 预算摘要、IRIS holdout 绑定、两路有界处理、局部完整性、correction 语义去重、unknown 不制造降级和 operational degraded 路径。
- Monorepo production build：11/11 包通过。Web 已改用离线安全的系统字体栈，构建不再依赖 Google Fonts 网络下载；页面结构未改。
- 运行验收：`run-1788431926970-1f3b6181` 达到 `workflowClosure=complete`、`operationalClosure=complete`、`closureStatus=partial`；`roundBudget=2/2, exhausted=true`，SSE 含且仅含一次 `scientific.loop-complete`，归档 request/manifest/patch SHA 保存在同一输出目录。
