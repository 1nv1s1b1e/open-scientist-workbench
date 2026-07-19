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

| 层 | 选型 | 理由 |
|---|---|---|
| Runtime | **Node.js** | AI SDK 7 纯 TS 兼容；better-sqlite3 + vitest + tsx |
| Lint/Format | **Biome** | 单工具替代 ESLint+Prettier，零配置 |
| Schema 校验 | **Zod** | AI SDK `tool.inputSchema` / `Output.object(zodSchema)` 必选 |
| HTTP 框架 | **Hono** | 轻量、Node 原生适配；返回标准 Response 可直返 |
| Build system | **Nitro**（`workflow/nitro` module） | WorkflowAgent 编译 `'use workflow'` / `'use step'` 指令需要 |
| Agent 抽象 | **WorkflowAgent**（`@ai-sdk/workflow` + `workflow`） | 全 6 个 agent 都用；durable + `needsApproval` 一等属性做跨 session 人机协同；step 自动重试 |
| Agent 编排 | **Workflow Composition**（direct await + background spawn） | Sisyphus 父 workflow 调 5 个子 workflow，顺序用 await，并行用 `start()` |
| 结构化输出 | **`Output.object(zod)`** | 假设池/批判报告/规划参数全 schema 化 |
| 文件/代码操作 | **`bash-tool`**（vercel-labs） | agent 自主 mkdir/write/bash 调试；host child_process，无沙箱限制 |
| 向量/图数据库 | **HelixDB**（`@helix-db/helix-db`，本地部署） | graph+vector 一体 Rust 引擎，知识图谱 + 语义检索 |
| 关系数据库 | **SQLite**（`better-sqlite3` + WAL） | per-project 数据库；零依赖；WAL 支持多读并发 |
| ORM | **Drizzle ORM** | 类型安全 + migration；`drizzle-orm/better-sqlite3` 适配 |
| LLM Provider | **OpenAI 优先**，`config/models.ts` 抽象 provider 接口 | 后期可换 Anthropic；模型配置走 Web API + SQLite 存储，不用 `.env` |
| MCP 集成 | **`@ai-sdk/mcp`**（正式，非可选） | HTTP transport，自定义 MCP server 封装 HelixDB / FITS / 沙箱工具；工具漂移检测 |
| Agent Skills | **自实现**（agentskills.io 开放格式） | per-agent skills，progressive disclosure，不挤爆 context |
| 凭证管理 | **CredentialStore**（SQLite 加密） | API key / OAuth token 存 SQLite，串行 modify 防双刷；借鉴 Pi |
| 人机协同扩展 | **Steering & Follow-up** | Tournament 长循环中用户中途插话/追加任务（借鉴 Pi） |
| 日志 | 结构化 JSON 日志 | 写 FS + stdout |
| 包管理 | **pnpm workspaces** | monorepo 原生支持 |

### 关键决策说明

**为什么全用 WorkflowAgent 而非 ToolLoopAgent**
- Tournament Evolution 是长流程（多轮循环 + 人机协同），需要 durable
- `needsApproval` 作为 tool 一等属性，审批时可暂停整个 workflow + persist resume state，用户几小时后回来也能续
- step 自动重试（默认 3 次）天然容错
- Workflow 可嵌套（direct await / background spawn），Sisyphus 编排 5 子 workflow 架构成立

**为什么 Explore 不用 Docker**
- bash-tool 给 agent 自主调试能力（mkdir / write / python run.py / 读 stdout / 改代码 / 再跑），这就是"不停调试"循环
- 只靠 project name + working dir 隔离，host 预装 Python 依赖（astropy/sunpy/scipy，或运行时 `uv pip install`）

---

## 3. Monorepo 结构

```
open-scientist/
├── apps/
│   └── api/                          # REST 入口（Hono + Nitro）
├── packages/
│   ├── agents/                       # 6 个 WorkflowAgent + workflow + steps
│   ├── tools/                        # 共享 tool 实现（bash-tool 封装、HelixDB 查询、FITS、MHD）
│   ├── skills/                       # Skills 基础设施 + 默认 skills
│   ├── mcp/                          # 自定义 MCP server
│   ├── storage/                      # SQLite + Drizzle 持久化
│   ├── helix/                        # HelixDB client + queries DSL
│   ├── schema/                       # Zod schemas + TS 类型（共享，无依赖）
│   └── config/                       # env / 路径 / provider 抽象
├── data/                             # 用户数据（.gitignore，base_dir 默认）
├── biome.json
├── tsconfig.base.json
└── package.json                      # workspaces 根
```

