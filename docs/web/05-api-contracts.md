# API 契约（前后端）

本文档定义 Web 前端与 Hono 后端之间的 API 契约。与根目录 SPEC.md §7 对齐，这里聚焦前端视角的请求/响应格式和 SSE 事件结构。

## 基础

- **Base URL**：`http://localhost:3000/api`（可配置，Next.js rewrite 或环境变量）
- **Content-Type**：`application/json`（除 SSE 流）
- **错误格式**：`{ error: { code: string, message: string, details?: any } }`

---

## Projects

### `GET /api/projects`
列出所有 project。

**Response 200**：
```json
{
  "projects": [
    {
      "id": "proj_abc123",
      "name": "corona-heating-mhd",
      "displayName": "日冕加热 MHD 探索",
      "createdAt": "2026-07-19T10:00:00Z",
      "updatedAt": "2026-07-19T18:00:00Z",
      "runCount": 3,
      "bestF1": 0.91
    }
  ]
}
```

### `POST /api/projects`
创建 project。

**Request**：
```json
{
  "name": "corona-heating-mhd",
  "displayName": "日冕加热 MHD 探索",
  "seedHypothesis": "重联纳耀斑加热机制",
  "settings": { /* 可选，override 全局 */ }
}
```

**Response 201**：
```json
{
  "id": "proj_abc123",
  "name": "corona-heating-mhd",
  "displayName": "日冕加热 MHD 探索",
  "seedHypothesis": "重联纳耀斑加热机制",
  "createdAt": "2026-07-19T10:00:00Z"
}
```

### `GET /api/projects/:projectId`
获取单个 project 详情。

### `PUT /api/projects/:projectId`
更新 project（displayName / settings）。

### `DELETE /api/projects/:projectId`
删除 project（级联删除 FS 产物 + SQLite）。

---

## Runs

### `POST /api/projects/:projectId/runs`
启动新 run。

**Request**：
```json
{
  "seedHypothesis": "重联纳耀斑加热机制",
  "maxRounds": 10,
  "targetF1": 0.9
}
```

**Response 201**：
```json
{
  "id": "run_xyz789",
  "projectId": "proj_abc123",
  "status": "running",
  "seedHypothesis": "重联纳耀斑加热机制",
  "currentRound": 0,
  "bestF1": 0,
  "createdAt": "2026-07-19T18:00:00Z",
  "workflowRunId": "wf_..."  // 用于 WorkflowChatTransport 重连
}
```

### `GET /api/runs/:runId`
获取 run 状态。

**Response 200**：
```json
{
  "id": "run_xyz789",
  "projectId": "proj_abc123",
  "status": "running",
  "currentRound": 4,
  "bestF1": 0.87,
  "hypothesisCount": 12,
  "createdAt": "2026-07-19T18:00:00Z",
  "converged": false,
  "stoppedAt": null
}
```

### `GET /api/runs/:runId/messages`（Chat History）
加载历史消息（UIMessage 格式，用于 assistant-ui ThreadHistoryAdapter）。

**Response 200**：
```json
{
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "parts": [{ "type": "text", "text": "探索日冕加热机制" }],
      "createdAt": "2026-07-19T18:00:00Z"
    },
    {
      "id": "msg_002",
      "role": "assistant",
      "parts": [
        { "type": "text", "text": "启动 Tournament..." },
        { "type": "tool-invocation", "toolCallId": "tc_001", "toolName": "call_librarian", "state": "result", "args": {...}, "result": {...} }
      ],
      "createdAt": "2026-07-19T18:00:05Z"
    }
  ]
}
```

### `POST /api/runs/:runId/messages`（Chat Send）
发送消息（SSE 流响应）。**必须返回 `x-workflow-run-id` header** 供 WorkflowChatTransport 重连。

**Request**：
```json
{
  "message": { /* 最后一条 UIMessage */ },
  "id": "run_xyz789"
}
```

**Response 200**（SSE）：
```
Headers:
  Content-Type: text/event-stream
  x-workflow-run-id: wf_abc123

event: data
data: {"type":"start","messageId":"msg_003"}

event: data
data: {"type":"text","text":"生成候选假设..."}

event: data
data: {"type":"tool-invocation","toolCallId":"tc_002","toolName":"call_librarian","state":"input","args":{...}}

event: data
data: {"type":"tool-invocation","toolCallId":"tc_002","toolName":"call_librarian","state":"output","result":{...}}

event: data
data: {"type":"tool-approval-request","toolCallId":"tc_003","toolName":"review_leading_hypothesis"}

event: data
data: {"type":"finish","messageId":"msg_003"}
```

