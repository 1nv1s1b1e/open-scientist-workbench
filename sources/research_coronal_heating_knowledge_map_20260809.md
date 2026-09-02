# 日冕加热知识与数据选择来源记录

检索日期：2026-08-09

用途：为 Open-Scientist 的日冕加热闭环定义物理问题、竞争机制、可观测预测和数据选择边界。本文是项目数据卡与 Agent 提示词的来源索引，不把文献观点直接当作观测证据。

## 核心判断

1. 日冕加热仍是开放问题。波动耗散、磁重联/纳耀斑、湍流及其耦合都可能在不同磁结构、不同空间尺度和不同时间尺度下有贡献。
2. `纳耀斑`应被视为小尺度、脉冲式能量释放的现象描述，不能自动等同于单一磁重联机制；波动也可以触发或参与脉冲加热。
3. 图像中的亮化、单一波段强度或单一磁场统计量都不足以单独确认机制。最终证据必须能回到原始观测、处理版本、可证伪预测和质量控制结果。

## 机制与优先诊断

| 候选过程                | 需要检验的预测                                               | 优先观测                                             |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| MHD/Alfven 波传输与耗散 | 传播、相位差、阻尼、速度或非热线宽的变化                     | 高 cadence AIA；共时 IRIS 或 Hinode/EIS 光谱         |
| 磁重联与脉冲/纳耀斑加热 | 热通道的脉冲增强、热-冷通道时延、间歇性、磁拓扑/磁通变化关联 | AIA 94/131/171/193/211/335，HMI，关键案例的 EIS/IRIS |
| 足点加热与热非平衡      | 沿环的周期性升温、冷却、凝结或雨状结构                       | 长时间多波段 AIA，304 A，IRIS/Hinode 作为补充        |
| 湍流/级联及混合过程     | 间歇性、频谱、尺度分布、非热展宽及机制耦合                   | 高 cadence 影像、光谱和多案例统计                    |

## 数据层级

- 每个案例的基础层：AIA 多波段时序、对应 HMI 磁图、GOES/EVE 的全局背景与事件目录。
- 深诊断层：仅为少数关键案例补 IRIS、Hinode/EIS/XRT、Solar Orbiter 等共时观测。
- 模拟层：3D MHD 或参数化模型的合成观测，用于生成可检验预测；不能代替真实太阳反例。
- 证据层：保存原始查询、FITS/cutout、WCS/时间信息、质量标记、派生特征、哈希和结论边界。

## 时间尺度

- 波动：约 12--24 秒 cadence，连续 30--120 分钟；低 cadence 数据只能作为候选发现，不能确认波动耗散。
- 脉冲加热与热演化：约 1--2 分钟 cadence，至少 2--6 小时，以观察热通道响应和冷却时延。
- 磁场驱动：至少 6--24 小时背景；研究磁通涌现或衰减时需要延伸到数天。
- 热非平衡：通常需要 6--24 小时以上连续覆盖。

## 项目约束

1. A 阶段可提出机制组合与可证伪预测，但不能把 RAG 文本写成观测结论。
2. Looker 只负责发现数据可用性与候选窗口；Explorer 执行对齐、质量检查和特征计算；Oracle 核验预测、来源和反例条件。
3. 缺少高 cadence 或光谱诊断时，波动机制相关结论必须是 `unknown`，并在 D 阶段生成补采任务。
4. JW-FD 是磁场/耀斑预测工程样例，不是日冕加热的多波段证据集。

## 已核验来源

### 综述与诊断文献

- Parnell, C. E. & De Moortel, I. (2012). _A contemporary view of coronal heating_. Philosophical Transactions of the Royal Society A. DOI: 10.1098/rsta.2012.0113. https://pubmed.ncbi.nlm.nih.gov/22665900/
- Klimchuk, J. A. (2015). _Key aspects of coronal heating_. Philosophical Transactions of the Royal Society A. https://pmc.ncbi.nlm.nih.gov/articles/PMC4410549/
- De Moortel, I. & Browning, P. (2015). _Recent advances in coronal heating_. Philosophical Transactions of the Royal Society A. https://pmc.ncbi.nlm.nih.gov/articles/PMC4410557/
- Van Doorsselaere, T. et al. (2020). _Coronal heating by MHD waves_. https://arxiv.org/abs/2012.01371
- Brooks, D. H. & Warren, H. P. (2015). _Measurements of Non-Thermal Line Widths in Solar Active Regions_. https://arxiv.org/abs/1511.02313
- Del Zanna, G. & Mason, H. E. (2018). _Solar UV and X-ray spectral diagnostics_. https://link.springer.com/article/10.1007/s41116-018-0015-3

### 官方数据入口

- NASA SDO AIA/HMI/EVE data access: https://sdo.gsfc.nasa.gov/data/dataaccess.php
- JSOC AIA/HMI archive: https://jsoc.stanford.edu/
- SunPy JSOC acquisition guide: https://docs.sunpy.org/en/stable/tutorial/acquiring_data/jsoc.html
- DRMS client documentation: https://docs.sunpy.org/projects/drms/en/stable/intro.html
- NOAA SWPC GOES products: https://services.swpc.noaa.gov/json/goes/primary/
- Virtual Solar Observatory: https://sdac.virtualsolar.org/cgi/search?server=sdac
- IRIS co-aligned-data note: https://iris.lmsal.com/itn32/itn32.pdf
- Hinode analysis guide: https://hinode.nao.ac.jp/en/for-researchers/analysis-guide/
