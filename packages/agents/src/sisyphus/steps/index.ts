// 'use step' retryable steps for the Sisyphus tournament workflow.
//
// Sisyphus is the orchestrator — most of its logic is deterministic control flow
// inside `tournamentWorkflow` (direct-await composition with the 5 sub-agents).
// The steps below are the retryable boundaries that MUST be 'use step':
//
//   - spawnExploreEvalStep: wraps `start(exploreWorkflow, [args])` so each
//     parallel Explore evaluation gets its own runId + event log + retry boundary
//     (background spawn, per Workflow Composition §4.2).
//   - waitForRunStep: polls a background-spawned Run's returnValue until the
//     child workflow completes; resilient to transient run-store hiccups.
//   - snapshotStep: writes `data/projects/<projectId>/rounds/<round>/snapshot.json`
//     after each tournament round so the API layer + UI can render progress.
//
// NOTE: `start()` from `workflow/api` MUST be called from inside a 'use step'
// function — the workflow runtime requires it for durable spawn semantics.
// `getRun()` is also safe to call from a 'use step' (it just constructs a Run
// handle; the polling happens via `await run.returnValue`).

import { getRoundsDir } from '@open-scientist/config'
import type { EvalResult } from '@open-scientist/schema'
import { type Run, start } from 'workflow/api'
import type { ExploreWorkflowInput } from '../../explore/workflow.js'
import { exploreWorkflow } from '../../explore/workflow.js'

/** Args for spawning one parallel Explore evaluation (background spawn). */
export interface SpawnExploreEvalArgs extends ExploreWorkflowInput {}

/**
 * Spawn one Explore workflow in the background and return its Run handle.
 *
 * MUST be a 'use step' — `start()` requires a step boundary so the workflow
 * runtime can durably record the spawn (independent runId + retry boundary).
 * The parent workflow does NOT block here; it awaits `run.returnValue` later
 * (inside `waitForRunStep`) to collect the EvalResult.
 *
 * Returns the Run handle (typed with EvalResult as the workflow's return type).
 */
export async function spawnExploreEvalStep(args: SpawnExploreEvalArgs): Promise<Run<EvalResult>> {
  'use step'
  return await start(exploreWorkflow, [args])
}

/**
 * Wait for a background-spawned workflow Run to complete and return its value.
 *
 * `run.returnValue` is a getter that polls the workflow run store until the run
 * finishes (status === 'completed') and then resolves with the typed return
 * value. Wrapped in 'use step' so transient polling failures get durable retry.
 *
 * Type parameter T lets callers pass the expected return type — e.g.
 * `await waitForRunStep<EvalResult>(run)`.
 */
export async function waitForRunStep<T>(run: Run<T>): Promise<T> {
  'use step'
  return await run.returnValue
}

/** Shape of one tournament round snapshot (persisted for the API / UI layer). */
export interface RoundSnapshot {
  round: number
  runId: string
  projectId: string
  bestF1: number
  leadingHypoId: string | null
  survivingCount: number
  hypotheses: Array<{
    id: string
    statement: string
    f1: number | null
    status: string
    parentId: string | null
    round: number
  }>
  convergenceHistory: Array<{ round: number; bestF1: number; count: number }>
  /** ISO 8601 timestamp when the snapshot was written. */
  capturedAt: string
}

/**
 * Persist a per-round snapshot to `data/projects/<projectId>/rounds/<round>/snapshot.json`.
 *
 * Wrapped in 'use step' so fs failures (mkdir race, EACCES, ENOSPC) get durable
 * retry separate from the agent loop. Imports `node:fs/promises` lazily inside
 * the step so the module remains importable from non-workflow contexts (tests).
 */
export async function snapshotStep(snapshot: RoundSnapshot): Promise<{ path: string }> {
  'use step'
  const { mkdir, writeFile } = await import('node:fs/promises')
  const dir = getRoundsDir(snapshot.projectId, snapshot.round)
  await mkdir(dir, { recursive: true })
  const path = `${dir}/snapshot.json`
  await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf-8')
  return { path }
}
