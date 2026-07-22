# Open-Scientist 技术规格

> 太阳物理多智能体（Multi-Agent）人机协同假设生成与证据推理系统
> 赛道一方向二 B：日冕加热之谜
> 基于 Google Co-Scientist (Nature, 2026) + AlphaEvolve 架构

---

## 1. 项目定位

构建 6 个自定义角色 Agent 协同的"分布式科学共同体"，对日冕加热等前沿课题执行 **Tournament Evolution**（假设生成 → 证据审查 → 锦标赛辩论 → 多轮规划）循环，最终输出 MHD 仿真配置 + 卫星观测建议书。支持人机协同介入节点（物理学家审查领先假设并注入专家直觉）。

本 spec 只覆盖 **API 侧**（REST + Agent 编排 + 持久化），Web/TUI 后期再加。

---

## 2. 技术选型

| 层            | 选型                                                   | 理由                                                                                                                                                               |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime       | **Node.js**                                            | AI SDK 7 纯 TS 兼容；better-sqlite3                                                                                                                                |
| Lint/Format   | **Vite+**（Oxlint + Oxfmt）                            | 统一工具链，替代 ESLint+Prettier+Biome，零配置                                                                                                                     |
| Schema 校验   | **Zod**                                                | AI SDK `tool.inputSchema` / `Output.object(zodSchema)` 必选                                                                                                        |
| HTTP 框架     | **Hono**                                               | 轻量、Node 原生适配；返回标准 Response 可直返                                                                                                                      |
| Server        | **@hono/node-server**                                  | hono 官方推荐生产 server；无 build-time bundle，dev 用 `tsx watch` 热重载                                                                                          |
| Agent 抽象    | **ToolLoopAgent**（`ai` 包直接导出）                   | 全 6 个 agent 都用；`toolApproval`（via `prepareCall`）做跨 session 人机协同；LLM + tool calls 核心循环                                                            |
| Agent 编排    | **plain async 函数**（direct await + `Promise.all`）   | Sisyphus `tournamentWorkflow` 调 5 个子 workflow，顺序用 `await`，并行 Explore 用 `Promise.all`；SSE 流通过 `emitChunk` 回调从子 workflow 逐层冒泡到 `RunRegistry` |
| 结构化输出    | **`Output.object(zod)`**                               | 假设池/批判报告/规划参数全 schema 化                                                                                                                               |
| 文件/代码操作 | **`bash-tool`**（vercel-labs）                         | agent 自主 mkdir/write/bash 调试；host child_process，无沙箱限制                                                                                                   |
| 向量/图数据库 | **HelixDB**（`@helix-db/helix-db`，本地部署）          | graph+vector 一体 Rust 引擎，知识图谱 + 语义检索                                                                                                                   |
| 关系数据库    | **SQLite**（`better-sqlite3` + WAL）                   | per-project 数据库；零依赖；WAL 支持多读并发                                                                                                                       |
| ORM           | **Drizzle ORM**                                        | 类型安全 + migration；`drizzle-orm/better-sqlite3` 适配                                                                                                            |
| LLM Provider  | **OpenAI 优先**，`config/models.ts` 抽象 provider 接口 | 后期可换 Anthropic；模型配置走 Web API + SQLite 存储，不用 `.env`                                                                                                  |
| MCP 集成      | **`@ai-sdk/mcp`**（正式，非可选）                      | HTTP transport，自定义 MCP server 封装 HelixDB / FITS / 沙箱工具；工具漂移检测                                                                                     |
| Agent Skills  | **自实现**（agentskills.io 开放格式）                  | per-agent skills，progressive disclosure，不挤爆 context                                                                                                           |
| 凭证管理      | **CredentialStore**（SQLite 加密）                     | API key / OAuth token 存 SQLite，串行 modify 防双刷；借鉴 Pi                                                                                                       |
| 人机协同扩展  | **Steering & Follow-up**                               | Tournament 长循环中用户中途插话/追加任务（借鉴 Pi）                                                                                                                |
| 日志          | 结构化 JSON 日志                                       | 写 FS + stdout                                                                                                                                                     |
| 包管理        | **pnpm workspaces**                                    | monorepo 原生支持                                                                                                                                                  |

### 关键决策说明

**为什么用 ToolLoopAgent 而非 WorkflowAgent**

- `WorkflowAgent` 本质就是 durable 版 `ToolLoopAgent`，agent 核心循环（LLM + tool calls + `stopWhen: isStepCount(N)` + `Output.object({schema})`）完全一样，从 `ai` 包直接 `import { ToolLoopAgent }` 即可
- WorkflowAgent 的三文件边界（agent.ts / workflow.ts 薄壳 / steps/）是为绕开 `@workflow/core` VM sandbox 无 `importModuleDynamically` 的限制，纯样板代码；ToolLoopAgent 在 host Node runtime 直接跑，`await import()` 随便用
- `toolApproval` 在 `streamText` / ToolLoopAgent 上是一等 option（构造时或 `prepareCall` 返回值），人机协同审批可真正接上（WorkflowAgent 不暴露 `toolApproval`）
- 并行 Explore 用 `Promise.all(hypotheses.map(h => exploreWorkflow(input)))`，事件共享父流——UI 可视化无影响
- 失去的是 crash 后 durable resume（补法：每轮已写 `snapshot.json`，加 resume-from-snapshot 入口点）和 SSE 断线重连（补法：自实现 `RunRegistry` chunk ring buffer，~150 行）

**为什么 Explore 不用 Docker**

- bash-tool 给 agent 自主调试能力（mkdir / write / python run.py / 读 stdout / 改代码 / 再跑），这就是"不停调试"循环
- 只靠 project name + working dir 隔离，host 预装 Python 依赖（astropy/sunpy/scipy，或运行时 `uv pip install`）

---

## 3. Monorepo 结构

```
open-scientist/
├── apps/
│   └── api/                          # REST 入口（Hono + @hono/node-server）
├── packages/
│   ├── agents/                       # 6 个 ToolLoopAgent + workflow（plain async）+ shared
│   ├── tools/                        # 共享 tool 实现（bash-tool 封装、HelixDB 查询、FITS、MHD）
│   ├── skills/                       # Skills 基础设施 + 默认 skills
│   ├── mcp/                          # 自定义 MCP server
│   ├── storage/                      # SQLite + Drizzle 持久化
│   ├── helix/                        # HelixDB client + queries DSL
│   ├── schema/                       # Zod schemas + TS 类型（共享，无依赖）
│   └── config/                       # env / 路径 / provider 抽象
├── data/                             # 用户数据（.gitignore，base_dir 默认）
├── vite.config.ts
├── tsconfig.base.json
└── package.json                      # workspaces 根
```

