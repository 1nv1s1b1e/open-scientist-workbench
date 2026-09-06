# API 契约（前后端）— 基于实际代码

> 本文档基于 `apps/api/src/routes/` 实际实现（非设计期）。所有字段名、状态码、行为均与代码一一对应。前端 agent 以本文档为唯一权威。
>
> **实现版本**：Phase 4 末（VM 修复 + type stripping 之后）。`tournamentWorkflow` 已能跑通 librarian 首轮；looker/explore/oracle/prometheus 链路代码就绪但需真实数据集 + 模型才能端到端验证。

## 基础

- **Base URL**：`http://localhost:3000`（nitro dev，apps/api）
- **Content-Type**：`application/json`（除 SSE 流式端点为 `text/event-stream`）
- **错误格式**：`{ "error": "<code>", "message": "<human readable>" }`
- **路径参数 `:project` / `:name`**：project 名（slug），用于定位 `data/projects/<name>/` 目录 + SQLite。
- **路径参数 `:runId`**：SDK workflow run id（`wrun_...` 格式），从响应 header `x-workflow-run-id` 拿到，用于 stream/stop/get。

---

## 1. Health

### `GET /api/health`

探活，无需认证。

**Response 200**：

```json
{
  "status": "ok",
  "timestamp": "2026-07-20T08:00:00.000Z",
  "baseDir": "/Users/didi/personal/open-scientist/apps/api/data"
}
```

---

## 2. Settings

Settings 是两层结构：

- **Global settings**：`data/settings.json`（文件存储）
- **Project settings**：`data/projects/<name>/settings.json`，override 全局（deep merge）

`getSettings(projectName)` 会自动 merge 两层（project 覆盖 global，models/modelAliases/tournament 等对象字段逐字段覆盖）。

### GlobalSettings 结构

```ts
{
  models: Record<string, ModelConfig>,          // 按 role 索引，如 "default" / "sisyphus" / "librarian" ...
  modelAliases?: Record<string, ModelConfig>,   // 可选，用户自定义 alias→config
  agents: Record<string, AgentConfig>,          // 按 role 索引，per-agent 非模型配置（instructions/skillDirectories/mcpServers）
  tournament: {
    maxRounds: number,            // 默认 10
    targetF1: number,             // 默认 0.9
    convergenceWindow: number,    // 默认 3
    convergenceThreshold: number, // 默认 0.005
  },
  concurrency: { maxConcurrentRuns: number },   // 默认 4
  steering: { mode: 'one-at-a-time' | 'all' },  // 默认 'one-at-a-time'
}
```

### ModelConfig 结构

```ts
{
  model: string,                                // 必填，如 'llab/Qwen3-Next-80B-A3B-Instruct'
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',  // 默认 'medium'
  credentialId: string,                         // 必填，引用 credentials 表的 id（如 'openai-1784477951898'）
}
```

> **Credential = Endpoint bundle**：一个 credential = 一个完整 endpoint `{id, provider, apiKey, baseURL?}`。`ModelConfig` 不存 provider/baseURL，全部从 `credentialId` 引用的 Credential 继承。支持「同 provider 不同 baseURL+apiKey」组合（如 `openai-main` 用官方 API，`openai-gateway` 用第三方网关）。

### AgentConfig 结构

Per-agent 非模型配置。模型仍走 `settings.models[role]`（fallback `default` → `sisyphus`）。所有字段可选 —— 未设置时 agent 工厂使用各自的硬编码默认值。

```ts
{
  instructions?: string,           // 覆盖 agent 的 system prompt（硬编码默认值的 override）
  skillDirectories?: string[],     // 自定义 skill 发现目录（默认 packages/skills/src/defaults/）
  mcpServers?: McpServerConfig[],  // 挂载的 MCP server 列表（默认 []，librarian 预配 2 个）
}
```

### McpServerConfig 结构

