# 联合太阳观测留出事件选择审计（2026-08-24）

## 目的

现有数据包已经覆盖多事件 AIA/HMI 热演化与磁场证据，但 `requires_data` 仍指向两个机制区分缺口：

1. 光谱 Doppler、非热展宽和密度/温度诊断；
2. 在分析前冻结的、未参与阈值设计的独立联合观测事件。

因此本轮不是继续堆叠同类 AIA 帧，而是选择同时具备 IRIS、Hinode/EIS、SDO/AIA 和 SDO/HMI 的事件，并在下载和分析前固定事件、时间窗和主要判据。

## 检索与选择条件

- 查询日期：2026-08-24。
- 条件：活动区接近日面中心；IRIS 与 EIS 时间重叠；AIA/HMI 可取得同时间窗观测；论文明确报告谱线、时间和空间配准过程；事件未用于当前系统阈值设定。
- 主要检索词：`IRIS EIS AIA HMI simultaneous active region fan loops event`、`IRIS EIS AR 11899 2013-11-19`、`Hinode EIS IRIS joint observation archive`。

## 冻结的留出事件

选择 NOAA AR 11899（2013-11-19）作为新的联合观测留出事件。该选择在本地数据分析之前冻结。

- IRIS：约 10:31:15–11:03:31 UT，6 个 raster，每个约 5 分 17 秒。
- Hinode/EIS：约 10:40:20–11:59:00 UT。
- SDO/AIA：覆盖联合观测前后，至少包含 94、131、171、193、211、335 Å，并加入 1600 Å 用于配准。
- SDO/HMI：覆盖相同 ROI 和时间窗，优先使用带可靠 WCS/BUNIT 的 SHARP 矢量磁场分量。
- IRIS 诊断线：C II 1334/1335 Å、Si IV 1393/1402 Å、O IV 1399/1401 Å。
- EIS 诊断线：Fe VIII 194.663 Å、Si VII 275.368 Å、Si X 258.375/261.058 Å、Fe XII 195.119 Å、Fe XIII 202.044 Å、Fe XIV 264.787 Å。

冻结的主问题不是“证明所有加热机制”，而是：在该事件和预先声明的 ROI 中，低频脉冲加热相对于稳态弥散加热或纯波动解释，是否获得跨热成像、光谱和磁场三个证据族的一致且有机制区分力的支持。

## 已下载和本地复现结果

- 联合光谱补充包已完成 4/4 资产校验，总计 1,462,224,668 字节；manifest 与每个资产均保存 SHA-256。
- IRIS Level-2 的 6/6 个 raster 可读。按照 Ghosh 等图 5 的 E 区 ROI，并以每个 raster 的 O I 1355.5988 Å 进行波长零点校正，本地得到 Si IV 1393.755 Å 中位 Doppler 速度 5.484 km/s，raster bootstrap 95% 区间为 [3.741, 6.642] km/s。
- 该区间完全为正并满足冻结判据，因此它是“过渡区足点存在系统流动”的可审计支持；它只约束低频脉冲热过程层级，不能唯一识别纳耀斑、磁重联或波致耗散。
- EIS 当前资产为 Level-0。在缺少固定版本的标定与谱线拟合流程时，后端明确排除 EIS 定量推断，不以论文数值补写本地结果。
- AR11899 是已发表的正控事件：选择和 ROI 在本地分析前冻结，但既有文献已经给出结果方向。因此它能检验实现是否复现已知信号，却不应被描述为新的盲发现；提交材料必须保留这一限制。

本地定量产物位于 `data/dataset/coronal-evidence-70gb-v1/derived/analysis-v4/ar11899-joint-spectroscopy-20131119/coronal_metrics.json`。光谱结果只有在候选事先注册了对应 Doppler/线宽/密度预测时才能绑定；不得事后把它移接到冷却或事件分布预测上。

## 文献给出的先验背景（不作为本地计算结果）

Ghosh 等对该事件报告了 IRIS/EIS/AIA 联合观测、跨仪器配准、足点红移、温度分量和密度诊断，并将结果解释为与低频纳米耀斑/脉冲加热一致。论文结论只用于确定可检验预测；系统不得把论文中的数值直接冒充本地数据证据。所有 `supported` 判定必须来自下载后可复现的本地计算。

## 预先声明的判定边界

- 单个“符合预测”的观测只能记为兼容证据，不能单独升格为机制支持。
- `supported` 至少要求两个相互独立的方法族、两个观测量族，以及一个未参与阈值选择的留出事件；支持结论必须限定到事件/样本和机制层级。
- 如果数据只表明共同预测（例如一般性升温或冷却），结论保持 `unknown`/`needs_data`。
- 如果联合观测与预测方向相反，必须保留反证并允许 `refuted`，不能通过 correction 删除真实反例。
- 光谱密度仅在有明确原子参数/标定曲线时计算；否则标记为不可执行，不以文献数值替代。

## 数据与论文来源

1. Ghosh, A. et al., _Fan Loops Observed by IRIS, EIS and AIA_, ApJ 835:244 (2017), DOI: https://doi.org/10.3847/1538-4357/835/2/244
2. 论文预印本：https://arxiv.org/abs/1701.01617
3. IRIS Level 2 数据说明：https://iris.lmsal.com/data.html
4. IRIS 数据检索：https://iris.lmsal.com/search/
5. Hinode DARTS 数据检索：https://darts.isas.jaxa.jp/app/query/hinode/
6. Hinode/EIS 官方仪器页：https://hinode.nao.ac.jp/en/for-researchers/instruments/eis/
7. NASA IRIS 任务页：https://science.nasa.gov/mission/iris/
8. IRIS 官方 Python 低层数据指南（ITN 41）：https://iris.lmsal.com/itn41/itn41.pdf
9. IRIS 数据级别与标定说明（ITN 51）：https://iris.lmsal.com/itn51/itn51.pdf
10. IRIS/SDO/Hinode 共配准数据说明（ITN 32）：https://iris.lmsal.com/itn32/itn32.pdf

ITN 41 明确给出 Level-2 raster 的扩展 HDU 组织、`NWIN/TDESC/TWMIN/TWMAX`
窗口描述，以及数组轴顺序（raster 位置、沿狭缝空间、波长）。ITN 51 说明 Level-2
已经完成暗场、平场、几何和波长校正，适合进一步科学分析。实现光谱读取器时以这些
官方格式说明为准，不从文件名猜测数组轴或窗口编号。

## 当前候选备选事件

- IRIS–AIA 大尺度磁重排脉冲加热事件（arXiv:1907.02291）：可作为第二光谱事件，但必须先从原文冻结精确时间、观测序列和下载标识。
- AIA 活动区核心间歇环事件集（arXiv:1404.7824）：适合扩大热演化跨事件样本，但不能替代 IRIS/EIS 光谱维度。

备选事件在完成时间窗冻结前不得加入支持计数，以避免结果导向的事件选择。