### 3.1 `apps/api` — REST 入口

**职责**：HTTP 边界，路由分发，SSE 流，请求校验。不含业务逻辑。

**内容**：
- `src/routes/` — REST handlers（见 §7 API 层）
- `src/server.ts` — Hono app 装配
- `src/index.ts` — 启动入口
- `nitro.config.ts` — `modules: ['workflow/nitro']` + `routes: {'/api/**': './src/index.ts'}` + `serverEntry: './src/index.ts'` + `workspaceDir: import.meta.dirname` + `noExternals` 列全 8 个 workspace 包（agents/logger/tools/skills/helix/config/schema/mcp）。文件顶部需 `import type {} from 'workflow/nitro'`（side-effect type import，让 TS 加载 module augmentation 认识 `workflow?` 字段）
- `package.json` 依赖：`hono`, `@hono/node-server`, `workflow`, `nitro`, `rollup`, 以及内部 packages

**不包含**：agent 实现、tool 实现、数据访问逻辑（全委派给 packages）

### 3.2 `packages/agents` — 6 个 WorkflowAgent

**职责**：6 个角色的 agent 定义、workflow 编排、可重试 step。

**目录结构**：
```
packages/agents/src/
├── sisyphus/
│   ├── agent.ts          # WorkflowAgent 构造工厂（module scope，拉 tools/skills/config）
│   ├── workflow.ts       # 'use workflow' — 纯 VM-safe 薄壳，只 import runXxxStep
│   └── steps/index.ts    # 'use step' — 主循环逻辑（编排子 workflow、收敛检测）
├── librarian/
│   ├── agent.ts
│   ├── workflow.ts       # 'use workflow' — 纯 VM-safe 薄壳
│   └── steps/index.ts    # 'use step' — HelixDB 检索、假设翻译为 Python
├── looker/
│   ├── agent.ts
│   ├── workflow.ts
│   └── steps/index.ts    # 'use step' — FITS 对齐、视频切片
├── explore/
│   ├── agent.ts
│   ├── workflow.ts
│   └── steps/index.ts    # 'use step' — bash-tool 跑 Python、F1 计算
├── oracle/
│   ├── agent.ts
│   ├── workflow.ts
│   └── steps/index.ts    # 'use step' — 批判、突变、反例 debug
├── prometheus/
│   ├── agent.ts
│   ├── workflow.ts
│   └── steps/index.ts    # 'use step' — 规划、MHD cfg 生成
└── index.ts              # 导出所有 agent + workflow 入口函数
```

**三文件边界**（方案 A：解决 VM sandbox 无 dynamic import callback 的限制）：

