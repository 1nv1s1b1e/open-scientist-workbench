# AGENTS.md

Open-scientist：太阳物理多智能体假设生成与证据推理系统（赛道一方向二 B 日冕加热之谜）。基于 Co-Scientist (Nature 2026) + AlphaEvolve。完整 spec 见 `SPEC.md`，web spec 见 `docs/web/`。

## 常用命令

```bash
vp lint           # oxlint（lint）
vp fmt --write    # oxfmt（format）
vp check          # format + lint + typecheck 一条命令
vp run -r typecheck  # 全 11 包 tsc --noEmit
vp test run       # vitest run（测试文件 *.test.ts）
vp dev            # 启动 apps/api（tsx watch src/server.ts）
vp run --filter @open-scientist/storage db:generate    # drizzle-kit generate（storage 包）
vp run --filter @open-scientist/storage db:migrate     # drizzle-kit migrate（storage 包）
```

- 单包操作：`vp run --filter @open-scientist/agents typecheck`
- web 单独验证：`cd apps/web && npx tsc --noEmit`
- web dev server：`cd apps/web && npx next dev -p 5173`
- 加依赖：在对应 package.json 加 + `vp install`（pnpm workspaces，node-linker=hoisted）
- 测试框架：Vitest（vite-plus 内置），测试文件放 `*.test.ts`，import 从 `vite-plus/test`
- commit message 和 PR 描述用英文
- 文档描述现状，不写变更过程（PROGRESS.md 除外）

## 技术栈

Node.js + pnpm + TypeScript 6 + Vite+（Oxlint + Oxfmt + Vitest）+ Zod 4 + Hono + `@hono/node-server` + AI SDK 7（`ai`，含 `ToolLoopAgent`）+ Drizzle ORM（双 SQLite）+ HelixDB（本地 graph+vector）+ `bash-tool` + `@ai-sdk/mcp`。

- **Runtime**：Node.js（包管理用 pnpm）
- **Lint/Format**：Vite+（Oxlint + Oxfmt，单工具链，无 ESLint/Prettier/Biome）。`vite.config.ts` 配 lint/fmt/test/staged block
- **Schema**：Zod 4（AI SDK `tool().inputSchema` / `Output.object({schema})` 必选）
- **Agent**：全 6 角色用 `ToolLoopAgent`（`ai` 包直接导出）。每 role 两文件：`agent.ts`（构造工厂）+ `workflow.ts`（plain async 编排函数，无 `'use workflow'`）
- **Build**：`@hono/node-server` 生产 server（`apps/api/src/server.ts`）；dev 用 `tsx watch` 热重载；无 build-time bundle

## Monorepo 结构（11 包）

```
apps/api        — Hono + @hono/node-server REST 入口（8 routes：health/settings/credentials/projects/test-llm/runs/dev-probe，settings 下含 model-aliases 子路由）
apps/web        — Next.js 16 + React 19 + assistant-ui 前端（Tailwind v4 + xAI 风格）
packages/
  agents        — 6 ToolLoopAgent（sisyphus/librarian/looker/explore/oracle/prometheus）
  tools         — bash/helix-query/fits-align/mhd-config/load-skill
  skills        — discover + prompt + load-tool（agentskills.io 开放格式）
  mcp           — MCP server registry + trust + 漂移检测
  storage       — 双 SQLite（global + per-project）+ Drizzle + 8 repo
  helix         — HelixDB client + queries DSL
  schema        — Zod schemas（零业务依赖）+ Credential/CredentialRecord/CredentialStore 接口（避免 config→storage 循环依赖）
  config        — paths + settings 两层 merge + models（ModelArg + createModelFromConfig）
  logger        — consola wrapper + 11 个预定义 tag
```

依赖方向：`schema`（零依赖）← 所有包；`logger` ← 所有包；`config` 只依赖 `schema`（Credential/CredentialRecord/CredentialStore 接口在 schema，config 从 schema import）；`agents → {tools, skills, mcp, helix, config, schema, logger}`；`apps/web → {schema}`。

## Agent 文件结构（ToolLoopAgent）

每个 agent 在 `packages/agents/src/<role>/` 下两文件：

