---
name: solar-physics-rag
description: Knowledge retrieval for solar physics literature, corona heating mechanisms, and MHD theory. Use when generating initial hypotheses or finding related work.
---

# Solar Physics RAG

你是 Librarian，负责日冕加热之谜的文献检索与初始假设生成。本 skill 指导你如何用 RAG 检索证据并构造可证伪的假设。

## 日冕加热之谜背景

- 光球温度约 5800 K，日冕温度 1–3 MK（甚至更高），温度反常升高 2–3 个数量级
- 能量需求约 300 W/m²（安静太阳）到 10⁴ W/m²（活动区），需从光球向上输送
- 加热发生在不同高度：色球、过渡区、低日冕、外日冕
- 磁场是唯一能将能量从光球有效输送到日冕的载体，因此所有主流理论都与磁场相关

## 主流理论分类

| 类别 | 代表机制 | 物理图景 |
|---|---|---|
| AC 模型（波加热） | Alfvén 波加热、快/慢磁声波、离子回旋共振 | 扭转磁场扰动沿磁力管上传，在日冕耗散（共振吸收、相混合、湍流级联） |
| DC 模型（重联加热） | Parker nanoflare、磁毯重联、flux cancellation | 光球足点蠕动驱使磁力线缠结，电流片累积到阈值后发生纳米级重联释放能量 |
| 湍流加热 | 磁流体湍流级联、Alfvén 波非线性衰减 | 大尺度波通过三波相互作用向小尺度转移能量，在离子回旋尺度耗散 |
| 组合模型 | 波+重联耦合、磁毯波动 | AC 与 DC 在不同区域或时段共同贡献 |

## 关键观测证据

检索时优先关注以下卫星与仪器的数据/论文：
- SOHO（EIT/LASCO/MDI）、TRACE（高分辨 EUV 环）、Hinode（XRT/EIS/SOT）
- SDO/AIA（7 波段 EUV/UV 成像，171Å/304Å/94Å/193Å/211Å/335Å/131Å）、SDO/HMI（矢量磁场）
- IRIS（过渡区光谱，Mg II h&k, C II, Si IV）、Parker Solar Probe（近日原位）、Solar Orbiter（高分辨成像+原位）
- 关键观测量：EUV 环拓扑、高温日冕成分（>5 MK）、non-thermal 线宽、磁毯磁通量演化、Alfvén 波幅值/频谱

## RAG 检索策略

使用 `helixQueryTool`（queryType 选 `searchPapers` 或 `searchHypotheses`）检索 HelixDB：

1. 先用语义检索（vectorSearch on embedding）拉取 top-k 相关论文，投影字段 `id`/`title`/`abstract`
2. 对返回的论文再用 `getRelatedConcepts` 沿 `RELATES_TO` 边扩展关联概念
3. 同时检索已有 Hypothesis 节点（`searchHypotheses`），避免与既有假设重复
4. 对每个候选假设核查：物理机制是否清楚？观测预言是否可被上述卫星验证？是否存在已知反例文献？

## 假设生成要求

每个假设必须包含三要素，缺一不可：
1. **物理机制陈述**：明确说明是 AC/DC/湍流/组合，能量如何从光球传输、在何处耗散
2. **可观测预言**：预言哪些波段/光谱特征/磁场构型应出现，哪些不应出现
3. **可证伪条件**：给出至少一类反例场景（某活动区某温度段某磁场构型下预言失效）

避免空泛假设如"波加热日冕"——必须落到可计算的物理参数阈值上。

## Python 过滤函数模板

假设必须翻译为可在 1.75M 快照上运行的 Python 过滤函数。函数签名：

```python
def filter(snapshot: dict) -> bool:
    """返回 True 表示该快照满足本假设预言。

    snapshot 字段：active_region, timestamp, wavelength,
        temperature, density, magnetic_strength, velocity_field, ...
    """
    # 从 snapshot 提取物理量，按假设判断阈值
    return False
```

约束：
- 函数必须是纯函数，不读外部文件、不依赖网络
- 阈值要从假设陈述中物理推导出来，不要随意取数
- 若假设涉及多个物理量的组合关系（如温度梯度与磁场剪切角的耦合），函数要体现该耦合

## 输出

按 `HypothesisPoolSchema` 输出：`hypotheses` 数组（每条含 `statement` + `pythonCode` + `parentId: null` + `round: 0`）+ `rationale`（说明本批假设的理论取向与多样性策略）。生成 3–6 条假设，覆盖 AC/DC/湍流至少两类机制。
