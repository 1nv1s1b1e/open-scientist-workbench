# 架构设计

## Transport 流（核心）

前后端通过 `useRunStream`（自实现 SSE hook）通信，自带断线重连：

```
assistant-ui Thread
    └─ ExternalStoreRuntime
        └─ useRunStream（自实现 SSE hook，断线重连）
            ├─ POST /api/runs/:id/messages   → SSE 流 + x-workflow-run-id header
            ├─ GET  /api/runs/:id/stream?startIndex=-50  → 页面刷新时自动重连（只取最后 50 chunks）
            └─ POST /api/runs/:id/stop       → 真正停止（持久化 partial + cancel work）
```

### 断线重连机制

- `useRunStream` 检测到中断流（无 finish 事件）→ 自动 GET `/{runId}/stream` 重连
- `initialStartIndex: -50` — 页面刷新时只取最后 50 chunks，不重放全部
- `maxConsecutiveErrors: 5` — 连续重连失败上限
- 后端 POST 必须返回 `x-workflow-run-id` header，前端存 runId 用于重连

### 路由卸载 vs 停止（关键区分）

- **路由卸载**（用户导航到别的页面）：只 disconnect fetch，**不调 stop endpoint**，后端 workflow 继续跑
- **用户显式按停止按钮**：调 `POST /api/runs/:id/stop`，持久化 partial messages + cancel workflow + clear activeStreamId
- 客户端 `stop()` 只是 abort fetch（流继续跑），真正停止需专用 endpoint

## 6 Agent 输出渲染

后端 6 个 agent 的输出通过 SSE stream 的 message parts 到达前端，按 `part.type` 分发到不同可视化组件：

### assistant-ui Toolkit 机制

```tsx
import { defineToolkit } from '@assistant-ui/react-ai-sdk'

const toolkit = defineToolkit({
  // 每个 agent 的输出对应一个 tool，用 per-tool renderer 渲染
  call_librarian: {
    type: 'backend',
    render: ({ args, result }) => <LibrarianCard hypotheses={result?.hypotheses} />,
  },
  call_looker: {
    type: 'backend',
    render: ({ args, result }) => <LookerCard evidence={result?.evidence} />,
  },
  call_explore: {
    type: 'backend',
    render: ({ args, result }) => <ExploreCard eval={result?.evalResult} />,
  },
  call_oracle: {
    type: 'backend',
    render: ({ args, result }) => (
      <OracleCard critique={result?.critique} mutation={result?.mutation} />
    ),
  },
  call_prometheus: {
    type: 'backend',
    render: ({ args, result }) => <PrometheusCard plan={result?.plan} />,
  },
  // 人机协同审批节点
  review_leading_hypothesis: {
    type: 'backend',
    render: ({ args, approval, respondToApproval }) => (
      <ApprovalCard
        hypothesis={args.hypothesis}
        approval={approval}
        onApprove={(reason) => respondToApproval({ approved: true, reason })}
        onReject={(reason) => respondToApproval({ approved: false, reason })}
      />
    ),
  },
})
```

### Part 类型映射

| part.type                                      | 来源 agent             | 渲染组件                              |
| ---------------------------------------------- | ---------------------- | ------------------------------------- |
| `tool-invocation`（call_librarian）            | Librarian              | LibrarianCard（候选假设列表）         |
| `tool-invocation`（call_looker）               | Looker                 | LookerCard（FITS/视频凭证预览）       |
| `tool-invocation`（call_explore）              | Explore                | ExploreCard（F1 分数 + 反例日志）     |
| `tool-invocation`（call_oracle）               | Oracle                 | OracleCard（批判 + 突变 diff）        |
| `tool-invocation`（call_prometheus）           | Prometheus             | PrometheusCard（规划参数 + 算力分配） |
| `tool-invocation`（review_leading_hypothesis） | Sisyphus（人机协同）   | ApprovalCard（approve/reject）        |
| `text`                                         | 任意 agent 的文本输出  | 标准 message bubble                   |
| `reasoning`                                    | 任意 agent 的 thinking | 可折叠的 reasoning panel              |
| `dynamic`（自定义 data part）                  | 系统事件               | RoundTransition / ConvergenceBadge 等 |

## 人机协同 Approval

### 三状态机

```
approval.approved:
  undefined  →  待审（渲染审批 UI，流暂停）
  true       →  通过（流继续）
  false      →  驳回（流继续，agent 收到驳回原因）
```

### 前端实现

```tsx
// ApprovalCard.tsx
function ApprovalCard({ hypothesis, approval, respondToApproval }) {
  // approval.approved === undefined 时渲染审批按钮
  // approved === true 时显示"已通过"徽章
  // approved === false 时显示"已驳回"徽章 + 原因
}

// assistant-ui runtime 配置
useChatRuntime({
  transport: new AssistantChatTransport({
    api: `/api/runs/${runId}/messages`,
  }),
  // 当最后一条 assistant message 完成且带 approval responses 时自动发送
  sendAutomaticallyWhen: 'lastAssistantMessageIsCompleteWithApprovalResponses',
  toolkit,
})
```

