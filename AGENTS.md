# AGENTS.md

Open-scientist：太阳物理多智能体假设生成与证据推理系统（赛道一方向二 B 日冕加热之谜）。基于 Co-Scientist (Nature 2026) + AlphaEvolve。完整 spec 见 `SPEC.md`，web spec 见 `docs/web/`。

## 常用命令

```bash
pnpm lint           # biome check .（lint + format）
pnpm format         # biome format --write .
pnpm typecheck      # 全 11 包 tsc --noEmit
pnpm test           # vitest run（测试文件 *.test.ts）
pnpm lint -- --write     # biome auto-fix
pnpm dev            # 启动 apps/api（nitro dev）
pnpm db:generate    # drizzle-kit generate（storage 包）
pnpm db:migrate     # drizzle-kit migrate（storage 包）
```

- 单包操作：`pnpm --filter @open-scientist/agents typecheck`
- web 单独验证：`cd apps/web && npx tsc --noEmit && npx biome check .`（web 用 TS 6.0.3，其余包 TS 7.0.2）
- web dev server：`cd apps/web && npx next dev -p 5173`
- 加依赖：在对应 package.json 加 + `pnpm install`（pnpm workspaces，node-linker=hoisted）
- 测试框架：`vitest`，测试文件放 `*.test.ts`

## 技术栈

Node.js + pnpm + TypeScript 7 + Biome 2.5 + Zod 4 + Hono + Nitro（workflow/nitro module）+ AI SDK 7（`ai` + `@ai-sdk/workflow` + `workflow` DevKit）+ Drizzle ORM（双 SQLite）+ HelixDB（本地 graph+vector）+ `bash-tool` + `@ai-sdk/mcp`。

- **Runtime**：Node.js（包管理用 pnpm，不用 Bun）
- **Lint/Format**：Biome（单工具，无 ESLint/Prettier）。`biome.json` 已配 2.5.4 preset
- **Schema**：Zod 4（AI SDK `tool().inputSchema` / `Output.object({schema})` 必选）
- **Agent**：全 6 角色用 `WorkflowAgent`（`@ai-sdk/workflow`，durable 版 ToolLoopAgent）。三文件边界：`agent.ts`（构造）/ `workflow.ts`（`'use workflow'`）/ `steps/`（`'use step'` 可重试）
- **Build**：Nitro（`apps/api/nitro.config.ts` 配 `modules: ['workflow/nitro']`），非 Hono 自带 build

## Monorepo 结构（11 包）

```
apps/api        — Hono + Nitro REST 入口（8 routes：health/settings/credentials/projects/test-llm/runs/dev-probe，settings 下含 model-aliases 子路由）
apps/web        — Next.js 16 + React 19 + assistant-ui 前端（Tailwind v4 + xAI 风格）
packages/
  agents        — 6 WorkflowAgent（sisyphus/librarian/looker/explore/oracle/prometheus）
  tools         — bash/helix-query/fits-align/mhd-config/load-skill
  skills        — discover + prompt + load-tool（agentskills.io 开放格式）
  mcp           — MCP server registry + trust + 漂移检测
  storage       — 双 SQLite（global + per-project）+ Drizzle + 8 repo
  helix         — HelixDB client + queries DSL
  schema        — Zod schemas（零业务依赖）+ Credential/CredentialRecord/CredentialStore 接口（避免 config→storage 循环依赖）
  config        — paths + settings 两层 merge + models（ModelArg + createModelFromConfig）
  logger        — consola wrapper + 11 个预定义 tag
```

依赖方向：`schema`（零依赖）← 所有包；`logger` ← 所有包；`config` 不再依赖 `storage`（Credential/CredentialRecord/CredentialStore 接口移到 schema，config 从 schema import）；`agents → {tools, skills, mcp, helix, config, schema, logger}`；`apps/web → {schema}`。

## WorkflowAgent 三文件边界（关键约束）

每个 agent 在 `packages/agents/src/<role>/` 下：
- `agent.ts` — `createXxxAgent(...)` async 工厂（module scope），拉 tools/skills/config（Node 模块链）。**不能被 workflow.ts 静态 import**（会把 node:* 链拉进 VM bundle）。
- `workflow.ts` — `'use workflow'` 指令，**纯 VM-safe 薄壳**：只静态 import `./steps/index.ts` 的 `runXxxStep` + return `await runXxxStep(input)`。不调 `getWritable`，不构造 agent。
- `steps/index.ts` — `'use step'` 函数体内 `await import('../agent.ts')` + `createXxxAgent(...)` + `agent.stream({messages, writable: getWritable<ModelCallStreamPart>(), runtimeContext})` + `return result.output`。step 在 host Node runtime 跑（不在 VM），`import()` 走 host ESM loader。

