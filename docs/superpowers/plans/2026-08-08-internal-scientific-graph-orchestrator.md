# Internal Scientific Graph Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Goal:** 在不接入 LangGraph 或 GPT Researcher 的前提下，在现有 TypeScript 工程中实现可测试、可恢复、可观测的 A—B—C—D 科研状态图。
> **Architecture:** 新建无外部依赖的通用 `StateGraph` 运行时，提供节点、边、条件路由、重试、最大步数、取消、事件和检查点。科学图只把自然语言现象作为入口；A/B/C/D 通过注入服务执行，SQLite 和 JSON 检查点仍是事实来源，旧 tournament 保持兼容。
> **Tech Stack:** TypeScript, Zod, Vite Plus tests, Hono, Drizzle SQLite, AI SDK SSE, Next.js.

---

### Task 1: Generic state graph runtime

**Files:**

- Create: `packages/agents/src/orchestration/state-graph.ts`
- Create: `packages/agents/src/orchestration/index.ts`
- Test: `packages/agents/test/state-graph.test.ts`
- [ ] Step 1: write tests that construct a graph with `start -> work -> route -> work|END`, assert node order, shallow state patches, and one checkpoint after every successful node.
- [ ] Step 2: run `corepack pnpm exec vp test run packages/agents/test/state-graph.test.ts`; expect module-not-found or missing-export failure.
- [ ] Step 3: implement `StateGraph<TState>` with `addNode`, `addEdge`, `addConditionalEdges`, `setEntryPoint`, and `compile().run()`; define `GRAPH_END`, `GraphEvent`, `GraphCheckpoint`, retry options, `startAt`, `maxSteps`, `AbortSignal`, `onEvent`, and `checkpoint` hooks.
- [ ] Step 4: add tests for bounded retry, abort, max-step protection, and resume from `checkpoint.nextNode` without rerunning prior nodes; run until green.

### Task 2: Scientific graph state and domain services

**Files:**

- Modify: `packages/schema/src/scientific-loop.ts`
- Create: `packages/agents/src/scientific-loop/graph-state.ts`
- Create: `packages/agents/src/scientific-loop/services.ts`
- Test: `packages/agents/test/scientific-graph.test.ts`
- [ ] Step 1: write failing schema tests for a serializable graph state and checkpoint containing phenomenon, round, hypotheses, evidence, tasks, memory IDs, corrections, current/next node, and termination reason.
- [ ] Step 2: implement schemas and service interfaces for hypothesis generation, source audit/discovery, deterministic analysis, counterexample review, synthesis, and validation planning. Default services must return `unknown` when no executable data exists.
- [ ] Step 3: verify malformed support/contradict evidence without source IDs is downgraded to `unknown` and recorded as a correction.

### Task 3: A—B—C—D graph

**Files:**

- Create: `packages/agents/src/scientific-loop/scientific-graph.ts`
- Modify: `packages/agents/src/scientific-loop/workflow.ts`
- Modify: `packages/agents/src/scientific-loop/index.ts`
- Test: `packages/agents/test/scientific-graph.test.ts`
- [ ] Step 1: write failing tests for node order `A -> A_CHECK -> B_LOOKER -> B_EXPLORE -> B_ORACLE -> B_CHECK -> C -> C_CHECK -> D`, D-to-B routing, D-to-A routing, no-progress stop, and `maxRounds` stop.
- [ ] Step 2: implement the graph with injected services; graph state is serializable and excludes model clients, secrets, and callbacks.
- [ ] Step 3: migrate the workflow body from the manual `for` loop to the compiled graph while preserving existing SSE kinds and `ScientificLoopResult`.
- [ ] Step 4: retrieve bounded prior memory before A, include only typed summaries in the A prompt, and persist hypothesis/evidence/task/decision memories by fingerprint.

### Task 4: Checkpoint and resume

**Files:**

- Create: `packages/agents/src/scientific-loop/checkpoint.ts`
- Modify: `packages/agents/src/scientific-loop/workflow.ts`
- Modify: `apps/api/src/routes/runs.ts`
- Test: `packages/agents/test/scientific-checkpoint.test.ts`
- Test: `apps/api/test/runs.test.ts`
- [ ] Step 1: write failing tests for atomic checkpoint write/read and resume from `nextNode` without rerunning completed A nodes.
- [ ] Step 2: persist `scientific-checkpoint.json` after every successful node and keep per-round `scientific-snapshot.json` at D.
- [ ] Step 3: make `/resume` prefer a scientific checkpoint when present, otherwise retain legacy `snapshot.json` behavior.

### Task 5: Frontend node observability

**Files:**

- Modify: `apps/web/src/lib/types/sse-events.ts`
- Modify: `apps/web/src/lib/workbench/state.ts`
- Modify: `apps/web/src/components/workbench/scientific-workbench.tsx`
- Test: `apps/web/test/scientific-workbench-state.test.ts`
- [ ] Step 1: write failing reducer tests for `scientific.node-state`, retries, corrections, and resume events.
- [ ] Step 2: emit graph node states through SSE and show active node, completed nodes, retry/error, round, and feedback route on the workbench.

### Task 6: Verification

- [ ] Run `corepack pnpm exec vp test run packages/agents/test/state-graph.test.ts packages/agents/test/scientific-graph.test.ts packages/agents/test/scientific-checkpoint.test.ts apps/api/test/runs.test.ts apps/web/test/scientific-workbench-state.test.ts`.
- [ ] Run `corepack pnpm test`, `corepack pnpm typecheck`, and `corepack pnpm --filter @open-scientist/web build`.
- [ ] Run the deterministic Python checks from `archive` with `PYTHONPATH=src`; record exact failures separately from the TypeScript project.
- [ ] Inspect `git status --short`; do not alter read-only datasets, credentials, or unrelated dirty files.