### 后端配合

- 后端 tool 审批用 `ToolLoopAgent` 构造时的 `toolApproval`（per-tool map 或 `GenericToolApprovalFunction`）
- 审批时 workflow 暂停，persist opaque resume state 到 SQLite
- 前端 `respondToApproval` → 下一个 POST 携带 approval response → 后端 `continueStream` 续跑

## Steering（用户中途插话）

Tournament 长循环中用户可中途插入专家直觉或追加任务：

### 前端实现

```tsx
// 独立 endpoint，不通过 chat transport
async function steer(runId: string, text: string) {
  await fetch(`/api/runs/${runId}/steer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}
// 后端把 steering message 入队，在 turn boundary 注入 agent context
```

### SSE 流中的 steering 事件

后端注入 steering message 时，SSE 流发送自定义 data part：

```
event: data
data: {"type":"steering-injected","text":"用户专家直觉...","timestamp":"..."}
```

前端监听这个 part.type 渲染一个特殊的"用户插话"气泡（区别于正常 user message）。

## 消息持久化

### 存储格式

存 **UIMessage 格式**（含 id/createdAt/parts），不是 ModelMessage。与后端 SPEC §5 `messages` 表对齐。

### Message ID 生成

- **Server-side 生成**：`toUIMessageStream({generateMessageId: createIdGenerator({prefix:'msg', size:16})})`
- 客户端只发最后一条消息，服务端 `loadChat(id)` 加载历史 + append

### 历史加载校验

服务端加载历史消息后用 `validateUIMessages({messages, tools, metadataSchema, dataPartsSchema})` 校验，防 DB 里的旧消息与当前 schema 不匹配。

### assistant-ui ThreadHistoryAdapter 对接

```tsx
const history = ThreadHistoryAdapter.withFormat({
  encode: (message) => ({ /* UIMessage → 存储行 */ }),
  decode: (row) => ({ /* 存储行 → UIMessage */ }),
})

// 对接后端 REST 端点
async load({ threadId }): Promise<Message[]> {
  const res = await fetch(`/api/runs/${threadId}/messages`)
  return res.json()
}
```

## 客户端断开处理

当客户端断开（路由卸载/关闭页面）：

1. `result.consumeStream()`（不 await）— 移除 backpressure，服务端继续跑完
2. 服务端 `onEnd` 触发存库
3. 客户端重载后从存储恢复（`load(threadId)`）

## 状态管理（Zustand）

### Run 主界面状态

```ts
interface RunState {
  runId: string
  status: 'running' | 'paused' | 'completed' | 'error'
  currentRound: number
  bestF1: number
  selectedHypothesisId: string | null
  // UI 状态
  activeView: 'concept-net' | 'debate-theater' | 'evolution-tree' | 'orchestrator'
  chatCollapsed: boolean
  // Actions
  setRunId: (id: string) => void
  selectHypothesis: (id: string) => void
  setActiveView: (view: string) => void
}
```

### 全局状态

- projects 列表（TanStack Query 缓存）
- 当前 project
- settings（global + project override，TanStack Query）

## 数据获取（TanStack Query）

```ts
// projects
useQuery({ queryKey: ['projects'], queryFn: () => api.listProjects() })

// run 历史
useQuery({ queryKey: ['runs', projectId], queryFn: () => api.listRuns(projectId) })

// hypotheses
useQuery({ queryKey: ['hypotheses', runId], queryFn: () => api.listHypotheses(runId) })

// evidence
useQuery({ queryKey: ['evidence', hypothesisId], queryFn: () => api.getEvidence(hypothesisId) })

// rounds
useQuery({ queryKey: ['rounds', runId], queryFn: () => api.listRounds(runId) })

// MHD config
useQuery({ queryKey: ['mhd', runId], queryFn: () => api.getMhdConfig(runId) })

// settings
useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })
useMutation({ mutationFn: api.updateSettings })
```

## Throttle（关键性能优化）

Tournament 长循环流式 chunk 多，`useChat` 配 `throttle: 50`（50ms）节流渲染，避免高频更新卡顿。

```tsx
useChat({
  transport,
  throttle: 50, // 仅 React
})
```

## Type Safety（端到端类型）

```ts
// 从后端 tool 定义推断前端类型
import type { tools } from '@open-scientist/agents'
type MyUITools = InferUITools<typeof tools>
type MyUIMessage = UIMessage<Metadata, DataParts, MyUITools>

// useChat 类型安全
useChat<MyUIMessage>()
```

`packages/schema` 导出共享的 Zod schemas，前后端复用。