`@workflow/core` 的 VM sandbox 用裸 `runInContext`，无 `importModuleDynamically` callback —— workflow body（VM 内）任何 `await import()` 必抛 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`。因此「拉 Node 模块链的代码」只能出现在 step 里（step 在 host Node runtime 跑，`import()` 走 host ESM loader）。

- `agent.ts` — `createXxxAgent(...)` async 工厂（module scope），拉 tools/skills/config（Node 模块链）。**不能被 workflow.ts 静态 import**（会把 `node:*` 链拉进 VM bundle）
- `workflow.ts` — `'use workflow'` 指令，**纯 VM-safe 薄壳**：只静态 import `./steps/index.ts` 的 `runXxxStep`，函数体只有 `return await runXxxStep(input)`。不调 `getWritable`，不构造 agent，不 `await import()`
- `steps/index.ts` — `'use step'` 函数体内 `await import('../agent.ts')` + `createXxxAgent(...)` + `agent.stream({messages, writable: getWritable<ModelCallStreamPart>(), runtimeContext})` + `return result.output`。tool execute 也在此层

**关键约束**：
- workflow body（VM 内）**严禁 `await import()`**（抛 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`）—— 一切 Node 模块拉取必须在 step 函数体内
- workflow 模块图必须精简——重依赖（HelixDB client、SQLite、bash-tool）只在 step 函数内动态 import，不进 workflow bundle
- runtimeContext / toolsContext 必须可序列化（plain data），传 identifiers 在 step 内重建资源；`ModelArg`（plain object）是跨 workflow structured-clone 边界传 model 配置的载体，每个子 agent 在 step 内调 `createModelFromConfig(modelConfig)` 重建 `LanguageModel`
- bash-tool 的 working dir = `data/projects/<project_name>/workspace/<hypo_id>/`

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
- `needsApproval?: true | async fn` — 人机协同节点（仅 WorkflowAgent）

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
- `src/plan.ts` — `PlanSchema` + `MhdConfigSchema`（round, searchParams, mhdCfg, observationProposal）
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
  - `resolveModelArg(projectName, credentials, {role?, modelAlias?})` 读 settings → ModelConfig（含 credentialId）→ `credentials.get(credentialId)` → 从 credential 拿 provider/apiKey/baseURL → 组装 `ModelArg = {provider, model, baseURL?, apiKey, thinkingLevel}` plain object（跨 workflow 边界传 model 配置的载体）
  - `createModelFromConfig(modelConfig)` 在 step 内重建 `LanguageModel` 实例（step 在 host Node runtime 跑，可持有 SDK client）
  - **per-agent thinkingLevel**（借鉴 Pi）：`settings.models.oracle.thinkingLevel: 'high'`
  - **sessionId for provider caching**（借鉴 Pi）：runtimeContext 传 sessionId 复用 provider 端 prompt cache
- `src/constants.ts` — 默认值（MAX_ROUNDS=10, TARGET_F1=0.9, MAX_CONCURRENT_RUNS=4, ...）

**关键设计**：
- **模型配置不走 env**：API key / model 选择 / thinkingLevel 全存 SQLite（`credentials` + `settings` 表），通过 Web API 管理
- **Credential = endpoint bundle**：`{id, provider, apiKey, baseURL?}`，id 命名实体不按 provider 唯一，支持「同 provider 不同 endpoint」组合，upsert by id
- **ModelConfig 用 credentialId 引用**：`{model, thinkingLevel, credentialId}`，provider/baseURL/apiKey 全由 credentialId 引用的 Credential 条目决定
- **CredentialStore 串行 modify**（借鉴 Pi）：OAuth refresh 加锁防双刷，API key 加密存储
- **两层 settings merge**：global `data/settings.json` + per-project `data/projects/<name>/settings.json` override（deep merge），`getSettings(projectName?)` 返回合并结果
- env 只留 4 个基础设施变量（BASE_DIR / PORT / HELIX_URL / LOG_LEVEL）

**依赖**：`zod`, `@ai-sdk/openai`, `packages/storage`（读 credentials + settings）

---

## 4. Agent 架构

### 4.1 角色总表

| Agent | 职责 | Output Schema | 主要 Tools | Skills |
|---|---|---|---|---|
| **Sisyphus** | 编排器，Tournament Evolution 主循环 | `TournamentResultSchema` | `call_librarian`, `call_looker`, `call_explore`, `call_oracle`, `call_prometheus`, `review_leading_hypothesis`（needsApproval） | `tournament-protocol` |
| **Librarian** | RAG 知识检索 + 假设生成（翻译为 Python 物理过滤函数） | `HypothesisPoolSchema`（HypothesisSchema[]） | `helix-query`, `bash`（写 Python 文件） | `solar-physics-rag`, `hypothesis-to-python` |
| **Multimodal Looker** | 多模态数据对齐（FITS + MP4 时空索引） | `EvidenceAlignmentSchema` | `fits-align`, `helix-query` | `multimodal-align` |
| **Explore** | AlphaEvolve 确定性评估（跑 Python 在 1.75M 快照搜索，算 F1） | `EvalResultSchema`（F1 + 反例日志） | `bash`（python run.py / 读 stdout / 改代码 / 再跑） | `fits-snapshot-search` |
| **Oracle** | Co-Scientist 评估 + 锦标赛辩论（批判 + 突变 + 反例 debug） | `CritiqueSchema` + `MutationSchema` | `bash`（跑测试脚本）, `helix-query` | `critique-protocol` |
| **Prometheus** | 多轮规划（Scaling Test-time Compute）+ MHD cfg 生成 | `PlanSchema` + `MhdConfigSchema` | `mhd-config`, `bash`（写 .cfg） | `mhd-planning` |

