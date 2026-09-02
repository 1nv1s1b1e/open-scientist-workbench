# 官方太阳观测数据访问与使用边界（2026-08-14）

本笔记记录本次后端审计使用的官方入口，不是新增观测数据。

## 官方入口

- NASA SDO 数据访问页：<https://sdo.gsfc.nasa.gov/data/dataaccess.php>
  - 提供 AIA、HMI、EVE 的浏览、时间序列和科学数据访问入口。
  - 页面明确区分浏览图像、近实时数据和 JSOC 科学档案；需要精确配准时推荐使用 JSOC 的 tracked-patch/科学数据流程，而不是只使用浏览图像。
  - AIA synoptic 目录提供 1k x 1k、3 分钟 cadence 的近实时 FITS；这适合快速原型，不等价于全部科学级高 cadence 资料。

- SunPy DRMS 教程：<https://docs.sunpy.org/projects/drms/en/latest/tutorial.html>
  - JSOC 记录由 series、prime keys、keywords 和 segments 组成；应先查询时间、质量、观测参数，再取得数据片段。
  - 直接访问 segment 路径得到的 FITS 可能没有完整 header keyword；若需要 WCS、标定和精确配准所需关键字，应查询元数据并使用带 `protocol='fits'` 的导出。
  - `url_quick/as-is` 适合快速、低负担下载；它不能被误认为已经完成 header 补全。

- SunPy JSOC 获取指南：<https://docs.sunpy.org/en/stable/tutorial/acquiring_data/jsoc.html>
  - 标准工作流是 query → stage/export → download，并应记录请求状态、查询字符串、导出 ID（如有）和下载文件。

## 对 Open-Scientist 的直接约束

1. 每个样本必须保存 series、时间范围、cadence、波段/segment、ROI、查询字符串、FITS header/WCS、质量字段和文件哈希。
2. 没有 WCS/header 或没有共同时间基准时，只能做“观测量描述”，不能把跨波段相关、视向磁场代理量直接升级为传播速度、拓扑重联或能量闭合证据。
3. 优先下载事件 ROI/cutout 和少量深度诊断资料；不要用完整日面数据量替代独立事件数和正交观测量。
