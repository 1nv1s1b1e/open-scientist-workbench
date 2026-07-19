# AGENTS.md

Open-scientist：太阳物理多智能体假设生成与证据推理系统（赛道一方向二 B 日冕加热之谜）。基于 Co-Scientist (Nature 2026) + AlphaEvolve。完整 spec 见 `SPEC.md`，web spec 见 `docs/web/`。

## 常用命令

```bash
pnpm lint           # biome check .（lint + format）
pnpm format         # biome format --write .
pnpm typecheck      # 全 9 包 tsc --noEmit
pnpm test           # vitest run（测试文件 *.test.ts）
pnpm lint -- --write     # biome auto-fix
pnpm dev            # 启动 apps/api（nitro dev）
pnpm db:generate    # drizzle-kit generate（storage 包）
pnpm db:migrate     # drizzle-kit migrate（storage 包）
```

- 单包操作：`pnpm --filter @open-scientist/agents typecheck`
- 加依赖：在对应 package.json 加 + `pnpm install`（pnpm workspaces，node-linker=hoisted）
- 测试框架：`vitest`，测试文件放 `*.test.ts`

## 技术栈

Node.js + pnpm + TypeScript 7 + Biome 2.5 + Zod 4 + Hono + Nitro（workflow/nitro module）+ AI SDK 7（`ai` + `@ai-sdk/workflow` + `workflow` DevKit）+ Drizzle ORM（双 SQLite）+ HelixDB（本地 graph+vector）+ `bash-tool` + `@ai-sdk/mcp`。

- **Runtime**：Node.js（包管理用 pnpm，不用 Bun）
- **Lint/Format**：Biome（单工具，无 ESLint/Prettier）。`biome.json` 已配 2.5.4 preset
- **Schema**：Zod 4（AI SDK `tool().inputSchema` / `Output.object({schema})` 必选）
- **Agent**：全 6 角色用 `WorkflowAgent`（`@ai-sdk/workflow`，durable 版 ToolLoopAgent）。三文件边界：`agent.ts`（构造）/ `workflow.ts`（`'use workflow'`）/ `steps/`（`'use step'` 可重试）
- **Build**：Nitro（`apps/api/nitro.config.ts` 配 `modules: ['workflow/nitro']`），非 Hono 自带 build

## Monorepo 结构（9 包）

```
apps/api        — Hono + Nitro REST 入口
packages/
  agents        — 6 WorkflowAgent（sisyphus/librarian/looker/explore/oracle/prometheus）
  tools         — bash/helix-query/fits-align/mhd-config/load-skill
  skills        — discover + prompt + load-tool（agentskills.io 开放格式）
  mcp           — MCP server registry + trust + 漂移检测
  storage       — 双 SQLite（global + per-project）+ Drizzle + 8 repo
  helix         — HelixDB client + queries DSL
  schema        — Zod schemas（零业务依赖）
  config        — paths + settings 两层 merge + models（per-agent model 解析）
```

依赖方向：`schema`（零依赖）← 所有包；`config → storage`（单向读 credentials/settings）；`agents → {tools, skills, mcp, helix, config, schema}`。

## WorkflowAgent 三文件边界（关键约束）

每个 agent 在 `packages/agents/src/<role>/` 下：
- `agent.ts` — `new WorkflowAgent({...})` 构造（module scope）
- `workflow.ts` — `'use workflow'` 指令，调 `agent.stream({messages, writable: getWritable<ModelCallStreamPart>()})`
- `steps/index.ts` — `'use step'`，tool execute 标记后获自动重试（默认 3 次）+ persistence

**context 必须可序列化**：`runtimeContext` / `toolsContext` 不能放 functions/class instances/symbols/SDK clients，只能 plain data（strings/numbers/bools/arrays/plain objects/dates/URLs/maps/sets）。传 identifiers，在 step 函数内重建非序列化资源。

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

## 配置层

- **env 极简**（`.env.example`）：`BASE_DIR` / `PORT` / `HELIX_URL` / `LOG_LEVEL`。**不用 .env 存模型配置**
- **模型配置全走 Web API + SQLite**：`packages/config/src/models.ts` 的 `getAgentModel(role, projectName, credentials)` 读 settings → 取 per-agent 配置 → 读 CredentialStore → 组装 `LanguageModel`
- **两层 settings**：global `data/global.sqlite` + per-project `data/projects/<name>/db.sqlite` override
- **CredentialStore**：SQLite 加密，串行 modify 防 OAuth 双刷

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

Round 1: Librarian 生成 → Looker 对齐 → Loop(Explore 并行评估 → Oracle 批判突变 → 人机协同 review → Prometheus 规划 → 收敛检测) → 最终 MHD cfg。

终止条件：`TARGET_F1` / `MAX_ROUNDS` / 收敛检测 / 手动。每轮快照存 SQLite。

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
- Web/TUI 当前阶段先忽略（spec 在 `docs/web/`，实现后期）
- 不要在 `tsconfig.json` 的 `compilerOptions` 里放 `extends`（放顶层）