### 4.2 Sisyphus 编排（Workflow Composition）

Sisyphus 是父 WorkflowAgent，通过两种方式调 5 个子 WorkflowAgent。**所有 workflow.ts 都是 VM-safe 薄壳**（见 §3.2 方案 A），下面的伪代码描述的是设计意图 —— 实际逻辑在各自 `steps/index.ts` 的 `runXxxStep` 里执行，workflow.ts 只负责 `return await runXxxStep(input)`。

**Direct await**（顺序，需结果）：
```ts
// sisyphus/workflow.ts （VM-safe 薄壳：return await runSisyphusStep(input)）
// 以下逻辑实际在 sisyphus/steps/index.ts 的 runSisyphusStep 内执行
'use workflow'
export async function tournamentWorkflow(input: TournamentInput) {
  // Round 1: Librarian 生成假设
  const hypotheses = await librarianWorkflow({seed: input.seed, projectId: input.projectId})

  // Round 2: Looker 加载对齐数据
  const alignment = await lookerWorkflow({projectId: input.projectId})

  while (round < MAX_ROUNDS && !converged) {
    // 并行评估多个假设
    const evals = await Promise.all(
      hypotheses.map(h => runExploreStep({hypoId: h.id, projectId: input.projectId}))
    )
    // Oracle 批判 + 突变
    const {critiques, mutations} = await oracleWorkflow({evals, hypotheses, projectId: input.projectId})

    // 人机协同节点（needsApproval 暂停 workflow）
    const review = await reviewLeadingHypoStep({leadingHypoId, critiques, projectId: input.projectId})
    // ↑ tool 带 needsApproval: true，用户审批后 resume

    // Prometheus 规划下一轮
    const plan = await prometheusWorkflow({evals, review, round, projectId: input.projectId})
    hypotheses = applyMutations(hypotheses, mutations, plan)
    round++
    if (bestF1 >= TARGET_F1) converged = true
  }

  return {winningHypothesis: hypotheses[0], mhdConfig, observationProposal}
}
```

**Background spawn**（并行 fan-out，独立 run ID）：
```ts
// 用于并行评估多个假设
'step'
async function runExploreStep({hypoId, projectId}) {
  const run = await start(exploreWorkflow, [{hypoId, projectId}])
  return await getRun(run.runId)  // 等完成
}
```

### 4.3 runtimeContext 流转

workflow 间通过 `runtimeContext` 传递数据（**必须可序列化**）：

```ts
RuntimeContextSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
  round: z.number(),
  hypotheses: z.array(HypothesisSchema),    // 当前假设池快照
  leadingHypoId: z.string().nullable(),     // 当前领先假设
  bestF1: z.number(),
  convergenceHistory: z.array(z.object({round, bestF1, count})),
  userFeedback: z.string().nullable(),      // 人机协同输入
})
```

**禁止放入 runtimeContext**：functions / class instances / symbols / WeakMap / SDK clients / DB handles。传 identifiers（projectId, runId, hypoId），在 step 函数内重建资源。

### 4.4 人机协同节点

**needsApproval（durable 审批）**
`review_leading_hypothesis` tool 带 `needsApproval: true`：
- WorkflowAgent 执行到此 tool 时暂停整个 workflow
- persist opaque resume state 到 SQLite
- API 返回 `tool-approval-request` 事件给前端
- 用户审查领先假设 + 反例，输入专家直觉
- API 收到 approval response → `createSession({sessionId, resumeFrom})` → `continueStream()` 恢复
- 用户几小时后回来也能续（durable）

**Steering & Follow-up（借鉴 Pi）**
Tournament 长循环中用户中途插话/追加任务，不等到 needsApproval 节点：
- **Steering**：用户在 tool 执行中插入消息，当前 turn 结束后注入到 agent context
- **Follow-up**：agent 本要停止时，队列注入消息让它继续
- AI SDK WorkflowAgent 无原生支持，我们在 API 层实现 message queue + turn boundary 检测：
  - `POST /runs/:runId/steer` — 注入 steering 消息
  - message queue 持久化到 SQLite，workflow 下一个 step 边界检查并注入
  - `steeringMode: 'one-at-a-time' | 'all'`（settings 可配）

---

## 5. 数据模型

### 5.1 SQLite 表（Drizzle schema）