- `agent.ts` — `createXxxAgent(...)` async 工厂：拉 tools/skills/config（Node 模块链），`new ToolLoopAgent({id, model, instructions, tools, output: Output.object({schema}), stopWhen: isStepCount(N), runtimeContext?})`。deps 接口含 `modelConfig: ModelArg` + `runtimeContext?: Record<string, unknown>`，构造时传 runtimeContext（ToolLoopAgent.stream 不接受 runtimeContext 调用选项）。
- `workflow.ts` — **plain async 函数**（无 `'use workflow'`）：静态 import `./agent.ts`，`const result = await agent.stream({messages})`，调 `streamAgentOutput(result.fullStream, agent.tools, input.emitChunk)` 把 fullStream 转 UIMessageChunk 推给 SSE，`return result.output`。input 接口含 `emitChunk?: EmitChunk`。

部分 role 还有：

- `logic.ts` — 纯函数（sisyphus/oracle/prometheus）
- `snapshot.ts` — `snapshotStep` + `RoundSnapshot`（sisyphus 独有）

**`shared/stream.ts`**：`streamAgentOutput<TOOLS>(fullStream, tools, emitChunk)` 用 `toUIMessageStream({stream, tools})` 把 ToolLoopAgent 的 `result.fullStream`（`AsyncIterableStream<TextStreamPart<TOOLS>>`）转成 `ReadableStream<UIMessageChunk>`，逐 chunk 调 `emitChunk(chunk)`。`EmitChunk = (chunk: UIMessageChunk) => void`。

**`shared/convergence.ts`**：`ConvergenceEntry` 接口（`{round, bestF1, count}`），被 sisyphus/logic.ts + prometheus/workflow.ts 共享。

**`shared/tool-output.ts`**：`extractSubmitResult(staticToolCalls, toolName?, fallback?)` — 从 ToolLoopAgent 的 staticToolCalls 提取 submit_result tool 的输入。第三个参数 `fallback?: T`：有 fallback 时未找到 submit_result 返回 fallback（不 throw），无 fallback 时 throw。所有 5 个 workflow 都传 fallback，确保 agent 达到 step limit 未提交结果时不崩溃。

**context 传递**：`ModelArg`（plain object `{provider, model, baseURL?, apiKey, thinkingLevel}`）是跨调用边界的 model 配置载体。workflow 函数内调 `createModelFromConfig(modelConfig)` 重建 `LanguageModel`。`runtimeContext` 也是 plain object（`{projectId, runId, round?, hypoId?}`），在构造 ToolLoopAgent 时传入。

**ToolLoopAgent.stream 关键点**：返回 `Promise<StreamTextResult>`（**必须 await**，WorkflowAgent.stream 是同步的）。`result.fullStream: AsyncIterableStream<TextStreamPart<TOOLS>>`（是 `AsyncIterable<T> & ReadableStream<T>`，可直接喂给 `toUIMessageStream`）。`result.output: Promise<OUTPUT>`。

**Sisyphus agent 特殊**：`createSisyphusAgent` 构造的 agent **未被 tournamentWorkflow 调用**——tournamentWorkflow 是纯确定性控制流，直接 await 5 个子 workflow。Sisyphus agent 留给 Phase 4 API 层用于 free-form steering + approval（通过 `toolApproval` + `prepareCall`）。

## AI SDK 7 API 关键点（易错）

