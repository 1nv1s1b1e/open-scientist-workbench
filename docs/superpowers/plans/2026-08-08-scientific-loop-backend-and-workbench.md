# Scientific Research Loop and Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Follow `superpowers:executing-plans` while implementing this plan, with tests and verification at every checkpoint.

**Goal:** 把当前 Open-Scientist 从“旧的 F1/MHD tournament 展示”扩展成真正围绕太阳物理现象运行的 A—B—C—D 科研闭环，并用一个可追踪的科学工作台展示现象、假设、证据、反例、自校正和下一步验证任务。

**Architecture:** 保留既有 JW-FD tournament 作为兼容路径；当请求包含结构化的活动区现象和多波段观测时，进入新的 scientific-loop 路径。Sisyphus 仍是确定性编排器，A/B/C/D 的每个产物都有结构化 schema、来源引用和 round 绑定；跨轮次只检索摘要化 memory，不把整段历史对话塞回模型。D 只产生验证任务，任务完成后的新证据或失败事实才能触发下一轮 B，必要时才回到 A 修订假设。

**Tech Stack:** TypeScript, Zod, Hono, Drizzle SQLite, AI SDK workflow stream, Next.js 16, React 19, `motion`, Radix UI, Tailwind v4.

---

## 1. Freeze the scientific input and output contracts

**Files:**

- Create `packages/schema/src/phenomenon.ts`
- Create `packages/schema/src/scientific-loop.ts`
- Update `packages/schema/src/index.ts`
- Update `packages/schema/src/api.ts`
- Create `packages/schema/test/scientific-loop.test.ts`

**Steps:**

1. Write failing tests for `PhenomenonInput`, `ObservationRef`, `ScientificHypothesis`, `EvidenceRecord`, `ValidationTask`, `MemoryEntry`, `ScientificRoundSnapshot`, and `ScientificLoopResult`.
2. Require every observation to carry a stable `sourceId`, `kind`, `wavelengthOrBand` when known, and a local/reference path or URI; do not invent measurement fields.
3. Require every hypothesis to include a mechanism composition, observable predictions, falsification conditions, source IDs, and uncertainty/scope.
4. Model evidence as `support`, `contradict`, or `unknown`; keep “unknown” distinct from negative evidence.
5. Model validation tasks with `route: 'B' | 'A'`, a deterministic `triggeredBy`, required data, discriminating outcomes, and task status.
6. Model memory as typed, source-bound, round-bound summaries with a stable fingerprint so failed directions can be retrieved without copying unbounded transcripts.
7. Export the schemas and extend `StartRunRequestSchema` with optional `phenomenon` and `maxRounds` while leaving `seed` compatible for old clients.
8. Run the new schema test and observe the initial failure before implementing the schemas.

## 2. Persist research memory and validation tasks

**Files:**

- Update `packages/storage/src/schema/project.ts`
- Create `packages/storage/src/repo/memory.ts`
- Create `packages/storage/src/repo/validation-task.ts`
- Update `packages/storage/src/index.ts`
- Generate the Drizzle migration under `packages/storage/drizzle/project/`
- Update `packages/storage/test/repo.test.ts`

**Steps:**

1. Write failing repository tests for inserting/listing memory by project/run/round, retrieving top-k by fingerprint/tag, deduplicating repeated tasks, and updating task status with result evidence IDs.
2. Add SQLite tables for `memory_entries` and `validation_tasks`; keep existing alignment-specific `evidence` tables intact to avoid breaking legacy runs.
3. Persist only structured summaries and source references; never persist API keys or full private prompts.
4. Generate the migration with the repository’s existing migration command, then run the repository tests and `pip`/Node-independent schema checks as applicable.

## 3. Add scientific-loop orchestration without breaking the legacy tournament

**Files:**

- Create `packages/agents/src/scientific-loop/workflow.ts`
- Create `packages/agents/src/scientific-loop/loop-logic.ts`
- Create `packages/agents/src/scientific-loop/memory.ts`
- Create `packages/agents/src/scientific-loop/self-correction.ts`
- Create `packages/agents/src/scientific-loop/synthesis.ts`
- Update `packages/agents/src/index.ts`
- Update `packages/agents/test/scientific-loop.test.ts`

**Steps:**

