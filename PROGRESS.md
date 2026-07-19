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

---

## 当前状态（2026-07-19）

### 代码
- **10 包**：apps/api + packages/{schema,config,storage,helix,logger,tools,skills,mcp,agents}
- **341 tests pass**（28 files，~2.6s/run，无 flaky）
- **typecheck** 10 包全 Done
- **lint** 152 files clean
- **10 commits**（见上）

### 已验证
- HelixDB 本地启动（Docker `ghcr.io/helixdb/enterprise-dev`，localhost:6969）+ 10 个集成测试通过
- Python venv（`uv venv /tmp/solar-test`，astropy 8.0.1/sunpy 8.0.0/scipy 1.18.0/numpy 2.5.1）+ FITS 创建读回
- API 端到端：health/settings/credentials/test-llm 全 200（LLM 用 `http://<internal-llm-host>:8084/v1` + `llab/Qwen3-Next-80B-A3B-Instruct`，500ms 响应）
- `@ai-sdk/openai` 用 `openai.chat(model)` 而非 `openai(model)`（第三方网关只完整支持 Chat Completions API）

### 技术栈定型
- Node.js + pnpm（不用 Bun）+ TypeScript 7 + Biome 2.5 + Zod 4
- Hono + Nitro（`modules: ['workflow/nitro']`）+ AI SDK 7（`ai` + `@ai-sdk/workflow` + `workflow` DevKit）
- 全 6 agent 用 WorkflowAgent（durable 版 ToolLoopAgent，三文件边界）
- Drizzle ORM + better-sqlite3（双 SQLite）+ HelixDB（本地 Docker，graph+vector 一体）
- bash-tool（host child_process，无沙箱，靠 project name 隔离 working dir）
- `@ai-sdk/mcp`（正式包，HTTP transport 为主）+ Skills 自实现（agentskills.io 开放格式）

---

## 后续 Phase 计划

### Phase 4: API 层（当前，SPEC §7）

**目标**：实现 Tournament run 的完整 API 端点——启动 run + SSE 流 + 人机协同审批 + steering 注入 + stop。

**待实现端点**（已有：health/settings/credentials/projects/test-llm）：

| 优先级 | Method | Path | 功能 | 依赖 |
|---|---|---|---|---|
| P0 | POST | `/projects/:name/runs` | 启动 Tournament run（seed hypothesis） | `tournamentWorkflow` + `start()` + run repo |
| P0 | GET | `/projects/:name/runs/:runId/stream` | SSE 流（workflow 事件 + tool-approval-request） | `Run.readable` + `createUIMessageStreamResponse` |
| P0 | GET | `/projects/:name/runs/:runId` | 获取 run 状态 | run repo |
| P0 | POST | `/projects/:name/runs/:runId/stop` | 终止 run | `Run.cancel()` |
| P1 | POST | `/projects/:name/runs/:runId/approve` | 提交人机协同审批 | `needsApproval` tool + workflow resume |
| P1 | POST | `/projects/:name/runs/:runId/steer` | 注入 steering/follow-up 消息 | message queue + turn boundary |
| P2 | GET | `/projects/:name/runs/:runId/hypotheses` | 列出假设池 | hypothesis repo |
| P2 | GET | `/projects/:name/hypotheses/:hypoId` | 获取假设详情 | hypothesis repo |
| P2 | GET | `/projects/:name/hypotheses/:hypoId/evidence` | 获取证据 | evidence repo |
| P2 | GET | `/projects/:name/runs/:runId/rounds/:n` | 获取某轮快照 | FS `rounds/<n>/snapshot.json` |
| P2 | GET | `/projects/:name/runs/:runId/mhd` | 下载 MHD cfg | FS `mhd/<runId>.cfg` |
| P2 | GET | `/projects/:name/runs` | 列出 runs | run repo |
| P3 | POST | `/credentials/:id/refresh` | 手动触发 OAuth refresh | CredentialStore |
| P3 | PUT | `/projects/:name/mcp/config` | 更新 MCP server 配置 | mcp registry |
| P3 | GET/POST | `/projects/:name/mcp/trust` | MCP server trust 管理 | mcp trust repo |
| P3 | PUT | `/projects/:name/skills` | 上传/更新 project 级 skills | FS skills/ |

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

### Phase 5: 集成测试（SPEC §10.5）

**目标**：端到端跑通 Tournament Evolution + 人机协同节点测试。

**待做**：
1. 端到端跑通 Tournament Evolution（seed → MHD cfg），需真实 LLM + HelixDB + Python venv
2. 人机协同节点测试（approve / 几小时后 resume）
3. 断线重连测试（SSE 流中断后续传）
4. Steering 注入测试（round boundary 检查 + 注入）
5. 并发测试（多 run 同时跑 + MAX_CONCURRENT_RUNS 限制）
6. 性能测试（单 run 耗时 / LLM token 消耗 / HelixDB 查询延迟）

---

### Web 层（后期，SPEC 见 `docs/web/`）

**目标**：三个 WOW 效果（3D 概念图谱 / 辩论剧场 / 演化树）+ assistant-ui chat + WorkflowChatTransport 断线重连。

**选型已定**（`docs/web/` 6 文件 1418 行）：
- Next.js 15 + React 19 + assistant-ui + WorkflowChatTransport
- Radix Primitives + shadcn/ui + React Bits（三层互补）
- Motion（主力动画）+ GSAP（辅助剧本式动画）
- react-force-graph-3d（3D 图谱）+ d3-hierarchy（演化树）+ React Flow（协作大厅）
- Zustand + TanStack Query + Tailwind v4

**当前阶段先忽略**，Phase 4 + 5 完成后再启动。

---

## 关键约束（贯穿所有 Phase）

- **WorkflowAgent 三文件边界**：agent.ts（构造）/ workflow.ts（`'use workflow'`）/ steps/（`'use step'` 可重试）
- **context 必须可序列化**：runtimeContext / toolsContext 不能放 functions/class instances/symbols/SDK clients，只能 plain data
- **Nitro build**：`apps/api/nitro.config.ts` 配 `modules: ['workflow/nitro']`，非 Hono 自带 build
- **bash-tool 无沙箱**：host child_process，靠 project name 隔离 working dir（用户明确决定不加 Docker）
- **模型配置全走 Web API + SQLite**：不用 .env 存模型配置
- **MCP server 是远程代码执行**：per-project 加载需信任（`mcp_trust` 表 + `fingerprintTools` 漂移检测）
- **不要用 ESLint/Prettier**（用 Biome）/ **不要用 Bun**（用 Node.js + pnpm）/ **不要给 Explore 的 Python 加 Docker 沙箱**
- **Web/TUI 当前阶段先忽略**

---

## 环境信息

- **Node.js** v26.5.0
- **pnpm** 11.x（`node-linker=hoisted`，`allowBuilds` for better-sqlite3 + esbuild）
- **HelixDB** v3.0.8 CLI（Docker `ghcr.io/helixdb/enterprise-dev`，localhost:6969，项目目录 `/tmp/helix-test`）
- **Python** v3.9.6 系统 + `uv venv /tmp/solar-test`（astropy 8.0.1/sunpy 8.0.0/scipy 1.18.0/numpy 2.5.1）
- **LLM 测试端点**：`http://<internal-llm-host>:8084/v1` + key `sk-<redacted>` + 模型 `llab/Qwen3-Next-80B-A3B-Instruct`