```ts
{
  name: string,                                   // 必填，MCP server 标识（也作缓存 key）
  transport: 'http' | 'stdio' | 'sse',           // 必填
  url?: string,                                   // http/sse 必填
  command?: string,                               // stdio 必填，如 'uvx' / 'npx'
  args?: string[],                                // stdio 可选，如 ['paper-search-mcp']
  headers?: Record<string, string>,               // http/sse 可选
}
```

> **MCP presets**：`GET /api/settings/mcp-presets` 列出预配的第三方 MCP server 清单（paper-search-mcp / duckduckgo-mcp / arxiv-mcp）。前端可展示清单，用户选择后 `PUT /api/settings/agents/:role` 的 `mcpServers` 字段引用对应 preset。

### `GET /api/settings`

获取全局 settings。

**Response 200**：`GlobalSettings`（见上）

### `PUT /api/settings`

整体替换全局 settings（body 经 `GlobalSettingsSchema.parse` 严格校验，缺字段用默认值补全）。

**Request body**：`GlobalSettings`

**Response 200**：替换后的完整 `GlobalSettings`

### `PATCH /api/settings`

Deep merge patch 到当前 settings（嵌套对象递归合并，数组替换，`undefined` 跳过，`null` 覆盖）。

**Request body**：`Partial<GlobalSettings>`

**Response 200**：合并后的完整 `GlobalSettings`

### `GET /api/settings/models/:role`

获取某个 role 的 model 配置。

**Response 200**：`ModelConfig`
**Response 404**：`{ "error": "not_found", "message": "No model config for role \"<role>\"" }`

### `PUT /api/settings/models/:role`

设置某个 role 的 model 配置（整体替换该 role）。

**Request body**：`ModelConfig`
**Response 200**：写入的 `ModelConfig`

### `DELETE /api/settings/models/:role`

删除某个 role 的 model 配置。

**Response 200**：`{ "ok": true }`

### `GET /api/settings/model-aliases`

列出所有 model alias。

**Response 200**：`Record<string, ModelConfig>`（可能为空对象 `{}`）

### `PUT /api/settings/model-aliases/:alias`

创建/更新一个 model alias（整体替换该 alias）。

**Request body**：`ModelConfig`
**Response 200**：写入的 `ModelConfig`

### `DELETE /api/settings/model-aliases/:alias`

删除一个 model alias。

**Response 200**：`{ "ok": true }`

### `GET /api/settings/agents`

列出所有 agent 配置（非模型维度）。返回 `DEFAULT_GLOBAL.agents` 与磁盘 `settings.json` 合并后的结果（含 librarian 预配的 2 个 MCP server）。

**Response 200**：`Record<string, AgentConfig>`（如 `{ "librarian": { mcpServers: [...] } }`）

### `GET /api/settings/agents/:role`

获取某个 role 的 agent 配置。

**Response 200**：`AgentConfig`
**Response 404**：`{ "error": "not_found", "message": "No agent config for role \"<role>\"" }`

### `PUT /api/settings/agents/:role`

设置某个 role 的 agent 配置（**整体替换**该 role 的 AgentConfig，body 经 `AgentConfigSchema.parse` 校验）。传空对象 `{}` 清除所有 override（agent 回退到硬编码默认）。

**Request body**：`AgentConfig`（所有字段可选）

```ts
{
  instructions?: string,
  skillDirectories?: string[],
  mcpServers?: McpServerConfig[],
}
```

**Response 200**：写入的 `AgentConfig`

**Response 500**：Zod 校验失败（如 mcpServer 缺 `name` 字段）→ `{ "error": "...", "message": "<zod error>" }`

### `DELETE /api/settings/agents/:role`

删除某个 role 的 agent 配置（no-op if unset，返回 200）。

**Response 200**：`{ "ok": true }`

### `GET /api/settings/mcp-presets`

列出预配的第三方 MCP server 清单（静态数据，不从文件读）。前端可展示清单，用户选择后 `PUT /api/settings/agents/:role` 的 `mcpServers` 字段引用对应 preset。

**Response 200**：`Record<string, McpServerConfig & { description: string; recommendedFor: string[] }>`

