# State-Context Scientific Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 LangGraph.js 建立单一、可恢复、可审计的 A—B—C—D 后端智能体编排；Agent 默认无长期记忆，run-scoped State 管理闭环，按节点生成的 Context 充当 Working Memory，科研事实库保存可复现记录。

**Architecture:** LangGraph 根图是唯一流程控制器；每个 Agent 都是默认无状态的任务执行器。模型调用前，Context Projector 从当前 State、RAG 结果和科研事实库中选择最小必要输入；模型输出先进入候选区，依次通过结构、来源、数据处理溯源和事实边界校验，之后才晋升为正式假设、证据或验证任务。LangGraph SQLite checkpoint 只用于当前 run 的恢复，跨 run 的假设、证据、数据快照、处理记录和产物属于领域数据，不称为 Agent Memory。

**Tech Stack:** TypeScript 6, LangGraph.js, Zod 4, Vite Plus, Drizzle SQLite, LangGraph SQLite checkpointer, AI SDK SSE, Hono, Next.js.

**Workspace decision:** 当前 `ymy-branch` 包含本任务依赖的未提交改动，从 HEAD 创建 worktree 会遗漏这些内容。继续在当前非主分支执行，限制修改范围，不覆盖无关文件，不提交或推送。

---

## Corrected backend model

```text
Observation / Simulation input
           |
           v
  Run-scoped LangGraph State  <---- SQLite checkpoint
           |
           v
   Context Projector (per node and per task)
           |
           v
 Stateless Agent + tools + local tool loop
           |
           v
 Candidate output
           |
    schema -> provenance -> factual gate
           |
           v
 Canonical scientific records + updated graph State
```

State stores control and current scientific status: run identity, phenomenon, round, hypothesis versions, task queue, accepted evidence references, correction records, agent execution state, route and termination reason. It never stores API keys, model clients, callbacks, open files, raw FITS arrays, full prompts or private reasoning.

Context is a temporary model-visible projection. A receives the phenomenon and verified RAG excerpts; each B worker receives one task, relevant hypotheses and data references; C receives only accepted evidence, counterexamples, uncertainty and scope; D receives conclusions and unresolved gaps. Other Agent scratch work is not automatically forwarded.

The persistent scientific store contains hypotheses, evidence, counterexamples, data snapshots, processing runs, immutable artifacts and corrections. It is application data and audit history, not autonomous Agent memory. Role-specific long-term memory remains disabled until a benchmark demonstrates a measurable benefit.

## Agent and deterministic-node layout

- Intake nodes: validate the natural-language phenomenon and register supplied observation references.
- A Librarian/RAG: retrieve literature and prior verified scientific records.
- A Hypothesis Architect: generate candidate mechanism combinations with observable predictions and falsification conditions.
- A Validator: deterministic schema, citation-boundary and duplication checks.
- B Planner: convert hypotheses and unresolved evidence into typed validation tasks.
- B Looker group: source audit, data discovery, snapshot registration and observation alignment.
- B Explorer group: historical-data search, time-series/image/spectrum analysis, simulation comparison and counterexample search.
- B Oracle group: provenance review, factual criticism and evidence adjudication; it cannot change deterministic metrics.
- C Synthesizer: compare competing and coupled mechanisms using accepted evidence only.
- C Claim Gate: prevent conclusions stronger than the evidence boundary.
- D Planner: produce the next validation plan.
- D Router: deterministically route to A, B or END under `maxRounds`.

Not every box is an LLM Agent. Validation, routing, checksum verification, metric computation, deduplication and evidence promotion are deterministic nodes.

---

### Task 1: Replace Agent-memory semantics with State and Context projection

**Files:**
- Create: `packages/agents/src/scientific-loop/context-policy.ts`
- Create: `packages/agents/src/scientific-loop/context-builder.ts`
- Modify: `packages/agents/src/scientific-loop/evidence-subgraph.ts`
- Modify: `packages/agents/src/scientific-loop/index.ts`
- Deprecate: `packages/agents/src/scientific-loop/memory-policy.ts`
- Test: `packages/agents/test/scientific-context.test.ts`
- Modify: `packages/agents/test/scientific-memory.test.ts`