**全局数据库** `data/global.sqlite`：

```ts
// storage/src/schema.ts (global)
credentials: { id, provider, type, encryptedKey, baseUrl, metadata_json, createdAt, updatedAt }
// id 命名实体（用户指定或 auto `${provider}-${ts}`），不按 provider 唯一，支持「同 provider 不同 baseURL+apiKey」组合，upsert by id
// type: 'api-key' | 'oauth-token'；encryptedKey 加密存储；baseUrl 可选（同 provider 不同 endpoint）；CredentialStore 串行 modify

settings: { scope, name, value_json, updatedAt }
// scope: 'global' | 'project:<name>'；name: 'models' | 'tournament' | 'steering' 等

mcp_trust: { id, projectName, serverName, fingerprint, trusted, firstSeen, lastChecked }
// MCP server 工具漂移检测 baseline

mcp_tool_baselines: { id, trustId, toolName, digest, recordedAt }
// 每个 tool 的 fingerprint baseline
```

**per-project 数据库** `data/projects/<name>/db.sqlite`：

```ts
// storage/src/schema.ts (project)
projects: { id, name, createdAt, config_json }  // config: mcp/skills/prompts 路径

runs: { id, projectId, status, startedAt, endedAt, resumeState_blob, currentRound, bestF1 }

messages: { id, runId, role, parts_json, createdAt }  // UIMessage[] source of truth

steering_messages: { id, runId, content, mode, injectedAt, status }
// mode: 'steering' | 'follow-up'；status: 'pending' | 'injected' | 'skipped'

hypotheses: { id, projectId, runId, parentId, round, statement, pythonCode, f1, status, createdAt }
// status: 'candidate' | 'evaluated' | 'critiqued' | 'mutated' | 'winner' | 'eliminated'

evidence: { id, hypoId, fitsPaths_json, videoClipPath, metadata_json, createdAt }

critiques: { id, hypoId, critiqueText, rationale, round, createdAt }

mutations: { id, parentHypoId, childHypoId, mutationRationale, round, createdAt }

plans: { id, runId, round, searchParams_json, mhdCfgPath, observationProposal, createdAt }

logs: { id, runId, level, message_json, timestamp }
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
  │    ├─ [人机协同] review_leading_hypothesis (needsApproval)
  │    │    └─ User 审查 + 输入专家直觉
  │    ├─ Prometheus → 调整搜索参数 + 下一轮规划
  │    └─ 收敛检测（F1 ≥ TARGET_F1 或 round ≥ MAX_ROUNDS）
  └─ Prometheus → MHD cfg + 卫星观测建议书
```

### 6.2 终止条件

- `bestF1 >= TARGET_F1`（默认 0.9）
- `round >= MAX_ROUNDS`（默认 10）
- 收敛检测：连续 N 轮 bestF1 提升小于阈值
- 用户手动终止（API 端点）

### 6.3 每轮快照

每轮结束写 `rounds/<n>/snapshot.json`（假设池 + 分数 + 批判摘要），用于前端谱系树可视化 + 审计。

---

## 7. API 层

### 7.1 REST 端点