- `stopWhen: isStepCount(N)`（从 `ai` 导入，别名 `stepCountIs`），**不是** `{ type: 'stepCount', count: N }`
- `tools: ToolSet`（从 `ai` 导入），**不是** `Record<string, unknown>`
- `output: Output.object({ schema: ZodSchema })`（从 `ai` 导入 `Output`），**不是** 裸 Zod schema
- `tool({ description, inputSchema: z.object(), outputSchema?, execute, needsApproval? })` — AI SDK 7 把 tool-level `needsApproval` **deprecated**，推荐 `ToolLoopAgent` 构造时或 `prepareCall` 返回值里的 `toolApproval`（`ToolApprovalConfiguration`：per-tool map 或 `GenericToolApprovalFunction`）。返回 `'user-approval'` → stream 暂停并 emit `tool-approval-request` chunk。
- `createMCPClient(config): Promise<MCPClient>` — async，需 await；`client.tools(): Promise<McpToolSet>` 也 async
- `fingerprintTools(tools: ToolSet): Promise<Record<string,string>>` — async，需 await
- `detectToolDrift(current, baseline): {added: string[], removed: string[], changed: string[]}` — 同步
- `createBashTool(options?): Promise<BashToolkit>` — async，options 用 `destination`（非 `cwd`）作 working dir
- `MCPTransportConfig`（`@ai-sdk/mcp`）只有 'http'|'sse'；stdio 需用 `StdioClientTransport`（`@modelcontextprotocol/sdk/client/stdio.js`）构造 `MCPTransport` 对象传入
- TS2883 "inferred type cannot be named" → package.json 加 `@ai-sdk/provider-utils` + `@ai-sdk/provider` 依赖

## @hono/node-server + tsx + Node type stripping

- **dev**：`tsx watch src/server.ts`（tsx 用 esbuild 做 on-the-fly type stripping + watch）
- **生产**：`tsc` 出 `dist/`，`node dist/server.js` 启动（或 `tsup` 打包单文件，当前用 tsc）
- **源码内部相对 import 用 `.ts` 后缀**（不是 `.js`）——`tsx` + Node type stripping **不做 `.js`→`.ts` fallback**
- **`tsconfig.base.json`** 开 `allowImportingTsExtensions: true` + `rewriteRelativeImportExtensions: true`
- **package.json exports 指向 `./src/index.ts`**——workspace 包间 import 走 Node type stripping 加载
- 无 build-time bundle，无 VM sandbox，无 externalize 配置——比原来 workflow/nitro + esbuild 大幅简化

## 配置层

- **env 极简**（`.env.example`）：`BASE_DIR` / `PORT` / `HELIX_URL` / `LOG_LEVEL`。模型配置走 Web API + SQLite
- **Credential = Endpoint bundle**：一个 credential = 一个完整 endpoint `{id, provider, apiKey, baseURL?}`。`id` 命名实体（用户指定或 auto `${provider}-${ts}`），**按 id 唯一**（非按 provider），支持「同 provider 不同 baseURL+apiKey」组合。upsert by id（后加覆盖先加）。SQLite 加密（`data/global.sqlite`），串行 modifyLock 防 OAuth 双刷。
- **ModelConfig 用 credentialId 引用**：`ModelConfig = {model, thinkingLevel, credentialId}`。provider/baseURL/apiKey 全部由 credentialId 引用的 Credential 条目决定。`settings.models.<role>` 和 `settings.modelAliases.<alias>` 都用此形态。
- **ModelArg 跨边界载体**：`ModelArg = {provider, model, baseURL?, apiKey, thinkingLevel}` 是 plain object。`resolveModelArg(projectName, credentials, {role?, modelAlias?})` 读 settings → ModelConfig（含 credentialId）→ `credentials.get(credentialId)` → 从 credential 拿 provider/apiKey/baseURL → 组装 `ModelArg`。workflow 函数内调 `createModelFromConfig(modelConfig)` 重建 `LanguageModel`。
- **两层 settings**：global `data/settings.json` + per-project `data/projects/<name>/settings.json` override（deep merge）。`getSettings(projectName?)` 自动 merge 两层。

## 数据层

双 SQLite：

- `data/global.sqlite` — credentials / settings / mcp_trust / mcp_tool_baselines
- `data/projects/<name>/db.sqlite` — projects / runs / messages / steering_messages / hypotheses / evidence / critiques / mutations / plans / logs

FS 产物在 `data/projects/<name>/` 下：runs/ / rounds/ / hypotheses/ / evidence/ / mhd/ / workspace/ / skills/ / mcp/ / prompts/ / logs/。

## 6 Agent 角色