### 3.1 `apps/api` — REST 入口

**职责**：HTTP 边界，路由分发，SSE 流，请求校验。不含业务逻辑。

**内容**：

- `src/routes/` — REST handlers（见 §7 API 层）
- `src/index.ts` — Hono app 装配（`new Hono()` + `registerRoutes(app)` + notFound + onError + `export default app`）
- `src/server.ts` — 启动入口（`import { serve } from '@hono/node-server'; serve({fetch: app.fetch, port})`）
- `src/lib/run-stream.ts` — `RunRegistry`（in-memory chunk ring buffer，见 §7.2 SSE 流）
- `package.json` 依赖：`hono`, `@hono/node-server`, `ai`, `tsx`(devDep), 以及内部 packages

**不包含**：agent 实现、tool 实现、数据访问逻辑（全委派给 packages）

### 3.2 `packages/agents` — 6 个 ToolLoopAgent

**职责**：6 个角色的 agent 定义、workflow 编排。

**目录结构**：

```
packages/agents/src/
├── shared/
│   ├── stream.ts            # streamAgentOutput + EmitChunk（toUIMessageStream 封装）
│   └── convergence.ts       # ConvergenceEntry 接口（sisyphus + prometheus 共享）
├── sisyphus/
│   ├── agent.ts             # ToolLoopAgent 构造工厂（拉 tools/skills/config）
│   ├── workflow.ts          # plain async — tournamentWorkflow 主循环（编排子 workflow、收敛检测）
│   ├── logic.ts             # 纯函数（updateHypothesesWithEval / computeLeader / shouldStop* / applyOraclePruning）
│   └── snapshot.ts          # snapshotStep + RoundSnapshot（写 FS snapshot.json）
├── librarian/
│   ├── agent.ts
│   └── workflow.ts          # plain async — HelixDB 检索、假设翻译为 Python
├── looker/
│   ├── agent.ts
│   └── workflow.ts          # plain async — FITS 对齐、视频切片
├── explore/
│   ├── agent.ts
│   └── workflow.ts          # plain async — bash-tool 跑 Python、F1 计算
├── oracle/
│   ├── agent.ts
│   ├── workflow.ts          # plain async — 批判、突变、反例 debug
│   └── logic.ts             # 纯函数（buildHypothesesBlock / buildEvalSummaryBlock）
├── prometheus/
│   ├── agent.ts
│   └── workflow.ts          # plain async — 规划、MHD cfg 生成
└── index.ts                 # 导出所有 agent + workflow 入口函数
```

**两文件边界**（ToolLoopAgent 在 host Node runtime 跑，无 VM sandbox 限制）：

- `agent.ts` — `createXxxAgent(...)` async 工厂：拉 tools/skills/config（Node 模块链），`new ToolLoopAgent({id, model, instructions, tools, output: Output.object({schema}), stopWhen: isStepCount(N), runtimeContext?})`。deps 接口含 `modelConfig: ModelArg` + `runtimeContext?: Record<string, unknown>`。
- `workflow.ts` — **plain async 函数**（无 `'use workflow'`）：静态 import `./agent.ts`，`const result = await agent.stream({messages})`（ToolLoopAgent.stream 返回 Promise，必须 await），调 `streamAgentOutput(result.fullStream, agent.tools, input.emitChunk)` 把 fullStream 转 UIMessageChunk 推给 SSE，`return result.output`。input 接口含 `emitChunk?: EmitChunk`。

**关键约束**：

- `runtimeContext` 是 ToolLoopAgent **构造参数**（不是 `agent.stream()` 调用选项），在 `createXxxAgent` 时传入
- `ModelArg`（plain object `{provider, model, baseURL?, apiKey, thinkingLevel}`）是跨调用边界的 model 配置载体，workflow 函数内调 `createModelFromConfig(modelConfig)` 重建 `LanguageModel`
- bash-tool 的 working dir = `data/projects/<project_name>/workspace/<hypo_id>/`
- SSE 流通过 `emitChunk` 回调从子 workflow 逐层冒泡到 `RunRegistry`（见 §7.2）

**依赖**：`packages/{tools, schema, config, helix, skills}`

### 3.3 `packages/tools` — 共享 tool 实现

**职责**：AI SDK `tool()` 定义，agent 通过 `tools:` 参数引用。

**内容**：

- `src/bash.ts` — `bash-tool` 封装，注入 project-aware working dir
- `src/helix-query.ts` — HelixDB 查询 tool（语义检索、图谱遍历）
- `src/fits-align.ts` — FITS 对齐 tool（输入候选案例 → 输出 FITS 路径 + 视频切片 + 元数据）
- `src/mhd-config.ts` — MHD 仿真配置生成 tool（Prometheus 用）
- `src/load-skill.ts` — `loadSkill` tool（progressive disclosure 用，skills 包提供实现）

**每个 tool 的契约**：

- `inputSchema: z.object(...)` — 输入校验
- `outputSchema?: z.object(...)` — 输出校验（结构化结果）
- `contextSchema?: z.object(...)` — per-call context（project name、working dir、credentials）
- `execute: async ({...input}, {context, ...}) => result`
- `needsApproval?: true | async fn` — **deprecated**（AI SDK 7），推荐用 `ToolLoopAgent` 构造时的 `toolApproval`（per-tool map 或 `GenericToolApprovalFunction`，返回 `'user-approval'` 暂停流 emit `tool-approval-request` chunk）；或 `prepareCall` 返回值里的 `toolApproval`（per-call 动态注入）

**依赖**：`packages/{schema, config, helix}`，`bash-tool`

### 3.4 `packages/skills` — Skills 基础设施 + 默认 skills

**职责**：实现 agentskills.io 开放格式的 progressive disclosure。

**内容**：

