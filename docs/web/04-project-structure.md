# 项目结构

## `apps/web/` 目录

```
apps/web/
├── app/                                    # Next.js App Router
│   ├── layout.tsx                          # 根布局（providers 注入）
│   ├── page.tsx                            # 首页（projects 列表）
│   ├── globals.css                         # Tailwind v4 + 全局样式
│   ├── projects/
│   │   ├── new/
│   │   │   └── page.tsx                    # 新建 project
│   │   └── [projectId]/
│   │       ├── layout.tsx                  # project 布局（侧边栏）
│   │       ├── page.tsx                    # project dashboard（runs 列表）
│   │       ├── settings/
│   │       │   └── page.tsx                # project settings
│   │       └── runs/
│   │           └── [runId]/
│   │               ├── layout.tsx          # run 布局（顶栏 + 四视图框架）
│   │               ├── page.tsx            # run 主界面（四视图）
│   │               ├── hypotheses/
│   │               │   └── [hypothesisId]/
│   │               │       └── page.tsx    # 假设详情
│   │               ├── evidence/
│   │               │   └── [evidenceId]/
│   │               │       └── page.tsx    # 证据详情（FITS/视频）
│   │               ├── rounds/
│   │               │   └── [roundNumber]/
│   │               │       └── page.tsx    # 轮次回放
│   │               └── mhd/
│   │                   └── page.tsx        # MHD 仿真配置查看
│   └── settings/
│       └── page.tsx                        # 全局 settings
│
├── components/
│   ├── chat/                               # Chat Thread（assistant-ui）
│   │   ├── ChatThread.tsx                  # 主 chat 组件
│   │   ├── MessagePart.tsx                 # part.type 分发器
│   │   ├── tools/                          # per-tool renderer（toolkit）
│   │   │   ├── LibrarianCard.tsx           # call_librarian
│   │   │   ├── LookerCard.tsx              # call_looker
│   │   │   ├── ExploreCard.tsx             # call_explore
│   │   │   ├── OracleCard.tsx              # call_oracle
│   │   │   ├── PrometheusCard.tsx          # call_prometheus
│   │   │   └── ApprovalCard.tsx            # review_leading_hypothesis
│   │   ├── SteeringBubble.tsx              # steering 插话气泡
│   │   └── RoundTransition.tsx             # 轮次转换动画
│   │
│   ├── visualizers/                        # 三个 WOW 效果
│   │   ├── ConceptNet3D.tsx                # WOW #1（react-force-graph-3d）
│   │   ├── DebateTheater.tsx               # WOW #2（React Flow + GSAP 剧本）
│   │   ├── EvolutionTree.tsx               # WOW #3（d3-hierarchy + SVG）
│   │   └── shared/
│   │       ├── ParticleEffects.ts          # GSAP 粒子特效封装
│   │       ├── NodeAnimations.ts           # Motion 节点动画封装
│   │       └── colorTheme.ts               # agent 配色常量
│   │
│   ├── orchestrator/                       # Sisyphus 协作大厅
│   │   ├── CollaborationHall.tsx           # React Flow 主画布
│   │   ├── AgentNode.tsx                   # 6 agent 自定义节点
│   │   ├── MessageEdge.tsx                 # 消息流边（脉冲粒子）
│   │   └── AgentDetailSheet.tsx            # 节点详情面板（Radix Sheet）
│   │
│   ├── settings/                           # settings UI
│   │   ├── GlobalSettings.tsx              # 全局 settings
│   │   ├── ProjectSettings.tsx             # project settings
│   │   ├── ModelConfig.tsx                 # per-agent model 配置
│   │   ├── CredentialManager.tsx           # API key / OAuth 管理
│   │   ├── McpTrustManager.tsx             # MCP server 信任管理
│   │   └── SkillsManager.tsx               # Skills 上传/管理
│   │
│   ├── projects/                           # project 管理
│   │   ├── ProjectList.tsx
│   │   ├── ProjectCard.tsx
│   │   └── NewProjectDialog.tsx
│   │
│   ├── runs/                               # run 管理
│   │   ├── RunList.tsx
│   │   ├── RunHeader.tsx                   # 顶栏（Run #/Round/F1/状态/停止）
│   │   └── ViewToggle.tsx                  # 视图切换 tab
│   │
│   ├── hypotheses/                         # 假设详情
│   │   ├── HypothesisDetail.tsx
│   │   ├── PhysicsFormula.tsx              # KaTeX 物理公式渲染
│   │   └── MutationDiff.tsx                # 突变前后 diff
│   │
│   ├── evidence/                           # 证据详情
│   │   ├── FitsViewer.tsx                  # FITS 图像查看器
│   │   ├── VideoClip.tsx                   # MP4 视频切片播放
│   │   └── EvidenceAlignment.tsx           # 对齐元数据展示
│   │
│   └── ui/                                 # shadcn/ui 组件（copy-paste）
│       ├── button.tsx
│       ├── card.tsx
│       ├── dialog.tsx
│       ├── input.tsx
│       ├── select.tsx
│       ├── tabs.tsx
│       ├── tooltip.tsx
│       └── scroll-area.tsx
│
├── lib/
│   ├── api/                                # 后端 API 客户端
│   │   ├── client.ts                       # fetch 封装（baseURL/headers/error handling）
│   │   ├── projects.ts                     # projects CRUD
│   │   ├── runs.ts                         # runs 启动/SSE/steer/stop
│   │   ├── hypotheses.ts                   # hypotheses 查询
│   │   ├── evidence.ts                     # evidence 查询
│   │   ├── rounds.ts                       # rounds 查询
│   │   ├── mhd.ts                          # MHD config 查询
│   │   ├── settings.ts                     # settings GET/PUT
│   │   ├── credentials.ts                  # credentials CRUD
│   │   └── mcp.ts                          # MCP trust 管理
│   │
│   ├── transport/                          # chat transport 配置
│   │   ├── workflow-transport.ts           # WorkflowChatTransport 实例
│   │   └── runtime.ts                      # useChatRuntime + toolkit 配置
│   │
│   ├── store/                              # Zustand stores
│   │   ├── run-store.ts                    # Run 主界面状态
│   │   └── ui-store.ts                     # UI 状态（视图切换/面板折叠）
│   │
│   ├── hooks/                              # 自定义 hooks
│   │   ├── useRunStream.ts                 # 订阅 run SSE 流
│   │   ├── useSteering.ts                  # 发送 steering 消息
│   │   ├── useApproval.ts                  # 审批响应
│   │   └── useAgentStatus.ts               # 6 agent 实时状态
│   │
│   ├── types/                              # 前端专属类型
│   │   ├── agent-events.ts                 # SSE 事件类型
│   │   └── visualizers.ts                  # 可视化数据类型
│   │
│   ├── visualizers/                        # 可视化数据处理
│   │   ├── concept-net-data.ts             # HelixDB 图谱 → react-force-graph-3d 数据
│   │   ├── evolution-tree-data.ts          # hypotheses 表 → d3-hierarchy 数据
│   │   └── orchestrator-data.ts            # agent 状态 → React Flow 节点/边
│   │
│   └── utils/
│       ├── cn.ts                           # className 合并
│       └── format.ts                       # 时间/数字格式化
│
├── public/
│   ├── agents/                             # 6 agent Avatar 图片
│   └── textures/                           # 3D 图谱纹理资源
│
├── next.config.ts
├── tailwind.config.ts                      # Tailwind v4 配置
├── components.json                         # shadcn/ui 配置
├── biome.json                              # 与后端共享 biome 配置
├── tsconfig.json
└── package.json
```

