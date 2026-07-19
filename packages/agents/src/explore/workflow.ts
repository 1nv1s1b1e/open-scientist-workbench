'use workflow'

import type { EvalResult } from '@open-scientist/schema'
import { type RunExploreStepInput, runExploreStep } from './steps/index.ts'

export interface ExploreWorkflowInput extends RunExploreStepInput {}

/**
 * Explore workflow: AlphaEvolve deterministic evaluation of one hypothesis.
 *
 * Spawns a fresh ExploreAgent bound to a per-hypothesis bash workspace, runs the
 * hypothesis' Python filter against the 1.75M snapshot dataset, and returns the
 * EvalResult (F1 + counterexamples). Sisyphus parallelizes this across the
 * hypothesis pool by spawning N explore workflows (each gets its own run ID +
 * retry boundary).
 *
 * The workflow body is a thin VM-safe wrapper — all agent construction +
 * `agent.stream()` happens inside `runExploreStep` (a `'use step'` function
 * that executes on the host Node runtime, not the VM sandbox). This is
 * required because:
 *   - The VM (`@workflow/core`) provides no `importModuleDynamically` callback,
 *     so any `await import()` inside the workflow body throws
 *     `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
 *   - `createExploreAgent` statically imports tools/skills/config →
 *     node:fs/node:path, which cannot live in the esbuild workflow bundle.
 *   - `'use step'` functions run on the host runtime, where dynamic imports
 *     and Node modules work normally. The step variant of `getWritable()`
 *     (from `workflow`) writes agent stream events to the workflow run server
 *     stream, readable via the API SSE endpoint exactly as before.
 *
 * runtimeContext carries only serializable identifiers; the bash workspace is
 * reconstructed inside createExploreAgent from (projectId, hypoId).
 */
export async function exploreWorkflow(input: ExploreWorkflowInput): Promise<EvalResult> {
  return await runExploreStep(input)
}
