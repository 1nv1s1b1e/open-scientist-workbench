# 技术选型

## 选型表

| 层 | 选型 | 版本 | 理由 |
|---|---|---|---|
| 框架 | **Next.js** | 15（App Router） | AI SDK 官方推荐，与 Workflow DevKit 集成最完善 |
| React | 19 | — | Next 15 要求 |
| Chat UI 框架 | **assistant-ui** | `@assistant-ui/react@14` + `@assistant-ui/react-ai-sdk` | 生产级 AI chat React 库，与 AI SDK v7 深度集成；approval 三状态一等公民；per-tool 自定义渲染器 |
| Transport | **WorkflowChatTransport** | `@ai-sdk/workflow` | 为 WorkflowAgent 设计，自带断线重连（chunk index resume），不需要 Redis + resumable-stream |
| 行为层 | **Radix Primitives** | `@radix-ui/react-*` 按需 | 无样式可访问性 primitives，WAI-ARIA 合规；assistant-ui 和 AI Elements 底层都用 Radix |
| 业务 UI 层 | **shadcn/ui** | shadcn CLI copy-paste | 基于 Radix 的预样式组件，Tailwind 样式，拥有代码所有权；AI Elements 也是 shadcn registry |
| 视觉效果层 | **React Bits** | shadcn CLI（TS-TW 变体） | 140+ 动画组件（text/animations/components/backgrounds），WOW 效果专用，与 shadcn/ui 同体系 |
| 动画主力 | **Motion**（原 Framer Motion） | `motion` | 声明式 React 原生，组件 enter/exit + layout 动画 + 手势；30KB；2025 已免费 |
| 动画辅助 | **GSAP** | `gsap` + `@gsap/react` | 命令式，复杂时间线 + ScrollTrigger；27KB；2025 全免费；用于剧本式多元素同步动画 |
| 3D 知识图谱 | **react-force-graph-3d** | latest | ThreeJS/WebGL + d3-force-3d 物理引擎 |
| 演化树 | **d3-hierarchy** + 自写 SVG | latest | 树布局算法，动画用 Motion/GSAP |
| Agent 协作大厅 | **React Flow** | `@xyflow/react@12` | React 节点式编辑器，6 agent 头像作节点，消息流作边 |
| 状态管理 | **Zustand** | `zustand@5` | 轻量，Tournament 长循环的 UI 状态（当前轮/F1/选中假设） |
| 数据获取 | **TanStack Query** | `@tanstack/react-query@5` | REST 端点（projects/hypotheses/evidence/rounds/mhd）的数据获取 + 缓存 |
| 样式 | **Tailwind CSS** | v4 | shadcn/ui + React Bits 基础 |
| Schema | **Zod** | `zod@3` | 与后端共享类型（`packages/schema`） |

## 依赖清单

### `apps/web/package.json`

```json
{
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "@assistant-ui/react": "^14",
    "@assistant-ui/react-ai-sdk": "^14",
    "@ai-sdk/workflow": "latest",
    "ai": "^7",
    "zod": "^3",
    "@xyflow/react": "^12",
    "react-force-graph-3d": "latest",
    "d3-hierarchy": "latest",
    "three": "latest",
    "motion": "^11",
    "gsap": "^3",
    "@gsap/react": "^2",
    "zustand": "^5",
    "@tanstack/react-query": "^5",
    "tailwindcss": "^4",
    "lucide-react": "latest"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/three": "latest",
    "@types/d3-hierarchy": "latest"
  }
}
```

### shadcn 组件安装（按需）

```bash
# shadcn/ui 业务组件
npx shadcn@latest init
npx shadcn@latest add button card dialog input select tabs tooltip scroll-area

# AI Elements（shadcn registry）
npx shadcn@latest add https://elements.ai-sdk.dev/r/message
npx shadcn@latest add https://elements.ai-sdk.dev/r/tool
npx shadcn@latest add https://elements.ai-sdk.dev/r/reasoning

# React Bits 视觉效果（TS-TW 变体）
npx shadcn@latest add @react-bits/BlurText-TS-TW
npx shadcn@latest add @react-bits/Particles-TS-TW
npx shadcn@latest add @react-bits/AnimatedGradientText-TS-TW
```

## 三层 UI 体系（关键区分）

**Radix + shadcn/ui + React Bits 是互补三层，不是竞争关系**：

```
┌─────────────────────────────────────────┐
│  React Bits      视觉效果层（WOW 专用）  │  粒子背景、渐变文字、动态光效
├─────────────────────────────────────────┤
│  shadcn/ui       业务 UI 层              │  Button/Dialog/Tabs/Form 等
├─────────────────────────────────────────┤
│  Radix Primitives 行为层                 │  焦点管理、键盘导航、ARIA
└─────────────────────────────────────────┘
```

- **Radix** 解决"可访问性 + 行为"（Dialog 的焦点陷阱、Select 的键盘导航）
- **shadcn/ui** 解决"标准业务 UI"（预样式组件，Tailwind 样式，copy-paste 拥有代码）
- **React Bits** 解决"视觉惊艳"（对应三个 WOW 效果的装饰性动画）

三层通过 Tailwind 统一样式系统，通过 shadcn CLI 统一安装流程。

## 动画库双轨（关键区分）

| | Motion（主力） | GSAP（辅助） |
|---|---|---|
| 范式 | 声明式（`<motion.div animate={...}>`） | 命令式（`gsap.timeline().to(...).to(...)`） |
| React 集成 | 原生 | 需 `@gsap/react` 的 `useGSAP` hook |
| 强项 | 组件 enter/exit、layout 动画、手势 | 复杂时间线、多元素同步序列、ScrollTrigger |
| 用在哪 | Chat message 滑入、演化树节点生长、approval dialog 弹出、3D 图谱节点 hover | React Flow 协作大厅的"Oracle 红色警告 → Sisyphus 响应 → Librarian CoT 树生长"多元素同步剧本动画；3D 图谱连线的粒子散开特效 |

**不引入 React Spring**（Motion 的 `physics` spring 已够用，避免生态分散）。

## 不选的方案

| 方案 | 不选原因 |
|---|---|
| NexUI Agentic UI Components | star 太低（1 star），只支持 AI SDK v6（非 v7） |
| react-d3-tree | 太基础，枯萎/开花动画需自己加，不如直接用 d3-hierarchy + 自写 SVG |
| DirectChatTransport | 本项目 client/server 分离（Next.js + Hono API），必须 HTTP transport |
| Redis + resumable-stream | WorkflowChatTransport 已自带断线重连（chunk index），不需要额外 Redis |
| React Spring | Motion 的 physics spring 够用，避免生态分散 |
| framer-motion（旧命名） | 已改名 `motion`，用新包名 |
