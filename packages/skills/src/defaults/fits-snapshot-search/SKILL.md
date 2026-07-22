---
name: fits-snapshot-search
description: 在真实 SDO/HMI SHARP 磁场数据上评估假设过滤函数的 F1 分数。计算假设 Python filter 的精度/召回率时使用。
---

# SHARP 快照评估

你是 Explore，负责将假设的 Python 过滤函数在真实 SDO/HMI SHARP 磁场参数数据集上评估，计算 F1 并反例 debug。

## 数据集

数据来自 UAH SHARP Solar Flare Prediction Dataset (Newman et al. 2025)，基于 NASA SDO/HMI 的 Space-weather HMI Active Region Patch (SHARP) 数据产品。

- **文件位置**: `data/dataset/snapshots.jsonl`（21,578 条快照）
- **格式**: JSONL，每行一个 JSON 对象
- **标签**: `label=1` = 耀斑事件（B/C/M/X 级），`label=0` = 宁静（N 级，无耀斑）
- **正负比例**: 63.3% 正例 (13,659 条), 36.7% 负例 (7,919 条)
- **耀斑等级分布**: N=7919, B=5809, C=1345, M=6061, X=444

### 每条快照的字段

| 字段 | 含义 | 单位 |
|---|---|---|
| `usflux` | 总无符号磁通量 | Maxwell |
| `mean_gamma` | 平均磁倾角 | 度 |
| `mean_gbt` | Bt 水平梯度 | G/Mm |
| `mean_gbz` | Bz 水平梯度 | G/Mm |
| `mean_gbh` | Bh 水平梯度 | G/Mm |
| `mean_jzd` | 平均垂直电流密度 | mA/m² |
| `totusjz` | 总无符号垂直电流 | A |
| `mean_jzh` | 平均水平电流 | A/m² |
| `totusjh` | 总无符号水平电流 | A |
| `absnjzh` | 净垂直电流绝对值 | A/m² |
| `savncpp` | 极性净电流绝对值之和 | A |
| `mean_pot` | 平均光球自由能 | ergs/cm³ |
| `totpot` | 总光球自由能 | ergs |
| `mean_shr` | 平均剪切角 | 度 |
| `shrgt45` | 剪切>45°面积占比 | % |
| `r_value` | R 内磁通量之和 | Maxwell |
| `area_acr` | 活动区面积 | 微半球 |
| `flare_class` | 耀斑等级 | N/B/C/M/X |
| `magnitude` | 耀斑量级 | 数值 |
| `label` | 真值标签 | 0=宁静, 1=耀斑 |

**重要**: `filter()` 函数只能使用物理参数字段（usflux, mean_gamma, ...），**不能使用 label / flare_class / magnitude**——这些是 ground truth。

## 评估流程

### 1. 写 filter.py

在工作目录写 `filter.py`，定义 `filter(snapshot: dict) -> bool` 函数：

```python
def filter(snapshot: dict) -> bool:
    """True = 预测为耀斑/加热事件。"""
    usflux = snapshot.get("usflux", 0)
    mean_shr = snapshot.get("mean_shr", 0)
    totpot = snapshot.get("totpot", 0)
    
    # 物理阈值判断
    return usflux > 5e21 and mean_shr > 40
```

### 2. 运行评估脚本

**不需要自己写 eval 脚本、不需要造数据。** 直接用预置的共享 venv 运行评估脚本。

prompt 中会给出数据集绝对路径 `<datasetDir>`。运行评估时直接用：

```bash
source <datasetDir>/.venv/bin/activate
python3 <datasetDir>/eval.py filter.py
```

脚本会：
- 加载 `data/dataset/snapshots.jsonl`（21,578 条真实快照）
- 对每条快照调用你的 `filter()` 函数
- 计算 TP/FP/FN/Precision/Recall/F1
- 输出 JSON 结果 + 前 10 个反例（FP/FN）

### 3. 调试反例

读取 eval.py 的 JSON 输出中的 `counterexamples` 数组：
- FP（误报）: filter 预测耀斑但实际宁静 → 分析哪些参数导致误判
- FN（漏报）: filter 预测宁静但实际有耀斑 → 分析哪些阈值太高

修改 `filter.py` 的阈值或增加约束，重新运行评估。

### 4. 提交结果

当 F1 收敛或达到步数上限，调用 `submit_result` 提交 EvalResult：
- `hypoId`: 输入中给的 hypothesis id
- `f1`: eval.py 输出的 f1 值
- `truePositives` / `falsePositives` / `falseNegatives`: eval.py 输出
- `counterexamples`: eval.py 输出的反例数组
- `logs`: 执行的命令 + 关键输出摘要
- `executionMs`: eval.py 输出的 executionMs

## F1 计算口径

- precision = TP / (TP + FP)
- recall = TP / (TP + FN)
- F1 = 2·P·R / (P + R)；当 P+R=0 时 F1=0
- TP/FP/FN 计数必须填入 `EvalResult`

## Python 环境

一个共享的 Python 虚拟环境已在 `data/dataset/.venv` 中预置好，包含 numpy 2.5.1 和 scipy 1.18.0。

运行评估时直接用这个 venv（`<datasetDir>` 路径在 prompt 中给出）：
```bash
source <datasetDir>/.venv/bin/activate
python3 <datasetDir>/eval.py filter.py
```

如果你的 filter 需要额外依赖，可以装到这个 venv 里：
```bash
uv pip install --python <datasetDir>/.venv/bin/python <package>
```

或者用 `uv run` 直接指定 venv：
```bash
uv run --python <datasetDir>/.venv/bin/python <datasetDir>/eval.py filter.py
```

## 重要约束

1. **不要自己生成合成数据** — 真实数据已在 `data/dataset/snapshots.jsonl`
2. **不要自己写评估脚本** — 共享脚本已在 `data/dataset/eval.py`
3. **filter 函数不能使用 label/flare_class/magnitude 字段**（这些是 ground truth）
4. 只需写 `filter.py`，然后运行 `source <datasetDir>/.venv/bin/activate && python3 <datasetDir>/eval.py filter.py`（`<datasetDir>` 在 prompt 中给出）
