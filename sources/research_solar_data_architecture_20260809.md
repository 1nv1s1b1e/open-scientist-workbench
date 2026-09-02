# Solar-data implementation notes

检索日期：2026-08-09

用途：为日冕加热闭环确定首批观测数据入口、处理边界与可追溯性要求。

## 已核验的数据入口

- SDO 的官方数据入口提供 AIA、HMI 与 EVE 产品；页面明确支持按时间、波段、分辨率和 cadence 浏览或下载，也提示可获取 AIA/HMI cutout，而非一开始下载整盘图像。
- JSOC 是 HMI/AIA 的主要科学数据归档；可通过其查询与导出接口获取记录、元数据和数据段。
- SunPy/DRMS 文档说明 JSOC 下载存在查询、stage、下载三个阶段；自动采集器需要把 export request、状态和最终文件清单都记录下来。
- NOAA SWPC 提供 GOES 产品目录，可作为软 X 射线的外部时间序列参照。
- VSO 可作为扩展仪器的统一检索入口；IRIS 和 Hinode 适合在首批 AIA/HMI/GOES 流程稳定后，按事件补充高分辨率光谱或 XRT/EIS 诊断。

## 对系统的约束

1. 原始 FITS/cutout 应保存到数据资产层；Helix 只保存数据资产的版本、校验、时间空间覆盖、派生指标和证据关系。
2. 没有原始数据时，只能生成可验证假设和缺失数据计划，不能把 RAG 输出写成观测证据。
3. 首批采集应优先使用活动区 ROI、统一 cadence 的多波段序列和对应 HMI 磁图，避免全日面全 cadence 下载。
4. 每次处理必须留下查询条件、导出请求、FITS header/WCS、校准与对齐版本、输出哈希及质量控制结果。

## 来源

- NASA SDO data access: https://sdo.gsfc.nasa.gov/data/dataaccess.php
- JSOC data products: https://jsoc.stanford.edu/
- SunPy JSOC download guide: https://docs.sunpy.org/en/stable/tutorial/acquiring_data/jsoc.html
- DRMS documentation: https://docs.sunpy.org/projects/drms/en/stable/intro.html
- NOAA SWPC GOES primary JSON directory: https://services.swpc.noaa.gov/json/goes/primary/
- Virtual Solar Observatory: https://sdac.virtualsolar.org/cgi/search?server=sdac
- IRIS co-aligned-data note: https://iris.lmsal.com/itn32/itn32.pdf
- Hinode analysis guide: https://hinode.nao.ac.jp/en/for-researchers/analysis-guide/
