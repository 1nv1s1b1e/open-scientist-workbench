# Open-Scientist 进度与计划

> 太阳物理多智能体假设生成与证据推理系统（赛道一方向二 B 日冕加热之谜）
> 基于 Co-Scientist (Nature 2026) + AlphaEvolve。完整 spec 见 `SPEC.md`，web spec 见 `docs/web/`。

---

## Changelog

### Phase 1-3 已完成（2026-07-19）

#### `b5ea7b9` — chore: init project scaffold

- pnpm workspaces monorepo（10 包：apps/api + packages/{schema,config,storage,helix,logger,tools,skills,mcp,agents}）
- Biome 2.5.4（lint + format，单工具，无 ESLint/Prettier）
- Vitest 2.1.9（测试框架）
- TypeScript 7.0.2（`tsconfig.base.json`：strict + bundler moduleResolution + noUncheckedIndexedAccess + verbatimModuleSyntax）
- Node.js + pnpm（从 Bun 迁移而来，因 Nitro dev 不支持 `bun:sqlite`）
- `.npmrc node-linker=hoisted` + `pnpm-workspace.yaml allowBuilds`（better-sqlite3 + esbuild 原生编译）

#### `5ea582d` — feat(infra): schema + config + storage + helix + logger

- **schema**：7 文件 Zod schemas（hypothesis/eval/critique/plan/evidence/api/runtime-context + settings），零业务依赖
- **config**：env（4 变量 zod 校验）+ paths（12 路径函数）+ constants + settings（两层 merge：global `data/settings.json` + per-project override）+ models（provider 抽象 + `getAgentModel` + `createModelFromConfig`，OpenAI 优先，支持 baseURL）
- **storage**：双 SQLite（`data/global.sqlite` 全局 credentials/settings/mcp_trust/mcp_tool_baselines + per-project `db.sqlite` 10 表）+ Drizzle ORM + WAL + 8 repo + `CredentialStore`（AES-256-CBC 加密 + 串行 modifyLock 防 OAuth 双刷）+ 自动 migration
- **helix**：HelixDB client 封装 + 26 个 DSL 查询（15 read + 11 write）+ `queries.json` 运行时生成
- **logger**：consola wrapper + 11 个预定义 tag + `setLogLevel`

#### `5e9d779` — feat(tools): tools + skills + mcp

- **tools**：14 个 helix tool（9 read + 5 write，精确 inputSchema/outputSchema）+ `createBashToolForHypothesis`（bash-tool 封装，per-hypo workspace 隔离）+ `mhdConfigTool`（写 .cfg 文件）+ `fitsAlignTool`（informative stub，throw 带安装指引）
- **skills**：`Sandbox` 接口 + `createNodeSandbox` + `discoverSkills`（frontmatter 解析，first-name-wins）+ `buildSkillsPrompt` + `createLoadSkillTool` + 5 个默认 SKILL.md（solar-physics-rag / fits-snapshot-search / critique-protocol / mhd-config-gen / hypothesis-mutation）+ `DEFAULT_SKILLS_DIR` 导出
- **mcp**：3 个自定义 MCP server（helix 13 tools / fits 3 tools / sandbox 4 tools）+ `getMcpTools`（client 缓存）+ `resolveTransport`（http/sse/stdio）+ `checkMcpTrust`（`fingerprintTools` + `detectToolDrift` 漂移检测）+ `trustServer` + stdio bin 入口 + 8 个集成测试（InMemoryTransport）

#### `bf11770` — feat(agents-api): 6 WorkflowAgent + Hono API

- **agents**：6 个 WorkflowAgent 占位（sisyphus/librarian/looker/explore/oracle/prometheus），每个三文件边界（agent.ts / workflow.ts `'use workflow'` / steps/index.ts `'use step'`），instructions + Output.object({schema}) + isStepCount(N) + ToolSet 类型
- **apps/api**：Hono app + Nitro（`modules: ['workflow/nitro']`）+ REST routes（health/settings/credentials/projects/test-llm）+ 全局 onError/notFound

#### `d61bad4` — feat(phase-2): helix queries + tools + skills + mcp servers

- Phase 2 工具层完整实现（详见 `5e9d779` + `5ea582d` 的 helix 部分）

#### `1730d03` — fix(helix): DSL nWhere+hasLabel bug + read unwrap + id projection

- **根因**：HelixDB v3.0.8 上 `nWhere(EqExpr).hasLabel()` 对 i64 属性参数失效（返回 0 节点），必须用 `nWithLabelWhere(label, EqExpr)` 把 label 和属性谓词合并进 NWhere 的 And
- 修了 `getSnapshot` / `getHypothesesByRound` / `getConceptByName`
- read 返回值容器结构 unwrap（`readBatch().varAs().returning()` 返回 `{properties: T[]}` 而非 `T[]`）
- 节点 id 投影用 `Expr.id()` 而非 `Projection.property('id','id')`
- 新增 `ensureIndexes` 幂等 query（text + vector index，client 首次调用自动建）
- `addPaper`/`addHypothesis` 拆分为带/不带 embedding 两版本（vector index 建后 embedding 不能为 null）
- `types.ts` id 类型 string→number（HelixDB 返回 number）
- 新增 `integration.test.ts`（10 tests，需 HelixDB 在线）

#### `9fad5ed` — feat(phase-3): implement 6 WorkflowAgent + tournament orchestration

- 6 个 agent 全部实现（agent.ts async 工厂 + workflow.ts `'use workflow'` + steps/index.ts）
- **Librarian**：searchPapers/searchHypotheses/addHypothesis + bash/readFile/writeFile（`__librarian__` workspace）+ loadSkill（solar-physics-rag）
- **Explore**：bash/readFile/writeFile（per-hypo workspace `<project>/workspace/<hypoId>/`）+ loadSkill（fits-snapshot-search）
- **Oracle**：addCritique/addMutationLink/getCritiquesByHypothesis + bash（`__oracle__` workspace）+ loadSkill（critique-protocol + hypothesis-mutation）
- **Looker**：fitsAlign/getEvidenceByHypothesis/addEvidence + bash（per-hypo）+ loadSkill（fits-snapshot-search 复用）
- **Prometheus**：mhdConfig + bash（`__prometheus__` workspace）+ loadSkill（mhd-config-gen）
- **Sisyphus**：`review_leading_hypothesis` tool（`needsApproval: true`，Phase 4 接 approval transport）+ `tournamentWorkflow`（纯确定性控制流：Round 1 librarian → Loop(explore 并行 background spawn → oracle direct await → prometheus → 收敛检测) → 末轮 MHD cfg）
- **steps/index.ts（Sisyphus）**：`spawnExploreEvalStep` / `waitForRunStep` / `snapshotStep`（三个 `'use step'` 函数）
- **关键 API 事实**：`getWritable` 从 `workflow` 导入；`ModelCallStreamPart` 从 `@ai-sdk/workflow` 导入；`result.output` 不是 Promise；`start(childWorkflow, [args])` 返回 `Run<TResult>`，`await run.returnValue` 拿 output；`needsApproval` 在 AI SDK 7 被 deprecated 但 tool-level 仍是唯一机制
- **重构**：`sisyphus/logic.ts` 提取 6 个纯函数（updateHypothesesWithEval/computeLeader/shouldStopByTarget/applyOraclePruning/buildConvergenceEntry/shouldStopByPrometheus）；`oracle/logic.ts` 提取 buildHypothesesBlock/buildEvalSummaryBlock；`apps/api/src/lib/deep-merge.ts` 提取 deepMerge

