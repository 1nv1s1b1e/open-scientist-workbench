# Web 端 Spec

本目录包含 open-scientist Web 前端的完整技术规格。Web 端是 SPEC.md（后端 + Agent）的前端对应物，分文件组织如下：

| 文件 | 内容 |
|---|---|
| [01-tech-stack.md](./01-tech-stack.md) | 技术选型表、依赖清单、版本要求 |
| [02-architecture.md](./02-architecture.md) | Transport 流、6 agent 输出渲染、人机协同 approval、消息持久化、断线重连 |
| [03-visualizers.md](./03-visualizers.md) | 三个 WOW 效果可视化设计（3D 知识图谱、辩论剧场、演化树）+ Sisyphus 协作大厅 |
| [04-project-structure.md](./04-project-structure.md) | `apps/web/` 目录结构、模块划分 |
| [05-api-contracts.md](./05-api-contracts.md) | 前后端 API 契约（transport 端点、steering、approval、history） |

## 核心定位

- **后端**：Node.js + Hono + Nitro + WorkflowAgent（见根目录 [SPEC.md](../../SPEC.md)）
- **前端**：Next.js 16 + React 19 + assistant-ui，独立部署在 `apps/web/`
- **通信**：REST + SSE（`WorkflowChatTransport` 自带断线重连，不需要 Redis）
- **前后端分离**：前端通过 HTTP transport 调后端 Hono API，不做进程内直连（`DirectChatTransport` 不适用）

## 三个 WOW 效果（比赛答辩核心卖点）

完全排除折线图/表格，聚焦三大可视化：

1. **三维太阳物理知识图谱**（`react-force-graph-3d`）— 左侧悬浮 3D 概念认知图谱，节点随 Oracle/Explore 引入新物理参量约束实时重构连线，点击触发粒子散开特效
2. **Co-Scientist 智能体协作大厅 + 辩论剧场**（React Flow）— 中央圆形 6 agent Avatar 环形排列，实时展示"科学辩论与协作"过程（Oracle 抛红色警告 → Sisyphus 响应 → Librarian 生长 CoT 树）
3. **锦标赛假说演化谱系树**（d3-hierarchy + Motion/GSAP）— 右侧假说进化树，被证伪分支枯萎断裂，获胜分支开花发光

## 选型速查

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16（App Router） |
| React | 19 |
| Chat UI 框架 | assistant-ui |
| Transport | WorkflowChatTransport |
| 行为层 | Radix Primitives |
| 业务 UI 层 | shadcn/ui |
| 视觉效果层 | React Bits |
| 动画主力 | Motion |
| 动画辅助 | GSAP |
| 3D 图谱 | react-force-graph-3d |
| 演化树 | d3-hierarchy + 自写 SVG |
| 协作大厅 | React Flow |
| 状态 | Zustand |
| 数据获取 | TanStack Query |
| 样式 | Tailwind v4 |
