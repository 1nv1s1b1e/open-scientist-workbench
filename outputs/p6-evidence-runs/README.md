# P6 案例运行记录（competition-2b 提交）

本目录存放报告 P6「典型科研案例与实验验证」所引用的四次真实运行的原始记录，
供评审独立复核 run ID 与报告中的数字（假设数、证据数、验证任务数、科学状态）。
报告正文以「归档运行①②③④」指代，与下表「文档标注」列一一对应。

| 文档标注 | 报告案例 | run ID | 记录目录 | 报告引用数字 |
| --- | --- | --- | --- | --- |
| 归档运行① | 正例一：基线双轮闭环 | `run-1787318886369-33b8f13c` | `run-01-baseline/` | 4 假设、37 条证据/审查记录、7 项验证任务；needs_data / partial |
| 归档运行②（提交基线） | 正例二：最终 Demo（Docker + Helix） | `run-1788431926970-1f3b6181` | `docker-helix-submission-20260903/` | 15 假设、144 条证据、29 项验证任务（18 完成、11 待外部）；workflowClosure=complete |
| 归档运行③ | 反例一：留出回归绑定错误 | `run-1787320503954-a90e1b94` | `run-02b-discriminative-corrected/` | 冷却时滞未计算却被计为有效支持（工程教训） |
| 归档运行④ | 反例二：对抗运行 | `run-1787321190918-0d9dc4aa` | `run-03-adversarial/` | 18 条证据全部 unknown、inconclusive（结构化状态正确） |

补充：报告图 6.3–6.5 的工作台截图取自回放运行 `run-1788523706295-f194c5a0`
（以 v1.0-competition 冻结代码、local-grounded 模式一键重放归档运行②的同一请求，
假设/证据/任务数与②完全一致：15/144/29，18 完成 + 11 待外部）。

## 文件说明

- `request.json`：运行输入（现象描述、观测窗口配置）。
- `run-metadata.json`：运行元数据（runId、状态、模型角色调用统计）。
- `scientific-result.json`：完整科学输出（假设、证据、验证任务、结论、修正记录）。

## 复核方式

1. 在 `run-metadata.json` 中核对 `runId` 与报告 P6 总览表一致。
2. 在 `scientific-result.json` 中核对 `hypotheses`、`evidence`、`validationTasks`
   数量与 P6 各案例描述一致；归档运行④可核对全部证据 `verificationStatus=unknown`
   且 `scientificStatus=inconclusive`。
3. 归档运行②与图 6.3–6.5 的回放运行可由 `corepack pnpm demo:scientific`
   一键命令在纯 CPU 环境复现；环境与命令见仓库 README。