1. Write failing tests for routing: structured phenomenon → scientific loop; seed-only request → legacy tournament. Test `maxRounds`, task deduplication, and A/B feedback routing.
2. Implement round zero input audit: verify source references, record missing/unsupported fields, and emit an `unknown` data-quality result instead of fabricating values.
3. Implement A as RAG hypothesis generation using the existing Librarian role, augmented by top-k typed memory. Validate and repair malformed model output; never let the model change deterministic provenance.
4. Implement B as bounded parallel jobs: Looker audits/alignment, Explore performs reproducible analysis or searches existing data, and Oracle searches for counterexamples and competing explanations. Each job returns structured evidence with source IDs and limitations.
5. Implement self-correction gates: source/provenance validation before evidence is accepted, deterministic observation/data validation in B, and claim-to-evidence coverage checks before synthesis. Failed checks are recorded as memory and do not become support.
6. Implement C as a deterministic synthesis layer that separates supported, contradicted, unresolved, and data-limited claims, then asks Oracle only for structured interpretation where necessary.
7. Implement D as Prometheus-style validation-task planning. Route to B when an existing-data/analysis task can resolve the uncertainty; route to A only when the task exposes a missing mechanism or requires a revised hypothesis. Enforce `maxRounds`, `maxTasksPerRound`, task fingerprints, and no-progress termination.
8. Add a self-evolve acceptance gate: only hypothesis/analysis-plan/model-version candidates may change; evaluator, provenance, ground-truth binding, and source identifiers are immutable. Candidate changes need new evidence, held-out/control checks where applicable, and an auditable keep/reject decision.
9. Persist a round snapshot containing the phenomenon digest, hypotheses, evidence, counterexamples, revisions, validation tasks, memory references, and termination reason. Keep legacy `RoundSnapshot`/F1 behavior unchanged for old tests.

## 4. Expose the scientific loop through the API and stream

**Files:**

- Update `apps/api/src/routes/runs.ts`
- Update `apps/api/src/lib/run-stream.ts` only if the new callback payload needs a typed boundary
- Create/update API tests under `apps/api/test/`
- Update `packages/schema/src/api.ts` result types

**Steps:**

1. Write failing API tests for accepting a structured phenomenon, preserving `maxRounds`, returning a run ID, and selecting the scientific workflow without exposing credentials.
2. Parse and validate the structured request at the route boundary. Persist the input digest and route in the run record or snapshot metadata.
3. Emit custom chunks for `phenomenon`, `hypothesis`, `evidence`, `counterexample`, `self-correction`, `validation-task`, `round-summary`, and `loop-complete`; keep existing agent/phase/round-update chunks for legacy UI consumers.
4. Return structured failure messages when no model mapping, no usable data reference, or invalid source metadata prevents scientific execution.
5. Test stream replay from SQLite so a browser refresh reconstructs the workbench from persisted chunks rather than a blank page.

## 5. Rebuild the frontend as a scientific workbench

**Files:**

- Update `apps/web/src/lib/types/sse-events.ts`
- Update `apps/web/src/lib/hooks/useRunStream.ts`
- Update `apps/web/src/lib/chat/workflow-runtime.tsx`
- Create `apps/web/src/components/workbench/scientific-workbench.tsx`
- Create `apps/web/src/components/workbench/phenomenon-panel.tsx`
- Create `apps/web/src/components/workbench/evidence-ledger.tsx`
- Create `apps/web/src/components/workbench/validation-queue.tsx`
- Update `apps/web/src/app/projects/[project]/page.tsx`
- Update `apps/web/src/app/page.tsx`
- Update `apps/web/src/app/globals.css`

**Visual thesis:** 深色太阳物理观测台；背景像观测室，状态颜色只用于表达科学状态，证据链用细线和光点表达，标题和文案以中文为主。

**Content plan:** 顶部显示当前活动区现象和运行状态；主区按“现象 → 假设 → 证据/反例 → 下一任务”展示；侧栏保留对话流和模型错误；轮次轨道显示每轮为何继续或停止。

**Interaction thesis:**

1. 轮次和任务回流用 `motion` 的 layout/opacity 动画表达状态变化；
2. 点击假设打开证据抽屉，支持/反例/未知三类证据有明确颜色和来源入口；
3. 新任务进入队列或自校正失败时，用轻量状态脉冲和可展开详情提醒，而不是弹窗打断。

**Steps:**

1. Write a frontend reducer/type test for replaying custom scientific chunks into one stable workbench state.
2. Extend the SSE types and stream hook with scientific state and preserve old `round-update` handling.
3. Replace the home-page marketing Hero with a concise project/workspace entry view; keep the project list and credential/settings links.
4. Replace the project page’s first view with the scientific workbench; keep legacy visualizers behind an optional “旧版演化视图” tab so existing run data remains inspectable.
5. Use the installed `motion`, Radix primitives, and existing icons; do not add an unverified “Animation UI” dependency.
6. Show loading, empty, invalid input, no model config, backend 500, stream reconnecting, and completed/no-conclusion states in Chinese.
7. Run `pnpm --filter @open-scientist/web typecheck` and a production build before visual QA.

## 6. Verification and handoff

**Files:**

- Update `docs/` with a short Chinese implementation/status note if the API contract changes
- Keep all source URLs in `sources/research_agentic_science_loop_20260808.md`

**Steps:**

1. Run focused schema, storage, agent, API, and frontend tests after each phase.
2. Run the required repository checks: `vp lint`, `vp fmt --write` only where formatting is intended, `vp check`, `vp run -r typecheck`, and `vp test run`.
3. Run the root required checks when their environment is available: `python -m pytest -q` and `python -m jinwu run --request examples/jwfd_demo_request.json`.
4. Run one deterministic scientific-loop smoke test with fixture phenomenon data; report exact artifact paths, rounds, termination reason, and known limitations.
5. Inspect `git diff` and `git status` to ensure no read-only dataset was moved/changed and no credential entered source, logs, fixtures, or documentation.