```ts
{
  "paper-search-mcp": {
    name: "paper-search-mcp",
    transport: "stdio",
    command: "uvx",
    args: ["paper-search-mcp"],
    description: "多源学术检索（arXiv/PubMed/bioRxiv/Semantic Scholar/Crossref/OpenAlex/Zenodo 等 20+ 源）...",
    recommendedFor: ["librarian"],
  },
  "duckduckgo-mcp": { /* ... */ recommendedFor: ["librarian", "prometheus"] },
  "arxiv-mcp": { /* ... */ recommendedFor: ["librarian"] },
}
```

> **安装前置**：stdio 类 preset 需本机装 `uvx`（`curl -LsSf https://astral.sh/uv/install.sh | sh`）。若 uvx 缺失，agent factory 的 `getMcpTools` 会 throw（连接失败），非阻塞——agent 仍可用自有工具跑。

### `GET /api/projects/:project/settings`

获取 project settings（仅 project 层 override 部分，不含 global）。

**Response 200**：`ProjectSettings`

```ts
{
  models?: Record<string, ModelConfig>,
  modelAliases?: Record<string, ModelConfig>,
  agents?: Record<string, AgentConfig>,   // per-role 非模型配置（与 global agents per-role per-field deep merge）
  tournament?: { ... },         // 同 GlobalSettings.tournament 的 Partial
  concurrency?: { ... },
  steering?: { ... },
  mcp?: { servers: unknown[] },
  skills?: { directories: string[] },
  prompts?: { dir: string },
}
```

### `PATCH /api/projects/:project/settings`

Deep merge patch 到 project settings。

**Request body**：`Partial<ProjectSettings>`
**Response 200**：合并后的完整 `ProjectSettings`

---

## 3. Credentials

Credentials 存在 `data/global.sqlite` 加密表中。**Credential = Endpoint bundle**：一个 credential = 一个完整 endpoint `{id, provider, apiKey, baseURL?}`，按 id 唯一（非按 provider），支持「同 provider 不同 baseURL+apiKey」组合（upsert by id）。

### `GET /api/credentials`

列出所有凭证（不返回明文 key）。

**Response 200**：`CredentialResponse[]`

```ts
;[{
  id: string,                    // 用户指定或 auto '${provider}-${ts}'，如 'openai-main' / 'openai-1784477951898'
  provider: string,              // 'openai' | 'anthropic' | ...
  type: 'api-key' | 'oauth-token',
  hasKey: true,                  // 始终 true（list 只返回有 key 的）
  baseURL?: string,              // 可选，OpenAI 兼容端点（与 apiKey 一起存于 credential）
  metadata?: Record<string, unknown>,  // 可选，透传存储
}]
```

### `POST /api/credentials`

添加/更新凭证（**upsert by id**：同 id 先删后加，按 id 唯一）。

**Request body**：`AddCredentialRequest`

```ts
{
  id?: string,                   // 可选，用户指定（如 'openai-main'）；省略则 auto '${provider}-${ts}'
  provider: string,              // 必填
  type: 'api-key' | 'oauth-token',  // 默认 'api-key'
  key: string,                   // 必填，明文 apiKey（会被加密存储）
  baseURL?: string,              // 可选，OpenAI 兼容端点
  metadata?: Record<string, unknown>,  // 可选
}
```

**Response 201**：`CredentialResponse`（同上 GET 返回结构，含解析后的 id）
**Response 500**：`{ "error": "internal_error", "message": "credential add failed" }`

### `DELETE /api/credentials/:id`

按 id 删除凭证。

**Response 200**：`{ "ok": true }`

---

## 4. Projects

Project 是逻辑隔离单位，每个 project 有独立 SQLite + FS 产物目录。

### `GET /api/projects`

列出所有 project（扫描 `data/projects/` 目录）。

**Response 200**：`Array<{ name: string, createdAt: null }>`（`createdAt` 目前始终 `null`，待补）

### `POST /api/projects`

创建 project。

**Request body**：`CreateProjectRequest`

```ts
{
  name: string,                  // 1-64 字符，用作目录名 + SQLite 库名
  config?: {                     // 可选
    mcp?: Record<string, unknown>,
    skills?: string[],
    prompts?: string,
  },
}
```