#### `9e84fd7` — test: expand coverage 28→341

- 3 subagent 并行补测试，28 files / 341 tests
- **schema**（53 tests）：全 schema happy + throw 路径
- **config**（47 tests）：env + paths + settings-schema + constants
- **logger**（8 tests）：createLogger 缓存 + setLogLevel + 11 tag
- **storage**（68 tests）：credential-crypto 纯函数 + repo CRUD（全 8 repo）+ credential-store + migrations
- **tools**（37 tests）：14 helix tool schema + fits-align stub + mhd-config 写文件
- **skills**（12 tests）：discover tmpdir + buildSkillsPrompt + load-tool
- **mcp**（20 tests）：servers（8 集成）+ registry resolveTransport + trust 三分支
- **agents**（56 tests）：sisyphus-logic 纯函数 + 6 agent 构造 + 6 agent tools 装配 + snapshot-step + workflow import smoke + oracle-prompt
- **apps/api**（30 tests）：routes（health/settings/projects/credentials/404）+ test-llm + settings-merge

#### `0159ff2` — refactor: remove module-level state for testable isolation

- **根因**：测试因跨包 mock/resetModules 太多。分析后确认是源码模块级状态问题，不是测试位置
- `config/env.ts`：`export const env = loadEnv()` 模块级冻结 → Proxy 对象，每次属性访问动态调 `loadEnv()` 读 process.env。public API 零改动
- `storage/global-db.ts`：单例 → `Map<path, GlobalDb>` 按路径缓存；新增 `closeGlobalDb(path?)`
- `storage/db.ts`：cache key 从 `projectName` → `${getBaseDir()}:${projectName}`
- 7 个测试文件去掉 `vi.resetModules()` + 动态 import + `StorageModule` 接口，-185 行样板，改回静态 import + `process.env.BASE_DIR` + `afterEach closeXxxDb`

#### `af59d97` — refactor(test-llm): 依赖注入替代 vi.doMock('ai')

- `test-llm.ts`：加 module-level `generateTextFn` + `setGenerateTextFn` setter，route 内改调 `generateTextFn`（生产默认用真实 `generateText`）
- `test-llm.test.ts`：去掉 `loadAppWithMockedAi` + `vi.resetModules` + `vi.doMock('ai')`，改用 `setGenerateTextFn(vi.fn(...))`
- 整个项目**零 `vi.doMock`**，只剩 `vi.mock` 用于 mcp trust/registry/servers（mock 外部 MCP SDK，合理）

#### `484e832` — docs: PROGRESS.md 落盘

- 232 行进度文档：Changelog（10 commits）+ 当前状态 + Phase 4-5 计划 + Web 层选型 + 关键约束 + 环境信息

#### Phase 4 未 commit 改动（2026-07-20）

- **modelConfig 重构**：`model: LanguageModel` → `modelConfig: ModelArg`（6 agent + workflow + 测试）。`ModelArg` 统一定义在 `packages/config/src/models.ts`，`createModelFromConfig(config: ModelArg)` 单参数。
- **Credential endpoint bundle 改造**：credential = `{id, provider, apiKey, baseURL?}` 完整 endpoint（移除「按 provider 唯一」+「不存 baseURL」约束），upsert by id（支持同 provider 不同 baseURL+apiKey）。`ModelConfig = {model, thinkingLevel, credentialId}`（移除 provider+baseURL，用 credentialId 引用 credential）。`resolveModelArg(projectName, credentials, {role?, modelAlias?})` 从 credential 拿 provider/apiKey/baseURL 组装 ModelArg。settings 加 modelAliases（GET/PUT/DELETE `/api/settings/model-aliases/:alias`）。
- **workflow VM 修复（方案 A）**：6 个 workflow.ts 改纯 VM-safe 薄壳（只 `import { runXxxStep } from './steps/index.ts'` + `return await runXxxStep(input)`），agent 构造 + `agent.stream` 全移进 `steps/index.ts` 的 `'use step'` 函数（host runtime 跑，`await import('../agent.ts')` 正常）。sisyphus/workflow.ts 的 6 个变量 specifier 动态 import 改静态 import（子 workflow.ts 已 VM-safe）+ MAX_ROUNDS/TARGET_F1 内联到 logic.ts。
- **step bundle externalize 修复（type stripping）**：tsconfig.base.json 开 `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`，源码内部相对 import 全改 `.ts` 后缀（153 处 from + 18 处 dynamic import）。`apps/api/nitro.config.ts` 的 `noExternals` 扩成 8 个 workspace 包。Node 26 type stripping 默认开启，`package.json exports` 指向 `./src/index.ts` 可直接加载。
- **nitro 路由修复 + typecheck 修复**：`routes: { '/**': './src/index.ts' }` → `routes: { '/api/**': './src/index.ts' }` + `entry` → `serverEntry` + `workspaceDir: import.meta.dirname` + `ajv@^8.20.0` dep。`nitro.config.ts` 顶部加 `import type {} from 'workflow/nitro'`（side-effect type import 加载 module augmentation），修复 `workflow` 属性 TS2353 报错。
- **P0 runs 路由**：`apps/api/src/routes/runs.ts`（4 端点 + 15 tests）+ `apps/api/src/routes/dev-probe.ts`（临时验证）。
- **logger 接入**：tools/skills/helix/config 4 包加 `@open-scientist/logger` dep + 9 个源文件加 logger。
- **librarian ensureIndexes**：`librarian/steps/index.ts` 在 `agent.stream` 前调 `ensureIndexes()`（idempotent 建 HelixDB text + vector index）。
- **dev-probe 端到端验证**：POST `/api/dev-probe/stream-test` 全链路打通——SSE 流出 `start` → `start-step` → 多轮 `text-delta` + `tool-input-available` + `tool-output-available`（loadSkill/searchPapers/searchHypotheses/bash）→ `finish-step` → `finish`。未抛任何 VM / module 错误。

#### Phase 4 续（2026-07-20，per-agent config + VM bundle fix + 真实模型 E2E）