- [ ] **Step 1: Write the failing context-projection tests**

```ts
const context = buildAgentContext({
  agent: timeseriesAgent,
  state,
  task: state.validationTasks[0],
  records,
})
expect(context.validationTasks).toHaveLength(1)
expect(context.validationTasks[0]?.taskId).toBe('task-1')
expect(context.evidence.every((item) => item.hypothesisId === 'h-1')).toBe(true)
expect(context).not.toHaveProperty('apiKey')
```

Also assert a C context excludes unverified evidence and an A context excludes B tool logs.

- [ ] **Step 2: Run RED**

Run: `corepack pnpm exec vp test run packages/agents/test/scientific-context.test.ts`

Expected: FAIL because `context-builder.ts` does not exist.

- [ ] **Step 3: Implement typed projections**

```ts
export interface AgentContextProjection {
  phenomenon: PhenomenonInput
  hypotheses: ScientificHypothesis[]
  evidence: EvidenceRecord[]
  validationTasks: ValidationTask[]
  dataSnapshotIds: string[]
  artifactIds: string[]
  round: number
}

export function buildAgentContext(input: BuildAgentContextInput):
  AgentContextProjection
```

Policies are keyed first by capability and stage, not by mutable display name. They control read projection only; Agents do not write personal memory.

- [ ] **Step 4: Preserve compatibility without keeping the old concept**

`memory-policy.ts` re-exports deprecated aliases temporarily. Production imports switch to `context-policy.ts`; no root-graph node persists per-Agent long-term memory.

- [ ] **Step 5: Run GREEN**

Run: `corepack pnpm exec vp test run packages/agents/test/scientific-context.test.ts packages/agents/test/evidence-subgraph.test.ts`

### Task 2: Complete the A—B—C—D LangGraph root

**Files:**
- Modify: `packages/agents/src/scientific-loop/graph-state.ts`
- Create: `packages/agents/src/scientific-loop/services.ts`
- Create: `packages/agents/src/scientific-loop/evidence-promotion.ts`
- Create: `packages/agents/src/scientific-loop/scientific-graph.ts`
- Modify: `packages/agents/src/scientific-loop/index.ts`
- Test: `packages/agents/test/scientific-graph.test.ts`

- [x] **Step 1: Write the root-graph tests and run RED**

The existing test fixes node order, `maxRounds`, D→B routing and downgrade of unsupported decisive evidence. RED was observed because `scientific-graph.ts` does not exist.

- [ ] **Step 2: Keep checkpoint state serializable and run-scoped**

```ts
export const ScientificGraphStateSchema = new StateSchema({
  projectId: z.string(),
  runId: z.string(),
  phenomenon: PhenomenonInputSchema,
  round: z.number().int().min(1),
  maxRounds: z.number().int().min(1),
  hypotheses: z.array(ScientificHypothesisSchema).default([]),
  evidence: z.array(EvidenceRecordSchema).default([]),
  validationTasks: z.array(ValidationTaskSchema).default([]),
  corrections: z.array(ScientificCorrectionSchema).default([]),
  agentExecutions: z.array(AgentExecutionSchema).default([]),
  nextRoute: z.enum(['A', 'B', 'END']).default('B'),
})
```

- [ ] **Step 3: Implement candidate promotion**

```ts
export async function promoteEvidence(
  candidate: unknown,
  context: PromotionContext,
): Promise<{ evidence?: EvidenceRecord; corrections: ScientificCorrection[] }>
```

`support` and `contradict` require deterministic processing provenance. Contradictions also require sample IDs. Missing provenance downgrades to `unknown`; other invalid records are rejected with a correction.

- [ ] **Step 4: Build the root graph**

```text
START -> A.generate -> A.verify -> B.run -> BC.verify
      -> C.synthesize -> C.verify -> D.plan -> D.route
                                            |-> A.generate
                                            |-> B.run
                                            |-> END
```

The B node invokes the existing LangGraph `Send` workgroup. All callbacks, model clients and adapters are captured in `ScientificGraphDependencies`, never written to State.

- [ ] **Step 5: Run GREEN**