### `GET /api/runs/:runId/stream`（断线重连）
页面刷新时 WorkflowChatTransport 自动调用。`startIndex` query param 指定从哪个 chunk 开始。

**Query**：`?startIndex=-50`（最后 50 个 chunk）

**Response 200**（SSE）：同上，从指定 index 重放。

### `POST /api/runs/:runId/messages`（Approval Response）
审批响应（同一个 endpoint，body 带 approval）。

**Request**：
```json
{
  "message": {
    "role": "user",
    "parts": [{
      "type": "tool-approval-response",
      "toolCallId": "tc_003",
      "approved": true,
      "reason": "假设符合物理直觉"
    }]
  }
}
```

### `POST /api/runs/:runId/steer`（Steering 插话）
独立 endpoint，不走 chat transport。

**Request**：
```json
{
  "text": "静态复杂拓扑无法积累足够的剪切流动，应引入磁场梯度的时序导数作为硬约束。"
}
```

**Response 202**：
```json
{
  "steeringMessageId": "sm_001",
  "queuedAt": "2026-07-19T18:30:00Z",
  "willInjectAt": "turn-boundary"
}
```

Steering message 会在下一个 turn boundary 注入 agent context，同时通过 SSE 流发送 `steering-injected` data part 通知前端渲染。

### `POST /api/runs/:runId/stop`（停止 Run）
用户显式停止（区别于路由卸载的 disconnect）。

**Response 200**：
```json
{
  "id": "run_xyz789",
  "status": "stopped",
  "stoppedAt": "2026-07-19T19:00:00Z",
  "partialMessagesSaved": true
}
```

---

## Hypotheses

### `GET /api/runs/:runId/hypotheses`
列出 run 的所有假设。

**Query**：`?round=4`（可选，按轮次过滤）

**Response 200**：
```json
{
  "hypotheses": [
    {
      "id": "hypo_001",
      "runId": "run_xyz789",
      "round": 1,
      "parentId": null,
      "name": "假设 A：纳耀斑加热由中性线弯曲能触发",
      "physicsFormula": "def filter(snapshot): return snapshot.bending_energy > threshold",
      "f1Score": 0.72,
      "status": "critiqued",
      "critiqueSummary": "未考虑磁场梯度随时间的变化率",
      "createdAt": "2026-07-19T18:01:00Z"
    }
  ]
}
```

### `GET /api/hypotheses/:hypothesisId`
假设详情（含完整批判历史 + 突变谱系）。

**Response 200**：
```json
{
  "id": "hypo_001",
  "hypothesis": { /* ... */ },
  "critiques": [ { /* CritiqueSchema */ } ],
  "mutations": [ { /* MutationSchema */ } ],
  "evidence": [ { /* EvidenceAlignmentSchema */ } ],
  "lineage": {
    "parent": { /* 父假设摘要 */ },
    "children": [ { /* 子假设摘要 */ } ]
  }
}
```

---

## Evidence

### `GET /api/hypotheses/:hypothesisId/evidence`
假设关联的证据（FITS/视频）。

**Response 200**：
```json
{
  "evidence": [
    {
      "id": "ev_001",
      "hypothesisId": "hypo_001",
      "type": "fits-alignment",
      "activeRegion": "AR1140",
      "timestamp": "2014-01-07T14:00:00Z",
      "wavelength": "171A",
      "fitsPath": "/projects/corona-heating-mhd/evidence/hypo_001/ar1140_171A.fits",
      "videoClipPath": "/projects/corona-heating-mhd/evidence/hypo_001/ar1140_clip.mp4",
      "alignmentMetadata": { /* fits_align.json 内容 */ }
    }
  ]
}
```

### `GET /api/evidence/:evidenceId/files/:filename`
获取证据文件（FITS/MP4/JSON），stream response。

---

## Rounds

### `GET /api/runs/:runId/rounds`
列出所有轮次快照。

**Response 200**：
```json
{
  "rounds": [
    {
      "number": 1,
      "hypothesisCount": 2,
      "bestF1": 0.72,
      "startedAt": "2026-07-19T18:00:00Z",
      "endedAt": "2026-07-19T18:10:00Z",
      "humanFeedback": null
    },
    {
      "number": 2,
      "hypothesisCount": 4,
      "bestF1": 0.81,
      "startedAt": "2026-07-19T18:10:00Z",
      "endedAt": "2026-07-19T18:25:00Z",
      "humanFeedback": "引入磁场梯度的时序导数作为硬约束"
    }
  ]
}
```

