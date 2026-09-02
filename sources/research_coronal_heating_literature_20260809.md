# 日冕加热论文元数据检索记录

检索日期：2026-08-09
用途：补齐 Open-Scientist 本地 Helix 论文语料的可追溯基础元数据；不下载受版权限制的全文，也不将综述或模型结果写成针对具体活动区的观测结论。

## 本次核验的主来源

- PubMed：Parnell 与 De Moortel，A contemporary view of coronal heating，2012，DOI 10.1098/rsta.2012.0113。
  https://pubmed.ncbi.nlm.nih.gov/22665900/
- PubMed Central：Klimchuk，Key aspects of coronal heating，2015，DOI 10.1098/rsta.2014.0256。
  https://pmc.ncbi.nlm.nih.gov/articles/PMC4410549/
- PubMed Central：De Moortel 与 Browning，Recent advances in coronal heating，2015，DOI 10.1098/rsta.2014.0269。
  https://pmc.ncbi.nlm.nih.gov/articles/PMC4410557/
- DOI 或 NASA 记录：Van Doorsselaere 等，Coronal heating by MHD waves，2020，DOI 10.1007/s11214-020-00770-y。
  https://doi.org/10.1007/s11214-020-00770-y
- Springer Nature：Del Zanna 与 Mason，Solar UV and X-ray spectral diagnostics，2018，DOI 10.1007/s41116-018-0015-3。
  https://doi.org/10.1007/s41116-018-0015-3
- arXiv：Brooks 与 Warren，Measurements of Non-Thermal Line Widths in Solar Active Regions。
  https://arxiv.org/abs/1511.02313

## 入库规则

1. coronal-heating-corpus-v1.json 保存题名、作者、年份、DOI、来源页、中文受控注释和证据边界。
2. Helix 仅保存这些元数据和受控注释，以便本地检索；全文下载仍由后续 OA 检索工具在需要时完成。
3. 每条注释都明确其角色：综述、模型预测、诊断方法或候选性观测约束。Agent 不得将其自动升级为对输入活动区的机制结论。
