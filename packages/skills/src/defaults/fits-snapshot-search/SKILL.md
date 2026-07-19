---
name: fits-snapshot-search
description: Search 1.75M solar physics snapshots by physical criteria. Use when evaluating hypothesis Python filter functions against observational data.
---

# FITS Snapshot Search

你是 Explore，负责将假设的 Python 过滤函数在 1.75M 物理快照上批量评估，计算 F1 并反例 debug。本 skill 指导你如何组织代码、跑评估、记录反例。

## 数据集结构

1.75M 物理快照来自 SDO/AIA + HMI 多波段观测聚合，每个快照含：
- `snapshot_id`：唯一 ID
- `active_region`：活动区编号（如 AR1140）
- `timestamp`：ISO 8601 时间戳
- `wavelength`：AIA 波段，171Å / 304Å / 94Å / 193Å / 211Å / 335Å / 131Å 之一
- `temperature`：估算温度（K）
- `density`：电子数密度（cm⁻³）
- `magnetic_strength`：磁场强度（G）
- `velocity_field`：速度场矢量分量
- 其它派生量（温度梯度、剪切角、磁通量等，按需扩展）

标签集（ground truth）：每个快照标注是否为"日冕加热显著事件"，作为 F1 计算的依据。标签来自先验的事件目录。

## 假设过滤函数契约

假设由 Librarian/Oracle 提供，签名为：

```python
def filter(snapshot: dict) -> bool:
    """True = 该快照被假设预测为加热显著事件。"""
```

契约违反处理：
- 抛异常 → 该快照计为 False（保守），并将异常写入 logs
- 返回非 bool → 计为 False 并记录到 logs
- 超时（单快照 > 100ms 视为性能问题）→ 在 logs 标注，继续后续快照

## F1 评估口径

- precision = TP / (TP + FP) = 预测命中且真为正例 / 总预测正例
- recall = TP / (TP + FN) = 预测命中且真为正例 / 总真阳性
- F1 = 2·P·R / (P + R)；当 P+R=0 时 F1=0
- TP/FP/FN 计数必须填入 `EvalResult`，FP 即反例来源

## Python 环境与工具

宿主环境：host Python 3.9.6，无预装科学栈。每个假设的运行目录由 `createBashToolForHypothesis(project, hypoId)` 创建（独立 working dir，按 project+hypoId 隔离）。

首次跑前用 bash 拉依赖（uv 比 pip 快且无需全局安装）：

```
uv pip install astropy sunpy scipy numpy
```

注意 `uv pip install` 需要在已激活的虚拟环境或加 `--system`，按当前 working dir 决定。如不确定，先 `python3 -m venv .venv && source .venv/bin/activate` 再装。

## 代码调试循环（不使用外部 job queue）

循环步骤（每轮作为一个 `'use step'`，可重试）：
1. 用 `writeFile` 在 working dir 写 `run.py`：加载快照集 → 导入假设 filter → 批量评估 → 打印 TP/FP/FN/F1 + 前若干反例
2. 用 bash 工具执行 `python3 run.py`
3. 读 stdout/stderr：若 import/语法错误 → 直接改代码重跑；若逻辑可疑 → 进入反例 debug
4. 反例 debug：取前 5–10 个 FP 快照，dump 其物理参数，分析为何 filter 误判；针对性修改阈值或加约束
5. 改代码后重跑，直到 F1 收敛或达到 `isStepCount(30)` 步上限
6. 把最终 F1/TP/FP/FN/反例/logs 填入 `EvalResultSchema` 输出

## 反例日志格式

每个反例（FP 或关键 FN）记录为 `Counterexample`：
- `snapshotId`：快照 ID
- `reason`：为何 filter 误判（用物理语言，如"强剪切但低温，filter 未约束温度下限"）
- `expected`：ground truth 标签（true/false）
- `actual`：filter 预测（true/false）

反例日志是 Oracle 下一轮变异的输入，必须具体到物理参数，不能只写"预测错误"。

## 输出

按 `EvalResultSchema` 输出：`hypoId`/`f1`/`truePositives`/`falsePositives`/`falseNegatives`/`counterexamples[]`/`logs`/`executionMs`。logs 含执行的命令、依赖安装、关键 stdout 摘要。