### `GET /api/runs/:runId/rounds/:number`
单轮详情（含该轮所有假设状态 + agent 消息回放）。

---

## MHD Config

### `GET /api/runs/:runId/mhd`
最终 MHD 仿真配置（仅 run 完成后可用）。

**Response 200**：
```json
{
  "runId": "run_xyz789",
  "configPath": "/projects/corona-heating-mhd/mhd/run_xyz789.cfg",
  "configContent": "# MHD config\n...",  // .cfg 文件内容
  "observationProposal": "建议 SDO/AIA 在...",  // 卫星观测建议书
  "winningHypothesisId": "hypo_007",
  "winningF1": 0.91
}
```

### `GET /api/runs/:runId/mhd/download`
下载 .cfg 文件。

---

## Settings

### `GET /api/settings`
获取全局 settings。

**Response 200**：
```json
{
  "models": {
    "default": { "provider": "openai", "model": "gpt-4o", "thinkingLevel": "medium" },
    "oracle": { "provider": "openai", "model": "o3", "thinkingLevel": "high" },
    "explore": { "provider": "openai", "model": "gpt-4o-mini", "thinkingLevel": "low" }
  },
  "tournament": {
    "maxRounds": 10,
    "targetF1": 0.9,
    "convergenceThreshold": 0.01
  },
  "concurrency": {
    "maxConcurrentRuns": 3
  },
  "steering": {
    "mode": "one-at-a-time"
  }
}
```

### `PUT /api/settings`
更新全局 settings。

### `GET /api/projects/:projectId/settings`
获取 project settings（merge 全局）。

### `PUT /api/projects/:projectId/settings`
更新 project settings（override 全局）。

---

## Credentials

### `GET /api/credentials`
列出所有凭证（不返回明文 key）。

**Response 200**：
```json
{
  "credentials": [
    {
      "id": "cred_001",
      "provider": "openai",
      "type": "api-key",
      "displayName": "OpenAI API Key",
      "lastRefreshedAt": "2026-07-19T10:00:00Z",
      "status": "valid"
    }
  ]
}
```

### `POST /api/credentials`
添加凭证。

**Request**：
```json
{
  "provider": "openai",
  "type": "api-key",
  "apiKey": "sk-..."
}
```

### `DELETE /api/credentials/:id`
删除凭证。

### `POST /api/credentials/:id/refresh`
刷新 OAuth token（如果是 OAuth 类型）。

---

## MCP Trust

### `GET /api/mcp/trust`
列出 MCP server 信任状态。

**Response 200**：
```json
{
  "trusts": [
    {
      "id": "mcp_001",
      "name": "helixdb-server",
      "url": "http://localhost:3001",
      "trusted": true,
      "trustedAt": "2026-07-19T10:00:00Z",
      "toolFingerprint": "sha256:..."
    }
  ]
}
```

### `POST /api/mcp/trust`
信任/撤销信任 MCP server。

**Request**：
```json
{
  "name": "helixdb-server",
  "trusted": true
}
```

---

## Skills

### `GET /api/projects/:projectId/skills`
列出 project 的 skills。

### `POST /api/projects/:projectId/skills`
上传 skill（zip 或目录结构）。

### `DELETE /api/projects/:projectId/skills/:name`
删除 skill。

---

## Health

### `GET /api/health`

**Response 200**：
```json
{
  "status": "ok",
  "version": "0.1.0",
  "helixDb": { "connected": true, "url": "http://localhost:6969" },
  "activeRuns": 2
}
```

---

## SSE 事件类型汇总

| event:data.type | 含义 | 前端处理 |
|---|---|---|
| `start` | 消息开始 | 创建新 message bubble |
| `text` | 文本增量 | 追加到 message parts |
| `reasoning` | thinking 增量 | 追加到 reasoning panel |
| `tool-invocation`（state:input） | tool 调用开始 | 渲染对应 agent card（loading 态） |
| `tool-invocation`（state:output） | tool 调用完成 | 更新 agent card（结果态） |
| `tool-approval-request` | 人机协同审批 | 渲染 ApprovalCard，暂停流 |
| `tool-approval-response`（用户发送） | 审批响应 | — |
| `steering-injected` | steering 消息已注入 | 渲染 SteeringBubble |
| `round-transition` | 轮次切换 | 触发演化树/图谱动画 |
| `convergence` | 收敛达成 | 显示 ConvergenceBadge |
| `finish` | 消息结束 | 完成 message bubble |
| `error` | 错误 | 显示错误提示 |