**Response 201**：`{ id: string, name: string, createdAt: string, ... }`（`createProject` 返回值）

### `GET /api/projects/:project`

获取单个 project。

**Response 200**：

```ts
{
  id: string,                    // projects 表 UUID
  name: string,
  createdAt: string,             // ISO timestamp
  config: unknown | null,        // configJson 解析后的对象
}
```

**Response 404**：`{ "error": "not_found", "message": "Project \"<name>\" not found" }`

### `DELETE /api/projects/:project`

删除 project（级联删除 SQLite 行 + FS 产物目录 `data/projects/<name>/`）。

**Response 200**：`{ "ok": true }`

---

## 5. Test LLM

测试 LLM 连通性（不走 settings/credential，body 直接传完整 config）。

### `POST /api/test-llm`

**Request body**：`TestLlmRequest`

```ts
{
  provider: 'openai' | 'anthropic',   // 默认 'openai'
  model: string,                        // 必填
  baseURL?: string,                     // 可选
  apiKey: string,                       // 必填
  prompt: string,                       // 默认 'Say hi in 3 words.'
  maxTokens: number,                    // 1-4096，默认 50
}
```

**Response 200**：`TestLlmResponse`

成功：

```ts
{
  ok: true,
  text: string,
  usage?: {
    promptTokens?: number,
    completionTokens?: number,
    totalTokens?: number,
  },
  model: string,                // 实际响应的 modelId
  durationMs: number,
}
```

失败：

```ts
{
  ok: false,
  error: string,                // 错误信息
  durationMs: number,
}
```

> 注：此端点 `thinkingLevel` 强制为 `'off'`，纯连通性测试。

---

## 6. Runs（Tournament Workflow）

核心端点。启动 / 查询 / 重连 / 停止 tournament workflow。

### `POST /api/projects/:name/runs`

启动一个 tournament run。

**前置条件**：

1. project 必须存在（`getProject(name)`，否则 404）
2. model 配置可解析（见下）
3. credential 可解析（见下）

**Request body**：

```ts
{
  seed: string,                  // 必填，种子假设文本
  modelAlias?: string,           // 可选，引用 settings.modelAliases[alias]
}
```

**model 解析逻辑**（`resolveModelArg`，从 `@open-scientist/config` 导入）：

- 若传 `modelAlias`：从 `settings.modelAliases[alias]` 查找（找不到抛 `ModelAliasNotFoundError` → 400）
- 否则：`settings.models.sisyphus ?? settings.models.default`（都无则 500）
- 拿到 `ModelConfig = {model, thinkingLevel, credentialId}` 后，按 `cfg.credentialId` 查 credential（`credentialStore.get(credentialId)`，找不到 500）
- 从 credential 拿 `provider` / `apiKey` / `baseURL?`，组装 `ModelArg = { provider, model, baseURL?, apiKey, thinkingLevel }`

**per-agent config 解析逻辑**（`resolveAgentConfigs`）：

- 启动 run 时，server 调 `resolveAgentConfigs(projectName, credentials)` 为全 6 个 tournament role（sisyphus/librarian/looker/explore/oracle/prometheus）各 resolve 一个 `AgentRuntimeConfig = { modelConfig: ModelArg, instructions?, skillDirectories?, mcpServers? }`
- 每个 role 的 `modelConfig` = `resolveModelArg(role)`（fallback `default` → `sisyphus`）
- `instructions` / `skillDirectories` / `mcpServers` 从 `settings.agents[role]` 读取（undefined → agent 工厂用硬编码默认）
- 若传 `modelAlias`，override `configs.sisyphus.modelConfig`（其余 5 role 仍走各自 role 解析）
- 组装的 `agentConfigs: Record<string, AgentRuntimeConfig>` 传给 `tournamentWorkflow`，各子 workflow 按 role 取 `agentConfigs[role]` 作为 `agentConfig` 传入

**Response 200**（SSE 流）：