- `src/discover.ts` — `discoverSkills(sandbox, directories)` 扫描 skill 目录，解析 frontmatter，first-name-wins（project override 优先）
- `src/prompt.ts` — `buildSkillsPrompt(skills)` 生成 system prompt 片段（列 name+description，告诉 agent 用 loadSkill 加载）
- `src/load-tool.ts` — `loadSkill` tool 实现（读 SKILL.md 去 frontmatter，返回 `{skillDirectory, content}`）
- `src/sandbox.ts` — `Sandbox` 抽象接口（readFile / readdir / exec，Node 用 `fs/promises` + `child_process`）
- `defaults/` — 内置 skills（可被 project override）
  - `solar-physics-rag/SKILL.md` — Librarian 用
  - `fits-snapshot-search/SKILL.md` — Explore 用
  - `critique-protocol/SKILL.md` — Oracle 用
  - `mhd-planning/SKILL.md` — Prometheus 用
  - `multimodal-align/SKILL.md` — Looker 用

**Skill 加载流程**（每个 agent 的 `prepareCall` 注入）：

1. Discovery：启动时只加载每个 skill 的 `name` + `description`（frontmatter）
2. Activation：agent 调 `loadSkill` tool 读完整 SKILL.md 进 context
3. Execution：agent 跟随指令，用现有 tools 按需加载 `scripts/` / `references/` / `assets/`

**依赖**：`packages/{schema, config}`

### 3.5 `packages/mcp` — 自定义 MCP server

**职责**：把共享能力封装成 MCP server，让 6 个 agent 通过 `@ai-sdk/mcp` 客户端统一调用。也可对接社区 MCP server（文件系统、git、web search）。**正式包，Phase 2 必做**。

**内容**：

- `src/helix-server.ts` — HelixDB MCP server（暴露图谱查询、语义检索 tools）
- `src/fits-server.ts` — FITS 处理 MCP server（暴露对齐、切片 tools）
- `src/sandbox-server.ts` — 代码执行 MCP server（暴露 bash、write、read tools）
- `src/index.ts` — server 启动入口（stdio 本地 / HTTP 生产）
- `src/registry.ts` — MCP server 注册表（按 project config 动态加载）
- `src/trust.ts` — **Project Trust 安全机制**（借鉴 Pi）：per-project MCP server 首次连接需用户信任，存 baseline fingerprint，后续 `detectToolDrift` 检测变更

**MCP 客户端使用**（在 agent 构造时）：

```ts
const mcpClient = createMCPClient({transport: {type: 'http', url, headers}})
const mcpTools = await mcpClient.tools({schemas: {...}})  // 类型安全
```

**工具漂移检测**：`fingerprintTools` + `detectToolDrift` 防 "rug pull" 攻击，首次连接人工 review 后存 baseline（存 SQLite）。

**依赖**：`packages/{helix, schema, storage}`, `@modelcontextprotocol/sdk`, `@ai-sdk/mcp`

### 3.6 `packages/storage` — SQLite + Drizzle 持久化

**职责**：关系数据持久化，per-project 数据库。

**内容**：

- `src/db.ts` — `better-sqlite3` + WAL mode + Drizzle 实例工厂（per-project）
- `src/global-db.ts` — **全局 SQLite**（`data/global.sqlite`）：存 credentials、global settings、MCP trust baseline
- `src/schema.ts` — Drizzle 表定义（见 §5 数据模型）
- `src/migrate.ts` — migration 脚本
- `src/repo/` — repository 模式
  - `project.ts` — project 元数据 CRUD
  - `run.ts` — run 生命周期 + resume state 持久化
  - `message.ts` — UIMessage[] 持久化（对话历史）
  - `hypothesis.ts` — 假设池 + 每轮快照
  - `evidence.ts` — 证据记录
  - `critique.ts` — 批判 + 突变记录
  - `plan.ts` — 规划参数 + MHD cfg 引用
  - `credential.ts` — **CredentialStore**（API key / OAuth token 加密存储，串行 modify 防双刷）
  - `settings.ts` — global + project 两层 settings 读写
  - `mcp-trust.ts` — MCP server trust baseline + fingerprint 存储

**关键设计**：

- **双数据库**：全局 `data/global.sqlite`（credentials/settings/trust）+ per-project `data/projects/<name>/db.sqlite`（run/message/hypothesis 等）
- per-project database：project 间无锁竞争
- WAL mode：多读并发 + 写串行，支持单 project 多 run 并发
- resume state 用 opaque blob 存储（workflow DevKit 序列化格式），`INSERT OR REPLACE`
- 文件产物（Python 代码、FITS、MHD cfg）走 FS，SQLite 只存结构化数据 + 路径引用
- **CredentialStore 串行 modify**（借鉴 Pi）：OAuth refresh 在 `modify` 内加锁，防止并发双刷 token

**依赖**：`packages/{schema, config}`, `drizzle-orm`, `drizzle-kit`

### 3.7 `packages/helix` — HelixDB client + queries

**职责**：HelixDB 图谱+向量数据库的查询定义和客户端。

**内容**：

- `src/queries.ts` — HelixDB DSL 查询定义（`defineQueries` + `registerRead`/`registerWrite`），编译时生成 `queries.json`
  - `searchPapers` — 语义检索论文
  - `searchHypotheses` — 语义检索历史假设
  - `getRelatedConcepts` — 图谱遍历
  - `addHypothesis` / `addEvidence` / `addCritique` — 写入节点 + 关系边
- `src/client.ts` — `new Client(HELIX_URL).withApiKey(HELIX_API_KEY)`，`.query<T>().dynamic(queries.call.<name>(params)).send()`
- `src/types.ts` — 节点/边类型（Paper / Hypothesis / Evidence / Critique / Concept）

**HelixDB 图谱 schema**：

- 节点：`Paper`（论文）、`Hypothesis`（假设）、`Evidence`（证据）、`Critique`（批判）、`Concept`（物理概念）、`Snapshot`（1.75M 物理快照索引）
- 边：`CITES`（Paper→Paper）、`PROPOSES`（Paper→Hypothesis）、`SUPPORTED_BY`（Hypothesis→Evidence）、`CRITIQUED_BY`（Hypothesis→Critique）、`MUTATED_INTO`（Hypothesis→Hypothesis）、`RELATES_TO`（Concept→Concept）

**依赖**：`packages/{schema, config}`, `@helix-db/helix-db`

### 3.8 `packages/schema` — Zod schemas + TS 类型

**职责**：全项目共享的类型定义，零业务依赖，打破循环依赖。

**内容**：