- **Per-agent config（模型/mcp/skills/sys prompt 全可配）**：
  - **schema**：`McpServerConfigSchema`（{name, transport:'http'|'stdio'|'sse', url?, command?, args?, headers?}）+ `AgentConfigSchema`（{instructions?, skillDirectories?, mcpServers?}）+ `GlobalSettingsSchema.agents: Record<string, AgentConfigSchema>.default({})`。
  - **config**：`DEFAULT_GLOBAL` 加 `agents: {}`；`getSettings` merge `agents: {...global.agents, ...project.agents}`（per-key）；新增 `AgentRuntimeConfig = {modelConfig: ModelArg, instructions?, skillDirectories?, mcpServers?}` + `resolveAgentConfigs(projectName, credentials): Promise<Record<AgentRole, AgentRuntimeConfig>>`（6 个 tournament role 各自 resolveModelArg + 非模型 override）。
  - **mcp**：`McpServerConfig` type 从 schema 导入（结构兼容，re-export），runtime 函数不变。
  - **6 agent factory**：每个 `XxxAgentDeps` 加 `instructions?/skillDirectories?/mcpServers?`；`getDefaultXxxTools` 签名加 `(skillDirectories?, mcpServers?)`（sisyphus 无 skills 故只 mcpServers?）；mcpServers 非空时 loop `getMcpTools(server)` + `Object.assign` 合并；`instructions: instructions ?? '<原硬编码默认>'`。全 backward compatible（新字段全 optional）。
  - **5 step files + sisyphus/workflow.ts**：`RunXxxStepInput` 加 `agentConfig?: AgentRuntimeConfig`；`runXxxStep` 传 `modelConfig: input.agentConfig?.modelConfig ?? input.modelConfig` + spread instructions/skillDirectories/mcpServers；`TournamentWorkflowInput` 加 `agentConfigs?: Record<string, AgentRuntimeConfig>`，加 `agentConfigFor(role)` helper，5 个子 workflow 调用各 forward `agentConfigs[role]`。sub workflow.ts 无需改（`extends RunXxxStepInput` 自动继承）。
  - **API routes**：`GET/PUT/DELETE /api/settings/agents/:role`（PUT 全量替换 via AgentConfigSchema.parse，DELETE no-op if unset）+ `GET /api/settings/agents`（list）。项目级走已有 `PATCH /api/projects/:project/settings`（deepMerge 按 key 合并 agents）。
  - **runs route**：新增 `resolveRunAgentConfigs(projectName, modelAlias?)`——调 `resolveAgentConfigs` + 若 modelAlias 则 override `configs.sisyphus.modelConfig`。POST handler 同时 resolve `modelConfig`（legacy）+ `agentConfigs` 传给 tournament。
  - **dev-probe**：`agentConfigs?` optional，无需改。
  - **tests**：10 个 agent-config route tests + 1 个 project-level agents merge test + runs.test.ts mock `resolveAgentConfigs`。368 tests pass。
  - **curl E2E 验证**：14 个 agent CRUD checks 全过（GET empty/404、PUT instructions-only/skillDirectories+mcpServers/full-replace、DELETE/no-op、surfaces on GET /api/settings、rejects invalid mcpServer）。
- **`ERR_IMPORT_ATTRIBUTE_MISSING` 修复（预存 bug，非 per-agent config 引入）**：
  - **根因**：`@workflow/builders@4.1.1` 的 `fast-discovery.js:626` 把 `serde-checker.js` 误判为 "serde-only file"——`hasLikelySerdeClass(source)` regex 扫源码（`stripComments` 去注释但**不去字符串字面量**），`serde-checker.js:48-49` 的错误信息字符串 `static [WORKFLOW_SERIALIZE](...) { ... }` 命中 regex。esbuild plugin 路径（`discover-entries-esbuild-plugin.js:136`）有 `!isSdkFile` guard 正确跳过，但 `base-builder.js:376` 用的 `fastDiscoverEntries`（fast-discovery 路径）**无此 guard**。
  - **链路**：`serde-checker.js` 进 `serdeOnlyFiles` → 虚拟 entry `import '@workflow/builders/dist/serde-checker.js'` → 静态 import `builtin-modules` → `import json with {type:'json'}` → esbuild CJS 输出**丢掉 import attribute** → `@workflow/core` VM sandbox 的 `defaultLoadSync` 拒绝无 attribute 的 JSON import → `ERR_IMPORT_ATTRIBUTE_MISSING`。proof：`.nitro/workflow/workflows.mjs.debug.json` 的 `serdeOnlyFiles` 含 `serde-checker.js`。
  - **bundle 内的死代码**：`steps.mjs:6976-6982` 的 `builtin_modules_default` + `nodeBuiltins` + `nodeImportExtractRegex` 定义后**从不被引用**（esbuild CJS 保留 module-level var 赋值即使 unused）。
  - **修复**：新建 `apps/api/src/workflow-bundle-fixup.ts` nitro module，注册在 `workflow/nitro` 之后（`modules: ['workflow/nitro', workflowBundleFixup]`），`build:before` hook 在 `@workflow/nitro` 写完 `steps.mjs`/`workflows.mjs` 后读取两文件，regex 替换 `import builtinModules from "...builtin-modules.json";` → `var builtinModules = [];`（零功能影响，imported values 是死代码）。**非 patch**——build-time 后处理 generated artifact，不动 node_modules，survive `pnpm install`，版本受控。
  - **pnpm patch 尝试（全部被否决，已回退）**：`createRequire` 方案（VM 无 require + 路径解析到 bundled steps.mjs 而非原文件 → `Cannot find module './builtin-modules.json'`）；inline JSON array 方案（写到 patch edit dir 但用户否决）。`patches/` dir + `patchedDependencies` 全删，`pnpm install` 恢复原始 `builtin-modules@5.0.0`。
- **真实模型 E2E 验证（tournament run）**：
  - 启动 HelixDB（`helix init local --path . --no-skills --quiet` + `helix start`，localhost:6969，dev instance，`helix.toml` gitignored）+ nitro dev（`workflow-bundle-fixup` 日志 `patched steps.mjs`）。
  - `POST /api/projects/e2e-final/runs` seed `"Nanoflare heating in coronal loops: Alfvén wave dissipation via phase mixing may explain the million-degree corona."`。
  - SSE 流跑通：`start` → `start-step` → `text-delta` + `tool-input-available` + `tool-output-available` → `finish-step` → next step。
  - **Librarian（带 `[TEST-OVERRIDE] You are Librarian. Generate exactly 2 hypotheses...` 自定义指令）实际执行**：loadSkill（skill not found，dev 模式 `.nitro/workflow/defaults` 不存在，非阻塞）→ 3 次 searchPapers（HelixDB 空 → `[]`）→ 2 次 searchHypotheses（返回 5 results each）→ **addHypothesis 精确 2 次**（遵循 "exactly 2 hypotheses" 指令）→ **per-agent config 验证生效**。
  - **遗留**：Librarian 建完 2 假设后 `AI_NoObjectGeneratedError: No object generated: could not parse the response`——Qwen3-Next-80B 未产 `Output.object({schema: HypothesisPoolSchema})` 期望的结构化 JSON。属模型/Schema 兼容问题，与 per-agent config + VM bundle fix 无关。

