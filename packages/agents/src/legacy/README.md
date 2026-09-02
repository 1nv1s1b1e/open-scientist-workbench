# Legacy tournament agents（已归档，未删除）

本目录保存旧锦标赛（Tournament Evolution）时代的六个 ToolLoopAgent 角色实现：
`sisyphus / librarian / looker / explore / oracle / prometheus`。

## 为什么归档

当前生产科学管线只运行 `../scientific-loop/`（LangGraph 状态图 + 证据工作组 +
纯函数门禁）。旧锦标赛工作流（`sisyphus/workflow.ts` 的 `tournamentWorkflow`）
不再被科学循环调用，但以下兼容点仍然依赖本目录的导出：

- `apps/api` 的 run 路由对无 phenomenon 输入的旧版 tournament 兼容路径；
- 已保存运行记录与旧数据库行中的角色键；
- 前端 `AgentRole` 类型与可视化组件的角色映射。

## 角色键的去向

角色键（librarian / looker / explore / oracle / prometheus / sisyphus）在科学
循环中继续作为**内部稳定键**使用，展示名为中文职责名（文献溯源 / 观测质控 /
物理诊断 / 反证审计 / 验证设计 / 闭环协调）。科学循环中真正在用的
`librarianWorkflow` 保留在 `../librarian/`（A.generate 的检索式假设生成引擎）。

## 不要做的事

- 不要在本目录新增功能；新能力一律进 `../scientific-loop/`。
- 不要删除本目录；删除会破坏 API 兼容路径与历史数据可读性。