**为什么这样分**：`@workflow/core` VM sandbox 用裸 `runInContext`，无 `importModuleDynamically` callback → workflow body（VM 内）任何 `await import()` 必抛 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`。但 `'use step'` 函数在 host Node runtime 执行，`import()` 正常。所以「拉 Node 模块的代码」只能出现在 step 里，不能出现在 workflow body 里。

**context 必须可序列化**：`runtimeContext` / `toolsContext` / workflow args 不能放 functions/class instances/symbols/SDK clients，只能 plain data（strings/numbers/bools/arrays/plain objects/dates/URLs/maps/sets）。`ModelArg`（plain object）是跨 workflow 边界传 model 配置的载体，每个子 agent 在 step 内调 `createModelFromConfig(modelConfig)` 重建 `LanguageModel`。

**getWritable 有两个版本**：从 `workflow` 包导入的是 **step 版**（`@workflow/core/dist/step/writable-stream.js`，用 `contextStorage` 存真实 globalThis），在 step 函数内可用。VM body 版（`@workflow/core/dist/workflow/writable-stream.js`）用 VM 注入的 globalThis，但我们不用（workflow body 不调 getWritable）。

## AI SDK 7 API 关键点（易错）

- `stopWhen: isStepCount(N)`（从 `ai` 导入，别名 `stepCountIs`），**不是** `{ type: 'stepCount', count: N }`
- `tools: ToolSet`（从 `ai` 导入），**不是** `Record<string, unknown>`
- `output: Output.object({ schema: ZodSchema })`（从 `ai` 导入 `Output`），**不是** 裸 Zod schema
- `tool({ description, inputSchema: z.object(), outputSchema?, execute, needsApproval? })` — `needsApproval: true | async fn` 是 tool 一等属性（durable 审批，跨 session resume）
- `createMCPClient(config): Promise<MCPClient>` — async，需 await；`client.tools(): Promise<McpToolSet>` 也 async
- `fingerprintTools(tools: ToolSet): Promise<Record<string,string>>` — async，需 await
- `detectToolDrift(current, baseline): {added: string[], removed: string[], changed: string[]}` — 同步
- `createBashTool(options?): Promise<BashToolkit>` — async，options 用 `destination`（非 `cwd`）作 working dir
- `MCPTransportConfig`（`@ai-sdk/mcp`）只有 'http'|'sse'；stdio 需用 `StdioClientTransport`（`@modelcontextprotocol/sdk/client/stdio.js`）构造 `MCPTransport` 对象传入
- TS2883 "inferred type cannot be named" → package.json 加 `@ai-sdk/provider-utils` + `@ai-sdk/provider` 依赖

## workflow/nitro + pnpm workspace 陷阱（关键）

workflow/nitro 的 step bundle（esbuild via `@workflow/builders`）在 dev 模式会把 **workspace 包 externalize**（因 `isProjectLocalFile` 对 `isWorkspacePackage=true` 的包返回 false）。externalize 后 runtime 用 bare specifier `@open-scientist/config` → package.json exports `./src/index.ts` → Node type stripping 加载。

**解法**（已落地）：
1. **Node 26 type stripping 默认开启**（无需 flag），`package.json exports` 指向 `./src/index.ts` 可直接加载。
2. **源码内部相对 import 用 `.ts` 后缀**（不是 `.js`）——Node type stripping **不做 `.js`→`.ts` fallback**。
3. **tsconfig.base.json** 开 `allowImportingTsExtensions: true` + `rewriteRelativeImportExtensions: true`。
4. **`apps/api/nitro.config.ts` 的 `noExternals`** 需列全 8 个 workspace 包（agents/logger/tools/skills/helix/config/schema/mcp），否则 nitro dev bundle 无法 resolve。

**不要**：
- 不要在 workflow body（VM 内）写 `await import()`（抛 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`）——放 step 里。
- 不要给源码内部 import 加 `.js` 后缀（Node type stripping 不 fallback，会 `ERR_MODULE_NOT_FOUND`）。
- 不要 patch `@workflow/builders` 的 `isProjectLocalFile`——type stripping 已解决，patch 会增加维护负担。
- `workflow` nitro config 只有 `dirs/typescriptPlugin/runtime` 4 字段，**无** externalize 控制入口。

## 配置层