Run: `corepack pnpm exec vp test run packages/agents/test/scientific-graph.test.ts packages/agents/test/evidence-subgraph.test.ts packages/agents/test/scientific-loop-logic.test.ts`

### Task 3: Implement the default stateless scientific-agent registry

**Files:**
- Create: `packages/agents/src/scientific-loop/default-agents.ts`
- Create: `packages/agents/src/scientific-loop/default-services.ts`
- Modify: `packages/agents/src/scientific-loop/workflow.ts`
- Test: `packages/agents/test/default-scientific-agents.test.ts`

- [ ] **Step 1: Write failing registry tests**

Given a natural-language-only phenomenon, assert the registry schedules literature retrieval and source discovery but emits no supporting evidence. Given registered time-series observations, assert source audit and time-series tasks are eligible. Given simulation references, assert the simulation-comparison worker is eligible.

- [ ] **Step 2: Register capability-based workers**

```ts
export function createDefaultEvidenceAgents(input: WorkflowRuntimeInput):
  EvidenceAgent[] {
  return [
    createSourceAuditAgent(input),
    createHistorySearchAgent(input),
    createObservationAnalysisAgent(input),
    createCounterexampleAgent(input),
    createProvenanceReviewAgent(input),
  ]
}
```

Each Agent receives a clean projected context. If no executable adapter or artifact exists, it returns limitations and `unknown`, never a fabricated metric.

- [ ] **Step 3: Reuse existing model workflows only at valid boundaries**

Use Librarian for A RAG/hypothesis generation. Do not route the legacy JW-FD Python-filter Explore workflow into coronal-heating B tasks unless its manifest and labels match the requested analysis. Looker/Explorer/Oracle names remain UI roles while their new adapters consume typed scientific tasks.

- [ ] **Step 4: Replace the hand-written loop**

`scientificLoopWorkflow` constructs default services, creates the project LangGraph runtime, invokes the root graph and returns `ScientificLoopResult`. The old `for` loop is removed after focused tests pass.

- [ ] **Step 5: Run GREEN**

Run: `corepack pnpm exec vp test run packages/agents/test/default-scientific-agents.test.ts packages/agents/test/scientific-graph.test.ts`

### Task 4: Connect canonical records and data-processing provenance

**Files:**
- Create: `packages/storage/src/repo/scientific-record.ts`
- Modify: `packages/storage/src/repo/data-processing.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/agents/src/scientific-loop/default-services.ts`
- Test: `packages/storage/test/scientific-record.test.ts`
- Modify: `packages/storage/test/repo.test.ts`

- [x] **Step 1: Preserve data snapshots, processing runs and immutable artifacts**

The schema and SQLite repositories already store source checksums, parameters, tool versions, output artifacts and deterministic flags.

- [ ] **Step 2: Write failing promotion-persistence tests**

Assert an accepted evidence row references an existing processing run, snapshot and artifact. Assert a missing reference cannot be persisted as decisive evidence. Assert unknown evidence may be stored with explicit limitations.

- [ ] **Step 3: Implement append-only canonical records**

Only the orchestrator promotion gate writes canonical evidence and corrections. Agents return candidates. Deterministic metrics and checksums are never rewritten by model output.

- [ ] **Step 4: Remove Agent-memory writes from the hot path**

Stop calling `createMemoryEntry` for every Agent result. Keep the old table readable for migration compatibility, but do not use it as autonomous long-term memory. Cross-run reuse queries verified scientific records or RAG indexes explicitly.

- [ ] **Step 5: Run GREEN**

Run: `corepack pnpm exec vp test run packages/storage/test/scientific-record.test.ts packages/storage/test/repo.test.ts`

### Task 5: Durable resume and API lifecycle

**Files:**
- Modify: `packages/agents/src/scientific-loop/scientific-graph.ts`
- Modify: `packages/agents/src/scientific-loop/workflow.ts`
- Modify: `apps/api/src/lib/run-stream.ts`
- Modify: `apps/api/src/routes/runs.ts`
- Test: `packages/agents/test/scientific-checkpoint.test.ts`
- Test: `apps/api/test/runs.test.ts`

- [ ] **Step 1: Write failing resume tests**