- `src/hypothesis.ts` — `HypothesisSchema`（id, statement, pythonCode, parentId, round, f1, status）
- `src/eval.ts` — `EvalResultSchema`（hypoId, f1, truePositives, falsePositives, counterexamples[], logs）
- `src/critique.ts` — `CritiqueSchema` + `MutationSchema`（hypoId, critique, mutatedHypothesis, rationale）
- `src/plan.ts` — `PlanSchema` + `MhdConfigSchema`（round, searchParams, mhdCfg, proposalPath）。Prometheus 末轮调 mhdConfig tool 时把 observationProposal markdown 作为输入参数传入，tool 写 `<runId>_proposal.md` 文件并返回 `proposalPath`，避免 submit_result JSON 过大导致 parse 失败
- `src/evidence.ts` — `EvidenceAlignmentSchema`（hypoId, fitsPaths[], videoClipPath, metadata）
- `src/api.ts` — REST 请求/响应 schema（CreateProjectRequest, StartRunRequest, ApproveRequest 等）
- `src/runtime-context.ts` — `RuntimeContextSchema`（可序列化的 workflow 上下文：projectId, runId, round, hypotheses[], leadingHypoId, ...）
- `src/index.ts` — 统一导出

**依赖**：仅 `zod`

### 3.9 `packages/config` — 配置/路径/provider 抽象

**职责**：集中管理路径解析、provider 抽象、settings 读写。**模型相关配置全走 Web API + SQLite，不用 `.env`**。

**内容**：

- `src/env.ts` — **极简 env**（仅 server 启动必需，不含模型配置）
  - `BASE_DIR`（默认 `./data`）— 数据根目录
  - `PORT`（默认 3000）— API server 端口
  - `HELIX_URL` — HelixDB 地址（基础设施，非模型）
  - `LOG_LEVEL`（默认 `info`）
- `src/paths.ts` — 路径解析
  - `getProjectDir(name)` → `BASE_DIR/projects/<name>/`
  - `getWorkspaceDir(project, hypoId)` → `.../workspace/<hypoId>/`
  - `getEvidenceDir(project, hypoId)` → `.../evidence/<hypoId>/`
  - `getMhdDir(project)` → `.../mhd/`
  - `getSkillsDir(project)` → `.../skills/`（project override）
  - `getMcpConfigPath(project)` → `.../mcp/config.json`
  - `getPromptsDir(project)` → `.../prompts/`
  - `getGlobalDbPath()` → `BASE_DIR/global.sqlite`
- `src/settings.ts` — **两层 settings**（借鉴 Pi）
  - global settings：`data/settings.json`（全局默认 model、MAX_ROUNDS、TARGET_F1 等）
  - project settings：`data/projects/<name>/settings.json`（override global，deep merge）
  - `getSettings(projectName?)` → merge global + project
  - `setGlobalSettings(partial)` / `setProjectSettings(name, partial)`
- `src/models.ts` — **provider 抽象**（模型配置从 SQLite CredentialStore 读，不读 env）
  - `createProvider(config)` 接口，默认 OpenAI 实现，可扩展 Anthropic
  - `resolveModelArg(projectName, credentials, {role?, modelAlias?})` 读 settings → ModelConfig（含 credentialId）→ `credentials.get(credentialId)` → 从 credential 拿 provider/apiKey/baseURL → 组装 `ModelArg = {provider, model, baseURL?, apiKey, thinkingLevel}` plain object（跨调用边界传 model 配置的载体）
  - `createModelFromConfig(modelConfig)` 在 workflow 函数内重建 `LanguageModel` 实例
  - **per-agent thinkingLevel**（借鉴 Pi）：`settings.models.oracle.thinkingLevel: 'high'`
  - **sessionId for provider caching**（借鉴 Pi）：runtimeContext 传 sessionId 复用 provider 端 prompt cache
- `src/constants.ts` — 默认值（MAX_ROUNDS=10, TARGET_F1=0.9, MAX_CONCURRENT_RUNS=4, ...）

**关键设计**：

- **模型配置不走 env**：API key / model 选择 / thinkingLevel 全存 SQLite（`credentials` + `settings` 表），通过 Web API 管理
- **Credential = endpoint bundle**：`{id, provider, apiKey, baseURL?}`，id 命名实体，按 id 唯一（非按 provider），支持「同 provider 不同 endpoint」组合，upsert by id
- **ModelConfig 用 credentialId 引用**：`{model, thinkingLevel, credentialId}`，provider/baseURL/apiKey 全由 credentialId 引用的 Credential 条目决定
- **CredentialStore 串行 modify**（借鉴 Pi）：OAuth refresh 加锁防双刷，API key 加密存储
- **两层 settings merge**：global `data/settings.json` + per-project `data/projects/<name>/settings.json` override（deep merge），`getSettings(projectName?)` 返回合并结果
- env 只留 4 个基础设施变量（BASE_DIR / PORT / HELIX_URL / LOG_LEVEL）

**依赖**：`zod`, `@ai-sdk/openai`, `packages/storage`（读 credentials + settings）

---

## 4. Agent 架构

### 4.1 角色总表

| Agent                 | 职责                                                         | Output Schema                                | 主要 Tools                                                                                                                     | Skills                                      |
| --------------------- | ------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| **Sisyphus**          | 编排器，Tournament Evolution 主循环                          | `TournamentResultSchema`                     | `call_librarian`, `call_looker`, `call_explore`, `call_oracle`, `call_prometheus`, `review_leading_hypothesis`（toolApproval） | `tournament-protocol`                       |
| **Librarian**         | RAG 知识检索 + 假设生成（翻译为 Python 物理过滤函数）        | `HypothesisPoolSchema`（HypothesisSchema[]） | `helix-query`, `bash`（写 Python 文件）                                                                                        | `solar-physics-rag`, `hypothesis-to-python` |
| **Multimodal Looker** | 多模态数据对齐（FITS + MP4 时空索引）                        | `EvidenceAlignmentSchema`                    | `fits-align`, `helix-query`                                                                                                    | `multimodal-align`                          |
| **Explore**           | AlphaEvolve 确定性评估（跑 Python 在 1.75M 快照搜索，算 F1） | `EvalResultSchema`（F1 + 反例日志）          | `bash`（python run.py / 读 stdout / 改代码 / 再跑）                                                                            | `fits-snapshot-search`                      |
| **Oracle**            | Co-Scientist 评估 + 锦标赛辩论（批判 + 突变 + 反例 debug）   | `CritiqueSchema` + `MutationSchema`          | `bash`（跑测试脚本）, `helix-query`                                                                                            | `critique-protocol`                         |
| **Prometheus**        | 多轮规划（Scaling Test-time Compute）+ MHD cfg 生成          | `PlanSchema` + `MhdConfigSchema`             | `mhd-config`, `bash`（写 .cfg）                                                                                                | `mhd-planning`                              |