#### Phase 6: Web 层（2026-07-20，apps/web Next.js 前端完整搭建）

基于 `docs/web/` 5 spec 文件 + 后端 routes 实际实现（subagent 彻底读了 `apps/api/src/routes/` 全部文件，提取 8 端点组精确签名）。**不 mock，全部真实 fetch**。

**基础配置**（`apps/web/`）：

- Next.js 16.2.10 (Turbopack) + React 19.2.7 + TypeScript 6.0.3（devDep，为兼容 Next 15/16 的 `verify-typescript-setup` 检查 `typescript/lib/typescript.js`——TS 7 重构了包结构无此文件）
- Tailwind v4.3.3 stable + Biome（与 monorepo 一致）
- `next.config.ts`：`images: { unoptimized: true }`（适配 Electron + 避免 sharp native build）+ rewrites 代理 `/api/*` → `${API_BASE_URL}/api/*`（同源避免 CORS，后端无 CORS middleware）
- `tsconfig.json`：extends base，移除 `baseUrl`（TS 6 弃用 TS5101），`rewriteRelativeImportExtensions: false`（noEmit 时开此项报 TS2877），保留 `allowImportingTsExtensions: true`
- `pnpm-workspace.yaml`：`sharp: true`（pnpm 把 build approval 从 .npmrc 移到此处）
- workspace 依赖 `@open-scientist/schema`（复用 Zod schemas + 类型）

**lib 层**（`apps/web/src/lib/`）：

- `api/client.ts`：完整 REST 客户端覆盖全部 8 端点组。`ApiError` class。`startRun` 返回 `{response, runId}`（从 `x-workflow-run-id` header 提取 SDK run id）。`reconnectRunStream` 返回 `{response, tailIndex}`（`x-workflow-stream-tail-index` header 仅 startIndex<0 时存在）。聚合导出 `api` 对象。
- `types/sse-events.ts`：UIMessageChunk 完整类型（生命周期/文本/reasoning/tool/审批/其他）+ CustomEventKind 常量
- `types/visualizers.ts`：ConceptNode/Link/NetData, AgentNodeData/MessageEdgeData/OrchestratorData, HypothesisTreeNode/EvolutionTreeData
- `visualizers/`：colorTheme（6 agent 色 + 概念色常量）、concept-net-data（POC 从假设列表构建概念图）、evolution-tree-data（d3-hierarchy 树构建）、orchestrator-data（TOOL_TO_AGENT 映射 + 环形坐标 + edge 推导）
- `store/`：run-store（Zustand：runId/status/currentRound/bestF1/selectedHypothesisId/activeView/chatCollapsed）、ui-store（sidebarCollapsed）
- `hooks/useRunStream.ts`：核心 SSE 流 hook。state: idle/connecting/streaming/reconnecting/done/error/stopped。start(seed, modelAlias?) → POST + 消费 SSE body 解析 `data: JSON\n\n`。累积 MessagePart（text/reasoning/tool/custom）。流中断自动 reconnect（-50 tail-relative, maxConsecutiveErrors=5）。stop() + reset()。
- `hooks/useApi.ts`：TanStack Query hooks（projects/project/createProject/deleteProject/globalSettings/updateGlobalSettings/projectSettings/credentials/addCredential/deleteCredential/testLlm/runStatus 轮询/modelAliases）。queryFn 包装成箭头函数避免 TanStack context 传入类型不匹配。
- `transport/workflow-transport.ts`：TRANSPORT_CONFIG 常量（initialStartIndex:-50, maxConsecutiveErrors:5, throttle:50）

**components 层**（`apps/web/src/components/`）：

- `ui/`：13 个 shadcn/ui 原语（button/card/input/textarea/label/badge/dialog/tabs/scroll-area/select/tooltip/popover/spinner），全部 xAI 风格化（胶囊按钮、hairline 边、无阴影、mono uppercase label）
- `site/`：banner（eyebrow + display 标题 + radial glow + accent-line-top）、eyebrow（Geist Mono uppercase tracked）、header（sticky 顶栏 + 旋转 corona logo）、footer
- `visualizers/`：concept-net-3d（react-force-graph-3d + three Sprite 标签 + ResizeObserver）、orchestrator-hall（@xyflow/react v12 6 agent 环形 + AgentNodeCard）、evolution-tree（d3-hierarchy + SVG + Motion 动画）、debate-theater（Motion 重写 + 中心脉冲 + SVG 连线粒子）
- `projects/project-list.tsx`：3 列卡片网格 + deterministic accent 色 + Motion stagger
- `credentials/credential-list.tsx`：3 列卡片 + provider 色点 + detail 行
- `settings/settings-panel.tsx`：4 Tabs（模型配置/锦标赛/并发/引导）+ SectionShell + per-role 配置卡片
- `settings/test-llm-panel.tsx`：两栏布局 + 结果面板 + usage 3 列
- `chat/chat-panel.tsx`：assistant-ui Thread + WorkflowRuntimeProvider + ChatToolbar

**assistant-ui 集成**（`apps/web/src/lib/chat/` + `apps/web/src/components/assistant-ui/`）：

- 选 **ExternalStoreRuntime** 模式（非 useChatRuntime + 自定义 transport），原因：请求形状不匹配（useChat 发 {messages}，我们发 {seed, modelAlias}）、重连协议不匹配（assistant-ui 用 GET /resume/:streamId，我们用 GET /runs/:id/stream?startIndex=N）、单轮约束、useRunStream 已实现重连
- `to-thread-messages.ts`：RunMessage[] → ThreadMessageLike[] 转换（text→text, reasoning→reasoning, tool→tool-call, custom→data-{kind}）。用 `Extract<NonNullable<ThreadMessageLike['content']>, { type: string }>` 提取 part 类型，无 any
- `workflow-runtime.tsx`：`useExternalStoreRuntime<ThreadMessageLike>` + `convertMessage: (msg) => msg` 恒等函数（ThreadMessageLike 不 extends ThreadMessage 需提供 convertMessage）。onNew 从 AppendMessage.content 找 textPart → setSeed + start。onCancel → stop。isSendDisabled: hasStarted && !isRunning（单轮）。不提供 onEdit/onReload → 编辑/重生成按钮不渲染。ResetContext 暴露 reset
- `toolkit.tsx`：6 个 makeAssistantToolUI 注册（bash-tool/helix-query/fits-align/mhd-config/load-skill + GenericToolUI fallback `toolName:'*'`），每个用 ToolShell 外壳 + JsonPreview 折叠 JSON
- `data-ui.tsx`：3 个 makeAssistantDataUI 注册（steering-injected/round-transition/convergence）
- `components/assistant-ui/thread.tsx`：基于 ThreadPrimitive 自建（方案 B）。ThreadPrimitive.Root → Viewport(Empty + Messages) + ViewportFooter(Composer)。Messages components={{ UserMessage, AssistantMessage }}。AssistantMessage 的 MessagePrimitive.Parts components={{ Text, Reasoning, tools: { Fallback } }}。Composer 用 AuiIf 切换 Send/Cancel
- `components/assistant-ui/markdown-text.tsx`：轻量 markdown（code fence + inline code + bold + 段落），无 react-markdown 依赖
- `components/assistant-ui/reasoning.tsx`：可折叠推理过程，running 时自动展开
- `components/assistant-ui/tool-fallback.tsx`：未注册工具兜底

