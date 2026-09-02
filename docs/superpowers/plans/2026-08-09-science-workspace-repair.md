# Science workspace repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the solar-physics workspace into a usable analysis surface: a user can enter an active-region phenomenon, start a bounded run, understand the current stage, inspect evidence and tasks, and see how the graph routes the next round without mistaking demo data for a scientific result.

**Architecture:** Keep the existing API and LangGraph event contract unchanged. Add a small pure presentation model over `ScientificOrchestrationState`, then use it in the workbench and orchestration views. The project page owns live State and keeps the run console secondary; child views only render or select that State.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Motion, Lucide, Vitest, Playwright.

---

### Task 1: Establish a tested state-to-view model

**Files:**
- Create: `apps/web/src/lib/workbench/orchestration-view-model.ts`
- Create: `apps/web/test/orchestration-view-model.test.ts`
- Modify: `apps/web/src/lib/workbench/state.ts` only if a missing display-safe type is required

- [x] Write focused tests for stage grouping, active selection, B-worker status, and D-route wording before implementation.
- [x] Run the new test and confirm it fails because the view model is absent.
- [x] Implement the pure view model with no fabricated observations, timestamps, or model reasoning.
- [x] Re-run the focused test and typecheck the web package.

### Task 2: Rebuild the scientific workbench around user decisions

**Files:**
- Modify: `apps/web/src/components/workbench/scientific-workbench.tsx`
- Modify: `apps/web/src/components/workbench/phenomenon-panel.tsx`
- Modify: `apps/web/src/components/workbench/evidence-ledger.tsx`
- Modify: `apps/web/src/components/workbench/validation-queue.tsx`
- Modify: `apps/web/src/app/globals.css`

- [x] Separate input, live progress, current conclusion, and result exploration instead of stacking six visually equal cards.
- [x] Keep natural-language phenomenon entry primary; do not require source IDs, instruments, or other technical fields at input time.
- [x] Add result tabs for hypotheses, evidence, validation tasks, and boundary/correction information so long projects remain scannable.
- [x] Use only Chinese user-facing labels and clearly label the bundled example as a demo.
- [x] Preserve the unknown/missing-data boundary in empty, pending, and conclusion states.

### Task 3: Turn the orchestration page into an interactive control room

**Files:**
- Modify: `apps/web/src/components/visualizers/scientific-orchestration.tsx`
- Modify: `apps/web/src/components/visualizers/index.ts` if its exported props change
- Modify: `apps/web/src/app/projects/[project]/page.tsx`
- Modify: `apps/web/src/app/globals.css`

- [x] Show A, B, C, and D as one connected graph, with `B.dispatch`, parallel workers, and `B.aggregate` embedded inside B.
- [x] Make graph nodes and workers selectable; expose a concise inspector based on State and route reason, not hidden chain-of-thought.
- [x] Connect worker selection to the existing run-console agent filter.
- [x] Render the route back to A/B/END visibly and distinguish waiting, running, complete, correction, and failure states.
- [x] Keep the mobile graph readable by stacking stages without horizontal page overflow.

### Task 4: Make project entry and run controls honest and low-friction

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/components/projects/project-list.tsx`
- Modify: `apps/web/src/components/chat/chat-panel.tsx`
- Modify: `apps/web/src/app/projects/[project]/page.tsx`
- Modify: `apps/web/src/app/globals.css`

- [x] Give ordinary projects an empty initial State; reserve populated scientific data for the named demo project only.
- [x] Replace artificial dashboard statistics with direct project actions and make the list the principal entry point.
- [x] Hide MCP/skill/prompt configuration behind an optional advanced section in project creation.
- [x] Rename console actions so reset, filtering, and a real analysis start are not conflated.

### Task 5: Verify and polish

**Files:**
- Modify only files above if verification identifies a localized defect.

- [x] Run the focused web tests, full project tests, typecheck/build, and `git diff --check`.
- [x] Use Playwright at desktop and mobile widths to verify home, an empty project, the demo project, all view tabs, console collapse, and no console errors.
- [x] Correct any issue found during the browser pass, then repeat the affected validation.
- [x] Update this plan’s checkboxes and report only verified results.