### 4.2 Sisyphus 编排（plain async 函数）

Sisyphus 的 `tournamentWorkflow` 是 plain async 函数，直接 await 5 个子 workflow。**Sisyphus agent（ToolLoopAgent）目前未被 tournamentWorkflow 调用**——tournamentWorkflow 是纯确定性控制流，Sisyphus agent 留给 Phase 4 API 层用于 free-form steering + approval。

**Direct await**（顺序，需结果）：

```ts
// sisyphus/workflow.ts （plain async，无 'use workflow'）
export async function tournamentWorkflow(input: TournamentWorkflowInput) {
  // Round 1: Librarian 生成假设
  const hypotheses = await librarianWorkflow({
    seed: input.seed,
    projectId: input.projectId,
    emitChunk: input.emitChunk,
  })

  while (round < MAX_ROUNDS && !converged) {
    // 并行评估多个假设（Promise.all，事件共享父流）
    const evals = await Promise.all(
      hypotheses.map((h) =>
        exploreWorkflow({ hypoId: h.id, projectId: input.projectId, emitChunk: input.emitChunk }),
      ),
    )
    // Oracle 批判 + 突变
    const { critiques, mutations } = await oracleWorkflow({
      evals,
      hypotheses,
      projectId: input.projectId,
      emitChunk: input.emitChunk,
    })

    // 人机协同节点（TODO Phase 4：通过 Sisyphus agent + toolApproval 接入）
    // const review = await reviewLeadingHypothesis({leadingHypoId, critiques, projectId})

    // Prometheus 规划下一轮
    const plan = await prometheusWorkflow({
      evals,
      review,
      round,
      projectId,
      emitChunk: input.emitChunk,
    })
    hypotheses = applyMutations(hypotheses, mutations, plan)
    round++
    if (bestF1 >= TARGET_F1) converged = true
  }

  return { winningHypothesis: hypotheses[0], mhdConfig, proposalPath }
}
```

**并行 fan-out**（`Promise.all`，事件共享父流）：

```ts
// 用于并行评估多个假设——SSE 流通过 emitChunk 回调从子 workflow 逐层冒泡到 RunRegistry
const evals = await Promise.all(
  hypotheses.map((h) => exploreWorkflow({ hypoId: h.id, projectId, emitChunk: input.emitChunk })),
)
```

### 4.3 runtimeContext 流转

workflow 间通过 `runtimeContext` 传递数据（plain object，在 ToolLoopAgent 构造时传入）：

```ts
RuntimeContextSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
  round: z.number(),
  hypotheses: z.array(HypothesisSchema), // 当前假设池快照
  leadingHypoId: z.string().nullable(), // 当前领先假设
  bestF1: z.number(),
  convergenceHistory: z.array(z.object({ round, bestF1, count })),
  userFeedback: z.string().nullable(), // 人机协同输入
})
```

**禁止放入 runtimeContext**：functions / class instances / symbols / WeakMap / SDK clients / DB handles（保持 plain data 习惯）。传 identifiers（projectId, runId, hypoId），在 workflow 函数内重建资源。

### 4.4 人机协同节点

**toolApproval（审批暂停）**
`review_leading_hypothesis` tool 在 Sisyphus agent 上配置 `toolApproval: {review_leading_hypothesis: 'user-approval'}`（或通过 `prepareCall` 动态注入）：

- ToolLoopAgent 执行到此 tool 时，`toolApproval` 返回 `'user-approval'` → stream 暂停
- emit `tool-approval-request` chunk（type='tool-approval-request', approvalId, toolCall, signature?）
- `toUIMessageStream` 转 UIMessageChunk → SSE 推前端
- 用户审查领先假设 + 反例，输入专家直觉
- API 收到 approval response → 注入回 agent stream 恢复执行

**Steering & Follow-up（借鉴 Pi）**
Tournament 长循环中用户中途插话/追加任务，不等到 toolApproval 节点：

- **Steering**：用户在 tool 执行中插入消息，当前 turn 结束后注入到 agent context
- **Follow-up**：agent 本要停止时，队列注入消息让它继续
- ToolLoopAgent 无原生 steering 支持，我们在 API 层实现 message queue + turn boundary 检测：
  - `POST /runs/:runId/steer` — 注入 steering 消息
  - message queue 持久化到 SQLite，workflow 下一个 step 边界检查并注入
  - `steeringMode: 'one-at-a-time' | 'all'`（settings 可配）

---

## 5. 数据模型

### 5.1 SQLite 表（Drizzle schema）

**全局数据库** `data/global.sqlite`：

```ts
// storage/src/schema.ts (global)
credentials: {
  ;(id, provider, type, encryptedKey, baseUrl, metadata_json, createdAt, updatedAt)
}
// id 命名实体（用户指定或 auto `${provider}-${ts}`），按 id 唯一（非按 provider），支持「同 provider 不同 baseURL+apiKey」组合，upsert by id
// type: 'api-key' | 'oauth-token'；encryptedKey 加密存储；baseUrl 可选（同 provider 不同 endpoint）；CredentialStore 串行 modify

settings: {
  ;(scope, name, value_json, updatedAt)
}
// scope: 'global' | 'project:<name>'；name: 'models' | 'tournament' | 'steering' 等

mcp_trust: {
  ;(id, projectName, serverName, fingerprint, trusted, firstSeen, lastChecked)
}
// MCP server 工具漂移检测 baseline

mcp_tool_baselines: {
  ;(id, trustId, toolName, digest, recordedAt)
}
// 每个 tool 的 fingerprint baseline
```

**per-project 数据库** `data/projects/<name>/db.sqlite`：

```ts
// storage/src/schema.ts (project)
projects: {
  ;(id, name, createdAt, config_json)
} // config: mcp/skills/prompts 路径

runs: {
  ;(id, projectId, status, startedAt, endedAt, resumeState_blob, currentRound, bestF1)
}

messages: {
  ;(id, runId, role, parts_json, createdAt)
} // UIMessage[] source of truth

steering_messages: {
  ;(id, runId, content, mode, injectedAt, status)
}
// mode: 'steering' | 'follow-up'；status: 'pending' | 'injected' | 'skipped'

hypotheses: {
  ;(id, projectId, runId, parentId, round, statement, pythonCode, f1, status, createdAt)
}
// status: 'candidate' | 'evaluated' | 'critiqued' | 'mutated' | 'winner' | 'eliminated'

evidence: {
  ;(id, hypoId, fitsPaths_json, videoClipPath, metadata_json, createdAt)
}

critiques: {
  ;(id, hypoId, critiqueText, rationale, round, createdAt)
}

mutations: {
  ;(id, parentHypoId, childHypoId, mutationRationale, round, createdAt)
}

plans: {
  ;(id, runId, round, searchParams_json, mhdCfgPath, proposalPath, createdAt)
}

logs: {
  ;(id, runId, level, message_json, timestamp)
}
```