**app 路由**（`apps/web/src/app/`）：

- `layout.tsx`：next/font 加载 Inter + Geist + Geist Mono（变量注入 globals.css）+ 全局 fixed grain overlay + Providers（QueryClientProvider + TooltipProvider）
- `page.tsx`（首页）：Banner hero「日冕加热之谜」+ 6 agent 卡片网格 + ProjectList + Mystery band（旋转 corona disk conic-gradient）
- `settings/page.tsx`：dusk Banner + 3 Tabs（全局设置/凭证/LLM 测试）
- `projects/[project]/page.tsx`：核心工作区。slim banner + 居中 pill 视图切换（协作大厅/知识图谱/演化树/辩论剧场）+ aside 侧边栏（AnimatePresence 滑入滑出）+ ChatPanel

**xAI 风格美化**（参考 DESIGN.md）：

- `globals.css`：xAI 色板（canvas #0a0a0a / surface #191919 / hairline #212327 / sunset #ff7a17 / dusk #7c3aed）、display 字号阶梯 token、pill-outline/pill-primary/eyebrow-mono/card-xai utilities、radial-sunset/dusk 径向辉光、bg-grid blueprint 网格、SVG fractal-noise 颗粒、shimmer/scanline/spin-slow/pulse-glow 动画、Radix 组件深色覆盖、React Flow 深色覆盖（`.react-flow__controls` / `.react-flow__minimap` / `.react-flow__attribution`）
- UI 原语全部 xAI 化：button rounded-full 胶囊 + outline 默认、card 8px 直角 + hairline 边 + 无阴影、input h-11 surface-soft 底、badge mono uppercase 11px、tabs pill 容器
- 所有表单/列表/卡片重写：FieldGroup helper、SectionShell（eyebrow+title+desc+action header）、3 列卡片网格、deterministic accent 色、Motion 入场动画
- 后续用户反馈：移除卡片彩色 header 条（project-list 顶部色条、credential-list 顶部色条、首页 agent 卡片 hover 底部彩色 hairline）、移除 OrchestratorHall 的 Controls + MiniMap

**依赖升级 + 循环依赖修复**（commit 277d256）：

- web package.json 全量重写到最新版（除 TS 6.0.3）
- monorepo 10 包版本统一到最新稳定版
- 循环依赖根因：`config → storage`（纯类型 import CredentialStore）+ `storage → config`（运行时 import getBaseDir 等）。解法：Credential/CredentialRecord/CredentialStore 三接口移到 schema 包（零依赖），config 改 import 源 + 去掉 storage 依赖，storage/credential.ts 改为 re-export（向后兼容）
- 删除未用的 gsap + @gsap/react（0 引用）

**Electron 适配文档**（`docs/web/06-electron-adaptation.md`）：

