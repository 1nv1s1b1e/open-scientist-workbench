# User-Facing Entry and Single Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with checkpoints.

**Goal:** 把首页改成用户可以直接进入项目和开始分析的工作区入口，并让项目页只有一个现象提交入口，右侧运行控制台只负责展示运行记录。

**Architecture:** 根页只承担项目选择和进入动作，不再展示 agent、A/B/C/D 或过程说明。项目页由 `WorkflowRuntimeProvider` 统一包住主工作台和右侧控制台；主工作台的现象面板触发运行，右侧控制台保留消息、轮次/假设筛选和状态展示，但不再提供第二个输入框、示例和重复的新建运行动作。

**Tech Stack:** Next.js App Router, React, assistant-ui external runtime, existing SSE `useRunStream`, Tailwind/CSS modules in `globals.css`.

---

### Task 1: 将首页改成用户入口

**Files:**

- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/components/projects/project-list.tsx`
- Stop rendering: `apps/web/src/components/site/home-science-preview.tsx`

- [ ] **Step 1: 删除过程型首页内容**
  - 移除 `PRINCIPLES`、流程图、过程型 hero 文案和 `HomeSciencePreview` 引用。
  - 保留品牌、设置入口、项目列表和打开演示项目动作。

- [ ] **Step 2: 将首页首屏替换为操作文案**
  - 使用“开始一次活动区分析”作为唯一首屏标题。
  - 只保留一句说明：“描述一个活动区现象，进入工作区查看分析结果。”
  - 提供“打开演示项目”主按钮，并把项目列表作为主要内容。

- [ ] **Step 3: 去除项目列表中的重复演示入口**
  - 删除 `ProjectList` 内固定的 Featured demo 横幅。
  - 将项目区标题改为“项目工作区”，说明改为“打开已有项目，或新建一个独立工作区”。

### Task 2: 让运行上下文同时覆盖主工作台与控制台

**Files:**

- Modify: `apps/web/src/lib/chat/workflow-runtime.tsx`
- Modify: `apps/web/src/components/chat/chat-panel.tsx`
- Modify: `apps/web/src/app/projects/[project]/page.tsx`

- [ ] **Step 1: 暴露统一运行动作**
  - 在 `WorkflowRuntimeProvider` 内把现有 `onNew` 的提交逻辑抽成 `submit(text?: string)`。
  - 导出 `useWorkflowControls()`，至少提供 `submit`、`reset`、`isRunning` 和 `hasStarted`。
  - 保持 `phenomenon` 参数优先：有结构化现象时调用 `start(undefined, modelAlias, { phenomenon, maxRounds })`。

- [ ] **Step 2: 提供外部 Provider 模式**
  - `ChatPanel` 增加 `runtimeProvided?: boolean`。
  - 默认行为继续自带 Provider，项目页使用外部 Provider 时只渲染控制台内容和工具 UI。

- [ ] **Step 3: 在项目页提升 Provider 边界**
  - 用同一个 `WorkflowRuntimeProvider` 包住 `ScientificWorkbench` 和 `ChatPanel`。
  - 主工作台和控制台共享同一个 SSE 状态、消息列表、轮次筛选和 reset，不再各自维护运行入口。

### Task 3: 将现象面板作为唯一提交入口

**Files:**

- Modify: `apps/web/src/components/workbench/phenomenon-panel.tsx`
- Modify: `apps/web/src/components/workbench/scientific-workbench.tsx`

- [ ] **Step 1: 为现象面板增加主动作**
  - 增加 `onSubmit?: () => void` 和 `isSubmitting?: boolean`。
  - 在面板底部添加唯一按钮：无内容时禁用，运行中显示“分析中…”，其余显示“开始分析”。

- [ ] **Step 2: 连接统一运行动作**
  - `ScientificWorkbench` 使用 `useWorkflowControls()`。
  - 点击“开始分析”时，若已有上一轮记录先 reset，再提交当前现象描述。
  - 删除工作台中把用户引导到“右侧发送”的文案，底部只保留结果状态提示。

### Task 4: 将右侧控制台改为只读运行记录

**Files:**

- Modify: `apps/web/src/components/chat/chat-panel.tsx`
- Modify: `apps/web/src/components/assistant-ui/thread.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: 移除第二个提交入口**
  - `Thread` 增加 `showComposer?: boolean`，项目控制台使用 `false`。
  - 移除空状态中的现象示例和输入提示，改成“开始分析后，这里显示运行记录”。
  - `ChatToolbar` 移除“新建运行”按钮，保留当前运行状态、agent 聚焦和轮次/假设筛选。

- [ ] **Step 2: 收紧控制台的用户认知**
  - 标题改为“运行记录”，副标题说明“只读查看本轮 agent 输出”。
  - 保留消息滚动、轮次/假设筛选和桌面/移动端抽屉交互。

- [ ] **Step 3: 调整样式层级**
  - 删除控制台 composer 和示例相关样式。
  - 将控制台内容区改为消息记录面板；没有消息时只显示简短空状态。

### Task 5: 验证

**Files:**

- Test: existing project tests and browser checks

- [ ] **Step 1: 静态检查**
  - Run `corepack pnpm --filter @open-scientist/web typecheck`.
  - Run `corepack pnpm --filter @open-scientist/web build`.

- [ ] **Step 2: 行为检查**
  - Run `corepack pnpm test`.
  - At `http://127.0.0.1:5173/`, verify the first viewport contains project actions rather than agent/process descriptions.
  - At the project page, verify only the main phenomenon panel has a submit button; opening the right console shows read-only messages and filters, with no second textbox.
  - Verify desktop and mobile drawer behavior and browser console errors.

## Acceptance Criteria

- 首页扫描标题即可知道下一步是“打开项目/新建项目”，没有 A/B/C/D、agent 列表或闭环说明。
- 项目页只有一个现象提交入口。
- 右侧控制台没有第二个输入框、示例或新建运行按钮，只展示运行消息和筛选。
- 现有 SSE、科学状态更新、轮次/假设筛选和四个视图仍然可用。
- typecheck、build、全量测试和浏览器控制台检查通过。