| Method | Path | 功能 |
|---|---|---|
| POST | `/projects` | 创建 project（name, config） |
| GET | `/projects` | 列出 projects |
| GET | `/projects/:name` | 获取 project 详情 |
| DELETE | `/projects/:name` | 删除 project |
| PUT | `/projects/:name/config` | 更新 project 配置（mcp/skills/prompts） |
| POST | `/projects/:name/runs` | 启动 Tournament run（seed hypothesis） |
| GET | `/projects/:name/runs` | 列出 runs |
| GET | `/projects/:name/runs/:runId` | 获取 run 状态 |
| GET | `/projects/:name/runs/:runId/stream` | SSE 流（workflow 事件 + tool-approval-request） |
| POST | `/projects/:name/runs/:runId/approve` | 提交人机协同审批（approval response） |
| POST | `/projects/:name/runs/:runId/steer` | **注入 steering/follow-up 消息**（借鉴 Pi） |
| POST | `/projects/:name/runs/:runId/stop` | 终止 run |
| GET | `/projects/:name/runs/:runId/hypotheses` | 列出假设池 |
| GET | `/projects/:name/hypotheses/:hypoId` | 获取假设详情 |
| GET | `/projects/:name/hypotheses/:hypoId/evidence` | 获取证据（FITS/视频路径） |
| GET | `/projects/:name/runs/:runId/rounds/:n` | 获取某轮快照 |
| GET | `/projects/:name/runs/:runId/mhd` | 下载 MHD cfg |
| GET | `/settings` | 获取 global settings |
| PUT | `/settings` | 更新 global settings（models / tournament / steering） |
| GET | `/projects/:name/settings` | 获取 project settings（merge global） |
| PUT | `/projects/:name/settings` | 更新 project settings（override global） |
| GET | `/credentials` | 列出已配置的 provider credentials（不返回 key） |
| POST | `/credentials` | 添加 provider credential（api-key / oauth） |
| DELETE | `/credentials/:id` | 删除 credential |
| POST | `/credentials/:id/refresh` | 手动触发 OAuth refresh |
| PUT | `/projects/:name/mcp/config` | 更新 MCP server 配置 |
| GET | `/projects/:name/mcp/trust` | 列出 MCP server trust 状态 |
| POST | `/projects/:name/mcp/trust` | 信任/拒绝 MCP server（首次连接 review） |
| PUT | `/projects/:name/skills` | 上传/更新 project 级 skills |
| GET | `/health` | 健康检查 |

### 7.2 SSE 流

`GET /runs/:runId/stream` 返回 SSE：
- workflow step 事件（start/step-start/tool-execution-start/tool-execution-end/step-end/end）
- `tool-approval-request` 事件（人机协同 needsApproval 节点）
- `steering-injected` 事件（steering 消息注入成功通知）
- 错误事件
- 断线重连：`WorkflowChatTransport` 处理，POST 返回 `x-workflow-run-id` header，GET `/{runId}/stream` 端点续传

### 7.3 并发控制

- `MAX_CONCURRENT_RUNS`（global settings，默认 4）限制全局并发 run 数
- 单 project 内多 run 并发：SQLite WAL 支持
- Hono + Node.js 单进程多请求并发（event loop）
- **CredentialStore 串行 modify**：OAuth refresh 加锁，防止并发请求触发双刷 token

---

## 8. 配置层

### 8.1 环境变量（极简，仅基础设施）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BASE_DIR` | `./data` | 数据根目录 |
| `PORT` | `3000` | API server 端口 |
| `HELIX_URL` | — | HelixDB 地址（基础设施） |
| `LOG_LEVEL` | `info` | 日志级别 |

**模型相关配置（API key / model / thinkingLevel）全走 Web API + SQLite，不用 `.env`。**

### 8.2 global settings（`data/settings.json` + SQLite `settings` 表）

通过 `PUT /settings` 管理：
```json
{
  "models": {
    "default": {"model": "gpt-4o", "thinkingLevel": "medium", "credentialId": "openai-prod"},
    "sisyphus": {"model": "gpt-4o", "thinkingLevel": "medium", "credentialId": "openai-prod"},
    "oracle": {"model": "o3", "thinkingLevel": "high", "credentialId": "openai-prod"},
    "explore": {"model": "gpt-4o", "thinkingLevel": "low", "credentialId": "openai-prod"},
    "librarian": {"model": "gpt-4o", "thinkingLevel": "medium", "credentialId": "openai-prod"},
    "looker": {"model": "gpt-4o", "thinkingLevel": "medium", "credentialId": "openai-prod"},
    "prometheus": {"model": "o3", "thinkingLevel": "high", "credentialId": "openai-prod"}
  },
  "modelAliases": {
    "fast": {"model": "gpt-4o-mini", "thinkingLevel": "low", "credentialId": "openai-prod"},
    "smart": {"model": "o3", "thinkingLevel": "high", "credentialId": "openai-prod"}
  },
  "tournament": {"maxRounds": 10, "targetF1": 0.9, "convergenceWindow": 3},
  "concurrency": {"maxConcurrentRuns": 4},
  "steering": {"mode": "one-at-a-time"}
}
```

`ModelConfig = {model, thinkingLevel, credentialId}`：provider/baseURL/apiKey 全由 `credentialId` 引用的 Credential 条目决定（见 §8.4），不在 ModelConfig 里重复。`modelAliases` 用同形态，供 `resolveModelArg({modelAlias?})` 解析。