- 结论：可行，改动量小（~3.5 天）。方案 A（Next standalone + 本地 Nitro）推荐
- 需改：next.config（API_BASE_URL env）、apps/api（PORT+BASE_DIR）、新增 apps/electron/（main process spawn api + BrowserWindow）。关 `images.unoptimized`（已关）。better-sqlite3 需 electron-rebuild。SSE 在 Electron Chromium 正常。无需改 lib/api/client、hooks/useRunStream、packages/**

**验证状态**：

- typecheck: 0 error（`npx tsc --noEmit`）
- lint: 0 error/warning（`npx biome check .`，62 files）
- dev server: `next dev -p 5173` Next 16.2.10 Turbopack Ready in 258ms，/、/settings、/projects/test 全 200
- 无 any（用户明确要求）

---

#### Phase 7: ToolLoopAgent 迁移 + 真实 LLM 端到端跑通（2026-07-22，未 commit）

**从 WorkflowAgent/Nitro 迁移到 ToolLoopAgent/@hono/node-server**：

- 移除 `@ai-sdk/workflow` / `workflow` DevKit / Nitro 全部依赖
- 全 6 agent 改用 `ToolLoopAgent`（从 `ai` 包直接导出），`agent.ts` 构造工厂 + `workflow.ts` plain async 函数（无 `'use workflow'`）
- `apps/api` 从 Nitro 迁移到 `@hono/node-server`（无 build-time bundle，dev 用 `tsx watch`）
- 移除 `workflow-bundle-fixup.ts`、VM sandbox workaround、`steps/index.ts` 三文件边界
- 源码内部 import 保持 `.ts` 后缀（tsx + Node type stripping 不做 `.js`→`.ts` fallback）
- `pnpm typecheck` 11/11 通过 + `pnpm lint` clean + `pnpm test` 380/380 通过

**中文化**：所有 prompt、instructions、skills 翻译为中文（2 个 SKILL.md + 6 个 agent.ts instructions + 5 个 workflow.ts prompt）。

**路径修复**：`packages/config/src/paths.ts` 新增 `getDatasetDir()` 函数（默认 `<BASE_DIR>/dataset`，支持 `DATASET_DIR` 环境变量），Explore agent prompt 注入绝对路径 `${datasetDir}`，修复工作目录距 `data/` 有 7 层导致的 `No such file or directory`。

**HelixDB BigInt bug 修复**：`packages/helix/src/client.ts` 新增 `safeBigInt(v)` — 对非数字字符串 hypoId 返回 null 而非 throw，避免 Oracle agent 调 `getCritiquesByHypothesis` 时 LLM 传字符串 hypoId 导致崩溃。

**extractSubmitResult fallback 修复**：

- `packages/agents/src/shared/tool-output.ts` — `extractSubmitResult(staticToolCalls, toolName?, fallback?)` 新增 `fallback?: T` 参数。未找到 submit_result 时：有 fallback 返回 fallback（不 throw），无 fallback 才 throw。
- 所有 5 个 workflow（librarian/explore/oracle/prometheus/looker）都传 fallback 值，确保 agent 达到 step limit 未调用 submit_result 时不崩溃，tournament 正常继续。

**Step limits 增大**：

| Agent      | 旧    | 新  |
| ---------- | ----- | --- |
| Librarian  | 30    | 50  |
| Oracle     | 40    | 60  |
| Prometheus | 30    | 60  |
| Explore    | 50→80 | 120 |
| Sisyphus   | 80    | 120 |
| Looker     | 30    | 50  |

**Prometheus observationProposal 写文件**：

- **问题**：Prometheus submit_result 需嵌入完整 observationProposal markdown（数千字），导致 `AI_InvalidToolInputError: JSON parsing failed`。
- **修复**：`mhdConfigTool` inputSchema 新增 `observationProposal: z.string()` 参数，execute 写两个文件（`<runId>.cfg` + `<runId>_proposal.md`），返回 `{runId, cfgPath, proposalPath, summary}`。Schema 全链路 `observationProposal` → `proposalPath`（`packages/schema` + `packages/storage` + `packages/tools` + `packages/agents` + `packages/skills` + 3 个测试文件）。

**DB status 修复**：

- **问题**：`apps/api/src/routes/runs.ts` POST handler 在 `startRun()` 后调 `createRun(status='running')` 但没有在 `run.result` 完成后更新 SQLite status，导致 DB 卡在 "running"。
- **修复**：`packages/storage/src/repo/run.ts` 新增 `completeRun(projectName, runId, status: 'completed'|'failed', metrics?: {bestF1?, currentRound?})` 函数。`runs.ts` POST handler 加 `void run.result.then(output => completeRun(..., 'completed', {bestF1, currentRound}), () => completeRun(..., 'failed'))`。

**真实 LLM 端到端验证（3 轮 tournament 完整跑通）**：

- Run `run-1784716873175-53f30def`：3 轮 tournament evolution，463 条消息，`status=completed, round=3, bestF1=0.8794`
- Librarian 生成 2 条假设（AC turbulent braiding + DC nanoflare shear）
- Explore 评估 F1=0.8799 (TP=12215, FP=1891, FN=1444)，中文反例分析
- Oracle 五维评审 + 突变
- Prometheus 3 轮规划，末轮生成 MHD cfg + 观测建议书（无 JSON parse 错误）
- **MHD config**：假设 DC Model — Critical Current Density Nanoflare Heating，12 个物理参数
- **观测建议书**：6 个可观测预言 + SDO/AIA + IRIS + SDO/HMI 仪器方案
- 共享 venv：`data/dataset/.venv`（numpy 2.5.1 + scipy 1.18.0）
- eval.py 执行时间 6ms

**Python venv 更新**：`data/dataset/.venv` 安装 numpy 2.5.1 + scipy 1.18.0（最新版），Explore agent 使用绝对路径 `/Users/didi/personal/open-scientist/data/dataset/.venv/bin/python`。

---

## 当前状态（2026-07-22）

### 代码

- **11 包**：apps/api + apps/web + packages/{schema,config,storage,helix,logger,tools,skills,mcp,agents}
- **380 tests pass**（无 flaky）
- **typecheck** 11 包全通过
- **lint** clean
- **所有 agent 用 ToolLoopAgent**（从 `ai` 包导入，无 WorkflowAgent/Nitro）
- **3 轮 tournament 完整跑通**：Librarian → Explore(2并行) → Oracle → Prometheus × 3 rounds → MHD cfg + 观测建议书

### Phase 4 进展（未 commit）

#### 已完成

- **modelConfig 重构**：6 个 agent 的 `model: LanguageModel` → `modelConfig: ModelArg`（plain object，可序列化）。`ModelArg = {provider, model, baseURL?, apiKey, thinkingLevel}` 统一定义在 `packages/config/src/models.ts`，workflow args 走 structured clone，不能传 `LanguageModel`（有方法的对象）。workflow 内部调 `createModelFromConfig(modelConfig)` 重建。apiKey 只用于构造 HTTP 请求头，不进 LLM prompt context。
- **Credential endpoint bundle 改造**：credential = `{id, provider, apiKey, baseURL?}` 完整 endpoint（一个 credential = 一个完整 LLM endpoint），upsert by id（不再按 provider 唯一，支持同 provider 不同 baseURL+apiKey）。`ModelConfig = {model, thinkingLevel, credentialId}`（移除 provider+baseURL，用 credentialId 引用 credential）。`resolveModelArg(projectName, credentials, {role?, modelAlias?})` 从 credential 拿 provider/apiKey/baseURL 组装 ModelArg。settings 加 **model alias 功能**（`settings.modelAliases` record + GET/PUT/DELETE `/api/settings/model-aliases/:alias`）。
- **workflow VM 修复（方案 A）**：`@workflow/core` VM sandbox 用裸 `runInContext`，无 `importModuleDynamically` callback → workflow body 内任何 `await import()` 必抛 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`。解法：6 个 workflow.ts 改纯 VM-safe 薄壳（只静态 import `./steps/index.ts` 的 `runXxxStep` + `return await runXxxStep(input)`），agent 构造 + `agent.stream` 全移进 `steps/index.ts` 的 `'use step'` 函数（step 在 host Node runtime 跑，`import()` 走 host ESM loader 正常）。sisyphus/workflow.ts 的 6 个变量 specifier 动态 import 改静态 import（子 workflow.ts 已 VM-safe）+ MAX_ROUNDS/TARGET_F1 内联到 logic.ts（不 import config，避免 VM 污染）。
- **step bundle externalize 修复（type stripping）**：workflow/nitro 的 step bundle（esbuild via `@workflow/builders`）在 dev 模式把 workspace 包 externalize（因 `isProjectLocalFile` 对 `isWorkspacePackage=true` 的包返回 false）→ runtime 用 bare specifier `@open-scientist/config` → package.json exports `./src/index.ts` → Node 加载 .ts。解法：tsconfig.base.json 开 `allowImportingTsExtensions: true` + `rewriteRelativeImportExtensions: true`，源码内部相对 import 全改 `.ts` 后缀（153 处 from + 18 处 dynamic import，9 个包）。Node 26 type stripping 默认开启（无需 flag），`package.json exports` 指向 `./src/index.ts` 可直接加载。`apps/api/nitro.config.ts` 的 `noExternals` 扩成 8 个 workspace 包（agents/logger/tools/skills/helix/config/schema/mcp），nitro dev bundle 才能 resolve。
- **nitro 路由修复**：`routes: { '/**': './src/index.ts' }` → `routes: { '/api/**': './src/index.ts' }`（让 workflow 内部路由 `/.well-known/workflow/v1/*` 落到 nitro 原生 handler）。`entry` → `serverEntry`（Hono app 作 catch-all web handler，workflow handlers 优先匹配）。加 `workspaceDir: import.meta.dirname`（修 workflowId 不匹配）。加 `ajv@^8.20.0` dep（修 CJS/ESM bundle 兼容）。
- **P0 runs 路由**（`apps/api/src/routes/runs.ts`，4 端点 + 15 tests）：POST 启动 + GET stream（SSE + 断线重连 + 负 startIndex + tail-index header）+ GET 状态 + POST stop。
- **dev-probe route**：临时验证用，`POST /api/dev-probe/stream-test`。
- **logger 接入**：tools/skills/helix/config 4 包加 `@open-scientist/logger` workspace dep + 9 个源文件加 logger（bash/helix-query/fits-align/mhd-config/discover/load-tool/sandbox/client/models）。
- **librarian ensureIndexes**：`librarian/steps/index.ts` 在 `agent.stream` 前调 `ensureIndexes()`（idempotent 建 HelixDB text + vector index，之前只在 integration test 调）。
- **dev-probe 端到端验证**：POST `/api/dev-probe/stream-test` 全链路打通——SSE 流出 `start` → `start-step` → 多轮 `text-delta` + `tool-input-available` + `tool-output-available`（loadSkill/searchPapers/searchHypotheses/bash）→ `finish-step` → `finish`。未抛任何 VM / module 错误。logger 输出正常。HelixDB index 已建，空库返回 `[]` 不报错。
- **Per-agent config（模型/mcp/skills/sys prompt 全可配）**：见上「Phase 4 续」changelog。6 agent 各自独立配 model（`settings.models[role]`，fallback `default`→`sisyphus`）、mcpServers、skillDirectories、instructions。API `GET/PUT/DELETE /api/settings/agents/:role` + 项目级 `PATCH /api/projects/:project/settings`。`resolveAgentConfigs` 在 POST /runs 时 resolve 全 6 role 的 `AgentRuntimeConfig` 传给 tournament。curl 14 checks 全过。
- **`ERR_IMPORT_ATTRIBUTE_MISSING` 修复**：`@workflow/builders` fast-discovery 误判 `serde-checker.js` 为 serde file（字符串字面量命中 regex）→ 拉入 `builtin-modules` JSON import → esbuild CJS 丢 import attribute → VM `defaultLoadSync` 拒绝。修复：`apps/api/src/workflow-bundle-fixup.ts` nitro 模块，build 时后处理 `.nitro/workflow/steps.mjs`+`workflows.mjs`，regex 替换死代码 JSON import 为空数组。非 patch，版本受控。
- **真实模型 E2E**：tournament run SSE 流跑通，Librarian 带 `[TEST-OVERRIDE]` 自定义指令实际生效（精确调 addHypothesis 2 次遵循 "exactly 2 hypotheses" 指令）。遗留 `AI_NoObjectGeneratedError`（Qwen3-Next-80B 结构化 JSON 输出兼容问题，非本次改动引入）。

#### 已验证

- **3 轮 tournament 端到端跑通**：seed → Librarian(2假设) → Explore(F1=0.8799) → Oracle(批判+突变) → Prometheus(MHD cfg + 观测建议书) × 3 rounds，`status=completed, bestF1=0.8794`
- **Prometheus submit_result 无 JSON parse 错误**：observationProposal 写文件方案生效
- **DB status 正确更新**：`completeRun` 在 `run.result` resolve 后写入 SQLite
- **fallback 机制生效**：agent 达到 step limit 未提交结果时不崩溃
- **HelixDB BigInt 安全**：字符串 hypoId 不再导致 Oracle 崩溃
- **中文 prompt 生效**：Librarian/Explore/Oracle/Prometheus 全部使用中文 instructions + skills
- **绝对路径注入**：Explore agent 使用 `getDatasetDir()` 绝对路径，不再 `No such file or directory`

### 已验证（Phase 1-4 遗留）

- HelixDB 本地启动（`helix init local --path . --no-skills --quiet` + `helix start`，localhost:6969）
- Python venv（`data/dataset/.venv`，numpy 2.5.1 + scipy 1.18.0）
- API 端到端：health/settings/credentials/test-llm 全 200
- `@ai-sdk/openai` 用 `openai.chat(model)` 而非 `openai(model)`（第三方网关只完整支持 Chat Completions API）
- **Node 26 type stripping**：`node -e "import('@open-scientist/config')..."` 成功加载
- **per-agent config curl E2E**：14 个 agent CRUD checks 全过

### 技术栈定型

- Node.js + pnpm（不用 Bun）+ TypeScript 6 + Biome 2.5 + Zod 4
- Hono + `@hono/node-server`（无 build-time bundle，dev 用 `tsx watch`）+ AI SDK 7（`ai` 包，含 `ToolLoopAgent`）
- 全 6 agent 用 `ToolLoopAgent`（`ai` 包直接导出，plain async workflow 函数）
- Drizzle ORM + better-sqlite3（双 SQLite）+ HelixDB（本地 graph+vector 一体）
- bash-tool（host child_process，无沙箱，靠 project name 隔离 working dir）
- `@ai-sdk/mcp`（正式包）+ Skills 自实现（agentskills.io 开放格式）
- 共享 venv：`data/dataset/.venv`（numpy 2.5.1 + scipy 1.18.0）

---

## 后续 Phase 计划

### Phase 4: API 层（当前，SPEC §7）

**目标**：实现 Tournament run 的完整 API 端点——启动 run + SSE 流 + 人机协同审批 + steering 注入 + stop。

**待实现端点**（已有：health/settings/credentials/projects/test-llm）：

| 优先级 | Method   | Path                                          | 功能                                            | 依赖                                             |
| ------ | -------- | --------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| P0     | POST     | `/projects/:name/runs`                        | 启动 Tournament run（seed hypothesis）          | `tournamentWorkflow` + `start()` + run repo      |
| P0     | GET      | `/projects/:name/runs/:runId/stream`          | SSE 流（workflow 事件 + tool-approval-request） | `Run.readable` + `createUIMessageStreamResponse` |
| P0     | GET      | `/projects/:name/runs/:runId`                 | 获取 run 状态                                   | run repo                                         |
| P0     | POST     | `/projects/:name/runs/:runId/stop`            | 终止 run                                        | `Run.cancel()`                                   |
| P1     | POST     | `/projects/:name/runs/:runId/approve`         | 提交人机协同审批                                | `needsApproval` tool + workflow resume           |
| P1     | POST     | `/projects/:name/runs/:runId/steer`           | 注入 steering/follow-up 消息                    | message queue + turn boundary                    |
| P2     | GET      | `/projects/:name/runs/:runId/hypotheses`      | 列出假设池                                      | hypothesis repo                                  |
| P2     | GET      | `/projects/:name/hypotheses/:hypoId`          | 获取假设详情                                    | hypothesis repo                                  |
| P2     | GET      | `/projects/:name/hypotheses/:hypoId/evidence` | 获取证据                                        | evidence repo                                    |
| P2     | GET      | `/projects/:name/runs/:runId/rounds/:n`       | 获取某轮快照                                    | FS `rounds/<n>/snapshot.json`                    |
| P2     | GET      | `/projects/:name/runs/:runId/mhd`             | 下载 MHD cfg                                    | FS `mhd/<runId>.cfg`                             |
| P2     | GET      | `/projects/:name/runs`                        | 列出 runs                                       | run repo                                         |
| P3     | POST     | `/credentials/:id/refresh`                    | 手动触发 OAuth refresh                          | CredentialStore                                  |
| P3     | PUT      | `/projects/:name/mcp/config`                  | 更新 MCP server 配置                            | mcp registry                                     |
| P3     | GET/POST | `/projects/:name/mcp/trust`                   | MCP server trust 管理                           | mcp trust repo                                   |
| P3     | PUT      | `/projects/:name/skills`                      | 上传/更新 project 级 skills                     | FS skills/                                       |

**关键实现点**：

1. **启动 run**（`POST /projects/:name/runs`）：
   - 接收 `{seed, modelConfig?}`，调 `getAgentModel` 拿 model
   - `start(tournamentWorkflow, [{seed, projectId, runId, model}])`（包在 route handler 内，Nitro 提供 workflow runtime）
   - 返回 `{runId}` + `x-workflow-run-id` header（供 `WorkflowChatTransport` 断线重连）
   - run 记录写 SQLite（status='running'）

2. **SSE 流**（`GET /projects/:name/runs/:runId/stream`）：
   - `getRun(runId)` 拿 `Run` handle → `run.readable`（`WorkflowReadableStream`）
   - `run.readable.pipeThrough(createModelCallToUIChunkTransform())` 转成 UI message chunks
   - `createUIMessageStreamResponse({stream})` 返回 SSE Response
   - 断线重连：客户端 `WorkflowChatTransport` 带 `?startIndex=-50` 重连，server 从 chunk index 续传

3. **停止 run**（`POST /projects/:name/runs/:runId/stop`）：
   - `getRun(runId).cancel()` → workflow 取消
   - 更新 run status='stopped'
   - SSE 流发 `error` 事件后关闭

4. **人机协同审批**（`POST /projects/:name/runs/:runId/approve`，P1）：
   - `review_leading_hypothesis` tool 带 `needsApproval: true`，workflow 暂停 + persist resume state
   - 客户端 POST `{approved: bool, reason?}` → workflow resume
   - **难点**：AI SDK 7 的 `needsApproval` 被 deprecated，替代方案是 `streamText` 的 `toolApproval` option，但 `WorkflowAgentStreamOptions` 不暴露该 option。需调研 workflow resume 机制（`continueStream`）或自建 approval queue
   - **TODO**：Phase 4 先实现 P0 端点，approval 留 P1 调研

5. **Steering 注入**（`POST /projects/:name/runs/:runId/steer`，P1）：
   - 接收 `{content, mode: 'steering'|'follow-up'}`
   - 写 `steering_messages` 表（status='pending'）
   - Tournament workflow 在 turn boundary 检查 pending steering messages，注入到下一轮 Librarian/Prometheus 的 messages
   - SSE 流发 `steering-injected` 事件
   - **难点**：`tournamentWorkflow` 是确定性控制流，需在 round 循环里插 steering 检查点（`await checkSteeringMessages(runId)`）

6. **并发控制**（SPEC §7.3）：
   - `MAX_CONCURRENT_RUNS`（global settings，默认 4）限制全局并发 run 数
   - SQLite WAL 支持单 project 多 run 并发
   - CredentialStore 串行 modifyLock 防 OAuth 双刷

**Phase 4 验收标准**：

- `POST /runs` 启动 → `GET /runs/:id/stream` 收到 SSE 事件流 → run 完成 → 返回 `TournamentResult`
- `POST /runs/:id/stop` 能终止 run，SSE 流发 error 后关闭
- 断线重连：刷新页面后 `GET /runs/:id/stream?startIndex=-50` 续传
- 至少 1 个 run 端到端跑通（seed → 候选假设 → eval → critique → MHD cfg）

---

### Phase 5: 集成测试（已完成，2026-07-22）

3 轮 tournament evolution 端到端跑通（seed → MHD cfg + 观测建议书）。人机协同审批 / steering 注入 / 断线重连 / 并发测试待后续迭代。

---

### Web 层（已完成，见上 Phase 6）

**选型已定并落地**（`docs/web/` 6 文件 + `apps/web/`）：

- Next.js 16 (Turbopack) + React 19 + TypeScript 6 + Tailwind v4
- assistant-ui 0.14.27（ExternalStoreRuntime 模式）+ ThreadPrimitive 自建 Thread
- Radix Primitives + shadcn/ui + Motion 12（主力动画）
- react-force-graph-3d（3D 图谱）+ d3-hierarchy（演化树）+ React Flow v12（协作大厅）
- Zustand 5 + TanStack Query 5
- xAI 设计语言（DESIGN.md）：近黑画布 + 胶囊按钮 + Geist Mono + 无阴影 + display 字号阶梯

**已实现**：8 端点组 REST 客户端（无 mock）+ useRunStream SSE hook（tail-relative 重连）+ assistant-ui Thread + 4 可视化组件（3D 概念图谱/协作大厅/演化树/辩论剧场）+ 项目/凭证/设置/LLM 测试管理页 + xAI 风格美化。Electron 适配文档完成。

---

## 关键约束（贯穿所有 Phase）

- **ToolLoopAgent 两文件边界**：`agent.ts`（构造工厂，拉 Node 模块链，`new ToolLoopAgent`）+ `workflow.ts`（plain async 函数，`await agent.stream({messages})` + `streamAgentOutput` + `return result.output`）。无 VM sandbox，`await import()` 随便用。
- **源码内部 import 用 `.ts` 后缀**（不是 `.js`）：tsx + Node type stripping 默认开启但不做 `.js`→`.ts` fallback。tsconfig 开 `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`。
- **context 必须可序列化**：runtimeContext 不能放 functions/class instances/symbols/SDK clients，只能 plain data。`ModelArg` 是跨 workflow 边界传 model 配置的载体。
- **`@hono/node-server` + tsx**：dev 用 `tsx watch src/server.ts`（on-the-fly type stripping + watch），生产用 `tsc` → `node dist/server.js`，无 build-time bundle。
- **bash-tool 无沙箱**：host child_process，靠 project name 隔离 working dir（用户明确决定不加 Docker）
- **模型配置全走 Web API + 文件**：不用 .env 存模型配置（settings.json + CredentialStore）
- **MCP server 是远程代码执行**：per-project 加载需信任（`mcp_trust` 表 + `fingerprintTools` 漂移检测）
- **不要用 ESLint/Prettier**（用 Biome）/ **不要用 Bun**（用 Node.js + pnpm）/ **不要给 Explore 的 Python 加 Docker 沙箱**

---

## 环境信息

- **Node.js** v26.5.0（`.node-version` 文件，fnm 自动切换；`eval "$(fnm env --shell zsh)" && fnm use`）
- **pnpm** 11.x（`node-linker=hoisted`，`allowBuilds` for better-sqlite3 + esbuild）
- **HelixDB** v3.0.8 CLI（`helix init local --path . --no-skills --quiet` + `helix start`，localhost:6969，dev instance in-memory；Docker `ghcr.io/helixdb/enterprise-dev` 也可用；`helix.toml` gitignored）
- **Python** v3.9.6 系统 + `data/dataset/.venv`（numpy 2.5.1 + scipy 1.18.0）
- **LLM 测试端点**：内部端点 + key（已脱敏） + 模型 `llab/Qwen3-Next-80B-A3B-Instruct`
- **服务重启**：`pkill -f 'tsx.*server'; nohup pnpm dev > /tmp/opencode-api.log 2>&1 &`