### 5.2 文件系统产物

```
data/projects/<project_name>/
├── project.json              # 元数据 + 配置
├── db.sqlite                 # project 级 SQLite
├── runs/<runId>/
│   └── events.log            # workflow event log
├── rounds/<n>/
│   └── snapshot.json         # 每轮假设池快照
├── hypotheses/<hypo_id>/
│   ├── filter.py             # Python 物理过滤函数
│   ├── eval.log              # Explore 执行日志
│   └── counterexamples.json  # 反例
├── evidence/<hypo_id>/
│   ├── fits_align.json       # 对齐元数据
│   ├── *.fits                # 原始 FITS 图像
│   └── video_clip.mp4        # 演化视频切片
├── mhd/
│   └── <runId>.cfg           # MHD 仿真配置
│   └── <runId>_proposal.md   # 卫星观测建议书
├── workspace/<hypo_id>/      # Explore 的 bash-tool working dir
├── skills/                   # project 级 skill override
├── mcp/config.json           # project 级 MCP server 配置
├── prompts/                  # project 级 prompt 模板
└── logs/
```

### 5.3 HelixDB 图谱

见 §3.7。用于 Librarian 的 RAG 检索 + Oracle 的历史假设参照 + 全局知识沉淀。

---

## 6. Tournament Evolution 工作流

### 6.1 流程

```
User (seed hypothesis)
  ↓
Sisyphus.tournamentWorkflow
  ├─ Round 1: Librarian → 候选假设池（Python filter functions）
  ├─ Looker → 跨模态时空索引
  ├─ Loop (round = 2..MAX_ROUNDS):
  │    ├─ Explore (并行) → 每个假设的 F1 + 反例日志
  │    ├─ Oracle → 批判 + 突变（淘汰低分，保留优质变异）
  │    ├─ [人机协同] review_leading_hypothesis (toolApproval)
  │    │    └─ User 审查 + 输入专家直觉（stream 暂停 emit tool-approval-request）
  │    ├─ Prometheus → 调整搜索参数 + 下一轮规划
  │    └─ 收敛检测（F1 ≥ TARGET_F1 或 round ≥ MAX_ROUNDS）
  └─ Prometheus → MHD cfg + 卫星观测建议书
```

### 6.2 终止条件

- `bestF1 >= TARGET_F1`（默认 0.9）
- `round >= MAX_ROUNDS`（默认 10）
- 收敛检测：连续 N 轮 bestF1 提升小于阈值
- 用户手动终止（API 端点）

### 6.3 Fallback 机制

每个 workflow 函数都有 fallback 输出——当 agent 达到 step limit 未调用 submit_result 时，`extractSubmitResult(staticToolCalls, toolName?, fallback?)` 返回 fallback 值（而非 throw），确保 tournament 不因单个 agent 超时崩溃。fallback 值标记 f1=0 / 空数组等，下游 agent 可正常处理。

Step limits（`isStepCount(N)` 双终止条件 + `hasToolCall('submit_result')`）：

- Librarian: 50 步
- Explore: 120 步（含 eval 迭代调参）
- Oracle: 60 步
- Prometheus: 60 步
- Sisyphus: 120 步（预留 free-form steering）
- Looker: 50 步

### 6.3 每轮快照

每轮结束写 `rounds/<n>/snapshot.json`（假设池 + 分数 + 批判摘要），用于前端谱系树可视化 + 审计。

---

## 7. API 层

### 7.1 REST 端点

| Method | Path                                          | 功能                                                   |
| ------ | --------------------------------------------- | ------------------------------------------------------ |
| POST   | `/projects`                                   | 创建 project（name, config）                           |
| GET    | `/projects`                                   | 列出 projects                                          |
| GET    | `/projects/:name`                             | 获取 project 详情                                      |
| DELETE | `/projects/:name`                             | 删除 project                                           |
| PUT    | `/projects/:name/config`                      | 更新 project 配置（mcp/skills/prompts）                |
| POST   | `/projects/:name/runs`                        | 启动 Tournament run（seed hypothesis）                 |
| GET    | `/projects/:name/runs`                        | 列出 runs                                              |
| GET    | `/projects/:name/runs/:runId`                 | 获取 run 状态                                          |
| GET    | `/projects/:name/runs/:runId/stream`          | SSE 流（workflow 事件 + tool-approval-request）        |
| POST   | `/projects/:name/runs/:runId/approve`         | 提交人机协同审批（approval response）                  |
| POST   | `/projects/:name/runs/:runId/steer`           | **注入 steering/follow-up 消息**（借鉴 Pi）            |
| POST   | `/projects/:name/runs/:runId/stop`            | 终止 run                                               |
| GET    | `/projects/:name/runs/:runId/hypotheses`      | 列出假设池                                             |
| GET    | `/projects/:name/hypotheses/:hypoId`          | 获取假设详情                                           |
| GET    | `/projects/:name/hypotheses/:hypoId/evidence` | 获取证据（FITS/视频路径）                              |
| GET    | `/projects/:name/runs/:runId/rounds/:n`       | 获取某轮快照                                           |
| GET    | `/projects/:name/runs/:runId/mhd`             | 下载 MHD cfg                                           |
| GET    | `/settings`                                   | 获取 global settings                                   |
| PUT    | `/settings`                                   | 更新 global settings（models / tournament / steering） |
| GET    | `/projects/:name/settings`                    | 获取 project settings（merge global）                  |
| PUT    | `/projects/:name/settings`                    | 更新 project settings（override global）               |
| GET    | `/credentials`                                | 列出已配置的 provider credentials（不返回 key）        |
| POST   | `/credentials`                                | 添加 provider credential（api-key / oauth）            |
| DELETE | `/credentials/:id`                            | 删除 credential                                        |
| POST   | `/credentials/:id/refresh`                    | 手动触发 OAuth refresh                                 |
| PUT    | `/projects/:name/mcp/config`                  | 更新 MCP server 配置                                   |
| GET    | `/projects/:name/mcp/trust`                   | 列出 MCP server trust 状态                             |
| POST   | `/projects/:name/mcp/trust`                   | 信任/拒绝 MCP server（首次连接 review）                |
| PUT    | `/projects/:name/skills`                      | 上传/更新 project 级 skills                            |
| GET    | `/health`                                     | 健康检查                                               |

