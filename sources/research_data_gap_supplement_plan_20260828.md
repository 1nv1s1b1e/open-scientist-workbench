# 机制判别数据补充计划（2026-08-28）

> 本文把当前数据缺口转成可执行的补数清单。口径遵循 [方向 2B 后端与数据最终说明](competition-2b-final-backend-and-data.md)：
> 只有预测级判别需求才触发补数；同类 AIA 扩容不自动增加机制区分力。
> 已核验的事件锚点来自 [targeted mechanism data 研究](research_targeted_mechanism_data_20260826.md)，不得另行编造时间窗。

## 1. 已就绪的补数 spec

`examples/coronal-mechanism-discriminant-supplement-v1.json` 登记两个窗口，总量约 4–6 GB：

| caseId                                | 作用                                                                                       | 锚点                          | 状态                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------- |
| `ar12721-microflare-context-20180909` | 为 NuSTAR `80414201001/2001/3001` 提供同期 AIA 热上下文 + HMI 背景；微耀斑 11:04 UT 已发表 | DOI:10.3847/2041-8213/ab873e  | 可直接 `--plan` 下载                                                                        |
| `ar12222-nustar-context-20141211`     | 为 NuSTAR `20001005001` 提供全天上下文以定位晚相区间                                       | DOI:10.3847/1538-4357/835/1/6 | 下载可行；但该 ObsID FPMA/FPMB 一致性检查未过，须先查明差异；最终子窗须对照 NuSTAR GTI 冻结 |

下载与登记命令（复用主包校验逻辑）：

```powershell
python scripts/fetch_coronal_starter.py `
  --plan `
  --spec examples/coronal-mechanism-discriminant-supplement-v1.json `
  --workers 12

python scripts/fetch_coronal_starter.py `
  --download `
  --spec examples/coronal-mechanism-discriminant-supplement-v1.json `
  --reuse-from data/dataset/coronal-evidence-70gb-v1 `
  --workers 12 `
  --download-workers 4
```

补齐后，NuSTAR HXR 判别的前置条件从"输入已审计"推进到"事件匹配热上下文可用"；
物理通量仍需源区/背景/响应/ghost-ray 处理链（`nustar_pyspy`），这一步与下载无关。

## 2. 第三光谱事件（先核验、后下载）

当前正控光谱事件仅 AR11899（IRIS+EIS）；AR11890 IRIS Level-2 已下载待处理。
达到"≥3 独立光谱事件"门控还差 1 个。

- 候选文献：Reale et al. 2019, ApJ, DOI:10.3847/1538-4357/ab304f（arXiv:1907.02291）——
  IRIS 亮点足点 + AIA 热通道瞬态环，机制上同时服务纳耀斑与湍流级联候选。
- 摘要未给观测日期与 AR 号，**在从 LMSAL HCR / Level-2 归档读出确切 obsID 与时间之前，
  不写入任何 spec**。核验流程与 AR11890 相同：
  1. 从论文正文/图注提取 IRIS SJI/raster 的 UTC 区间与 AR 号；
  2. 在 `https://www.lmsal.com/hek/hcr` 冻结 obsID；
  3. `https://www.lmsal.com/solarsoft/irisa/data/level2_compressed/` 下载 Level-2；
  4. 以 `fetch_joint_spectroscopy.py` 登记 SHA-256 后方可进入分析。

## 3. 与下载无关、必须先完成的处理链

| 链                                                       | 解锁的判别维度                     | 备注                                         |
| -------------------------------------------------------- | ---------------------------------- | -------------------------------------------- |
| NuSTAR 源区/背景/响应/ghost-ray（`nustar_pyspy`）        | 物理 HXR flux/上限 → 纳耀斑判别    | ObsID 20001005001 一致性异常未查明前不得使用 |
| EIS CHIANTI 冻结（Si X 258/261 → 密度；线宽 → 非热速度） | 光谱密度/非热诊断 → 波动与湍流判别 | 数据已在手（AR11899 Level-1）                |
| 差分自转补偿 → `wcs-roi-dem-v4`                          | 磁—热关联、长窗冷却/传播配准       | 全派生缓存重建，冷/热指纹必须一致            |

## 4. 永久缺口的处置（不可解决，必须披露）

- AR11158（2011-02）早于 IRIS 发射（2013）与 NuSTAR 太阳指向（2014）：同期光谱与 HXR
  永久缺失。处置：所有机制级断言限定在跨事件样本作用域（系统已按作用域门控执行），
  AR11158 仅作为发现事件。
- FOXSI 为探空火箭，无这些事件的存档观测；NuSTAR 太阳指向即其存档替代品（已在手）。
- 上述披露文字可直接进入提交材料的"数据与外部资源声明"。