```
Headers:
  Content-Type: text/event-stream
  x-workflow-run-id: wrn_xxx     // SDK workflow run id，用于后续重连/停止/查询
```

Body 为 SSE 流，每个事件 `data: <UIMessageChunk JSON>\n\n`。详见下方「SSE 事件类型」。

**Response 400**：`{ "error": "bad_request", "message": "body.seed is required" | "Unknown modelAlias ..." }`
**Response 404**：`{ "error": "not_found", "message": "Project \"<name>\" not found" }`
**Response 500**：`{ "error": "model_config_error", "message": "No model config for role ..." | "No credential found for id ..." }`

> **重要**：响应是 SSE 流，不是 JSON。前端应使用 `EventSource` 或 `fetch` + `ReadableStream` 消费。`x-workflow-run-id` header 必须捕获并保存，用于重连。

### `GET /api/projects/:name/runs/:runId/stream`

断线重连，从指定 chunk index 续传。

**Query**：

- `startIndex`：整数，默认 0。**负数表示 tail-relative**（如 `-3` 读最后 3 个 chunk）。

**Response 200**（SSE 流）：

```
Headers:
  Content-Type: text/event-stream
  x-workflow-run-id: <runId>
  x-workflow-stream-tail-index: <number>   // 仅当 startIndex < 0 时返回，绝对 tail index
```

**Response 400**：`{ "error": "bad_request", "message": "startIndex must be an integer" }`

### `GET /api/projects/:name/runs/:runId`

查询 run 的持久化状态（读 project SQLite `runs` 表）。

**Response 200**：

```ts
{
  runId: string,                // 同 path param
  projectId: string,            // projects 表 UUID
  status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'stopped',
  startedAt: string,            // ISO timestamp
  endedAt: string | null,       // 完成时设置
  currentRound: number,         // 当前轮次
  bestF1: number,               // 最佳 F1
}
```

**Response 404**：`{ "error": "not_found", "message": "Run \"<runId>\" not found in project \"<name>\"" }`

### `POST /api/projects/:name/runs/:runId/stop`

停止 run（取消 SDK workflow run + SQLite 标记 `stopped` + 设置 `endedAt`）。

**Response 200**：`{ "ok": true, "runId": string, "status": "stopped' }`
**Response 404**：同上

### Human-in-the-loop 控制（可选交互面）

> 设计不变量：科学闭环**不依赖人工参与**——默认 `humanGate: 'off'` 时，以下端点一个都不调用，
> 循环也会自主完成（`workflowClosure=complete`）。人工参与只通过这些端点**选择性介入**：
> 暂停/转向/审批。三者都**不能**写入证据、改写支持/淘汰门禁裁决或假设状态；
> 审批只决定"是否继续下一轮"（拒绝 → `terminationReason: 'human_halted_at_plan_review'`，
> 超时/中止 → fail-open 自动继续并留下审计记录）。
>
> 启动运行时通过 `POST /runs` 的 `humanGate: 'off' | 'plan_review'` 与
> `humanGateTimeoutMs?: 1000..3600000` 配置；审批门挂在 D.route 的续轮决策处。

#### `GET /api/projects/:name/runs/:runId/human`

人工控制状态（供 UI 轮询）。

**Response 200**：

```json
{
  "runId": "run-...",
  "gateMode": "plan_review",
  "paused": false,
  "pendingGate": { "gateId": "gate-...", "kind": "plan_review", "round": 1, "summary": "..." },
  "gateDecisions": 0
}
```

**Response 404**：run 未激活（已结束或不存在）。

#### `POST /api/projects/:name/runs/:runId/steer`

注入一条转向/追问消息，在下一个 A.generate 入口被消耗。model-assisted 模式将其作为候选生成
的侧重参考；local-grounded 模式只登记不消费（保持确定性可复现）。

**Request body**：`{ "content": string, "mode": "steering" | "follow-up" }`（mode 默认 steering）
**Response 200**：`{ "ok": true, "runId": string, "message": { "messageId": string, ... } }`
**Response 409**：run 已结束；**Response 404**：run 不存在。