### 7.2 SSE 流

**RunRegistry**（`apps/api/src/lib/run-stream.ts`）：in-memory chunk ring buffer，管理 active runs。

- `Run` 持有 `{runId, abortController, chunks: UIMessageChunk[], result: Promise<TournamentResult>, cancel(), getReadable({startIndex}), getTailIndex()}`
- `start(input: TournamentWorkflowInput): Run` — 生成 runId，创建 Run，后台异步跑 `tournamentWorkflow({...input, emitChunk: chunk => run.chunks.push(chunk)})`。`run.result` 完成后调 `completeRun(projectName, runId, 'completed'|'failed', {bestF1?, currentRound?})` 更新 SQLite status。60s 后自动 evict 完成的 run。
- `getRun(runId): Run | undefined`
- `Run.getReadable({startIndex}): ReadableStream<UIMessageChunk>` — 从 `chunks[startIndex]` 开始（支持 startIndex<0 tail-relative）
- `Run.getTailIndex(): number` — `chunks.length - 1`
- `Run.cancel()` — `abortController.abort()`

**SSE 响应**：`createUIMessageStreamResponse({stream, headers: {x-workflow-run-id}})`，stream 是 `Run.getReadable()` 返回的 `ReadableStream<UIMessageChunk>`。tournamentWorkflow 内每个子 agent 的 `result.fullStream` 通过 `streamAgentOutput`（`shared/stream.ts`）转 UIMessageChunk，经 `emitChunk` 回调逐层冒泡到 RunRegistry。

`GET /runs/:runId/stream` 返回 SSE：

- UIMessageChunk 流（start/start-step/finish-step/text-_/reasoning-_/tool-*/finish/abort/error/custom）
- `tool-approval-request` 事件（人机协同 toolApproval 节点）
- `steering-injected` 事件（steering 消息注入成功通知）
- 错误事件
- 断线重连：POST `/runs` 返回 `x-workflow-run-id` header，GET `/{runId}/stream?startIndex=N` 端点续传（startIndex<0 tail-relative，返 `x-workflow-stream-tail-index` header）

### 7.3 并发控制

- `MAX_CONCURRENT_RUNS`（global settings，默认 4）限制全局并发 run 数
- 单 project 内多 run 并发：SQLite WAL 支持
- Hono + Node.js 单进程多请求并发（event loop）
- **CredentialStore 串行 modify**：OAuth refresh 加锁，防止并发请求触发双刷 token

---

## 8. 配置层

### 8.1 环境变量（极简，仅基础设施）

| 变量        | 默认值   | 说明                     |
| ----------- | -------- | ------------------------ |
| `BASE_DIR`  | `./data` | 数据根目录               |
| `PORT`      | `3000`   | API server 端口          |
| `HELIX_URL` | —        | HelixDB 地址（基础设施） |
| `LOG_LEVEL` | `info`   | 日志级别                 |

**模型相关配置（API key / model / thinkingLevel）全走 Web API + SQLite，不用 `.env`。**

### 8.2 global settings（`data/settings.json` + SQLite `settings` 表）

通过 `PUT /settings` 管理：

```json
{
  "models": {
    "default": { "model": "gpt-4o", "thinkingLevel": "medium", "credentialId": "openai-prod" },
    "sisyphus": { "model": "gpt-4o", "thinkingLevel": "medium", "credentialId": "openai-prod" },
    "oracle": { "model": "o3", "thinkingLevel": "high", "credentialId": "openai-prod" },
    "explore": { "model": "gpt-4o", "thinkingLevel": "low", "credentialId": "openai-prod" },
    "librarian": { "model": "gpt-4o", "thinkingLevel": "medium", "credentialId": "openai-prod" },
    "looker": { "model": "gpt-4o", "thinkingLevel": "medium", "credentialId": "openai-prod" },
    "prometheus": { "model": "o3", "thinkingLevel": "high", "credentialId": "openai-prod" }
  },
  "modelAliases": {
    "fast": { "model": "gpt-4o-mini", "thinkingLevel": "low", "credentialId": "openai-prod" },
    "smart": { "model": "o3", "thinkingLevel": "high", "credentialId": "openai-prod" }
  },
  "tournament": { "maxRounds": 10, "targetF1": 0.9, "convergenceWindow": 3 },
  "concurrency": { "maxConcurrentRuns": 4 },
  "steering": { "mode": "one-at-a-time" }
}
```

`ModelConfig = {model, thinkingLevel, credentialId}`：provider/baseURL/apiKey 全由 `credentialId` 引用的 Credential 条目决定（见 §8.4），不在 ModelConfig 里重复。`modelAliases` 用同形态，供 `resolveModelArg({modelAlias?})` 解析。

### 8.3 project settings（`data/projects/<name>/settings.json` + SQLite）

通过 `PUT /projects/:name/settings` 管理，override global：

```json
{
  "models": {
    "oracle": {
      "model": "claude-sonnet-4-6",
      "thinkingLevel": "high",
      "credentialId": "anthropic-prod"
    }
  },
  "mcp": {
    "servers": [
      { "name": "helix", "transport": "http", "url": "http://localhost:6969" },
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem"]
      }
    ]
  },
  "skills": {
    "directories": ["packages/skills/defaults", "data/projects/<name>/skills"]
  },
  "prompts": {
    "dir": "data/projects/<name>/prompts"
  }
}
```

### 8.4 凭证管理（Web API + SQLite 加密）

一个 Credential = 一个完整 endpoint bundle `{id, provider, apiKey, baseURL?}`：支持「同 provider 不同 baseURL+apiKey」组合，**id 命名实体（用户指定或 auto `${provider}-${ts}`），按 id 唯一（非按 provider）**，upsert by id（后加覆盖先加）。

通过 `POST /credentials` 管理：

```json
// 请求
{"id": "openai-prod", "provider": "openai", "apiKey": "sk-...", "baseURL": "https://api.openai.com/v1"}

// 或同 provider 不同 endpoint
{"id": "openai-proxy", "provider": "openai", "apiKey": "sk-...", "baseURL": "https://my-proxy.example.com/v1"}
```