- **env 极简**（`.env.example`）：`BASE_DIR` / `PORT` / `HELIX_URL` / `LOG_LEVEL`。**不用 .env 存模型配置**
- **Credential = Endpoint bundle**：一个 credential = 一个完整 endpoint `{id, provider, apiKey, baseURL?}`。`id` 命名实体（用户指定或 auto `${provider}-${ts}`），**不再按 provider 唯一**，支持「同 provider 不同 baseURL+apiKey」组合。upsert by id（后加覆盖先加）。SQLite 加密（`data/global.sqlite`），串行 modifyLock 防 OAuth 双刷。
- **ModelConfig 用 credentialId 引用**：`ModelConfig = {model, thinkingLevel, credentialId}`（移除 provider+baseURL）。provider/baseURL/apiKey 全部由 credentialId 引用的 Credential 条目决定。`settings.models.<role>` 和 `settings.modelAliases.<alias>` 都用此形态。
- **ModelArg 跨边界载体**：`ModelArg = {provider, model, baseURL?, apiKey, thinkingLevel}` 是 plain object，可跨 workflow structured-clone 边界传递。`resolveModelArg(projectName, credentials, {role?, modelAlias?})` 读 settings → ModelConfig（含 credentialId）→ `credentials.get(credentialId)` → 从 credential 拿 provider/apiKey/baseURL → 组装 `ModelArg`。step 内调 `createModelFromConfig(modelConfig)` 重建 `LanguageModel`。
- **两层 settings**：global `data/settings.json` + per-project `data/projects/<name>/settings.json` override（deep merge）。`getSettings(projectName?)` 自动 merge 两层。

## 数据层

双 SQLite：
- `data/global.sqlite` — credentials / settings / mcp_trust / mcp_tool_baselines
- `data/projects/<name>/db.sqlite` — projects / runs / messages / steering_messages / hypotheses / evidence / critiques / mutations / plans / logs

FS 产物在 `data/projects/<name>/` 下：runs/ / rounds/ / hypotheses/ / evidence/ / mhd/ / workspace/ / skills/ / mcp/ / prompts/ / logs/。

## 6 Agent 角色

| 角色 | 职责 | Output Schema |
|---|---|---|
| Sisyphus | 编排器，Workflow Composition 调 5 子 agent | TournamentResult |
| Librarian | RAG 检索（HelixDB）+ 初始假设生成 | HypothesisPool |
| Multimodal Looker | FITS 图像 + MP4 视频对齐 | EvidenceAlignment |
| Explore | bash-tool 跑 Python 在 1.75M 快照搜索，算 F1 | EvalResult |
| Oracle | Co-Scientist 批判 + 突变 + 反例 debug | Critique + Mutation |
| Prometheus | 多轮规划，末轮输出 MHD .cfg + 观测建议书 | Plan + MhdConfig |

编排：Sisyphus 父 workflow 调 5 子 workflow——顺序用 direct await（共享 run ID），并行用 background spawn（`start(childWorkflow, [args])` 包在 `'use step'` 里，独立 run ID + retry boundary）。

## Tournament Evolution 工作流

Round 1: Librarian 生成 → Loop(Explore 并行评估 → Oracle 批判突变 → Prometheus 规划 → 收敛检测) → 最终 Prometheus 输出 MHD cfg + 观测建议书。

终止条件：`TARGET_F1` / `MAX_ROUNDS` / 收敛检测 / 手动。每轮快照存 SQLite（`snapshotStep`）。`MAX_ROUNDS`/`TARGET_F1` 内联在 `sisyphus/logic.ts`（不 import config，避免 VM 污染）。

> Looker 在当前 tournamentWorkflow 中**未被调用**（代码就绪但未编排进 round 循环，Phase 5 待补）。

## 安全约束

- `bash-tool` 无沙箱（host child_process），靠 project name 隔离 working dir
- MCP server 是远程代码执行，per-project 加载需信任（`mcp_trust` 表 + `fingerprintTools` 漂移检测）
- env 不进 git（`.gitignore` 已配 `.env`）
- HelixDB strict mode

## 不要做

- 不要用 ESLint/Prettier（用 Biome）
- 不要用 .env 存模型配置（走 Web API + SQLite）
- 不要给 Explore 的 Python 加 Docker 沙箱（用户明确决定：host child_process + project name 隔离）
- 不要把非序列化对象放进 `runtimeContext` / `toolsContext`
- 不要在 workflow body（VM 内）写 `await import()`（放 step 里）
- 不要给源码内部 import 加 `.js` 后缀（用 `.ts`，Node type stripping 不 fallback）
- 不要在 `tsconfig.json` 的 `compilerOptions` 里放 `extends`（放顶层）
