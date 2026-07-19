'use workflow'

import type { OracleOutput } from '@open-scientist/schema'
import { type RunOracleStepInput, runOracleStep } from './steps/index.ts'

export interface OracleWorkflowInput extends RunOracleStepInput {}

/**
 * Oracle workflow: Co-Scientist critique + AlphaEvolve mutation over a round's
 * evaluated hypotheses.
 *
 * Consumes the round's hypotheses (with their F1 scores) and Explore's
 * EvalResults (with counterexamples), then runs the Oracle agent to produce
 * critiques, mutations, eliminations, and (optionally) a winner if the
 * tournament has converged this round.
 *
 * The workflow body is a thin VM-safe wrapper — all agent construction +
 * `agent.stream()` happens inside `runOracleStep` (a `'use step'` function
 * that executes on the host Node runtime, not the VM sandbox). This is
 * required because:
 *   - The VM (`@workflow/core`) provides no `importModuleDynamically` callback,
 *     so any `await import()` inside the workflow body throws
 *     `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
 *   - `createOracleAgent` statically imports tools/skills/config →
 *     node:fs/node:path, which cannot live in the esbuild workflow bundle.
 *   - `'use step'` functions run on the host runtime, where dynamic imports
 *     and Node modules work normally. The step variant of `getWritable()`
 *     (from `workflow`) writes agent stream events to the workflow run server
 *     stream, readable via the API SSE endpoint exactly as before.
 *
 * runtimeContext carries only serializable identifiers (projectId / runId /
 * round); no HelixDB clients or DB handles cross the boundary.
 */
export async function oracleWorkflow(input: OracleWorkflowInput): Promise<OracleOutput> {
  return await runOracleStep(input)
}