## 模块依赖关系

```
app/（页面）
  ├─ components/（UI 组件）
  │   ├─ ui/（shadcn，零业务依赖）
  │   ├─ chat/（依赖 lib/transport + lib/api）
  │   ├─ visualizers/（依赖 lib/visualizers + lib/store）
  │   ├─ orchestrator/（依赖 lib/visualizers + lib/store）
  │   └─ settings/projects/runs/hypotheses/evidence（依赖 lib/api）
  └─ lib/
      ├─ api/（后端 REST 客户端，依赖 packages/schema）
      ├─ transport/（WorkflowChatTransport，依赖 @ai-sdk/workflow）
      ├─ store/（Zustand，零依赖）
      ├─ hooks/（依赖 lib/api + lib/store + lib/transport）
      ├─ types/（零依赖）
      └─ visualizers/（数据转换，依赖 packages/schema）
```

## 共享类型（与后端）

`packages/schema` 导出的 Zod schemas 前后端复用：

```ts
// 前端 import
import {
  HypothesisSchema,
  EvalResultSchema,
  CritiqueSchema,
  PlanSchema,
} from '@open-scientist/schema'
```

前端不直接 import 后端 agent 代码，只通过 `InferUITools<typeof tools>` 推断 tool 类型（在后端导出一个纯类型，前端 import type）。

## Provider 注入

```tsx
// app/layout.tsx
<QueryClientProvider client={queryClient}>
  <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
</QueryClientProvider>
```

- `QueryClientProvider` — TanStack Query
- `AssistantRuntimeProvider` — assistant-ui runtime（但 per-run 的 runtime 在 run 页面单独创建，因为 transport 绑定 runId）