Interrupt after A, rebuild with the same `projectId:runId` thread, resume with `graph.invoke(null, config)`, and assert A does not run twice.

- [ ] **Step 2: Implement fresh/resume separation**

Fresh runs pass initial State. Resume reads `graph.getState(config)`; completed threads return their stored result, pending threads invoke with `null`.

- [ ] **Step 3: Keep external configuration outside State**

Credentials, model configuration and SSE callbacks are reconstructed by the API and captured by services. Checkpoint inspection must contain no API key or base URL.

- [ ] **Step 4: Run GREEN**

Run: `corepack pnpm exec vp test run packages/agents/test/scientific-checkpoint.test.ts apps/api/test/runs.test.ts`

### Task 6: SSE observability and frontend graph projection

**Files:**
- Modify: `apps/web/src/lib/types/sse-events.ts`
- Modify: `apps/web/src/lib/workbench/state.ts`
- Modify: `apps/web/src/components/workbench/scientific-workbench.tsx`
- Test: `apps/web/test/scientific-workbench-state.test.ts`

- [ ] **Step 1: Write failing event-reducer tests**

Cover `scientific.node-state`, `scientific.agent-state`, `scientific.correction`, `scientific.route` and `scientific.resume`.

- [ ] **Step 2: Emit authoritative graph events**

Events include round, node, worker, task ID, status and correction reference. They exclude prompts, private reasoning, credentials and raw data.

- [ ] **Step 3: Render one root graph with nested B workers**

Show A/B/C/D on the main rail. B expands into currently scheduled workers. Corrections and limitations attach to the stage that produced them.

- [ ] **Step 4: Run GREEN**

Run: `corepack pnpm exec vp test run apps/web/test/scientific-workbench-state.test.ts`

### Task 7: Remove dual orchestration and verify the complete boundary

**Files:**
- Delete: `packages/agents/src/orchestration/state-graph.ts`
- Delete: `packages/agents/test/state-graph.test.ts`
- Modify: `packages/agents/src/orchestration/index.ts`
- Modify: `README.md`

- [ ] **Step 1: Prove production uses LangGraph only**

Run: `rg -n 'orchestration/state-graph|new StateGraph' packages apps`

Expected: production graph construction imports `StateGraph` only from `@langchain/langgraph`.

- [ ] **Step 2: Run focused tests**

Run: `corepack pnpm exec vp test run packages/agents/test/langgraph-runtime.test.ts packages/agents/test/scientific-context.test.ts packages/agents/test/evidence-subgraph.test.ts packages/agents/test/scientific-graph.test.ts packages/agents/test/default-scientific-agents.test.ts packages/agents/test/scientific-checkpoint.test.ts packages/storage/test/scientific-record.test.ts apps/api/test/runs.test.ts apps/web/test/scientific-workbench-state.test.ts`

- [ ] **Step 3: Run package and build verification**

Run: `corepack pnpm test`

Run: `corepack pnpm typecheck`

Run: `corepack pnpm --filter @open-scientist/web build`

- [ ] **Step 4: Run required deterministic Python checks separately**

From `archive`, set `PYTHONPATH=src`, then run `python -m pytest -q` and `python -m jinwu run --request examples/jwfd_demo_request.json`. These verify the adjacent Jinwu package, not the TypeScript LangGraph scientific loop.

- [ ] **Step 5: Audit scope and secrets**

Run `git status --short`; verify no API key, credential, downloaded read-only dataset, unrelated user file or raw FITS payload was added or modified.

---

## Acceptance criteria

- The production scientific path has one LangGraph root and no second custom orchestration runtime.
- Agents are stateless by default; no role-specific long-term memory is required for a run.
- Every model call receives a typed, bounded context projection derived from State and verified records.
- Every hypothesis has observable predictions and falsification conditions.
- Support/contradict evidence is impossible without deterministic processing provenance; counterexamples bind sample IDs.
- Model output cannot overwrite deterministic metrics, source IDs, checksums or artifact references.
- A worker failure is visible but does not erase successful parallel results.
- D routes deterministically to A, B or END and respects `maxRounds`.
- A run can resume from a SQLite checkpoint without repeating completed nodes.
- UI events expose graph progress and corrections without leaking prompts or credentials.