| 角色              | 职责                                                   | Output Schema       |
| ----------------- | ------------------------------------------------------ | ------------------- |
| Sisyphus          | 编排器，tournamentWorkflow 纯确定性控制流调 5 子 agent | TournamentResult    |
| Librarian         | RAG 检索（HelixDB）+ 初始假设生成                      | HypothesisPool      |
| Multimodal Looker | FITS 图像 + MP4 视频对齐                               | EvidenceAlignment   |
| Explore           | bash-tool 跑 Python 在 1.75M 快照搜索，算 F1           | EvalResult          |
| Oracle            | Co-Scientist 批判 + 突变 + 反例 debug                  | Critique + Mutation |
| Prometheus        | 多轮规划，末轮输出 MHD .cfg + 观测建议书               | Plan + MhdConfig    |

编排：`tournamentWorkflow` 是 plain async 函数，直接 await 5 个子 workflow——顺序用 `await xxxWorkflow(input)`（共享 run ID），并行 Explore 用 `Promise.all(hypotheses.map(h => exploreWorkflow(input)))`。SSE 流通过 `emitChunk` 回调从子 workflow 逐层冒泡到 `RunRegistry`（`apps/api/src/lib/run-stream.ts`）。`run.result` 完成后调 `completeRun` 更新 SQLite status（`completed`/`failed`）+ bestF1 + currentRound。

## Tournament Evolution 工作流

Round 1: Librarian 生成 → Loop(Explore 并行评估 → Oracle 批判突变 → Prometheus 规划 → 收敛检测) → 最终 Prometheus 输出 MHD cfg + 观测建议书。

终止条件：`TARGET_F1` / `MAX_ROUNDS` / 收敛检测 / 手动。每轮快照写 FS（`snapshotStep` → `data/projects/<projectId>/rounds/<round>/snapshot.json`，可用于 crash 后 resume）。`MAX_ROUNDS=10` / `TARGET_F1=0.9` 内联在 `sisyphus/logic.ts`。

> Looker 在当前 tournamentWorkflow 中**未被调用**（代码就绪但未编排进 round 循环，Phase 5 待补）。

## Step Limits + Fallback

| Agent      | Step Limit | 说明                            |
| ---------- | ---------- | ------------------------------- |
| Librarian  | 50         | 2 假设生成 + HelixDB 检索       |
| Explore    | 120        | eval 迭代调参（含 bash tool）   |
| Oracle     | 60         | 五维评审 + 突变                 |
| Prometheus | 60         | 多轮规划 + MHD cfg + 观测建议书 |
| Sisyphus   | 120        | 预留 free-form steering         |
| Looker     | 50         | FITS/MP4 对齐                   |

终止条件：`stopWhen: [isStepCount(N), hasToolCall('submit_result')]`（任一满足即停）。所有 5 个 workflow 传 fallback 给 `extractSubmitResult`，达到 step limit 未提交结果时返回 fallback 而非 throw。

## MHD 配置 + 观测建议书

Prometheus 末轮调 `mhdConfigTool` 时传入 `observationProposal` markdown 作为输入参数。Tool 写两个文件：

- `<runId>.cfg` — MHD 仿真配置（12+ 物理参数）
- `<runId>_proposal.md` — 卫星观测建议书

返回 `{runId, cfgPath, proposalPath, summary}`。`proposalPath` 而非 `observationProposal` 字符串，避免 submit_result JSON 过大导致 parse 失败。

## 安全约束

- `bash-tool` 无沙箱（host child_process），靠 project name 隔离 working dir
- MCP server 是远程代码执行，per-project 加载需信任（`mcp_trust` 表 + `fingerprintTools` 漂移检测）
- env 不进 git（`.gitignore` 配 `.env`）
- HelixDB strict mode

## 不要做

- 不要用 ESLint/Prettier/Biome（用 Vite+ 的 Oxlint + Oxfmt）
- 不要用 .env 存模型配置（走 Web API + SQLite）
- 不要给 Explore 的 Python 加 Docker 沙箱（用户明确决定：host child_process + project name 隔离）
- 不要用 `WorkflowAgent` / `@ai-sdk/workflow` / `workflow` 包（用 `ToolLoopAgent`，从 `ai` 导入）
- 不要给源码内部 import 加 `.js` 后缀（用 `.ts`，tsx + Node type stripping 不 fallback）
- 不要在 `tsconfig.json` 的 `compilerOptions` 里放 `extends`（放顶层）
- 不要把非序列化对象放进 `runtimeContext`（保持 plain data 习惯）