#### `POST /api/projects/:name/runs/:runId/pause` / `.../unpause`

在**节点边界**协作式暂停/恢复（不打断正在执行的智能体步骤；`/stop` 仍可随时强制终止）。
SSE 侧对应 `scientific.human-paused` / `scientific.human-resumed` 事件。

**Response 200**：`{ "ok": true, "runId": string, "paused": boolean }`

#### `POST /api/projects/:name/runs/:runId/approve`

应答待决的 plan_review 审批门。`approved: false` 使循环以
`terminationReason: 'human_halted_at_plan_review'` 结束（如实记录人工决定，不伪造任何科学裁决）。

**Request body**：`{ "approved": boolean, "reason"?: string, "gateId"?: string }`
**Response 200**：`{ "ok": true, "runId": string, "decision": { "gateId": string, "approved": boolean, "source": "human", "reason"?: string } }`
**Response 409**：当前没有待决审批门。

> 相关 SSE 自定义事件：`scientific.steering-injected`、`scientific.human-gate-request`、
> `scientific.human-gate-result`、`scientific.human-paused`、`scientific.human-resumed`。
> 运行结果的 `humanSteering` / `humanGates` 数组完整记录本轮实际发生的人工介入（未发生则缺省）。

---

## 7. Dev Probe（临时测试端点）

> 仅用于开发期验证 `tournamentWorkflow`。**不走 settings/project 校验**，但需有 openai credential 存在。

### `POST /api/dev-probe/stream-test`

**Request body**：`{ seed?: string }`（seed 有默认值）

**Response 200**（SSE 流）：同 `POST /api/projects/:name/runs`，header 带 `x-workflow-run-id`。

**内部行为**：

- 从 `credentialStore.list()` 找 `provider === 'openai'` 的第一条，再 `store.get(cred.id)` 拿 full credential（含 apiKey+baseURL）
- 硬编码 modelConfig：`provider: 'openai'`, `model: 'llab/Qwen3-Next-80B-A3B-Instruct'`, `baseURL: <cred.baseURL>`, `apiKey: <cred.apiKey>`, `thinkingLevel: 'medium'`
- `projectId: 'probe-project'`（无需预创建，workflow 内部按需建 workspace dir）
- `runId: 'probe-<timestamp>'`

**Response 500**：`{ "error": "no openai credential" }`

---

## 8. SSE 事件类型（UIMessageChunk）

所有 SSE 流端点（`POST /runs`, `GET /runs/:id/stream`, `POST /dev-probe/stream-test`）输出统一的 `UIMessageChunk` 格式（来自 `@ai-sdk/workflow` 的 `createModelCallToUIChunkTransform`）。

每个事件格式：`data: <JSON>\n\n`（无 `event:` 字段，全部用 `data`）。流结束发送 `data: [DONE]\n\n`。

### 生命周期事件

| `type`        | 字段                                                 | 含义                                                | 前端处理              |
| ------------- | ---------------------------------------------------- | --------------------------------------------------- | --------------------- |
| `start`       | `messageId?: string`, `messageMetadata?: unknown`    | 消息开始                                            | 创建新 message bubble |
| `start-step`  | —                                                    | 一个 agent step 开始（librarian/oracle/explore 等） | 可渲染 step 边界      |
| `finish-step` | —                                                    | agent step 结束                                     | 更新 step 状态        |
| `finish`      | `finishReason?: string`, `messageMetadata?: unknown` | 整个流结束                                          | 完成 message bubble   |
| `abort`       | `reason?: string`                                    | 流被中止                                            | 显示中止提示          |
| `error`       | `errorText: string`                                  | 错误                                                | 显示错误              |

### 文本事件

| `type`       | 字段                          | 含义             |
| ------------ | ----------------------------- | ---------------- |
| `text-start` | `id: string`                  | 一段文本开始     |
| `text-delta` | `id: string`, `delta: string` | 文本增量（追加） |
| `text-end`   | `id: string`                  | 一段文本结束     |

### Reasoning（thinking）事件

