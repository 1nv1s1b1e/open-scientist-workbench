# LangGraph Scientific Multi-Agent Framework Implementation Plan

> **Superseded:** State、Context 与长期记忆的边界已修正。后续执行以 `2026-08-08-state-context-scientific-orchestration.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 LangGraph.js 统一组织自然语言科学现象驱动的 A—B—C—D 科研闭环，提供可扩展的 B 多智能体并行协作、分层科学记忆、事实校正、SQLite 检查点和 D→A/B 反馈。

**Architecture:** 根图负责 A 假设、B 证据工作组、C 综合、D 验证计划和条件循环；B 使用 LangGraph `Send` 动态扇出已注册智能体并归并结果。Memory 分为工作、情景、语义科学、程序与数据四层；LangGraph SQLite checkpointer 保存工作记忆，项目数据库保存其余三层及数据处理/产物索引。模型客户端、密钥、回调、文件句柄、原始 FITS 和大数组不进入图状态。

**Tech Stack:** TypeScript 6, LangGraph.js, LangGraph SQLite checkpointer, Zod 4, Vite Plus, Drizzle SQLite, AI SDK SSE, Hono, Next.js.

**Workspace decision:** 当前 `ymy-branch` 含有本任务依赖的大量未提交科学闭环修改；从 HEAD 新建 worktree 会遗漏这些前置内容。因此本计划在当前非主分支内执行，逐文件限制修改范围，不提交、不覆盖无关内容。

---

### Task 1: LangGraph runtime and durable thread contract

**Files:**
- Modify: `packages/agents/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/agents/src/orchestration/langgraph-runtime.ts`
- Modify: `packages/agents/src/orchestration/index.ts`
- Test: `packages/agents/test/langgraph-runtime.test.ts`

- [ ] **Step 1: Write the failing runtime test**

```ts
const runtime = createInMemoryScientificRuntime()
const graph = new StateGraph(TestState)
  .addNode('increment', ({ count }) => ({ count: count + 1 }))
  .addEdge(START, 'increment')
  .addEdge('increment', END)
  .compile({ checkpointer: runtime.checkpointer })
await graph.invoke({ count: 0 }, runtime.config('project-a', 'run-a'))
expect((await graph.getState(runtime.config('project-a', 'run-a'))).values.count).toBe(1)
```

- [ ] **Step 2: Run RED**

Run: `corepack pnpm exec vp test run packages/agents/test/langgraph-runtime.test.ts`

Expected: FAIL because `langgraph-runtime.ts` and LangGraph dependencies do not exist.

- [ ] **Step 3: Install only the orchestration dependencies**

Run: `corepack pnpm --filter @open-scientist/agents add @langchain/langgraph @langchain/core @langchain/langgraph-checkpoint-sqlite`

- [ ] **Step 4: Implement the runtime adapter**

```ts
export interface ScientificGraphRuntime {
  checkpointer: BaseCheckpointSaver
  config(projectId: string, runId: string): RunnableConfig
}