### 8.3 project settings（`data/projects/<name>/settings.json` + SQLite）

通过 `PUT /projects/:name/settings` 管理，override global：
```json
{
  "models": {
    "oracle": {"model": "claude-sonnet-4-6", "thinkingLevel": "high", "credentialId": "anthropic-prod"}
  },
  "mcp": {
    "servers": [
      {"name": "helix", "transport": "http", "url": "http://localhost:6969"},
      {"name": "filesystem", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"]}
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

一个 Credential = 一个完整 endpoint bundle `{id, provider, apiKey, baseURL?}`：支持「同 provider 不同 baseURL+apiKey」组合，**id 命名实体（用户指定或 auto `${provider}-${ts}`），不再按 provider 唯一**，upsert by id（后加覆盖先加）。

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

**模型配置形态**：`ModelConfig = {model, thinkingLevel, credentialId}`（移除 provider+baseURL —— provider/baseURL/apiKey 全部由 credentialId 引用的 Credential 条目决定）。`settings.models.<role>` 和 `settings.modelAliases.<alias>` 都用此形态。

`packages/config/src/models.ts` 的 `resolveModelArg(projectName, credentials, {role?, modelAlias?})` 流程：
1. 读 settings（merge global + project override 两层）
2. 取 `models[role]` 或 `modelAliases[alias]` 的 `ModelConfig`（含 `credentialId`）
3. `credentials.get(credentialId)` 读 Credential 条目，从 credential 拿 provider/apiKey/baseURL
4. 组装并返回 **`ModelArg`** = `{provider, model, baseURL?, apiKey, thinkingLevel}` —— **plain object**，可跨 workflow structured-clone 边界传递（不能放 SDK `LanguageModel` 实例）
5. 附带 `sessionId`（runtimeContext 传入）用于 provider 端 prompt cache 复用

**重建时机**：`ModelArg` 随 runtimeContext 传入 workflow，每个子 agent 在 step 函数内调 `createModelFromConfig(modelConfig)` 重建 `LanguageModel` 实例（step 在 host Node runtime 跑，可持有 SDK client）。

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
14. `apps/api` — Hono routes + Nitro + SSE + 人机协同审批 + steering + 配置管理端点

### Phase 5: 集成测试
15. 端到端跑通 Tournament Evolution（seed → MHD cfg）
16. 人机协同节点测试（approve / 几小时后 resume）

---

## 11. 约束与注意事项

### Workflow DevKit 约束
- 三文件边界必须分离（agent.ts / workflow.ts / steps/index.ts），见 §3.2 方案 A
- **workflow body（VM 内）严禁 `await import()`**：`@workflow/core` VM sandbox 无 `importModuleDynamically` callback，必抛 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`。一切 Node 模块拉取必须在 step 函数体内（step 在 host Node runtime 跑）
- workflow.ts 必须是纯 VM-safe 薄壳：只 import `./steps/index.ts` 的 `runXxxStep` + `return await runXxxStep(input)`，不调 `getWritable`，不构造 agent
- workflow 模块图必须精简，重依赖在 step 内动态 import
- runtimeContext / toolsContext 必须可序列化（plain data），`ModelArg` 是跨边界传 model 配置的载体（step 内才 `createModelFromConfig` 重建）
- Nitro 作为 build system（`nitro.config.ts` 配 `workflow/nitro` module）
- tsconfig 加 workflow TS plugin

### workflow/nitro + pnpm workspace + Node type stripping 约束
- workflow/nitro 的 step bundle（esbuild via `@workflow/builders`）在 dev 模式把 workspace 包 externalize，runtime 用 bare specifier `@open-scientist/config` → `package.json exports ./src/index.ts` → Node 26 type stripping 加载（默认开启，无需 flag）
- **源码内部相对 import 用 `.ts` 后缀**（不是 `.js`）：Node type stripping 不做 `.js`→`.ts` fallback，加 `.js` 会 `ERR_MODULE_NOT_FOUND`
- `tsconfig.base.json` 开 `allowImportingTsExtensions: true` + `rewriteRelativeImportExtensions: true`
- **`apps/api/nitro.config.ts` 的 `noExternals` 需列全 8 个 workspace 包**（agents/logger/tools/skills/helix/config/schema/mcp），否则 nitro dev bundle 无法 resolve

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