| `type`            | 字段                          | 含义            |
| ----------------- | ----------------------------- | --------------- |
| `reasoning-start` | `id: string`                  | thinking 段开始 |
| `reasoning-delta` | `id: string`, `delta: string` | thinking 增量   |
| `reasoning-end`   | `id: string`                  | thinking 段结束 |

### Tool 调用事件

| `type`                  | 字段                                           | 含义                             |
| ----------------------- | ---------------------------------------------- | -------------------------------- |
| `tool-input-start`      | `toolCallId`, `toolName`                       | tool 调用开始                    |
| `tool-input-delta`      | `toolCallId`, `inputTextDelta: string`         | tool 参数增量（JSON 字符串碎片） |
| `tool-input-available`  | `toolCallId`, `toolName`, `input: unknown`     | tool 参数完整可用                |
| `tool-output-available` | `toolCallId`, `output: unknown`                | tool 执行结果可用                |
| `tool-input-error`      | `toolCallId`, `toolName`, `input`, `errorText` | tool 参数错误                    |
| `tool-output-error`     | `toolCallId`, `errorText`                      | tool 执行错误                    |

### 审批事件（人机协同，当前未启用）

| `type`                   | 字段                                                     | 含义         |
| ------------------------ | -------------------------------------------------------- | ------------ |
| `tool-approval-request`  | `approvalId`, `toolCallId`, `isAutomatic?`, `signature?` | 请求用户审批 |
| `tool-approval-response` | `approvalId`, `approved: boolean`, `reason?`             | 审批响应     |

### 其他事件

| `type`             | 字段                                          | 含义           |
| ------------------ | --------------------------------------------- | -------------- |
| `source-url`       | `sourceId`, `url`, `title?`                   | URL 来源       |
| `source-document`  | `sourceId`, `mediaType`, `title`, `filename?` | 文档来源       |
| `file`             | `url`, `mediaType`                            | 文件附件       |
| `message-metadata` | `messageMetadata: unknown`                    | 消息元数据更新 |
| `custom`           | `kind: '<namespace>.<name>'`                  | 自定义事件     |

### 实测样例（librarian 首轮）

```
data: {"type":"start"}

data: {"type":"start-step"}

data: {"type":"text-start","id":"0"}

data: {"type":"text-delta","id":"0","delta":""}

data: {"type":"tool-input-start","toolCallId":"call_98dab864-...","toolName":"loadSkill"}

data: {"type":"tool-input-delta","toolCallId":"call_98dab864-...","inputTextDelta":"{\"name\": \"s"}

data: {"type":"tool-input-delta","toolCallId":"call_98dab864-...","inputTextDelta":"olar-physics-r"}

data: {"type":"tool-input-delta","toolCallId":"call_98dab864-...","inputTextDelta":"ag\"}"}

data: {"type":"text-end","id":"0"}

data: {"type":"tool-input-available","toolCallId":"call_98dab864-...","toolName":"loadSkill","input":{"name":"solar-physics-rag"}}

data: {"type":"tool-output-available","toolCallId":"call_98dab864-...","output":"Error: Skill not found: solar-physics-rag"}

data: {"type":"finish-step"}

data: {"type":"start-step"}

...

data: {"type":"finish"}

data: [DONE]
```

---

## 9. Tournament Workflow 业务语义（前端展示用）

前端不需要直接调 workflow API，但需要理解 `POST /runs` 启动的后台流程，以渲染 UI。

### 流程

```
Round 1: Librarian 生成假设池 (HypothesisPool)
  ↓
Round 2..MAX_ROUNDS:
  Explore 并行评估每个假设 (EvalResult, 算 F1)
    → Oracle 批判 + 突变 + 淘汰 (OracleOutput)
    → Prometheus 规划下一轮 (PrometheusOutput)
    → 收敛检测 (F1 >= targetF1 OR round >= maxRounds OR !shouldContinue)
  ↓
Final round: Prometheus 生成 MHD cfg + 观测建议书
  ↓
TournamentResult
```

### TournamentResult（workflow 返回值，**当前 API 不直接返回**，需通过 SSE 流观察完成）