export function scientificThreadId(projectId: string, runId: string) {
  return projectId + ':' + runId
}
```

Provide an in-memory factory for tests and a per-project `SqliteSaver` factory using `getProjectDir(projectId)/langgraph-checkpoints.sqlite`.

- [ ] **Step 5: Run GREEN**

Run: `corepack pnpm exec vp test run packages/agents/test/langgraph-runtime.test.ts`

Expected: PASS and a retrievable checkpoint for the same `thread_id`.

### Task 2: Scientific state, four-layer memory, and data-processing contracts

**Files:**
- Modify: `packages/schema/src/scientific-loop.ts`
- Create: `packages/schema/src/data-processing.ts`
- Create: `packages/agents/src/scientific-loop/graph-state.ts`
- Create: `packages/agents/src/scientific-loop/memory-policy.ts`
- Modify: `packages/storage/src/schema/project.ts`
- Modify: `packages/storage/src/repo/memory.ts`
- Create: `packages/storage/src/repo/data-processing.ts`
- Create: `packages/storage/drizzle/project/0002_scientific_memory_metadata.sql`
- Test: `packages/schema/test/scientific-loop-contract.test.ts`
- Test: `packages/agents/test/scientific-memory.test.ts`
- Test: `packages/storage/test/repo.test.ts`

- [ ] **Step 1: Write failing contract tests**

```ts
expect(EvidenceRecordSchema.safeParse({
  evidenceId: 'e-1',
  status: 'support',
  sourceIds: ['obs-1'],
  provenance: {
    dataSnapshotId: 'snapshot-1',
    artifactPath: 'runs/r1/evidence/e-1.json',
    generatedBy: 'timeseries-agent',
    deterministic: true,
  },
}).success).toBe(true)
```

Assert that corrections contain `stage`, `triggeredBy`, `action`, and affected IDs; memory contains namespace, agent ID, phenomenon ID, verification status, artifact IDs, and triggers.

- [ ] **Step 2: Implement serializable schemas**

Add `EvidenceProvenanceSchema`, `ScientificCorrectionSchema`, `AgentExecutionSchema`, and memory metadata fields. Add `DataSnapshotRefSchema`, `ProcessingRunSchema`, `ProcessingStepSchema`, and `ArtifactRefSchema`; processing records bind source IDs, checksums, parameters, tool/code versions, deterministic flag, produced artifacts, metrics artifact, limitations, and trigger. Define `ScientificGraphStateSchema` with project/run identity, phenomenon, round, max rounds, hypotheses, evidence, tasks, memory IDs, processing run IDs, agent runs, corrections, route, conclusion, and termination reason.

- [ ] **Step 3: Implement stage memory policies**

```ts
const POLICY = {
  A: { read: ['phenomenon', 'hypothesis', 'counterexample', 'lesson'], limit: 8 },
  B: { read: ['hypothesis', 'evidence', 'counterexample', 'validation-task', 'failure'], limit: 12 },
  C: { read: ['evidence', 'counterexample', 'revision'], limit: 12 },
  D: { read: ['evidence', 'counterexample', 'decision', 'failure'], limit: 12 },
} satisfies Record<ScientificStage, StageMemoryPolicy>
```

Use four layers: `working` for graph state/checkpoints, `episodic` for decisions/failures/corrections/routes, `semantic` for verified literature/hypotheses/evidence/counterexamples, and `procedural-data` for processing recipes, snapshots and artifact references. Only the orchestrator may persist memory. Agents submit proposed writes; policy filters layer/kind and the repository deduplicates by fingerprint.

- [ ] **Step 4: Persist metadata compatibly**

Add nullable/defaulted SQLite columns so existing memory rows remain readable. Add append-only processing-run and artifact records; never store raw FITS/image arrays in these tables. Update row conversion, inserts, and fingerprint deduplication.

- [ ] **Step 5: Run GREEN**

Run: `corepack pnpm exec vp test run packages/schema/test/scientific-loop-contract.test.ts packages/agents/test/scientific-memory.test.ts packages/storage/test/repo.test.ts`

### Task 3: Dynamic B evidence-agent subgraph

**Files:**
- Modify: `packages/agents/src/scientific-loop/evidence-workgroup.ts`
- Create: `packages/agents/src/scientific-loop/evidence-subgraph.ts`
- Modify: `packages/agents/src/scientific-loop/index.ts`
- Modify: `packages/agents/test/evidence-workgroup.test.ts`
- Create: `packages/agents/test/evidence-subgraph.test.ts`

- [ ] **Step 1: Write failing fan-out tests**

Register two eligible agents and one ineligible agent. Assert two eligible workers overlap in execution, the skipped worker is recorded, outputs are ordered by registration order, and one worker failure becomes a limitation instead of aborting the whole graph.

- [ ] **Step 2: Add explicit agent contracts**

```ts
interface EvidenceAgent {
  id: string
  label: string
  capabilities: EvidenceAgentCapability[]
  memoryPolicy: { readKinds: MemoryKind[]; writeKinds: MemoryKind[]; limit: number }
  canRun(context: EvidenceAgentContext): boolean | Promise<boolean>
  run(context: EvidenceAgentContext): Promise<EvidenceAgentOutput>
}
```

- [ ] **Step 3: Implement LangGraph Send fan-out**

Build `B.dispatch -> B.worker[] -> B.aggregate`. The conditional dispatcher returns one `Send('B.worker', workerState)` per eligible agent. Agent results use a `ReducedValue` concatenation reducer; aggregation sorts by registry position and emits one result per agent.

- [ ] **Step 4: Apply memory and error boundaries**

Each worker receives only memory allowed by its policy. Catch worker errors inside the worker node, emit a failed execution record, and never fabricate evidence.

- [ ] **Step 5: Run GREEN**

Run: `corepack pnpm exec vp test run packages/agents/test/evidence-workgroup.test.ts packages/agents/test/evidence-subgraph.test.ts`

### Task 4: A—B—C—D root graph and factual guards

**Files:**
- Create: `packages/agents/src/scientific-loop/services.ts`
- Create: `packages/agents/src/scientific-loop/default-services.ts`
- Create: `packages/agents/src/scientific-loop/scientific-graph.ts`
- Modify: `packages/agents/src/scientific-loop/workflow.ts`
- Modify: `packages/agents/src/scientific-loop/index.ts`
- Test: `packages/agents/test/scientific-graph.test.ts`

- [ ] **Step 1: Write failing graph tests**

Assert node order `A.generate -> A.verify -> B -> BC.verify -> C.synthesize -> C.verify -> D.plan -> D.route`, D→B data-task routing, D→A model-update routing, `maxRounds` termination, and no-progress termination.

- [ ] **Step 2: Test factual correction before implementation**

Supply a worker result marked `support` without verified provenance. Assert it is downgraded to `unknown`, a B/C correction is recorded, and C cannot produce wording equivalent to “已经证明主要机制”.

- [ ] **Step 3: Implement service injection**

Model calls, RAG, data adapters, synthesis, validation planning, memory repository, event emission, and clock live in a `ScientificGraphServices` object captured by graph construction. They never enter checkpoint state.

- [ ] **Step 4: Build the root graph**

Use LangGraph `StateGraph` and embed the B subgraph as one logical stage. `D.route` uses deterministic task types first and conditional edges to A, B, or END. Set a recursion limit derived from `maxRounds`.

- [ ] **Step 5: Migrate default behavior**

Reuse the existing Librarian in A. Until a real solar-data adapter returns a verified snapshot and artifact, default B agents produce only `unknown`, limitations, and validation tasks. Preserve existing scientific SSE events and `ScientificLoopResult`.

- [ ] **Step 6: Run GREEN**

Run: `corepack pnpm exec vp test run packages/agents/test/scientific-graph.test.ts packages/agents/test/scientific-loop-logic.test.ts`

### Task 5: SQLite checkpoint resume and API integration

**Files:**
- Modify: `packages/agents/src/scientific-loop/workflow.ts`
- Modify: `apps/api/src/lib/run-stream.ts`
- Modify: `apps/api/src/routes/runs.ts`
- Test: `packages/agents/test/scientific-checkpoint.test.ts`
- Test: `apps/api/test/runs.test.ts`

- [ ] **Step 1: Write failing resume tests**

Interrupt after A, rebuild the graph with the same project/run thread ID, invoke with `null`, and assert A is not repeated while B continues from the stored checkpoint.

- [ ] **Step 2: Implement fresh and resume execution**

Fresh runs invoke the validated initial state. Resume reads `graph.getState(config)`; an empty `next` returns the completed state, otherwise `graph.invoke(null, config)` resumes.

- [ ] **Step 3: Preserve legacy compatibility**

`/resume` checks for a LangGraph scientific thread first and keeps the existing tournament snapshot path as fallback.

- [ ] **Step 4: Run GREEN**

Run: `corepack pnpm exec vp test run packages/agents/test/scientific-checkpoint.test.ts apps/api/test/runs.test.ts`

### Task 6: SSE observability and workbench graph state

**Files:**
- Modify: `apps/web/src/lib/types/sse-events.ts`
- Modify: `apps/web/src/lib/workbench/state.ts`
- Modify: `apps/web/src/components/workbench/scientific-workbench.tsx`
- Modify: `apps/web/test/scientific-workbench-state.test.ts`

- [ ] **Step 1: Write failing reducer tests**

Feed `scientific.node-state`, `scientific.agent-state`, `scientific.route`, and `scientific.resume` events. Assert active/completed/failed nodes, worker states, round, and A/B feedback route.

- [ ] **Step 2: Emit graph and worker events**

Stream node start/end/error, worker queued/running/completed/skipped/failed, correction records, checkpoint identity, and D route without exposing model configuration or credentials.

- [ ] **Step 3: Render the architecture**

Show A/B/C/D as the main rail and B workers as a nested group. Display limitations and corrections next to the stage that produced them.

- [ ] **Step 4: Run GREEN**

Run: `corepack pnpm exec vp test run apps/web/test/scientific-workbench-state.test.ts`

### Task 7: Remove dual runtime and verify

**Files:**
- Delete: `packages/agents/src/orchestration/state-graph.ts`
- Delete: `packages/agents/test/state-graph.test.ts`
- Modify: `packages/agents/src/orchestration/index.ts`
- Modify: `README.md`

- [ ] **Step 1: Prove no production import remains**

Run: `rg -n 'orchestration/state-graph|new StateGraph' packages apps`

Expected: production `StateGraph` imports come only from `@langchain/langgraph`.

- [ ] **Step 2: Run focused verification**

Run: `corepack pnpm exec vp test run packages/agents/test/langgraph-runtime.test.ts packages/agents/test/scientific-memory.test.ts packages/agents/test/evidence-subgraph.test.ts packages/agents/test/scientific-graph.test.ts packages/agents/test/scientific-checkpoint.test.ts apps/api/test/runs.test.ts apps/web/test/scientific-workbench-state.test.ts`

- [ ] **Step 3: Run full TypeScript verification**

Run: `corepack pnpm test`

Run: `corepack pnpm typecheck`

Run: `corepack pnpm --filter @open-scientist/web build`

- [ ] **Step 4: Run required deterministic Python verification**

From `archive`, set `PYTHONPATH=src`, then run `python -m pytest -q` and `python -m jinwu run --request examples/jwfd_demo_request.json`. Report these separately from the TypeScript LangGraph result.

- [ ] **Step 5: Audit scope**

Run `git status --short`; confirm no API key, read-only downloaded dataset, unrelated user file, or legacy Jinwu runtime was modified.
