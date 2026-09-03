# Scroll, UI, and Scientific Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project pages scroll correctly, give the user a clear solar-physics workspace, and expose the actual A/B/C/D LangGraph orchestration in the UI.

**Architecture:** Keep the existing project route and SSE transport. Constrain the project flex layout so `.workbench-scroll` owns vertical scrolling, extend the scientific state reducer with `scientific.node-state`, `scientific.agent-state`, and `scientific.route`, and render a dedicated orchestration view from that state. Use the installed Animate UI-inspired Motion/Tailwind patterns without introducing a second component framework.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Motion, LangGraph, SSE UIMessageChunk, Vite Plus tests, Playwright.

---

### Task 1: Lock down the scientific orchestration contract

**Files:**

- Modify: `apps/web/src/lib/types/sse-events.ts`
- Modify: `apps/web/src/lib/workbench/state.ts`
- Test: `apps/web/test/scientific-workbench-state.test.ts`

- [ ] Add a failing test that replays `scientific.node-state`, `scientific.agent-state`, and `scientific.route` chunks and expects node, parallel-agent, and route state to be retained.
- [ ] Run `corepack pnpm --filter @open-scientist/web test -- apps/web/test/scientific-workbench-state.test.ts` and confirm it fails because the reducer does not expose orchestration state.
- [ ] Add typed custom-event constants and a serializable `ScientificOrchestrationState` with node states, evidence-agent states, and the latest route decision.
- [ ] Update `emptyScientificWorkbenchState` and `reduceScientificChunk` to replay those events idempotently.
- [ ] Re-run the focused test and the existing workbench-state tests.

### Task 2: Fix the project-page scroll owner

**Files:**

- Modify: `apps/web/src/app/projects/[project]/page.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] Add `min-h-0` to the project main flex child and make the workbench shell a full-height column flex container.
- [ ] Make `.workbench-scroll` the only vertical scroll owner with `flex: 1`, `min-height: 0`, and `overflow-y: auto`.
- [ ] Reproduce with Playwright at `/projects/test`, then verify `scrollTop > 0` after a wheel action and that the conclusion section is reachable.

### Task 3: Replace the legacy topology view with the real graph view

**Files:**

- Create: `apps/web/src/components/visualizers/scientific-orchestration.tsx`
- Modify: `apps/web/src/app/projects/[project]/page.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/lib/workbench/demo-data.ts`

- [ ] Render the actual route `A.generate → A.verify → B.run → BC.verify → C.synthesize → C.verify → D.plan → D.route`.
- [ ] Render B as a parallel evidence workgroup containing Looker, Explorer history, Explorer observation, Oracle counterexample, and Oracle fact-check.
- [ ] Derive node and agent status from scientific state, show the latest D route back to A or B, and label demo data explicitly.
- [ ] Add restrained Motion transitions for node activation, route changes, and the parallel B lanes.
- [ ] Replace the old six-agent debate tab with `智能体编排`; keep evidence, hypothesis, and conclusion content in the main workbench.

### Task 4: Recompose the homepage as a usable product entry

**Files:**

- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/components/projects/project-list.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] Use a full-width solar observation hero with one clear action: open the demo or create a project.
- [ ] Keep copy user-facing: phenomenon input, project workspace, recent analyses, and status; do not lead with internal agent process terms.
- [ ] Use Motion/Tailwind patterns inspired by Animate UI for the signal trace, reveal, hover, and dialog transitions without adding a competing UI library.
- [ ] Remove duplicated project entry copy and preserve the existing create/delete API behavior.

### Task 5: Verify the complete path

**Files:**

- Test artifact: `output/playwright/`

- [ ] Run `corepack pnpm --filter @open-scientist/web typecheck`.
- [ ] Run `corepack pnpm --filter @open-scientist/web build`.
- [ ] Run `corepack pnpm test`.
- [ ] Use Playwright after `networkidle` to verify `/`, `/projects/test`, view switching, scroll, console collapse, and no browser errors other than none expected.
- [ ] Run `git diff --check` and report any remaining unrelated worktree changes without resetting them.