```ts
{
  runId: string,
  winningHypoId: string,
  bestF1: number,
  totalRounds: number,
  mhdConfigPath: string | null,
  observationProposal: string | null,
}
```

> **当前状态**：`TournamentResult` 是 workflow `returnValue`，但 `POST /runs` 端点返回的是 SSE 流（不 await `run.returnValue`）。前端需通过 SSE 流的 `finish` 事件判断完成，或轮询 `GET /runs/:runId` 看 `status` 是否变成 `completed`。

### 子 agent 产出 schema（供前端理解 tool-output 内容）

| Agent      | Output Schema      | 关键字段                                                                                                      |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Librarian  | `HypothesisPool`   | `hypotheses: Hypothesis[]`, `rationale: string`                                                               |
| Explore    | `EvalResult`       | `hypoId`, `f1`, `truePositives`, `falsePositives`, `falseNegatives`, `counterexamples`, `logs`, `executionMs` |
| Oracle     | `OracleOutput`     | `critiques: Critique[]`, `mutations: Mutation[]`, `eliminatedIds: string[]`, `winningHypoId: string\|null`    |
| Prometheus | `PrometheusOutput` | `plan: Plan`, `mhdConfig: MhdConfig\|null`, `shouldContinue: boolean`                                         |

详见 `packages/schema/src/` 各文件。

---

## 10. 典型前端流程

### 首次配置

```ts
// 1. 添加 credential（endpoint bundle：id + provider + apiKey + baseURL）
POST /api/credentials
  { id: 'openai-main', provider: 'openai', type: 'api-key', key: 'sk-...', baseURL: 'http://<internal-llm-host>:8084/v1' }
  // → { id: 'openai-main', provider: 'openai', hasKey: true, baseURL: 'http://...' }

// 2. 设置 default model（用 credentialId 引用 credential）
PUT /api/settings/models/default
  { model: 'llab/Qwen3-Next-80B-A3B-Instruct', thinkingLevel: 'medium', credentialId: 'openai-main' }

// 3. 测试 LLM 连通（独立路径，直接传完整 config）
POST /api/test-llm
  { provider: 'openai', model: '...', baseURL: '...', apiKey: '...', prompt: 'hi' }

// 4. 创建 project
POST /api/projects
  { name: 'corona-heating' }
```

### 启动 run

```ts
// POST /api/projects/corona-heating/runs
//   { seed: 'Magnetic reconnection in nanoflares...' }
//
// 捕获 response header 'x-workflow-run-id' → 存为 currentRunId
// 消费 SSE stream（见 §8）
```

### 断线重连

```ts
// 页面刷新后，用保存的 currentRunId + 本地已收到的 chunk count
// GET /api/projects/corona-heating/runs/<runId>/stream?startIndex=<localChunkCount>
//   - 若 startIndex 为负数，响应会带 'x-workflow-stream-tail-index' header
```

### 停止 run

```ts
// POST /api/projects/corona-heating/runs/<runId>/stop
//   → { ok: true, runId, status: 'stopped' }
```

### 查询状态

```ts
// GET /api/projects/corona-heating/runs/<runId>
//   → { runId, projectId, status, startedAt, endedAt, currentRound, bestF1 }
```

---

## 11. 已知限制

1. **无 hypotheses/evidence/rounds/mhd CRUD 端点**：这些数据当前只在 workflow 内部（HelixDB + FS 产物）生成，未暴露 REST。如前端需要展示，需补路由或直接读 FS 产物。
2. **无 steering / approval 端点**：SPEC 设计了 `POST /runs/:id/steer` 和 approval 响应，但当前未实现（tournament 全自动运行）。`SteerRequestSchema` / `ApproveRequestSchema` 已在 schema 包定义但无路由。
3. **`POST /runs` 返回 SSE 不返回 `TournamentResult`**：workflow `returnValue` 需另外 await（当前端点不 await）。前端判断完成靠 SSE `finish` 事件或轮询 `status`。
4. **dev-probe 硬编码内网 LLM endpoint**：仅用于本地开发测试，前端不应依赖。