- 存 SQLite `credentials` 表（存储列名 `encrypted_key` 加密存储），`base_url` 列存 endpoint
- **CredentialStore 串行 modify**（借鉴 Pi）：OAuth refresh 在 `modify` 内加锁，防止并发请求触发双刷 token
- `resolveModelArg(projectName, credentials, {role?, modelAlias?})` 从 settings + CredentialStore 组装 `ModelArg`（见 §8.5）

### 8.5 per-agent model 解析

**模型配置形态**：`ModelConfig = {model, thinkingLevel, credentialId}` —— provider/baseURL/apiKey 全部由 credentialId 引用的 Credential 条目决定。`settings.models.<role>` 和 `settings.modelAliases.<alias>` 都用此形态。

`packages/config/src/models.ts` 的 `resolveModelArg(projectName, credentials, {role?, modelAlias?})` 流程：

1. 读 settings（merge global + project override 两层）
2. 取 `models[role]` 或 `modelAliases[alias]` 的 `ModelConfig`（含 `credentialId`）
3. `credentials.get(credentialId)` 读 Credential 条目，从 credential 拿 provider/apiKey/baseURL
4. 组装并返回 **`ModelArg`** = `{provider, model, baseURL?, apiKey, thinkingLevel}` —— **plain object**，可跨 workflow structured-clone 边界传递（不能放 SDK `LanguageModel` 实例）
5. 附带 `sessionId`（runtimeContext 传入）用于 provider 端 prompt cache 复用

**重建时机**：`ModelArg` 随 workflow input 传入，每个子 agent 在 workflow 函数内调 `createModelFromConfig(modelConfig)` 重建 `LanguageModel` 实例。

---

## 9. 包依赖关系

```
apps/api → packages/{agents, storage, config, schema, mcp}
packages/agents → packages/{tools, schema, config, helix, skills, mcp}
packages/tools → packages/{schema, config, helix}
packages/skills → packages/{schema, config}
packages/mcp → packages/{helix, schema, storage}
packages/storage → packages/{schema, config}
packages/helix → packages/{schema, config}
packages/schema → (仅 zod)
packages/config → packages/storage (读 credentials + settings)
```

**注意**：`packages/config` → `packages/storage` 是单向依赖（config 读 storage 的 credentials/settings repo）。`packages/storage` 的 schema 定义不依赖 config，打破循环。

`packages/schema` 是零业务依赖的共享类型层，打破所有循环依赖。

---

## 10. 实施顺序

### Phase 1: 基础设施

1. `packages/schema` — 所有 Zod schemas（无依赖，先做）
2. `packages/config` — paths + constants + settings 读写（依赖 storage，但先用接口解耦）
3. `packages/storage` — 双 SQLite + Drizzle + migration + repo（含 credentials/settings/mcp_trust）
4. `packages/helix` — HelixDB client + queries

### Phase 2: 工具层

5. `packages/tools` — bash-tool 封装、helix-query、fits-align、mhd-config
6. `packages/skills` — discover + prompt + load-tool + 默认 skills
7. `packages/mcp` — 自定义 MCP server（helix/fits/sandbox）+ trust 机制 + 漂移检测

### Phase 3: Agent 层

8. `packages/agents/librarian` — 假设生成
9. `packages/agents/explore` — 代码评估
10. `packages/agents/oracle` — 批判 + 突变
11. `packages/agents/looker` — 多模态对齐
12. `packages/agents/prometheus` — 规划
13. `packages/agents/sisyphus` — Tournament 主循环编排

### Phase 4: API 层

14. `apps/api` — Hono routes + @hono/node-server + RunRegistry SSE + 人机协同审批（toolApproval） + steering + 配置管理端点

### Phase 5: 集成测试

15. 端到端跑通 Tournament Evolution（seed → MHD cfg）
16. 人机协同节点测试（approve / 几小时后 resume）

---

## 11. 约束与注意事项

### ToolLoopAgent + @hono/node-server 约束

- 每 role 两文件：`agent.ts`（构造工厂，`new ToolLoopAgent`）+ `workflow.ts`（plain async，`await agent.stream({messages})` + `streamAgentOutput` + `return result.output`）
- `runtimeContext` 是 ToolLoopAgent **构造参数**（不是 `agent.stream()` 调用选项）
- `agent.stream()` 返回 `Promise<StreamTextResult>`，**必须 await**（与 WorkflowAgent 同步返回不同）
- SSE 流通过 `emitChunk` 回调从子 workflow 逐层冒泡到 `RunRegistry`——tournamentWorkflow 接受 `emitChunk?: EmitChunk`，转发给每个子 workflow
- `toolApproval`（人机协同审批）在 ToolLoopAgent 构造时或 `prepareCall` 返回值里设置，返回 `'user-approval'` 暂停流 emit `tool-approval-request` chunk
- **源码内部相对 import 用 `.ts` 后缀**（不是 `.js`）：tsx + Node type stripping 不做 `.js`→`.ts` fallback
- `tsconfig.base.json` 开 `allowImportingTsExtensions: true` + `rewriteRelativeImportExtensions: true`
- **package.json exports 指向 `./src/index.ts`**：workspace 包间 import 走 Node type stripping 加载
- dev 用 `tsx watch src/server.ts`，生产用 `tsc` → `node dist/server.js`，无 build-time bundle

### bash-tool 使用

- working dir = `data/projects/<name>/workspace/<hypo_id>/`，project + hypothesis 隔离
- 无沙箱限制（用户明确决定），Python 直接在 host 跑
- host 预装 Python 依赖（astropy/sunpy/scipy），或 agent 运行时 `uv pip install`

### HelixDB

- 本地部署（用户已装）
- queries.ts 编译时生成 `queries.json`，运行时加载
- tsconfig 需 strict mode + NodeNext module

### 安全

- env 不进 git（.gitignore）
- MCP server 工具漂移检测（`fingerprintTools` + `detectToolDrift`）
- project 间数据隔离（独立 SQLite + 独立目录）

---

## 12. 后期扩展（不在本 spec 范围）

- Web UI（Next.js + `useChat<AgentUIMessage>()` + 3D 概念图谱 + 辩论剧场 + 谱系树）
- TUI 调试（`@ai-sdk/tui` `runAgentTUI`）
- Anthropic provider 支持
- Docker 化部署
- 多用户/多租户
